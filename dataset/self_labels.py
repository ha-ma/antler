"""実写の鹿の箱の台帳（docs/specs/dataset-train R12）。

台帳（dataset/self_labels.toml）は、匿名化した後の自分の映像のフレームに付けた鹿の箱を、
track（1 頭の 1 区間のキーフレーム）と mark（empty / ignore）で書く。resolve が manifest
（dataset/private/self-footage/manifest.json）と突き合わせ、フレームごとの状態にする。

    python dataset/self_labels.py sheet --video <id> --out <png> [--crop x0 y0 x1 y1]

sheet は補間した箱を重ね描きした一覧を作る（目で確かめる道具。出力は作業用のフォルダに置き、
Git・報告・チャットに載せない）。
"""

from __future__ import annotations

import argparse
import json
import sys
import tomllib
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from itertools import pairwise
from pathlib import Path
from typing import TYPE_CHECKING, Final

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

HERE: Final = Path(__file__).resolve().parent
LEDGER: Final = HERE / "self_labels.toml"
FOOTAGE: Final = HERE / "private/self-footage"
META_KEYS: Final = ("labeler", "method", "date", "negatives_checked")
TRACK_KEYS: Final = {"video", "id", "keys", "note"}
MARK_KEYS: Final = {"video", "frames", "range", "status", "reason"}
STATUSES: Final = ("empty", "ignore")

Box = tuple[float, float, float, float]  # 画素の (x1, y1, x2, y2)


class LabelError(Exception):
    """台帳の誤り。train_l0 は素材の誤りとして止まる。"""


@dataclass(frozen=True)
class FrameLabel:
    status: str  # box / empty / ignore
    boxes: tuple[Box, ...]  # 画素（status = box のときだけ）
    reason: str  # ""・ignore・blurred


def load_ledger(path: Path) -> dict:
    try:
        data = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        msg = f"台帳を読めない: {path.name}"
        raise LabelError(msg) from exc
    if extra := set(data) - {"meta", "track", "mark"}:
        msg = f"台帳に知らない表 {sorted(extra)}"
        raise LabelError(msg)
    meta = data.get("meta")
    if not isinstance(meta, dict):
        msg = "台帳に [meta] が無い"
        raise LabelError(msg)
    for key in META_KEYS:
        if not isinstance(meta.get(key), str) or not meta[key].strip():
            msg = f"台帳の [meta] に {key} が無い"
            raise LabelError(msg)
    return data


def to_center(box: Sequence[float], size: Sequence[int]) -> tuple[float, float, float, float]:
    """画素の (x1, y1, x2, y2) → YOLO の中心基準（0〜1）。"""
    x1, y1, x2, y2 = box
    width, height = size
    return ((x1 + x2) / 2 / width, (y1 + y2) / 2 / height, (x2 - x1) / width, (y2 - y1) / height)


def _overlaps(box: Box, xywh: Sequence[float]) -> bool:
    bx, by, bw, bh = xywh
    ix = min(box[2], bx + bw) - max(box[0], bx)
    iy = min(box[3], by + bh) - max(box[1], by)
    return ix > 0 and iy > 0


class _Video:
    def __init__(self, video: str, size: Sequence[int], rows: list[dict]) -> None:
        self.video = video
        self.size = (int(size[0]), int(size[1]))
        self.rows = sorted(rows, key=lambda r: r["frame"])
        self.frames = [r["frame"] for r in self.rows]
        self.by_frame = {r["frame"]: r for r in self.rows}

    def between(self, first: int, last: int) -> list[dict]:
        return self.rows[bisect_left(self.frames, first) : bisect_right(self.frames, last)]


def _videos(manifest: Mapping) -> dict[str, _Video]:
    grouped: dict[str, list[dict]] = {}
    for row in manifest["files"]:
        grouped.setdefault(row["video"], []).append(row)
    out = {}
    for video, rows in grouped.items():
        try:
            size = manifest["clips"][video]["size"]
        except (KeyError, TypeError) as exc:
            msg = f"manifest に動画 {video!r} の size が無い"
            raise LabelError(msg) from exc
        out[video] = _Video(video, size, rows)
    return out


def _video(videos: Mapping[str, _Video], raw: Mapping, label: str) -> _Video:
    video = raw.get("video")
    if video not in videos:
        msg = f"{label}: manifest に無い動画 {video!r}"
        raise LabelError(msg)
    return videos[video]


