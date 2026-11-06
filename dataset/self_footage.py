"""自分で撮った映像の受け取り（docs/specs/dataset-footage）。

元の映像（dataset/raw/self/<clip>/）→ SHA-256 の照合 → 焼き込みの塗りつぶしと人・車のモザイク →
間引いた JPEG のフレーム → manifest.json（走行単位の分割・区間・用途）。
クリップ・走行・カメラは self_footage.toml に書き、2 回目は行を足して同じコマンドを回す。
映像の読み出し・検出器・JPEG の書き込みは extra `day0` の環境（opencv・ultralytics）だけにあり、
差し替えられる薄い関数に閉じ込める（テストは偽物を渡す）。

    python -I dataset/self_footage.py ingest --raw <dataset/raw/self の絶対パス> \
        --out <dataset/private/self-footage の絶対パス> --weights <yolo26n.pt の絶対パス>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import sys
import tomllib
from dataclasses import dataclass, field
from datetime import date, timedelta
from itertools import pairwise
from pathlib import Path
from typing import TYPE_CHECKING, Final, Protocol

import numpy as np

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Iterator, Mapping, Sequence

HERE: Final = Path(__file__).resolve().parent
REPO: Final = HERE.parent
CONFIG: Final = HERE / "self_footage.toml"
WEIGHTS: Final = REPO / "edge/detector/models/yolo26n.pt"

# 書式は fullmatch で使う（$ は末尾の改行を許すため）
CLIP_ID: Final = re.compile(r"(\d{4})(\d{2})(\d{2})_([a-z0-9][a-z0-9-]*)")
# 時・分・秒の形（Git に入る一覧に残さない）: 4 桁以上の数字か、区切りのある 2 桁 × 2〜3
TIME_LIKE: Final = re.compile(r"\d{4,}|\d{1,2}[-_:.h]\d{2}(?:[-_:.m]\d{2})?")
DRIVE_ID: Final = re.compile(r"(\d{4})-(\d{2})-(\d{2})(?:-[a-z0-9]+)?")
CAMERA_ID: Final = re.compile(r"[a-z0-9][a-z0-9-]*")
SHA256: Final = re.compile(r"[0-9a-f]{64}")
OUT_PLACE: Final = ("dataset", "private", "self-footage")
RAW_PLACE: Final = ("dataset", "raw", "self")
SPLITS: Final = ("train", "val", "test")
CAMERA_KINDS: Final = ("dashcam", "phone", "vehicle")
FACINGS: Final = ("front",)  # ch5: 車内を写す映像は保存しない。前向き以外は受けない
TIMES: Final = ("day", "dusk", "night")
AREAS: Final = ("道東", "道北", "道央", "道南")  # 約 10 km 単位より粗い地域名だけ
DEFAULTS: Final = {"deer_every_s": 0.2, "no_deer_every_s": 1.0, "margin_s": 5.0}

# R4 顔・ナンバー: COCO のクラスとぼかす範囲（full = 箱の全体、lower = 下半分）
BLUR_CLASSES: Final = {
    "person": "full",
    "car": "lower",
    "motorcycle": "lower",
    "bus": "lower",
    "truck": "lower",
}
BLUR_CONF: Final = 0.15
BLUR_IMGSZ: Final = 1280  # 1920 幅の遠くの顔・ナンバーを 640 に縮めて見落とさないように
BLUR_GROW: Final = 0.10
BLOCK_MIN: Final = 12
COCO_YOLO26N: Final = "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"

# R4 焼き込みの残り: 明るい縁が 1 秒おきのフレームの半分以上で同じ画素に続けば「動かない文字」。
# 明るさは色の最大値で見る（平均だと黄・シアン・橙の文字が 180 に届かない）
OVERLAY_BRIGHT: Final = 180.0
OVERLAY_EDGE: Final = 60.0
OVERLAY_PERSIST: Final = 0.5
OVERLAY_MAX_RESIDUAL: Final = 50
OVERLAY_MIN_FRAMES: Final = 10
# 矩形のまわりの帯: 変わる桁（GPS の下の桁・秒）が矩形からはみ出していないか。5% 以上のフレームで
# 明るい縁になる画素が 1 つでもあればエラー（実データでは正しい矩形で 0、文字を切る矩形で 277〜871）
OVERLAY_BAND: Final = 60
OVERLAY_NEAR_FREQ: Final = 0.05
# 塗った矩形のすぐ外の 2 px は数えない（黒と明るい背景の境目そのものが縁になるため）
OVERLAY_SEAM: Final = 2
JPEG_QUALITY: Final = 95

# R5 JPEG で許すマーカー（SOS より前）。APP0（JFIF）・量子化表・フレーム・ハフマン表・
# リスタート間隔だけ。
# それ以外（APP1 = EXIF・XMP、APP2 = ICC、APP13 = IPTC、COM など）はエラー
JPEG_ALLOWED: Final = frozenset({0xE0, 0xDB, 0xC4, 0xDD} | (set(range(0xC0, 0xD0)) - {0xC8, 0xCC}))

Rect = tuple[int, int, int, int]  # x, y, w, h（px、左上基準）


class FootageError(Exception):
    """一覧・元の映像・匿名化の確かめの誤り。そのクリップの書きかけを消して止まる（exit 2）。"""


# ---------------------------------------------------------------- R1 一覧


@dataclass(frozen=True)
class Camera:
    id: str
    kind: str
    facing: str
    size: tuple[int, int]
    overlay_masks: tuple[Rect, ...]
    overlay_min_pixels: int  # 塗る前に矩形の中で見つかるはずの焼き込みの画素（陽性対照）


@dataclass(frozen=True)
class DeerSpan:
    start: float
    end: float | None


@dataclass(frozen=True)
class Clip:
    id: str
    file: str
    sha256: str
    drive: str
    camera: str
    time_of_day: str
    area: str
    deer: tuple[DeerSpan, ...]


@dataclass(frozen=True)
class Settings:
    deer_every_s: float
    no_deer_every_s: float
    margin_s: float


@dataclass(frozen=True)
class Config:
    cameras: Mapping[str, Camera]
    drives: Mapping[str, str]  # 走行 → 分割
    clips: tuple[Clip, ...]
    settings: Settings


def _fail(msg: str) -> FootageError:
    return FootageError(msg)


def _keys(table: object, allowed: set[str], required: set[str], label: str) -> dict:
    if not isinstance(table, dict):
        raise _fail(f"{label}: 表ではない")
    unknown = sorted(set(table) - allowed)
    if unknown:
        raise _fail(f"{label}: 知らないキー {unknown}")
    missing = sorted(required - set(table))
    if missing:
        raise _fail(f"{label}: キーが無い {missing}")
    return table


def _number(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise _fail(f"{label}: 数ではない（{value!r}）")
    return float(value)


def _choice(value: object, choices: Sequence[str], label: str) -> str:
    if value not in choices:
        raise _fail(f"{label}: {value!r} は {list(choices)} のどれでもない")
    return str(value)


def _camera(cid: str, table: object) -> Camera:
    label = f"camera.{cid}"
    if not CAMERA_ID.fullmatch(cid):
        raise _fail(f"{label}: id の書式が違う")
    keys = {"kind", "facing", "size", "overlay_masks", "overlay_min_pixels"}
    t = _keys(table, keys, keys, label)
    kind = _choice(t["kind"], CAMERA_KINDS, f"{label}.kind")
    facing = _choice(t["facing"], FACINGS, f"{label}.facing")
    size = t["size"]
    if (
        not isinstance(size, list)
        or len(size) != 2
        or not all(isinstance(v, int) and not isinstance(v, bool) and v > 0 for v in size)
    ):
        raise _fail(f"{label}.size: [幅, 高さ] の正の整数ではない")
    width, height = size
    masks: list[Rect] = []
    for n, rect in enumerate(t["overlay_masks"] if isinstance(t["overlay_masks"], list) else [0]):
        ok = (
            isinstance(rect, list)
            and len(rect) == 4
            and all(isinstance(v, int) and not isinstance(v, bool) for v in rect)
        )
        if not ok:
            raise _fail(f"{label}.overlay_masks[{n}]: [x, y, w, h] の整数ではない")
        x, y, w, h = rect
        if w <= 0 or h <= 0 or x < 0 or y < 0 or x + w > width or y + h > height:
            raise _fail(f"{label}.overlay_masks[{n}]: 画面の外か、幅・高さが正でない")
        masks.append((x, y, w, h))
    least = t["overlay_min_pixels"]
    if not isinstance(least, int) or isinstance(least, bool) or least < 0:
        raise _fail(f"{label}.overlay_min_pixels: 0 以上の整数ではない")
    if bool(masks) != (least > 0):
        raise _fail(f"{label}.overlay_min_pixels: 矩形があれば正、無ければ 0 にする")
    return Camera(cid, kind, facing, (width, height), tuple(masks), least)


def _span(value: object, label: str) -> DeerSpan:
    t = _keys(value, {"start", "end"}, {"start"}, label)
    start = _number(t["start"], f"{label}.start")
    end = _number(t["end"], f"{label}.end") if "end" in t else None
    if start < 0:
        raise _fail(f"{label}.start: 負の秒")
    if end is not None and end <= start:
        raise _fail(f"{label}: end が start 以下")
    return DeerSpan(start, end)


def _clip(table: object, n: int, cameras: Mapping[str, Camera], drives: Mapping[str, str]) -> Clip:
    keys = {"id", "file", "sha256", "drive", "camera", "time_of_day", "area", "deer"}
    t = _keys(table, keys, keys, f"clip[{n}]")
    cid = t["id"]
    match = CLIP_ID.fullmatch(cid) if isinstance(cid, str) else None
    if match is None:
        raise _fail(f"clip[{n}].id: {cid!r} の書式が違う（YYYYMMDD_name）")
    label = f"clip {cid}"
    if TIME_LIKE.search(match.group(4)):
        raise _fail(f"{label}.id: 日付の後ろに時刻の形（4 桁以上の数字・21-35 など）を書かない")
    name = t["file"]
    if not isinstance(name, str) or not name or "/" in name or "\\" in name or name.startswith("."):
        raise _fail(f"{label}.file: フォルダの中のファイル名ではない（{name!r}）")
    if TIME_LIKE.search(name):
        raise _fail(f"{label}.file: 日付・時刻の形を含む名前にしない（改名して置く）")
    sha = t["sha256"]
    if not isinstance(sha, str) or not SHA256.fullmatch(sha):
        raise _fail(f"{label}.sha256: 64 桁の 16 進ではない")
    drive = t["drive"]
    if drive not in drives:
        raise _fail(f"{label}.drive: 知らない走行 {drive!r}")
    clip_day = _day(match.groups()[:3], label)
    drive_day = _day(DRIVE_ID.fullmatch(drive).groups(), f"drive {drive}")  # type: ignore[union-attr]
    if clip_day not in (drive_day, drive_day + timedelta(days=1)):
        raise _fail(f"{label}: クリップの日付が走行 {drive} の日付かその翌日（0 時を跨ぐ夜）でない")
    if t["camera"] not in cameras:
        raise _fail(f"{label}.camera: 知らないカメラ {t['camera']!r}")
    time_of_day = _choice(t["time_of_day"], TIMES, f"{label}.time_of_day")
    area = _choice(t["area"], AREAS, f"{label}.area")
    if not isinstance(t["deer"], list):
        raise _fail(f"{label}.deer: 区間の配列ではない")
    spans = tuple(_span(s, f"{label}.deer[{i}]") for i, s in enumerate(t["deer"]))
    ordered = sorted(spans, key=lambda s: s.start)
    for a, b in pairwise(ordered):
        if a.end is None or a.end > b.start:
            raise _fail(f"{label}.deer: 区間が重なる")
    return Clip(cid, name, sha, drive, t["camera"], time_of_day, area, tuple(ordered))


def _day(parts: Sequence[str], label: str) -> date:
    try:
        return date(int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError as exc:
        raise _fail(f"{label}: 日付ではない") from exc


def load_config(path: Path) -> Config:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise _fail(f"{path.name}: 読めない（{exc}）") from exc
    _keys(data, {"settings", "camera", "drive", "clip"}, {"camera", "drive", "clip"}, path.name)
    raw_settings = _keys(data.get("settings", {}), set(DEFAULTS), set(), "settings")
    values = {k: _number(raw_settings.get(k, v), f"settings.{k}") for k, v in DEFAULTS.items()}
    if any(v <= 0 for v in values.values()):
        raise _fail("settings: 間隔と余白は正の数にする")
    if not isinstance(data["camera"], dict):
        raise _fail("camera: 表ではない")
    cameras = {cid: _camera(cid, t) for cid, t in data["camera"].items()}
    drives: dict[str, str] = {}
    for n, table in enumerate(data["drive"] if isinstance(data["drive"], list) else [0]):
        t = _keys(table, {"id", "split"}, {"id", "split"}, f"drive[{n}]")
        did = t["id"]
        if not isinstance(did, str) or not DRIVE_ID.fullmatch(did):
            raise _fail(f"drive[{n}].id: {did!r} の書式が違う（YYYY-MM-DD）")
        if did in drives:
            raise _fail(f"drive {did}: 重複")
        drives[did] = _choice(t["split"], SPLITS, f"drive {did}.split")
    clips = [
        _clip(t, n, cameras, drives)
        for n, t in enumerate(data["clip"] if isinstance(data["clip"], list) else [0])
    ]
    seen: set[str] = set()
    shas: dict[str, str] = {}
    for clip in clips:
        if clip.id in seen:
            raise _fail(f"clip {clip.id}: 重複")
        if clip.sha256 in shas:
            raise _fail(f"clip {clip.id}: 元の映像が {shas[clip.sha256]} と同じ（SHA-256 の重複）")
        seen.add(clip.id)
        shas[clip.sha256] = clip.id
    return Config(cameras, drives, tuple(clips), Settings(**values))


# ---------------------------------------------------------------- R2 元の映像の照合


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_source(raw: Path, clip: Clip) -> Path:
    """元の映像の実体を確かめ、SHA-256 を一覧とサイドカーの両方と照合する。読むだけ。"""
    label = f"clip {clip.id}"
    root = raw.resolve()
    folder = raw / clip.id
    path = folder / clip.file
    side = folder / f"{clip.file}.sha256"
    for node in (folder, path):
        if node.is_symlink():
            raise _fail(f"{label}: シンボリックリンクは読まない（{node.name}）")
    if not path.is_file():
        raise _fail(f"{label}: 元の映像が無い（{clip.id}/{clip.file}）")
    real = path.resolve()
    if (
        root not in real.parents
    ):  # pragma: no cover  上のリンクの検査が先に止める（念のための二重の確かめ）
        raise _fail(f"{label}: 元の映像が raw の外にある")
    if not side.is_file() or side.is_symlink():
        raise _fail(f"{label}: {clip.file}.sha256 が無い")
    lines = side.read_text(encoding="utf-8").split()
    expected = lines[0].lower() if lines else ""
    actual = sha256_file(real)
    if actual != clip.sha256:
        raise _fail(f"{label}: SHA-256 が一覧と違う（{actual[:12]}…）")
    if actual != expected:
        raise _fail(f"{label}: SHA-256 が {clip.file}.sha256 と違う")
    return real


# ---------------------------------------------------------------- R3 区間と書き出すフレーム


@dataclass(frozen=True)
class Segment:
    start: int  # フレーム（含む）
    end: int  # フレーム（含まない）
    deer: bool


def _frame_at(t: float, fps: float) -> int:
    return math.ceil(t * fps - 1e-9)


def segments(spans: Sequence[DeerSpan], fps: float, count: int, margin_s: float) -> list[Segment]:
    """鹿あり・鹿なしの区間（フレーム番号）。鹿の区間の前後 margin_s 秒はどちらにも入れない。"""
    duration = count / fps
    deer: list[tuple[int, int]] = []
    excluded: list[tuple[int, int]] = []
    for span in spans:
        if span.start >= duration:
            msg = f"鹿の区間の start {span.start} 秒が映像の長さ {duration:.1f} 秒以上"
            raise _fail(msg)
        a = _frame_at(span.start, fps)
        b = count if span.end is None else min(count, _frame_at(span.end, fps))
        deer.append((a, b))
        excluded.append((max(0, _frame_at(span.start - margin_s, fps)), a))
        excluded.append((b, min(count, _frame_at((b / fps) + margin_s, fps))))
    taken = np.zeros(count, dtype=bool)
    for a, b in deer + excluded:
        taken[a:b] = True
    out = [Segment(a, b, deer=True) for a, b in deer if b > a]
    start = None
    for i in range(count + 1):
        free = i < count and not taken[i]
        if free and start is None:
            start = i
        elif not free and start is not None:
            out.append(Segment(start, i, deer=False))
            start = None
    return sorted(out, key=lambda s: s.start)


def every(seconds: float, fps: float) -> int:
    """間隔（フレーム）。0.5 は切り上げる（Python の round の偶数丸めを使わない）。"""
    return max(1, math.floor(seconds * fps + 0.5))


def select_frames(segs: Sequence[Segment], fps: float, settings: Settings) -> list[tuple[int, int]]:
    """（フレーム番号, 区間の番号）。各区間の先頭から決まった間隔で。"""
    picked: list[tuple[int, int]] = []
    for n, seg in enumerate(segs):
        step = every(settings.deer_every_s if seg.deer else settings.no_deer_every_s, fps)
        picked.extend((i, n) for i in range(seg.start, seg.end, step))
    return sorted(picked)


# ---------------------------------------------------------------- R4 匿名化


@dataclass(frozen=True)
class Detection:
    cls: str
    conf: float
    box: tuple[float, float, float, float]  # x, y, w, h（px、左上基準）


class Detector(Protocol):
    name: str
    sha256: str

    def __call__(self, frame: np.ndarray) -> list[Detection]: ...


def fill_masks(frame: np.ndarray, masks: Iterable[Rect]) -> np.ndarray:
    out = frame.copy()
    for x, y, w, h in masks:
        out[y : y + h, x : x + w] = 0
    return out


def blur_rect(det: Detection, width: int, height: int) -> Rect | None:
    """ぼかす矩形（10% 広げ、車は下半分）。画面に切り詰める。対象外のクラスは None。"""
    mode = BLUR_CLASSES.get(det.cls)
    if mode is None or det.conf < BLUR_CONF:
        return None
    x, y, w, h = det.box
    gx, gy = w * BLUR_GROW / 2, h * BLUR_GROW / 2
    x0, y0, x1, y1 = x - gx, y - gy, x + w + gx, y + h + gy
    if mode == "lower":
        y0 = (y0 + y1) / 2
    left, top = max(0, math.floor(x0)), max(0, math.floor(y0))
    right, bottom = min(width, math.ceil(x1)), min(height, math.ceil(y1))
    if right <= left or bottom <= top:
        return None
    return (left, top, right - left, bottom - top)


def pixelate(frame: np.ndarray, rect: Rect) -> None:
    """矩形をモザイクにする（1 マス = max(12, 短辺 // 4) px の平均の色）。frame を書き換える。"""
    x, y, w, h = rect
    block = max(BLOCK_MIN, min(w, h) // 4)
    for top in range(y, y + h, block):
        for left in range(x, x + w, block):
            cell = frame[top : min(top + block, y + h), left : min(left + block, x + w)]
            cell[...] = cell.reshape(-1, cell.shape[-1]).mean(axis=0).round().astype(frame.dtype)


def anonymize(
    frame: np.ndarray, masks: Sequence[Rect], detector: Detector
) -> tuple[np.ndarray, list[tuple[str, Rect]]]:
    """焼き込みを塗りつぶし、その画像で人と車を検出してモザイクにする（クラスと矩形を返す）。"""
    out = fill_masks(frame, masks)
    height, width = out.shape[:2]
    blurred = [(d.cls, r) for d in detector(out) if (r := blur_rect(d, width, height)) is not None]
    for _, rect in blurred:
        pixelate(out, rect)
    return out, blurred


def _mask_union(shape: tuple[int, int], masks: Iterable[Rect], grow: int = 0) -> np.ndarray:
    union = np.zeros(shape, dtype=bool)
    for x, y, w, h in masks:
        union[max(0, y - grow) : y + h + grow, max(0, x - grow) : x + w + grow] = True
    return union


@dataclass
class OverlayMeter:
    """動かない明るい文字（焼き込み）の画素を数える。1 秒おきのフレームを足していく。"""

    counts: np.ndarray | None = None
    frames: int = 0

    def add(self, frame: np.ndarray) -> None:
        bright = frame.max(axis=2).astype(np.float32)  # 色の最大値（黄・橙の文字も明るい）
        gx = np.abs(np.diff(bright, axis=1, prepend=bright[:, :1]))
        gy = np.abs(np.diff(bright, axis=0, prepend=bright[:1]))
        hit = (bright > OVERLAY_BRIGHT) & ((gx + gy) > OVERLAY_EDGE)
        self.counts = hit.astype(np.int32) if self.counts is None else self.counts + hit
        self.frames += 1

    def persistent(self) -> np.ndarray:
        if self.counts is None or self.frames < OVERLAY_MIN_FRAMES:
            msg = (
                f"焼き込みの確かめに要るフレームが足りない（{self.frames} < {OVERLAY_MIN_FRAMES}）"
            )
            raise _fail(msg)
        return self.counts >= OVERLAY_PERSIST * self.frames

    def inside(self, masks: Iterable[Rect]) -> int:
        p = self.persistent()
        return int((p & _mask_union(p.shape, masks)).sum())

    def outside(self, masks: Iterable[Rect]) -> int:
        """矩形（とすぐ外の 2 px の境目）の外に続く明るい縁の画素。"""
        p = self.persistent()
        return int((p & ~_mask_union(p.shape, masks, OVERLAY_SEAM)).sum())

    def near(self, masks: Sequence[Rect]) -> int:
        """矩形のまわりの帯で、5% 以上のフレームで明るい縁になる画素（はみ出した変わる桁）。"""
        self.persistent()  # フレーム数の確かめ
        assert self.counts is not None  # noqa: S101  persistent が確かめた
        if not masks:
            return 0
        shape = self.counts.shape
        band = _mask_union(shape, masks, OVERLAY_BAND) & ~_mask_union(shape, masks, OVERLAY_SEAM)
        return int(((self.counts >= OVERLAY_NEAR_FREQ * self.frames) & band).sum())


# ---------------------------------------------------------------- R5 JPEG


def jpeg_metadata(data: bytes) -> list[str]:
    """SOS より前の、許していないマーカー（EXIF・XMP・ICC・コメントなど）。

    JPEG でない・壊れている → エラー。
    """
    if data[:2] != b"\xff\xd8":
        raise _fail("JPEG ではない")
    found: list[str] = []
    pos = 2
    while True:
        if pos + 4 > len(data) or data[pos] != 0xFF:
            raise _fail("JPEG のマーカーが壊れている")
        marker = data[pos + 1]
        if marker == 0xDA:
            return found
        if marker not in JPEG_ALLOWED:
            found.append(f"0xFF{marker:02X}")
        pos += 2 + int.from_bytes(data[pos + 2 : pos + 4], "big")


# ---------------------------------------------------------------- R6・R7 manifest と追加


class Video(Protocol):
    fps: float
    frame_count: int
    size: tuple[int, int]

    def frames(self, wanted: set[int]) -> Iterator[tuple[int, np.ndarray]]: ...


@dataclass
class Summary:
    done: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    test_deer_drives: int = 0
    lines: list[str] = field(default_factory=list)
    unlisted: list[str] = field(default_factory=list)  # 一覧から消えたが manifest に残すクリップ


def uses(deer: bool, split: str) -> list[str]:
    if deer:
        return ["label"]
    return ["synth_background", "negative"] if split == "train" else ["fp_eval"]


def fixed_part(clip: Clip, config: Config) -> dict:
    """済みのクリップで変えられないもの（変わると学習とテストの漏れになる）。

    --redo でも変えない。
    """
    return {
        "sha256": clip.sha256,
        "file": clip.file,
        "drive": clip.drive,
        "split": config.drives[clip.drive],
    }


def redo_part(clip: Clip, config: Config, detector: Detector) -> dict:
    """済みのクリップと比べる作り方の設定（違えば --redo で作り直す）。"""
    camera = config.cameras[clip.camera]
    return {
        "camera": clip.camera,
        "facing": camera.facing,
        "size": list(camera.size),
        "overlay_masks": [list(m) for m in camera.overlay_masks],
        "overlay_min_pixels": camera.overlay_min_pixels,
        "time_of_day": clip.time_of_day,
        "area": clip.area,
        "deer": [{"start": s.start, "end": s.end} for s in clip.deer],
        "settings": {
            "deer_every_s": config.settings.deer_every_s,
            "no_deer_every_s": config.settings.no_deer_every_s,
            "margin_s": config.settings.margin_s,
        },
        "detector": {
            "name": detector.name,
            "sha256": detector.sha256,
            "conf": BLUR_CONF,
            "imgsz": BLUR_IMGSZ,
            "classes": BLUR_CLASSES,
        },
        "anonymize": {  # 匿名化と確かめの定数（変えたら済みのクリップも作り直す）
            "blur_grow": BLUR_GROW,
            "block_min": BLOCK_MIN,
            "jpeg_quality": JPEG_QUALITY,
            "overlay": {
                "bright_max_channel": OVERLAY_BRIGHT,
                "edge": OVERLAY_EDGE,
                "persist": OVERLAY_PERSIST,
                "max_residual": OVERLAY_MAX_RESIDUAL,
                "band": OVERLAY_BAND,
                "near_freq": OVERLAY_NEAR_FREQ,
                "seam": OVERLAY_SEAM,
            },
        },
    }


def empty_manifest() -> dict:
    return {
        "version": 1,
        "license": "self",
        "allowed_use": ["train", "eval"],
        "distribution": "not_allowed",
        "blur_reviewed": False,
        "drives": {},
        "clips": {},
        "sources": {},
        "files": [],
    }


def load_manifest(path: Path) -> dict:
    if not path.exists():
        return empty_manifest()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _fail(f"manifest.json: 読めない（{exc}）") from exc
    if not isinstance(data, dict) or data.get("version") != 1:
        raise _fail("manifest.json: version 1 ではない")
    shapes = {"drives": dict, "clips": dict, "sources": dict, "files": list}
    for key, kind in shapes.items():
        if not isinstance(data.get(key), kind):
            raise _fail(f"manifest.json: {key} が無いか形が違う")
    for cid, clip in data["clips"].items():
        need = ("fixed", "redo", "sha256", "drive", "split", "segments")
        if not isinstance(clip, dict) or any(k not in clip for k in need):
            raise _fail(f"manifest.json: clips.{cid} の形が違う")
    if any(not isinstance(f, dict) or "video" not in f or "frame" not in f for f in data["files"]):
        raise _fail("manifest.json: files の形が違う")
    return data


def check_splits(manifest: Mapping, config: Config) -> None:
    """R7: manifest にある走行の分割は変えない。"""
    for drive, split in config.drives.items():
        old = manifest["drives"].get(drive)
        if old is not None and old != split:
            msg = (
                f"drive {drive}: 分割を {old} から {split} に変えようとしている"
                "（既に使われたかもしれない。変えるなら manifest を消して全部作り直す）"
            )
            raise _fail(msg)


def plan(
    manifest: Mapping, config: Config, out: Path, redo: set[str], detector: Detector
) -> list[Clip]:
    """処理するクリップ。済みで同じものは飛ばし、作り方が違うものは --redo が無ければエラー。"""
    unknown = sorted(redo - {c.id for c in config.clips})
    if unknown:
        raise _fail(f"--redo: 一覧に無いクリップ {unknown}")
    known_sha = {c["sha256"]: cid for cid, c in manifest["clips"].items()}
    todo: list[Clip] = []
    for clip in config.clips:
        old = manifest["clips"].get(clip.id)
        other = known_sha.get(clip.sha256)
        if other is not None and other != clip.id:
            raise _fail(f"clip {clip.id}: 元の映像が済みの {other} と同じ（SHA-256 の重複）")
        if old is None:
            if (out / "frames" / clip.id).exists():
                msg = (
                    f"clip {clip.id}: manifest に無いフレームのフォルダがある（--redo で作り直す）"
                )
                if clip.id not in redo:
                    raise _fail(msg)
            todo.append(clip)
            continue
        if old.get("fixed") != fixed_part(clip, config):
            msg = (
                f"clip {clip.id}: 済みのクリップの元の映像・走行・分割は変えられない"
                "（変えるなら manifest とフレームを消して全部作り直す）"
            )
            raise _fail(msg)
        if clip.id in redo:
            todo.append(clip)
        elif old.get("redo") != redo_part(clip, config, detector):
            msg = f"clip {clip.id}: 済みのクリップと作り方が違う（--redo {clip.id} で作り直す）"
            raise _fail(msg)
    return todo


def _write_json(path: Path, data: Mapping) -> None:
    tmp = path.with_name(f".{path.name}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def check_overlay(
    label: str, camera: Camera, before: OverlayMeter, after: OverlayMeter
) -> dict[str, int]:
    """R4 の確かめ: 塗る前に焼き込みが矩形の中で見つかり、塗った後に外とまわりに残らないこと。"""
    masks = camera.overlay_masks
    counts = {
        "inside_before": before.inside(masks),
        "outside_after": after.outside(masks),
        "near_after": after.near(masks),
    }
    if counts["inside_before"] < camera.overlay_min_pixels:
        msg = (
            f"{label}: 塗る前の矩形の中に焼き込みが見つからない（{counts['inside_before']} 画素 <"
            f" {camera.overlay_min_pixels}。矩形の位置か、焼き込みの色を確かめる）"
        )
        raise _fail(msg)
    if counts["outside_after"] > OVERLAY_MAX_RESIDUAL:
        msg = f"{label}: 塗った後も動かない明るい文字が {counts['outside_after']} 画素残る"
        raise _fail(msg)
    if counts["near_after"] > 0:
        msg = (
            f"{label}: 矩形のまわりに焼き込みらしい画素が {counts['near_after']} ある"
            "（矩形を広げる）"
        )
        raise _fail(msg)
    return counts


def process_clip(
    clip: Clip,
    config: Config,
    video: Video,
    detector: Detector,
    encode: Callable[[np.ndarray], bytes],
    tmp: Path,
) -> dict:
    """1 本のクリップのフレームを tmp に書き、manifest の clips と files の行を返す。"""
    label = f"clip {clip.id}"
    camera = config.cameras[clip.camera]
    split = config.drives[clip.drive]
    if tuple(video.size) != camera.size:
        raise _fail(f"{label}: 映像の大きさ {video.size} がカメラの {camera.size} と違う")
    fps, count = video.fps, video.frame_count
    if fps <= 0 or count <= 0:
        raise _fail(f"{label}: fps かフレーム数が読めない")
    segs = segments(clip.deer, fps, count, config.settings.margin_s)
    picked = dict(select_frames(segs, fps, config.settings))
    guard = set(range(0, count, every(1.0, fps)))
    before, after = OverlayMeter(), OverlayMeter()
    files: list[dict] = []
    blur_total = 0
    seen: set[int] = set()
    for i, frame in video.frames(set(picked) | guard):
        seen.add(i)
        if i in guard:
            before.add(frame)
            after.add(fill_masks(frame, camera.overlay_masks))
        if i not in picked:
            continue
        clean, blurred = anonymize(frame, camera.overlay_masks, detector)
        data = encode(clean)
        bad = jpeg_metadata(data)
        if bad:
            raise _fail(f"{label}: JPEG に許していないマーカーがある（{bad}）")
        name = f"{clip.id}_f{i:06d}.jpg"
        (tmp / name).write_bytes(data)
        seg = segs[picked[i]]
        blur_total += len(blurred)
        files.append(
            {
                "image": f"frames/{clip.id}/{name}",
                "label": None,
                "video": clip.id,
                "drive": clip.drive,
                "group": f"self:{clip.drive}",  # 学習と評価を分ける単位は走行（クリップではない）
                "split": split,
                "frame": i,
                "t": round(i / fps, 3),
                "deer": seg.deer,
                "uses": uses(seg.deer, split),
                "sha256": hashlib.sha256(data).hexdigest(),
                "blur_boxes": [{"cls": cls, "box": list(r)} for cls, r in blurred],
            }
        )
    missing = sorted(set(picked) - seen)
    if missing:
        raise _fail(f"{label}: 映像が途中で終わった（フレーム {missing[0]} 以降が読めない）")
    overlay = check_overlay(label, camera, before, after)
    record = {
        "fixed": fixed_part(clip, config),
        "redo": redo_part(clip, config, detector),
        "drive": clip.drive,
        "split": split,
        "camera": clip.camera,
        "time_of_day": clip.time_of_day,
        "area": clip.area,
        "sha256": clip.sha256,
        "fps": fps,
        "frame_count": count,
        "size": list(camera.size),
        "overlay_masks": [list(m) for m in camera.overlay_masks],
        "overlay_pixels": overlay,
        "blur_boxes": blur_total,
        "segments": [
            {
                "start_frame": s.start,
                "end_frame": s.end,
                "start_s": round(s.start / fps, 3),
                "end_s": round(s.end / fps, 3),
                "deer": s.deer,
            }
            for s in segs
        ],
        "every_frames": {
            "deer": every(config.settings.deer_every_s, fps),
            "no_deer": every(config.settings.no_deer_every_s, fps),
        },
        "frames": len(files),
    }
    return {"clip": record, "files": files}


def ingest(
    config: Config,
    raw: Path,
    out: Path,
    *,
    open_video: Callable[[Path], Video],
    detector: Detector,
    encode: Callable[[np.ndarray], bytes],
    redo: set[str] | None = None,
) -> Summary:
    """一覧のクリップを処理して out に書く。1 本ずつ manifest を更新する（R5〜R7）。"""
    check_locations(raw, out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "frames").mkdir(exist_ok=True)
    lock = out / ".ingest.lock"
    try:
        lock.mkdir()
    except FileExistsError as exc:
        msg = f"別の ingest が動いている（{lock.name} がある。止まったものなら手で消す）"
        raise _fail(msg) from exc
    try:
        return _ingest(config, raw, out, open_video, detector, encode, redo or set())
    finally:
        lock.rmdir()


def check_locations(raw: Path, out: Path) -> None:
    """--raw は <checkout>/dataset/raw/self、--out は <checkout>/dataset/private/self-footage だけ。

    どちらも Git の対象外。リンクを通した別名も受けない（W1・監査 W-3）。
    """
    for path, place in ((raw, RAW_PLACE), (out, OUT_PLACE)):
        absolute = path.absolute()
        if absolute.parts[-3:] != place or absolute.resolve() != absolute:
            raise _fail(f"{path}: {'/'.join(place)} のフォルダではない（リンクも受けない）")


def _ingest(
    config: Config,
    raw: Path,
    out: Path,
    open_video: Callable[[Path], Video],
    detector: Detector,
    encode: Callable[[np.ndarray], bytes],
    redo: set[str],
) -> Summary:
    manifest_path = out / "manifest.json"
    manifest = load_manifest(manifest_path)
    check_splits(manifest, config)
    todo = plan(manifest, config, out, redo, detector)
    summary = Summary(skipped=[c.id for c in config.clips if c not in todo])
    summary.unlisted = sorted(set(manifest["clips"]) - {c.id for c in config.clips})
    for leftover in (out / "frames").glob(".tmp-*"):  # 前の実行が残した一時フォルダ（W4 (c)）
        shutil.rmtree(leftover)
    for clip in todo:
        tmp = out / "frames" / f".tmp-{clip.id}"
        tmp.mkdir()
        try:
            source = verify_source(raw, clip)
            result = process_clip(clip, config, open_video(source), detector, encode, tmp)
        except BaseException:
            shutil.rmtree(tmp, ignore_errors=True)
            raise
        # 作り直し: 先に manifest から外して書く。差し替えの途中で落ちても「manifest に無い
        # フレームのフォルダ」として次の実行が止める（古い manifest の行が黙って残らない）
        if clip.id in manifest["clips"]:
            del manifest["clips"][clip.id]
            manifest["sources"].pop(clip.id, None)
            manifest["files"] = [f for f in manifest["files"] if f.get("video") != clip.id]
            _write_json(manifest_path, manifest)
        final = out / "frames" / clip.id
        if final.exists():
            shutil.rmtree(final)
        tmp.rename(final)
        manifest["files"].extend(result["files"])
        manifest["files"].sort(key=lambda f: (f["video"], f["frame"]))
        manifest["clips"][clip.id] = result["clip"]
        manifest["sources"][clip.id] = {
            "license": "self",
            "camera": clip.camera,
            "time_of_day": clip.time_of_day,
            "area": clip.area,
        }
        manifest["drives"][clip.drive] = config.drives[clip.drive]
        manifest["clips"] = dict(sorted(manifest["clips"].items()))
        manifest["sources"] = dict(sorted(manifest["sources"].items()))
        manifest["drives"] = dict(sorted(manifest["drives"].items()))
        _write_json(manifest_path, manifest)
        summary.done.append(clip.id)
        r = result["clip"]
        px = r["overlay_pixels"]
        summary.lines.append(
            f"{clip.id}: {r['frames']} 枚（{r['split']}）、焼き込み {px['inside_before']} 画素"
            f" → 外 {px['outside_after']}・まわり {px['near_after']}、ぼかし {r['blur_boxes']} 箱"
        )
    summary.test_deer_drives = len(
        {
            c["drive"]
            for c in manifest["clips"].values()
            if c["split"] == "test" and any(s["deer"] for s in c["segments"])
        }
    )
    return summary


# ---------------------------------------------------------------- day0 の環境の実物


@dataclass
class _CvVideo:  # pragma: no cover  day0 の環境（opencv）
    path: Path
    fps: float = 0.0
    frame_count: int = 0
    size: tuple[int, int] = (0, 0)

    def __post_init__(self) -> None:
        import cv2

        cap = cv2.VideoCapture(str(self.path))
        if not cap.isOpened():
            raise _fail(f"{self.path.name}: 映像を開けない")
        self.fps = float(cap.get(cv2.CAP_PROP_FPS))
        self.frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        self.size = (
            int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        )
        cap.release()

    def frames(self, wanted: set[int]) -> Iterator[tuple[int, np.ndarray]]:
        import cv2

        cap = cv2.VideoCapture(str(self.path))
        try:
            last = max(wanted, default=-1)
            for i in range(last + 1):
                if not cap.grab():
                    return
                if i in wanted:
                    ok, frame = cap.retrieve()
                    if not ok:
                        return
                    yield i, frame
        finally:
            cap.release()


def _encode_jpeg(frame: np.ndarray) -> bytes:  # pragma: no cover  day0 の環境（opencv）
    import cv2

    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    if not ok:
        raise _fail("JPEG に書けない")
    return bytes(buf)


@dataclass
class _CocoDetector:  # pragma: no cover  day0 の環境（ultralytics）
    weights: Path
    name: str = ""
    sha256: str = ""
    _model: object = None

    def __post_init__(self) -> None:
        if not self.weights.is_file():
            raise _fail(f"{self.weights.name}: 重みが無い（ダウンロードはしない。手で置く）")
        self.sha256 = sha256_file(self.weights)
        if self.sha256 != COCO_YOLO26N:
            raise _fail(f"{self.weights.name}: COCO の yolo26n.pt ではない（SHA-256 が違う）")
        # import の前に必ずオフラインにする（setdefault だと環境の 0 が残る。送信の有効は
        # import 時の ONLINE で決まる。監査 W-2）。import の後も送信を止めて確かめる
        os.environ["YOLO_OFFLINE"] = "1"
        from ultralytics import YOLO, settings
        from ultralytics.utils import events

        settings.update({"sync": False})
        events.events.enabled = False
        self._model = YOLO(str(self.weights))
        self.name = self.weights.name

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        model = self._model
        names = model.names  # type: ignore[attr-defined]
        wanted = [k for k, v in names.items() if v in BLUR_CLASSES]
        result = model.predict(  # type: ignore[attr-defined]
            frame, imgsz=BLUR_IMGSZ, conf=BLUR_CONF, classes=wanted, verbose=False, save=False
        )[0]
        dets: list[Detection] = []
        for xyxy, conf, cls in zip(
            result.boxes.xyxy.tolist(),
            result.boxes.conf.tolist(),
            result.boxes.cls.tolist(),
            strict=True,
        ):
            x0, y0, x1, y1 = xyxy
            dets.append(Detection(names[int(cls)], float(conf), (x0, y0, x1 - x0, y1 - y0)))
        return dets


# ---------------------------------------------------------------- CLI


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("ingest", help="一覧のクリップを匿名化したフレームと manifest にする")
    p.add_argument("--config", type=Path, default=CONFIG)
    p.add_argument("--raw", type=Path, default=HERE / "raw/self")
    p.add_argument("--out", type=Path, default=HERE / "private/self-footage")
    p.add_argument("--weights", type=Path, default=WEIGHTS)
    p.add_argument("--redo", action="append", default=[], metavar="CLIP")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        check_locations(args.raw, args.out)  # 検出器（重い import）より先に確かめる
        summary = ingest(  # pragma: no cover  day0 の環境
            config,
            args.raw,
            args.out,
            open_video=_CvVideo,
            detector=_CocoDetector(args.weights),
            encode=_encode_jpeg,
            redo=set(args.redo),
        )
    except FootageError as exc:
        sys.stderr.write(f"エラー: {exc}\n")
        return 2
    except ImportError as exc:  # pragma: no cover  dev だけの環境
        sys.stderr.write(f"エラー: day0 の環境（opencv・ultralytics）で回す（{exc.name}）\n")
        return 2
    report(summary, sys.stdout)  # pragma: no cover
    return 0  # pragma: no cover


def report(summary: Summary, stream: object) -> None:
    write = stream.write  # type: ignore[attr-defined]
    for line in summary.lines:
        write(f"{line}\n")
    for cid in summary.skipped:
        write(f"{cid}: 済み\n")
    for cid in summary.unlisted:
        write(f"{cid}: 一覧に無いが manifest に残す（走行の分割の固定は続く）\n")
    if summary.test_deer_drives == 0:
        write("テスト専用の鹿の走行がまだ無い（2026-11-07 の分で 1 本以上を test にする）\n")
    else:
        write(f"テスト専用の鹿の走行: {summary.test_deer_drives}\n")


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
