"""3D の鹿を自分で撮った夜の背景に合成する（docs/specs/dataset-synth）。

背景（dataset/private/self-footage/ の uses に synth_background があるフレーム）
× CC0 の 3D の鹿（dataset/external/deer3d/ の M01〜M04）
→ 計画（シード付き）→ Blender で鹿だけを描く（synth_render.py）→ 合成・採否
→ JPEG と YOLO のラベルと manifest.json（dataset/private/self-synth/<run>/）。
画像の読み書き（opencv）と Blender の子プロセスは差し替えられる薄い関数に閉じ込める
（テストは偽物を渡す）。

    python dataset/synth.py check --blender <Blender の実行ファイル>
    python dataset/synth.py run --run s1 --count 1300 --seed 7 --blender <Blender の実行ファイル>

（self_footage を import するので -I は付けない。背景・モデルはパスで渡すだけで、そのフォルダから
コードを読まない。）
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
from typing import TYPE_CHECKING, Final

import numpy as np

from self_footage import FootageError, jpeg_metadata, sha256_file

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping, Sequence

HERE: Final = Path(__file__).resolve().parent
CONFIG: Final = HERE / "synth.toml"
RENDER_SCRIPT: Final = HERE / "synth_render.py"
OUT_PLACE: Final = ("dataset", "private", "self-synth")
FOOTAGE_PLACE: Final = ("dataset", "private", "self-footage")
MODELS_PLACE: Final = ("dataset", "external", "deer3d")
RUN_RE: Final = re.compile(r"[a-z0-9][a-z0-9-]{0,31}")
MODEL_IDS: Final = ("M01", "M02", "M03", "M04")

# R4 置く前の大まかな箱（肩の高さの倍数）。向きを決める前なので、横は体長の半分より広めに取る
BOX_HALF_W: Final = 1.0
BOX_H: Final = 1.7
EDGE_MARGIN: Final = 0.02  # 画面の端からこの割合だけ内側
BATCH: Final = 50  # Blender を 1 回呼ぶごとの job の数（途中で落ちても失うのは 1 回分）
REVIEW_MAX: Final = 40
BANDS: Final = ((8.0, 20.0), (20.0, 35.0), (35.0, 50.0))
CHECK_TOL_PX: Final = 2.0
# 背景の路面の帯の明るさに合わせてヘッドライトを強める指数（Standard の表示変換 ≒ sRGB のガンマ）。
# 描いた明るさ（8 bit）は強さの 1/2.2 乗に比例するので、強さを (路面 / road_ref)^2.2 倍すると
# 鹿と路面の明るさの比が背景によらず保たれる
EXPOSURE_GAMMA: Final = 2.2
ROAD_FLOOR: Final = 2.0  # 真っ黒な路面の帯で強さが 0 にならないための下限（8 bit）
REASONS: Final = ("small", "few", "dark", "bright", "cut", "blurbox")

Rect = tuple[int, int, int, int]  # x, y, w, h（px、左上基準）


class SynthError(Exception):
    """一覧・背景・モデル・描画・置き場所の誤り。一時フォルダを消して止まる（exit 2）。"""


# ---------------------------------------------------------------- R1 一覧

# 値の種類: int+（正の整数）・pos（正の数）・nonneg・snum（符号あり）・unit（0〜1）
# jitter（0〜0.5 未満）・pct（0〜100）・quality（1〜100）・angle（0〜180 未満）・deer（1〜3 の整数）
# size（[正の整数, 正の整数]）
# range（[0 以上, 0 以上]、最小 ≤ 最大）・posrange（最小 > 0）・srange（符号あり）・clips
SCHEMA: Final[dict[str, dict[str, str]]] = {
    "render": {"samples": "int+"},
    "background": {"clips": "clips"},
    "camera": {"size": "size", "focal_px": "pos", "height_m": "pos", "pitch_deg": "srange"},
    "headlight": {
        "power_w": "range",
        "road_ref": "pos",
        "height_m": "pos",
        "spacing_m": "pos",
        "forward_m": "nonneg",
        "spot_deg": "angle",
        "blend": "unit",
        "tilt_deg": "snum",
        "ambient": "range",
    },
    "placement": {
        "distance_m": "posrange",
        "lateral_m": "srange",
        "shoulder_jitter": "jitter",
        "max_deer": "deer",
        "extra_deer_p": "unit",
        "min_gap_m": "nonneg",
        "tries": "int+",
    },
    "composite": {
        "blur_px": "range",
        "noise": "range",
        "floor_percentile": "pct",
        "jpeg_quality": "quality",
    },
    "accept": {
        "l0_size": "size",
        "min_box_h": "nonneg",
        "min_visible": "nonneg",
        "min_contrast": "nonneg",
        "max_cut": "unit",
        "max_bright_ratio": "pos",
    },
}
MODEL_REQUIRED: Final = {"id", "file", "weight", "shoulder_m", "rest_action", "actions"}
MODEL_OPTIONAL: Final = {"textures"}


@dataclass(frozen=True)
class Model:
    id: str
    file: str
    weight: float
    shoulder_m: float
    rest_action: str
    actions: tuple[str, ...]
    textures: Mapping[str, str]


@dataclass(frozen=True)
class Config:
    sections: Mapping[str, Mapping]  # SCHEMA の節 → 検証した値
    models: tuple[Model, ...]
    raw: Mapping  # manifest に写す一覧の中身

    def __getitem__(self, key: str) -> Mapping:
        return self.sections[key]


def _fail(msg: str) -> SynthError:
    return SynthError(msg)


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


def _num(value: object, label: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float) or not math.isfinite(value):
        raise _fail(f"{label}: 数ではない（{value!r}）")
    return float(value)


def _int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _fail(f"{label}: 整数ではない（{value!r}）")
    return value


def _pair(value: object, label: str) -> tuple[float, float]:
    if not isinstance(value, list) or len(value) != 2:
        raise _fail(f"{label}: [最小, 最大] ではない（{value!r}）")
    lo, hi = _num(value[0], label), _num(value[1], label)
    if lo > hi:
        raise _fail(f"{label}: 最小が最大より大きい（{value!r}）")
    return lo, hi


def _value(kind: str, value: object, label: str) -> object:
    if kind == "int+":
        n = _int(value, label)
        if n <= 0:
            raise _fail(f"{label}: 正の整数ではない（{value!r}）")
        return n
    if kind == "deer":
        n = _int(value, label)
        if not 1 <= n <= 3:
            raise _fail(f"{label}: 1〜3 ではない（{value!r}）")
        return n
    if kind == "size":
        if not isinstance(value, list) or len(value) != 2:
            raise _fail(f"{label}: [幅, 高さ] ではない（{value!r}）")
        w, h = _int(value[0], label), _int(value[1], label)
        if w <= 0 or h <= 0:
            raise _fail(f"{label}: 正でない（{value!r}）")
        return (w, h)
    if kind == "clips":
        if not isinstance(value, list) or not value or not all(isinstance(c, str) for c in value):
            raise _fail(f"{label}: クリップの id の配列（1 つ以上）ではない")
        if len(set(value)) != len(value):
            raise _fail(f"{label}: 重複がある")
        return tuple(value)
    if kind in ("range", "posrange", "srange"):
        lo, hi = _pair(value, label)
        if kind == "range" and lo < 0:
            raise _fail(f"{label}: 負の値（{value!r}）")
        if kind == "posrange" and lo <= 0:
            raise _fail(f"{label}: 正でない（{value!r}）")
        return (lo, hi)
    x = _num(value, label)
    bounds = {
        "pos": (0.0, math.inf, False),
        "nonneg": (0.0, math.inf, True),
        "snum": (-math.inf, math.inf, True),
        "unit": (0.0, 1.0, True),
        "pct": (0.0, 100.0, True),
        "quality": (1.0, 100.0, True),
    }
    if kind == "jitter":
        if not 0.0 <= x < 0.5:
            raise _fail(f"{label}: 0 以上 0.5 未満ではない（{value!r}）")
        return x
    if kind == "angle":
        if not 0.0 < x < 180.0:
            raise _fail(f"{label}: 0 より大きく 180 未満ではない（{value!r}）")
        return x
    lo, hi, closed = bounds[kind]
    if x > hi or x < lo or (not closed and x == lo):
        raise _fail(f"{label}: 範囲の外（{value!r}）")
    if kind == "quality":
        return _int(value, label)
    return x


def _model(table: object, n: int) -> Model:
    label = f"model[{n}]"
    t = _keys(table, MODEL_REQUIRED | MODEL_OPTIONAL, MODEL_REQUIRED, label)
    if t["id"] not in MODEL_IDS:
        raise _fail(f"{label}.id: {t['id']!r} は {list(MODEL_IDS)} のどれでもない")
    label = f"model {t['id']}"
    file = t["file"]
    if not isinstance(file, str) or not file or "/" in file or "\\" in file or file.startswith("."):
        raise _fail(f"{label}.file: ファイル名ではない（{file!r}）")
    weight = _value("pos", t["weight"], f"{label}.weight")
    shoulder = _value("pos", t["shoulder_m"], f"{label}.shoulder_m")
    actions = t["actions"]
    if (
        not isinstance(actions, list)
        or not actions
        or not all(isinstance(a, str) and a for a in actions)
        or len(set(actions)) != len(actions)
    ):
        raise _fail(f"{label}.actions: 動作の名前の配列（1 つ以上・重複なし）ではない")
    rest = t["rest_action"]
    if not isinstance(rest, str) or not rest:
        raise _fail(f"{label}.rest_action: 動作の名前ではない")
    textures = t.get("textures", {})
    if not isinstance(textures, dict) or not all(
        isinstance(k, str) and isinstance(v, str) and v for k, v in textures.items()
    ):
        raise _fail(f"{label}.textures: 材質の名前 → 画像の名前の表ではない")
    return Model(t["id"], file, weight, shoulder, rest, tuple(actions), dict(textures))  # type: ignore[arg-type]


def load_config(path: Path) -> Config:
    try:
        raw = tomllib.loads(path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise _fail(f"{path.name}: 読めない（{exc}）") from exc
    _keys(raw, set(SCHEMA) | {"model"}, set(SCHEMA) | {"model"}, path.name)
    sections: dict[str, dict] = {}
    for name, schema in SCHEMA.items():
        table = _keys(raw[name], set(schema), set(schema), name)
        sections[name] = {k: _value(kind, table[k], f"{name}.{k}") for k, kind in schema.items()}
    if not isinstance(raw["model"], list) or not raw["model"]:
        raise _fail("model: [[model]] が無い")
    models = tuple(_model(t, n) for n, t in enumerate(raw["model"]))
    ids = [m.id for m in models]
    if len(set(ids)) != len(ids):
        raise _fail(f"model: id の重複 {sorted({i for i in ids if ids.count(i) > 1})}")
    return Config(sections, models, raw)


# ---------------------------------------------------------------- R2 背景


@dataclass(frozen=True)
class Background:
    image: str  # self-footage からの相対
    sha256: str
    clip: str
    group: str
    time_of_day: str
    overlay: tuple[Rect, ...]
    blur: tuple[Rect, ...]


@dataclass(frozen=True)
class Footage:
    backgrounds: tuple[Background, ...]
    distribution: str
    blur_reviewed: bool
    sha256: str


def _rect(value: object, label: str) -> Rect:
    if (
        not isinstance(value, list)
        or len(value) != 4
        or not all(isinstance(v, int) and not isinstance(v, bool) for v in value)
    ):
        raise _fail(f"{label}: 矩形 [x, y, w, h] ではない")
    return (value[0], value[1], value[2], value[3])


def load_footage(footage: Path, config: Config) -> Footage:
    """背景の manifest から、一覧のクリップの synth_background のフレームを選ぶ。"""
    path = footage / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        files = manifest["files"]
        clips = manifest["clips"]
        sources = manifest.get("sources", {})
        distribution = manifest["distribution"]
        blur_reviewed = manifest["blur_reviewed"]
        if manifest["version"] != 1 or not isinstance(files, list) or not isinstance(clips, dict):
            raise TypeError
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise _fail("背景の manifest.json を読めない・形が違う") from exc
    if not isinstance(distribution, str) or not isinstance(blur_reviewed, bool):
        raise _fail("背景の manifest.json: distribution・blur_reviewed の形が違う")
    wanted = config["background"]["clips"]
    size = config["camera"]["size"]
    overlays: dict[str, tuple[Rect, ...]] = {}
    for cid in wanted:
        clip = clips.get(cid)
        if not isinstance(clip, dict):
            raise _fail(f"background.clips: {cid} が背景の manifest に無い")
        if tuple(clip.get("size", ())) != size:
            got = clip.get("size")
            raise _fail(f"{cid}: 背景の大きさ {got} が camera.size {list(size)} と違う")
        overlays[cid] = tuple(
            _rect(r, f"{cid}.overlay_masks") for r in clip.get("overlay_masks", [])
        )
    chosen = []
    for n, entry in enumerate(files):
        try:
            uses, video = entry["uses"], entry["video"]
        except (KeyError, TypeError) as exc:
            raise _fail(f"背景の manifest.json: files[{n}] の形が違う") from exc
        if "synth_background" not in uses:
            continue
        if entry.get("split") != "train":
            raise _fail(f"背景の manifest.json: files[{n}] が synth_background なのに train でない")
        if video not in wanted:
            continue
        try:
            blur = tuple(_rect(b["box"], f"files[{n}].blur_boxes") for b in entry["blur_boxes"])
            image = PurePosixPath(str(entry["image"]))
            if image.is_absolute() or ".." in image.parts or "\\" in str(image):
                raise _fail(f"背景の manifest.json: files[{n}].image が self-footage の外を指す")
            chosen.append(
                Background(
                    str(entry["image"]),
                    str(entry["sha256"]),
                    video,
                    str(entry["group"]),
                    str(sources.get(video, {}).get("time_of_day", clips[video].get("time_of_day"))),
                    overlays[video],
                    blur,
                )
            )
        except (KeyError, TypeError) as exc:
            raise _fail(f"背景の manifest.json: files[{n}] の形が違う") from exc
    if not chosen:
        raise _fail("合成の背景（一覧のクリップの synth_background）が 0 枚")
    return Footage(tuple(chosen), distribution, blur_reviewed, sha256_file(path))


# ---------------------------------------------------------------- R3 モデル


@dataclass(frozen=True)
class ModelFile:
    id: str
    path: Path
    sha256: str
    license: str
    author: str
    name: str


def load_models(models_dir: Path, config: Config) -> tuple[dict[str, ModelFile], str]:
    """一覧のモデルを deer3d の manifest の SHA-256・ライセンスと照合する（使うファイルだけ）。"""
    path = models_dir / "manifest.json"
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        entries = {m["id"]: m for m in manifest["models"]}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise _fail("deer3d の manifest.json を読めない・形が違う") from exc
    out: dict[str, ModelFile] = {}
    for model in config.models:
        entry = entries.get(model.id)
        if entry is None:
            raise _fail(f"{model.id}: deer3d の manifest に無い")
        if not str(entry.get("license", "")).startswith("CC0"):
            raise _fail(f"{model.id}: ライセンスが CC0 でない（{entry.get('license')!r}）")
        file = next((f for f in entry.get("files", []) if f.get("path") == model.file), None)
        if file is None:
            raise _fail(f"{model.id}: {model.file} が deer3d の manifest に無い")
        real = models_dir / model.id / model.file
        if real.is_symlink() or not real.is_file():
            raise _fail(f"{model.id}: {model.file} が無い（リンクも受けない）")
        digest = sha256_file(real)
        if digest != file.get("sha256"):
            raise _fail(f"{model.id}: {model.file} の SHA-256 が manifest と違う")
        out[model.id] = ModelFile(
            model.id,
            real,
            digest,
            str(entry["license"]),
            str(entry.get("author", "")),
            str(entry.get("name", "")),
        )
    return out, sha256_file(path)


# ---------------------------------------------------------------- R4 射影と計画


def project(camera: Mapping, pitch_deg: float, point: Sequence[float]) -> tuple[float, float]:
    """路面の座標（x 右・y 前・z 上、m）→ 画素。

    カメラは (0, 0, height_m) で +Y を向き、pitch_deg だけ下を向く。
    """
    width, height = camera["size"]
    focal = camera["focal_px"]
    pitch = math.radians(pitch_deg)
    vx, vy, vz = point[0], point[1], point[2] - camera["height_m"]
    depth = vy * math.cos(pitch) - vz * math.sin(pitch)
    up = vy * math.sin(pitch) + vz * math.cos(pitch)
    if depth <= 0:
        raise _fail("カメラの後ろの点は射影できない")
    return (width / 2 + focal * vx / depth, height / 2 - focal * up / depth)


def rough_box(
    camera: Mapping, pitch_deg: float, x: float, y: float, shoulder: float
) -> tuple[float, float, float, float]:
    """置く前の大まかな箱 [x0, y0, x1, y1]（向きに関係なく鹿が収まる広さ）。"""
    pts = [
        project(camera, pitch_deg, (x + dx * BOX_HALF_W * shoulder, y, z))
        for dx in (-1.0, 1.0)
        for z in (0.0, BOX_H * shoulder)
    ]
    us = [p[0] for p in pts]
    vs = [p[1] for p in pts]
    return (min(us), min(vs), max(us), max(vs))


def _overlaps(a: Sequence[float], rect: Rect) -> bool:
    """[x0, y0, x1, y1] と [x, y, w, h] が重なるか。"""
    x, y, w, h = rect
    return a[0] < x + w and x < a[2] and a[1] < y + h and y < a[3]


def _fits(box: Sequence[float], size: tuple[int, int], overlay: Iterable[Rect]) -> bool:
    width, height = size
    mx, my = EDGE_MARGIN * width, EDGE_MARGIN * height
    inside = box[0] >= mx and box[1] >= my and box[2] <= width - mx and box[3] <= height - my
    return inside and not any(_overlaps(box, r) for r in overlay)


@dataclass
class Plan:
    jobs: list[dict]
    unplaced: int  # 1 頭も置けずに捨てた枚
    planned: int


def _uniform(rng: np.random.Generator, pair: Sequence[float]) -> float:
    return float(rng.uniform(pair[0], pair[1])) if pair[1] > pair[0] else float(pair[0])


def road_luma(bg: np.ndarray) -> float:
    """背景の路面の帯（画面の下 1/4 の中央 1/3）の明るさの中央値（8 bit）。"""
    h, w = bg.shape[:2]
    return float(np.median(luma(bg[h * 3 // 4 :, w // 3 : w * 2 // 3])))


def exposure(road: float, road_ref: float) -> float:
    """路面の帯の明るさ → ヘッドライトの強さの倍率（ドラレコの露出に照明を合わせる）。"""
    return (max(road, ROAD_FLOOR) / road_ref) ** EXPOSURE_GAMMA


def plan_jobs(
    config: Config,
    backgrounds: Sequence[Background],
    count: int,
    seed: int,
    road: Mapping[str, float],
) -> Plan:
    """背景・鹿・照明を決める（シード付き・決定的）。背景は使い切ってから繰り返す。

    road は背景（image）→ 路面の帯の明るさ。ヘッドライトの強さを `exposure` 倍する。
    """
    rng = np.random.default_rng(seed)
    cam, place, comp = config["camera"], config["placement"], config["composite"]
    head = config["headlight"]
    order: list[int] = []
    while len(order) < count:
        order.extend(int(i) for i in rng.permutation(len(backgrounds)))
    jobs: list[dict] = []
    unplaced = 0
    for n in range(count):
        bg = backgrounds[order[n]]
        want = 1
        while want < place["max_deer"] and rng.random() < place["extra_deer_p"]:
            want += 1
        pool = list(config.models)
        chosen: list[Model] = []
        for _ in range(min(want, len(pool))):
            weights = np.array([m.weight for m in pool])
            pick = int(rng.choice(len(pool), p=weights / weights.sum()))
            chosen.append(pool.pop(pick))
        pitch = _uniform(rng, cam["pitch_deg"])
        gain = exposure(road[bg.image], head["road_ref"])
        light = {
            "power_w": _uniform(rng, head["power_w"]) * gain,
            "ambient": _uniform(rng, head["ambient"]),
            "road": road[bg.image],
        }
        blur = _uniform(rng, comp["blur_px"])
        noise = _uniform(rng, comp["noise"])
        job_seed = int(rng.integers(0, 2**31 - 1))
        deer: list[dict] = []
        for model in chosen:
            for _ in range(place["tries"]):
                d = _uniform(rng, place["distance_m"])
                lat = _uniform(rng, place["lateral_m"])
                yaw = float(rng.uniform(0.0, 360.0))
                jit = place["shoulder_jitter"]
                shoulder = model.shoulder_m * _uniform(rng, (1.0 - jit, 1.0 + jit))
                action = model.actions[int(rng.integers(0, len(model.actions)))]
                phase = float(rng.random())
                box = rough_box(cam, pitch, lat, d, shoulder)
                near = any(math.hypot(lat - o["x"], d - o["y"]) < place["min_gap_m"] for o in deer)
                if _fits(box, cam["size"], bg.overlay) and not near:
                    deer.append(
                        {
                            "model": model.id,
                            "action": action,
                            "phase": phase,
                            "x": lat,
                            "y": d,
                            "yaw_deg": yaw,
                            "shoulder_m": shoulder,
                        }
                    )
                    break
        if not deer:
            unplaced += 1
            continue
        jobs.append(
            {
                "id": f"{n:05d}",
                "background": bg.image,
                "pitch_deg": pitch,
                "light": light,
                "blur_px": blur,
                "noise": noise,
                "seed": job_seed,
                "deer": deer,
            }
        )
    return Plan(jobs, unplaced, count)


def band_of(distance: float) -> str:
    for lo, hi in BANDS:
        if lo <= distance < hi:
            return f"{lo:g}-{hi:g}"
    return f"{BANDS[-1][0]:g}-{BANDS[-1][1]:g}" if distance >= BANDS[-1][0] else "near"


def render_payload(config: Config, models: Mapping[str, ModelFile], jobs: Sequence[dict]) -> dict:
    """Blender に渡す中身（モデルの絶対パスを含む。manifest には写さない）。"""
    cam = config["camera"]
    return {
        "size": list(cam["size"]),
        "camera": {"focal_px": cam["focal_px"], "height_m": cam["height_m"]},
        "headlight": dict(config["headlight"]),
        "render": dict(config["render"]),
        "models": {
            m.id: {
                "path": str(models[m.id].path),
                "kind": "glb" if m.file.endswith(".glb") else "blend",
                "textures": dict(m.textures),
                "rest_action": m.rest_action,
                "actions": list(m.actions),
            }
            for m in config.models
        },
        "jobs": [{k: job[k] for k in ("id", "pitch_deg", "light", "deer")} for job in jobs],
    }


# ---------------------------------------------------------------- R6 合成と採否


@dataclass(frozen=True)
class Rendered:
    rgba: np.ndarray  # H×W×4 uint8（BGRA、straight alpha）
    masks: tuple[np.ndarray, ...]  # 鹿ごとの見えているアルファ（0〜1）
    boxes: tuple[tuple[float, float, float, float], ...]  # 鹿ごとの射影の箱（画面で切らない）
    frames: tuple[int, ...]


@dataclass
class Outcome:
    image: np.ndarray | None
    reason: str | None
    deer: list[dict] = field(default_factory=list)


def luma(img: np.ndarray) -> np.ndarray:
    """BGR の明るさ（Rec. 601）。"""
    img = img.astype(np.float64)
    return 0.114 * img[..., 0] + 0.587 * img[..., 1] + 0.299 * img[..., 2]


def gaussian(arr: np.ndarray, sigma: float) -> np.ndarray:
    """縦横に分けたガウスのぼかし（端は端の値を延ばす）。"""
    if sigma <= 0:
        return arr.astype(np.float64)
    radius = max(1, math.ceil(3 * sigma))
    xs = np.arange(-radius, radius + 1)
    kernel = np.exp(-(xs**2) / (2 * sigma**2))
    kernel /= kernel.sum()
    out = arr.astype(np.float64)
    for axis in (0, 1):
        pad = [(0, 0)] * out.ndim
        pad[axis] = (radius, radius)
        padded = np.pad(out, pad, mode="edge")
        acc = np.zeros_like(out)
        for k, w in enumerate(kernel):
            acc += w * np.take(padded, range(k, k + out.shape[axis]), axis=axis)
        out = acc
    return out


def _fill(img: np.ndarray, rects: Iterable[Rect]) -> None:
    for x, y, w, h in rects:
        img[max(0, y) : max(0, y + h), max(0, x) : max(0, x + w)] = 0


def _overlay_mask(shape: tuple[int, int], rects: Iterable[Rect]) -> np.ndarray:
    mask = np.zeros(shape, dtype=bool)
    for x, y, w, h in rects:
        mask[max(0, y) : max(0, y + h), max(0, x) : max(0, x + w)] = True
    return mask


def composite(
    bg: np.ndarray, rendered: Rendered, job: Mapping, background: Background, config: Config
) -> Outcome:
    """鹿の層を背景に重ね、鹿ごとに箱を作って採否を決める（合成のシードで決定的）。"""
    acc = config["accept"]
    comp_cfg = config["composite"]
    height, width = bg.shape[:2]
    alpha = rendered.rgba[..., 3].astype(np.float64) / 255.0
    premult = rendered.rgba[..., :3].astype(np.float64) * alpha[..., None]
    # premultiply してからぼかす（straight の RGB をぼかすと、透明の 0 が混ざって縁が暗くなる。C1）
    premult = gaussian(premult, job["blur_px"])
    alpha = np.clip(gaussian(alpha, job["blur_px"]), 0.0, 1.0)
    bg_luma = luma(bg)
    floor = float(np.percentile(bg_luma, comp_cfg["floor_percentile"]))
    premult += floor * alpha[..., None]
    base = np.clip(premult + (1.0 - alpha[..., None]) * bg.astype(np.float64), 0.0, 255.0)
    _fill(base, background.overlay)
    base_luma = luma(base)
    hidden = _overlay_mask((height, width), background.overlay)
    sx = acc["l0_size"][0] / width
    sy = acc["l0_size"][1] / height
    out = Outcome(None, None)
    for k, spec in enumerate(job["deer"]):
        mask = rendered.masks[k] if len(rendered.masks) > 1 else rendered.rgba[..., 3] / 255.0
        visible = (mask >= 0.5) & ~hidden
        count = int(visible.sum())
        info: dict = {"visible_px": count}
        reason = None
        if count == 0:
            reason = "few"
        else:
            ys, xs = np.nonzero(visible)
            x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
            box = (x0, y0, x1 - x0, y1 - y0)
            contrast = float(np.abs(base_luma[visible] - bg_luma[visible]).mean())
            bg_box = bg_luma[y0:y1, x0:x1]
            ratio = (float(np.median(base_luma[visible])) + 5.0) / (
                float(np.percentile(bg_box, 90)) + 5.0
            )
            px0, py0, px1, py1 = rendered.boxes[k]
            full = max(0.0, px1 - px0) * max(0.0, py1 - py0)
            cut = 1.0 - (box[2] * box[3]) / full if full > 0 else 1.0
            info.update(
                {
                    "box": list(box),
                    "contrast": round(contrast, 3),
                    "bright_ratio": round(ratio, 4),
                    "cut": round(max(0.0, cut), 4),
                    "luma": round(float(np.median(base_luma[visible])), 2),
                }
            )
            if box[3] * sy < acc["min_box_h"]:
                reason = "small"
            elif count * sx * sy < acc["min_visible"]:
                reason = "few"
            elif contrast < acc["min_contrast"]:
                reason = "dark"
            elif ratio > acc["max_bright_ratio"]:
                reason = "bright"
            elif cut > acc["max_cut"]:
                reason = "cut"
            elif any(_overlaps((x0, y0, x1, y1), r) for r in background.blur):
                reason = "blurbox"
        out.deer.append({**spec, "frame": rendered.frames[k], **info})
        if reason is not None and out.reason is None:
            out.reason = reason
    if out.reason is not None:
        return out
    # ノイズは画面全体に同じ σ で足す（鹿の範囲だけ性質の違う跡を作らない。C1）
    rng = np.random.default_rng(job["seed"])
    noisy = base + rng.normal(0.0, job["noise"], base.shape)
    image = np.clip(np.rint(noisy), 0, 255).astype(np.uint8)
    _fill(image, background.overlay)
    out.image = image
    return out


def yolo_lines(boxes: Iterable[Sequence[int]], size: tuple[int, int]) -> str:
    """[x, y, w, h]（px）→ `0 cx cy w h`（中心基準の正規化、小数 6 桁）。"""
    width, height = size
    lines = [
        f"0 {(x + w / 2) / width:.6f} {(y + h / 2) / height:.6f} {w / width:.6f} {h / height:.6f}"
        for x, y, w, h in boxes
    ]
    return "".join(f"{line}\n" for line in lines)


def review_image(image: np.ndarray, boxes: Iterable[Sequence[int]]) -> np.ndarray:
    """半分に縮めて箱を赤（BGR）で描いた確かめ用の画像。"""
    small = image[::2, ::2].copy()
    for x, y, w, h in boxes:
        x0, y0 = x // 2, y // 2
        x1, y1 = min(small.shape[1] - 1, (x + w) // 2), min(small.shape[0] - 1, (y + h) // 2)
        for a, b in ((y0, y0 + 2), (y1 - 1, y1 + 1)):
            small[max(0, a) : b, x0 : x1 + 1] = (0, 0, 255)
        for a, b in ((x0, x0 + 2), (x1 - 1, x1 + 1)):
            small[y0 : y1 + 1, max(0, a) : b] = (0, 0, 255)
    return small


# ---------------------------------------------------------------- R7・R8 書き出しと manifest


@dataclass(frozen=True)
class IO:
    """差し替えられる入出力（実物は opencv と Blender。テストは偽物）。"""

    read_image: Callable[[Path], np.ndarray]  # 背景の JPEG → H×W×3（BGR）
    read_png: Callable[[Path], np.ndarray]  # 描画の PNG → H×W×4（BGRA）
    encode_jpeg: Callable[[np.ndarray, int], bytes]
    blender: Callable[[str, Path, Path], str]  # (mode, payload, workdir) → Blender の版


@dataclass
class Summary:
    run: str
    planned: int
    written: int
    counts: dict
    brightness: dict  # 距離の帯 → {deer: 中央値, road: 中央値, n}
    lines: list[str] = field(default_factory=list)


def check_locations(out: Path, footage: Path, models: Path) -> None:
    """--out・--footage・--models はちょうどの置き場所だけ（リンクを通した別名も受けない）。"""
    for path, place in ((out, OUT_PLACE), (footage, FOOTAGE_PLACE), (models, MODELS_PLACE)):
        absolute = path.absolute()
        if absolute.parts[-3:] != place or absolute.resolve() != absolute:
            raise _fail(f"{path}: {'/'.join(place)} のフォルダではない（リンクも受けない）")


def load_rendered(workdir: Path, job: Mapping, io: IO) -> Rendered:
    jid = job["id"]
    try:
        meta = json.loads((workdir / f"{jid}.json").read_text(encoding="utf-8"))
        boxes = tuple(tuple(float(v) for v in b) for b in meta["boxes"])
        frames = tuple(int(f) for f in meta["frames"])
        rgba = io.read_png(workdir / f"{jid}.png")
        masks: tuple[np.ndarray, ...] = ()
        if len(job["deer"]) > 1:
            masks = tuple(
                io.read_png(workdir / f"{jid}_m{k}.png")[..., 3] / 255.0
                for k in range(len(job["deer"]))
            )
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise _fail(f"描画 {jid} が欠けている・読めない") from exc
    if len(boxes) != len(job["deer"]) or len(frames) != len(job["deer"]) or rgba.ndim != 3:
        raise _fail(f"描画 {jid} の形が違う")
    return Rendered(rgba, masks, boxes, frames)  # type: ignore[arg-type]


def _write_json(path: Path, data: Mapping) -> None:
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _counts_template() -> dict:
    return {
        "planned": 0,
        "unplaced": 0,
        "written": 0,
        "rejected": dict.fromkeys(REASONS, 0),
        "by_band": {},
    }


def _tally(counts: dict, job: Mapping, key: str) -> None:
    band = band_of(min(d["y"] for d in job["deer"]))
    heads = str(len(job["deer"]))
    cell = counts["by_band"].setdefault(band, {}).setdefault(heads, {"planned": 0, "written": 0})
    cell[key] += 1


def _background(footage_dir: Path, b: Background, size: tuple[int, int], io: IO) -> np.ndarray:
    """背景を SHA-256 で照合してから読む（シンボリックリンクは拒む）。"""
    path = footage_dir / b.image
    if path.is_symlink() or not path.is_file() or sha256_file(path) != b.sha256:
        raise _fail(f"背景 {b.image} の SHA-256 が manifest と違う")
    bg = io.read_image(path)
    if bg.shape[:2] != (size[1], size[0]):
        raise _fail(f"背景 {b.image} の大きさが camera.size と違う")
    return bg


def run(
    config: Config,
    footage_dir: Path,
    models_dir: Path,
    out: Path,
    run_name: str,
    count: int,
    seed: int,
    io: IO,
) -> Summary:
    """1 回分を作る。一時フォルダに書き、最後に <out>/<run>/ に名前を変える。"""
    if not RUN_RE.fullmatch(run_name):
        raise _fail(f"run の名前 {run_name!r} が書式に合わない（英小文字・数字・-、32 文字まで）")
    if run_name.endswith("-review"):  # 目で見る一覧 <run>-review/ とぶつからないように
        raise _fail(f"run の名前 {run_name!r} は -review で終われない")
    if count <= 0:
        raise _fail("count は正の整数")
    final = out / run_name
    if final.exists():
        raise _fail(f"{run_name}: 既にある（作り直すときは手で消す。上書きしない）")
    tmp = out / f".tmp-{run_name}"
    out.mkdir(parents=True, exist_ok=True)
    try:
        tmp.mkdir()
    except FileExistsError as exc:
        raise _fail(f"{tmp.name}: 同時の実行か、止まった実行の残り（手で消す）") from exc
    try:
        return _run(config, footage_dir, models_dir, out, tmp, run_name, count, seed, io)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise


def _run(
    config: Config,
    footage_dir: Path,
    models_dir: Path,
    out: Path,
    tmp: Path,
    run_name: str,
    count: int,
    seed: int,
    io: IO,
) -> Summary:
    footage = load_footage(footage_dir, config)
    models, deer3d_sha = load_models(models_dir, config)
    size = config["camera"]["size"]
    road: dict[str, float] = {}
    for b in footage.backgrounds:  # 先に全部の背景を照合し、路面の帯の明るさを測る
        road[b.image] = road_luma(_background(footage_dir, b, size, io))
    plan = plan_jobs(config, footage.backgrounds, count, seed, road)
    by_image = {b.image: b for b in footage.backgrounds}
    counts = _counts_template()
    counts["planned"] = plan.planned
    counts["unplaced"] = plan.unplaced
    for job in plan.jobs:
        _tally(counts, job, "planned")
    images = tmp / "images" / "train"
    labels = tmp / "labels" / "train"
    work = tmp / "render"
    for d in (images, labels, work):
        d.mkdir(parents=True)
    files: list[dict] = []
    written: list[tuple[str, list[list[int]]]] = []
    bright: dict[str, dict[str, list[float]]] = {}
    blender = ""
    for start in range(0, len(plan.jobs), BATCH):
        batch = plan.jobs[start : start + BATCH]
        payload = work / "payload.json"
        _write_json(payload, render_payload(config, models, batch))
        blender = io.blender("render", payload, work)
        for job in batch:
            bg_info = by_image[job["background"]]
            bg = _background(footage_dir, bg_info, size, io)
            outcome = composite(bg, load_rendered(work, job, io), job, bg_info, config)
            if outcome.image is None:
                counts["rejected"][outcome.reason] += 1
                continue
            name = f"{run_name}_{job['id']}"
            data = io.encode_jpeg(outcome.image, config["composite"]["jpeg_quality"])
            extra = jpeg_metadata(data)
            if extra:
                raise _fail(f"{name}.jpg: 許していない JPEG のマーカー {extra}")
            (images / f"{name}.jpg").write_bytes(data)
            boxes = [d["box"] for d in outcome.deer]
            (labels / f"{name}.txt").write_text(yolo_lines(boxes, size), encoding="utf-8")
            counts["written"] += 1
            _tally(counts, job, "written")
            for d in outcome.deer:
                cell = bright.setdefault(band_of(d["y"]), {"deer": [], "road": []})
                cell["deer"].append(d["luma"])
                cell["road"].append(road[bg_info.image])
            written.append((name, boxes))
            files.append(
                {
                    "image": f"images/train/{name}.jpg",
                    "label": f"labels/train/{name}.txt",
                    "sha256": sha256_file(images / f"{name}.jpg"),
                    "video": f"synth:{bg_info.clip}",
                    "group": bg_info.group,
                    "split": "train",
                    "background": {"image": bg_info.image, "sha256": bg_info.sha256},
                    "camera": {"pitch_deg": round(job["pitch_deg"], 4)},
                    "light": {
                        "power_w": round(job["light"]["power_w"], 2),
                        "ambient": round(job["light"]["ambient"], 5),
                        "road": round(job["light"]["road"], 2),
                        "blur_px": round(job["blur_px"], 4),
                        "noise": round(job["noise"], 4),
                        "seed": job["seed"],
                    },
                    "deer": [
                        {
                            "model": d["model"],
                            "action": d["action"],
                            "frame": d["frame"],
                            "distance_m": round(d["y"], 3),
                            "lateral_m": round(d["x"], 3),
                            "yaw_deg": round(d["yaw_deg"], 2),
                            "shoulder_m": round(d["shoulder_m"], 4),
                            "box": d["box"],
                            "visible_px": d["visible_px"],
                            "contrast": d["contrast"],
                            "bright_ratio": d["bright_ratio"],
                        }
                        for d in outcome.deer
                    ],
                }
            )
        for p in work.iterdir():
            p.unlink()
    shutil.rmtree(work)
    clips_used = sorted({b.clip for b in footage.backgrounds})
    tods = {b.clip: b.time_of_day for b in footage.backgrounds}
    manifest = {
        "version": 1,
        "kind": "synth",
        "run": run_name,
        "seed": seed,
        "license": "self",
        "allowed_use": ["train"],
        "distribution": footage.distribution,
        "blur_reviewed": footage.blur_reviewed,
        "footage_manifest_sha256": footage.sha256,
        "deer3d_manifest_sha256": deer3d_sha,
        "models": {
            mid: {
                "file": m.path.name,
                "sha256": m.sha256,
                "license": m.license,
                "author": m.author,
                "name": m.name,
            }
            for mid, m in sorted(models.items())
        },
        "blender": blender,
        "numpy": np.__version__,
        "config": config.raw,
        "counts": counts,
        "sources": {
            f"synth:{c}": {"license": "self", "background": c, "time_of_day": tods[c]}
            for c in clips_used
        },
        "files": files,
    }
    _write_json(tmp / "manifest.json", manifest)
    final = out / run_name
    if final.exists():  # 名前を変える直前にもう一度（空のフォルダは上書きされるため。I4）
        raise _fail(f"{run_name}: 既にある")
    tmp.rename(final)
    review = out / f"{run_name}-review"
    review.mkdir(exist_ok=True)
    pick = np.random.default_rng(seed).permutation(len(written))[:REVIEW_MAX]
    for i in sorted(int(p) for p in pick):
        name, boxes = written[i]
        img = io.read_image(final / "images" / "train" / f"{name}.jpg")
        (review / f"{name}.jpg").write_bytes(io.encode_jpeg(review_image(img, boxes), 90))
    brightness = {
        band: {
            "deer": round(float(np.median(v["deer"])), 2),
            "road": round(float(np.median(v["road"])), 2),
            "n": len(v["deer"]),
        }
        for band, v in sorted(bright.items())
    }
    return Summary(run_name, plan.planned, counts["written"], counts, brightness)


# ---------------------------------------------------------------- R5 check（射影の突き合わせ）


def check_points(config: Config) -> list[dict]:
    """Python と Blender の射影を比べる 5 点（路面の上・遠近・左右・下向きの角の違い）。"""
    pitches = config["camera"]["pitch_deg"]
    return [
        {"point": [0.0, 20.0, 0.0], "pitch_deg": pitches[0]},
        {"point": [-4.0, 10.0, 0.0], "pitch_deg": pitches[1]},
        {"point": [5.0, 40.0, 1.0], "pitch_deg": pitches[0]},
        {"point": [2.0, 8.0, 1.5], "pitch_deg": pitches[1]},
        {"point": [-6.0, 50.0, 0.5], "pitch_deg": (pitches[0] + pitches[1]) / 2},
    ]


def evaluate_check(result: Mapping, config: Config) -> list[str]:
    """check.json の結果の問題（空なら合格）。"""
    problems = []
    for item in result.get("projection", []):
        u, v = project(config["camera"], item["pitch_deg"], item["point"])
        gap = math.hypot(u - item["uv"][0], v - item["uv"][1])
        if gap > CHECK_TOL_PX:
            problems.append(f"射影のずれ {gap:.2f} px（点 {item['point']}）")
    if len(result.get("projection", [])) != len(check_points(config)):
        problems.append("射影の点が足りない")
    for model in config.models:
        info = result.get("models", {}).get(model.id)
        if info is None:
            problems.append(f"{model.id}: 結果が無い")
            continue
        for name in model.actions:
            act = info["actions"].get(name)
            if act is None or act["pose_change"] <= 1e-4:
                problems.append(f"{model.id}: 動作 {name} が姿勢を変えない")
        missing = sorted(set(model.textures) - set(info.get("textured", [])))
        if missing:
            problems.append(f"{model.id}: テクスチャが張れていない {missing}")
    return problems


def check(config: Config, models_dir: Path, out: Path, io: IO) -> tuple[list[str], dict]:
    models, _ = load_models(models_dir, config)
    out.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=out, prefix=".tmp-check-") as tmp:
        work = Path(tmp)
        payload = render_payload(config, models, [])
        payload["check_points"] = check_points(config)
        _write_json(work / "payload.json", payload)
        io.blender("check", work / "payload.json", work)
        try:
            result = json.loads((work / "check.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise _fail("check.json が書かれていない") from exc
        if (work / "check.png").exists():
            shutil.copyfile(work / "check.png", out / "check.png")
    return evaluate_check(result, config), result


# ---------------------------------------------------------------- 実物の入出力（day0 の環境）


def _cv_read(path: Path) -> np.ndarray:  # pragma: no cover  day0 の環境（opencv）
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if img is None:
        raise _fail(f"{path.name}: 画像を読めない")
    return img


def _cv_read_png(path: Path) -> np.ndarray:  # pragma: no cover  day0 の環境（opencv）
    import cv2

    img = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if img is None or img.ndim != 3 or img.shape[2] != 4:
        raise _fail(f"{path.name}: RGBA の PNG を読めない")
    return img


def _cv_jpeg(img: np.ndarray, quality: int) -> bytes:  # pragma: no cover  day0 の環境（opencv）
    import cv2

    ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), quality])
    if not ok:
        raise _fail("JPEG に書けない")
    return bytes(buf)


def _blender(executable: Path) -> Callable[[str, Path, Path], str]:  # pragma: no cover
    def call(mode: str, payload: Path, workdir: Path) -> str:
        cmd = [
            str(executable),
            "-b",
            "--factory-startup",
            "--disable-autoexec",
            "--python-exit-code",  # スクリプトの例外でも 0 で終わらないように
            "1",
            "--python",
            str(RENDER_SCRIPT),
            "--",
            mode,
            str(payload),
            str(workdir),
        ]
        # 引数の配列で呼ぶ（シェルを通さない）。実行ファイルは使う人が --blender で渡したもの
        proc = subprocess.run(cmd, capture_output=True, text=True, check=False)  # noqa: S603
        if proc.returncode != 0:
            tail = "\n".join(proc.stderr.strip().splitlines()[-5:])
            raise _fail(f"Blender が失敗した（終了コード {proc.returncode}）: {tail}")
        if mode == "check":
            return ""
        try:
            meta = json.loads((workdir / "render.json").read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise _fail("render.json が書かれていない") from exc
        return str(meta["blender"])

    return call


def real_io(blender: Path) -> IO:  # pragma: no cover  day0 の環境
    if not blender.is_file():
        raise _fail(f"{blender}: Blender の実行ファイルが無い")
    return IO(_cv_read, _cv_read_png, _cv_jpeg, _blender(blender))


# ---------------------------------------------------------------- CLI


def report(summary: Summary, stream: object) -> None:
    write = stream.write  # type: ignore[attr-defined]
    c = summary.counts
    head = f"{summary.run}: 計画 {summary.planned}・置けず {c['unplaced']}"
    write(f"{head}・書いた {summary.written}\n")
    write("捨てた: " + "・".join(f"{k} {v}" for k, v in c["rejected"].items()) + "\n")
    for band, heads in sorted(c["by_band"].items()):
        cells = "・".join(f"{h} 頭 {v['written']}/{v['planned']}" for h, v in sorted(heads.items()))
        write(f"距離 {band} m: {cells}（書いた/計画）\n")
    for band, v in summary.brightness.items():
        write(f"明るさ {band} m: 鹿 {v['deer']}・路面の帯 {v['road']}（{v['n']} 頭）\n")


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    for name in ("run", "check"):
        p = sub.add_parser(name)
        p.add_argument("--config", type=Path, default=CONFIG)
        p.add_argument("--blender", type=Path, required=True)
        p.add_argument("--footage", type=Path, default=HERE / "private/self-footage")
        p.add_argument("--models", type=Path, default=HERE / "external/deer3d")
        p.add_argument("--out", type=Path, default=HERE / "private/self-synth")
        if name == "run":
            p.add_argument("--run", required=True)
            p.add_argument("--count", type=int, required=True)
            p.add_argument("--seed", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        check_locations(args.out, args.footage, args.models)
        io = real_io(args.blender)  # pragma: no cover  day0 の環境
        if args.cmd == "check":  # pragma: no cover
            problems, result = check(config, args.models, args.out, io)
            for mid, info in sorted(result.get("models", {}).items()):
                sys.stdout.write(f"{mid}: 肩の高さ {info['shoulder_units']:.3f}（モデルの単位）\n")
            for line in problems:
                sys.stdout.write(f"問題: {line}\n")
            sys.stdout.write("check: 合格\n" if not problems else "check: 不合格\n")
            return 0 if not problems else 1
        summary = run(  # pragma: no cover
            config, args.footage, args.models, args.out, args.run, args.count, args.seed, io
        )
    except (SynthError, FootageError) as exc:
        sys.stderr.write(f"エラー: {exc}\n")
        return 2
    except ImportError as exc:  # pragma: no cover  dev だけの環境
        sys.stderr.write(f"エラー: day0 の環境（opencv）で回す（{exc.name}）\n")
        return 2
    report(summary, sys.stdout)  # pragma: no cover
    return 0  # pragma: no cover


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