def _track_boxes(raw: Mapping, vid: _Video, label: str) -> dict[int, Box]:
    keys = raw.get("keys")
    if not isinstance(keys, list) or not keys:
        msg = f"{label}: keys が無い"
        raise LabelError(msg)
    width, height = vid.size
    parsed: list[tuple[int, Box]] = []
    for key in keys:
        if not isinstance(key, list) or len(key) != 5:
            msg = f"{label}: キーは [frame, x1, y1, x2, y2] の 5 つ"
            raise LabelError(msg)
        frame, x1, y1, x2, y2 = key
        where = f"{label} のキー {frame}"
        if frame not in vid.by_frame:
            msg = f"{where}: manifest に無いフレーム"
            raise LabelError(msg)
        if vid.by_frame[frame]["deer"] is not True:
            msg = f"{where}: 鹿なしのフレーム"
            raise LabelError(msg)
        if parsed and frame <= parsed[-1][0]:
            msg = f"{where}: キーはフレーム番号の昇順で重複なし"
            raise LabelError(msg)
        if not x1 < x2:
            msg = f"{where}: x1 < x2 にする"
            raise LabelError(msg)
        if not y1 < y2:
            msg = f"{where}: y1 < y2 にする"
            raise LabelError(msg)
        if x1 < 0 or y1 < 0 or x2 > width or y2 > height:
            msg = f"{where}: 箱が画面（{width}×{height}）の外"
            raise LabelError(msg)
        parsed.append((frame, (float(x1), float(y1), float(x2), float(y2))))
    out: dict[int, Box] = {}
    for (f0, b0), (f1, b1) in pairwise(parsed):
        for row in vid.between(f0, f1):
            if row["deer"] is not True:
                msg = f"{label}: キー {f0}〜{f1} の間に鹿なしのフレーム {row['frame']}"
                raise LabelError(msg)
            r = (row["frame"] - f0) / (f1 - f0)
            out[row["frame"]] = tuple(a + (b - a) * r for a, b in zip(b0, b1, strict=True))  # type: ignore[assignment]
    out.setdefault(parsed[-1][0], parsed[-1][1])
    out.setdefault(parsed[0][0], parsed[0][1])
    return out


def _mark_frames(raw: Mapping, vid: _Video, label: str) -> list[int]:
    has_frames, has_range = "frames" in raw, "range" in raw
    if has_frames == has_range:
        msg = f"{label}: frames と range のどちらか 1 つを書く"
        raise LabelError(msg)
    if has_frames:
        frames = raw["frames"]
        if not isinstance(frames, list) or not frames:
            msg = f"{label}: frames はフレーム番号の列"
            raise LabelError(msg)
        for frame in frames:
            if frame not in vid.by_frame:
                msg = f"{label}: manifest に無いフレーム {frame}"
                raise LabelError(msg)
        return list(frames)
    span = raw["range"]
    if not isinstance(span, list) or len(span) != 2 or span[0] > span[1]:
        msg = f"{label}: range は [始め, 終わり]（始め ≤ 終わり）"
        raise LabelError(msg)
    rows = vid.between(span[0], span[1])
    if not rows:
        msg = f"{label}: range {span} に manifest のフレームが 1 つも無い"
        raise LabelError(msg)
    return [r["frame"] for r in rows]


def resolve(ledger: Mapping, manifest: Mapping) -> dict[tuple[str, int], FrameLabel]:
    """(動画, フレーム) → 状態。台帳が当たらないフレームは入らない（train_l0 が鹿ありを止める）。"""
    if not isinstance(ledger.get("meta"), dict):
        msg = "台帳に [meta] が無い"
        raise LabelError(msg)
    videos = _videos(manifest)
    boxes: dict[tuple[str, int], list[Box]] = {}
    seen_ids: set[tuple[str, str]] = set()
    for raw in ledger.get("track", []):
        label = f"track {raw.get('id')!r}"
        if extra := set(raw) - TRACK_KEYS:
            msg = f"{label}: 知らないキー {sorted(extra)}"
            raise LabelError(msg)
        vid = _video(videos, raw, label)
        tid = (vid.video, str(raw.get("id", "")))
        if tid in seen_ids or not tid[1]:
            msg = f"{label}: 同じ動画で id が重複（または空）"
            raise LabelError(msg)
        seen_ids.add(tid)
        for frame, box in sorted(_track_boxes(raw, vid, label).items()):
            boxes.setdefault((vid.video, frame), []).append(box)
    marks: dict[tuple[str, int], set[str]] = {}
    for no, raw in enumerate(ledger.get("mark", []), start=1):
        label = f"mark {no}（{raw.get('video')}）"
        if extra := set(raw) - MARK_KEYS:
            msg = f"{label}: 知らないキー {sorted(extra)}"
            raise LabelError(msg)
        if raw.get("status") not in STATUSES:
            msg = f"{label}: status は empty か ignore"
            raise LabelError(msg)
        if not isinstance(raw.get("reason"), str) or not raw["reason"].strip():
            msg = f"{label}: reason が無い"
            raise LabelError(msg)
        vid = _video(videos, raw, label)
        for frame in _mark_frames(raw, vid, label):
            marks.setdefault((vid.video, frame), set()).add(raw["status"])
    out: dict[tuple[str, int], FrameLabel] = {}
    for key in sorted(set(boxes) | set(marks)):
        row = videos[key[0]].by_frame[key[1]]
        blur = [b["box"] for b in row.get("blur_boxes") or []]
        status = marks.get(key, set())
        if "ignore" in status:
            out[key] = FrameLabel("ignore", (), "ignore")
        elif "empty" in status:
            if key in boxes:
                msg = f"{key[0]} のフレーム {key[1]}: empty と track が重なる"
                raise LabelError(msg)
            out[key] = FrameLabel("ignore", (), "blurred") if blur else FrameLabel("empty", (), "")
        else:
            frame_boxes = tuple(boxes[key])
            if any(_overlaps(b, xywh) for b in frame_boxes for xywh in blur):
                out[key] = FrameLabel("ignore", (), "blurred")
            else:
                out[key] = FrameLabel("box", frame_boxes, "")
    return out


# ---------------------------------------------------------------- 目で確かめる一覧（day0 の環境）


def sheet(  # pragma: no cover  day0 の環境（opencv）。確かめの道具
    footage: Path,
    ledger_path: Path,
    video: str,
    out: Path,
    crop: Sequence[int] | None = None,
    scale: float = 0.6,
    cols: int = 3,
) -> int:
    import cv2
    import numpy as np

    manifest = json.loads((footage / "manifest.json").read_text(encoding="utf-8"))
    labels = resolve(load_ledger(ledger_path), manifest)
    rows = sorted(
        (r for r in manifest["files"] if r["video"] == video and (video, r["frame"]) in labels),
        key=lambda r: r["frame"],
    )
    lut = np.array([min(255, int(255 * (i / 255) ** 0.45)) for i in range(256)], np.uint8)
    colors = {"box": (0, 255, 0), "empty": (255, 255, 0), "ignore": (0, 0, 255)}
    tiles = []
    for row in rows:
        lab = labels[(video, row["frame"])]
        image = cv2.LUT(cv2.imread(str(footage / row["image"])), lut)
        for x1, y1, x2, y2 in lab.boxes:
            cv2.rectangle(image, (int(x1), int(y1)), (int(x2), int(y2)), (0, 255, 0), 2)
        x0, y0, x3, y3 = crop or (0, 0, image.shape[1], image.shape[0])
        tile = cv2.resize(image[y0:y3, x0:x3], None, fx=scale, fy=scale)
        text = f"f{row['frame']} {lab.status} {lab.reason}"
        cv2.putText(tile, text, (6, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, colors[lab.status], 2)
        tiles.append(tile)
    if not tiles:
        return 0
    while len(tiles) % cols:
        tiles.append(np.zeros_like(tiles[0]))
    grid = np.vstack([np.hstack(tiles[i : i + cols]) for i in range(0, len(tiles), cols)])
    cv2.imwrite(str(out), grid)
    return len(rows)


def main(argv: Sequence[str] | None = None) -> int:  # pragma: no cover  道具の入口
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("sheet")
    s.add_argument("--footage", type=Path, default=FOOTAGE)
    s.add_argument("--labels", type=Path, default=LEDGER)
    s.add_argument("--video", required=True)
    s.add_argument("--out", type=Path, required=True)
    s.add_argument("--crop", type=int, nargs=4)
    s.add_argument("--scale", type=float, default=0.6)
    args = parser.parse_args(argv)
    try:
        n = sheet(args.footage, args.labels, args.video, args.out, args.crop, args.scale)
    except LabelError as exc:
        sys.stderr.write(f"エラー: {exc}\n")
        return 2
    sys.stdout.write(f"{n} 枚 → {args.out}\n")
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
