"""synth.py のテスト（docs/specs/dataset-synth の Test List）。

opencv・Blender・実データ（private/・external/）は使わない。
偽の背景・偽のモデル・偽の描画・偽の画像の読み書き（numpy の .npy）で回す。
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import re
from dataclasses import dataclass
from io import BytesIO, StringIO
from pathlib import Path

import numpy as np
import pytest

import synth
from self_footage import FootageError

W, H = 120, 90
OVERLAY = (100, 75, 20, 15)  # 右下の焼き込み
# SOI・APP0・DQT・SOF0・DHT・DRI・SOS（SOS より前は許したマーカーだけ）
HEADER = (
    b"\xff\xd8"
    + b"\xff\xe0\x00\x04JF"
    + b"\xff\xdb\x00\x04\x00\x00"
    + b"\xff\xc0\x00\x04\x00\x00"
    + b"\xff\xc4\x00\x04\x00\x00"
    + b"\xff\xdd\x00\x04\x00\x00"
    + b"\xff\xda"
)

BASE_CONFIG: dict = {
    "render": {"samples": 4},
    "background": {"clips": ["c1"]},
    "camera": {
        "size": [W, H],
        "focal_px": 100.0,
        "height_m": 1.35,
        "pitch_deg": [-1.0, 1.0],
    },
    "headlight": {
        "power_w": [400.0, 1200.0],
        "road_ref": 20.0,
        "height_m": 0.7,
        "spacing_m": 1.4,
        "forward_m": 1.8,
        "spot_deg": 60.0,
        "blend": 0.6,
        "tilt_deg": 1.5,
        "ambient": [0.002, 0.02],
    },
    "placement": {
        "distance_m": [8.0, 50.0],
        "lateral_m": [-3.0, 3.0],
        "shoulder_jitter": 0.1,
        "max_deer": 3,
        "extra_deer_p": 0.5,
        "min_gap_m": 2.5,
        "tries": 20,
    },
    "composite": {
        "blur_px": [0.4, 0.8],
        "noise": [1.0, 2.0],
        "floor_percentile": 2.0,
        "jpeg_quality": 95,
    },
    "accept": {
        "l0_size": [W, H],
        "min_box_h": 1.0,
        "min_visible": 1.0,
        "min_contrast": 10.0,
        "max_cut": 0.3,
        "max_bright_ratio": 3.0,
    },
    "model": [
        {
            "id": "M01",
            "file": "Stag.glb",
            "weight": 0.15,
            "shoulder_m": 1.0,
            "rest_action": "Idle",
            "actions": ["Idle", "Walk"],
        },
        {
            "id": "M02",
            "file": "Deer.glb",
            "weight": 0.15,
            "shoulder_m": 0.85,
            "rest_action": "Idle",
            "actions": ["Idle", "Gallop"],
        },
        {
            "id": "M03",
            "file": "deer1.blend",
            "weight": 0.35,
            "shoulder_m": 1.0,
            "rest_action": "Idle.000",
            "actions": ["Idle.000", "Run"],
            "textures": {"Body": "body"},
        },
    ],
}


# ---------------------------------------------------------------- 偽物


def _toml_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float):
        if math.isnan(value):
            return "nan"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return repr(value)
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return json.dumps(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(v) for v in value) + "]"
    if isinstance(value, dict):
        return "{ " + ", ".join(f"{k} = {_toml_value(v)}" for k, v in value.items()) + " }"
    raise TypeError(value)


def dump_toml(data: dict) -> str:
    """このテストの一覧に足りるだけの TOML の書き出し（節の表と [[model]]）。"""
    lines: list[str] = []
    for name, table in data.items():
        tables = table if isinstance(table, list) else [table]
        for item in tables:
            lines.append(f"[[{name}]]" if isinstance(table, list) else f"[{name}]")
            lines.extend(f"{k} = {_toml_value(v)}" for k, v in item.items())
            lines.append("")
    return "\n".join(lines)


def write_config(path: Path, mutate=None) -> Path:
    data = copy.deepcopy(BASE_CONFIG)
    if mutate is not None:
        mutate(data)
    path.write_text(dump_toml(data), encoding="utf-8")
    return path


def save_npy(path: Path, arr: np.ndarray) -> None:
    with path.open("wb") as handle:
        np.save(handle, arr)


def fake_read_image(path: Path) -> np.ndarray:
    data = path.read_bytes()
    if data.startswith(b"\xff\xd8"):
        data = data[len(HEADER) :]
    return np.load(BytesIO(data))


def fake_read_png(path: Path) -> np.ndarray:
    return np.load(path)


def fake_encode_jpeg(img: np.ndarray, quality: int) -> bytes:
    buf = BytesIO()
    np.save(buf, img)
    return HEADER + buf.getvalue()


class FakeBlender:
    """render_payload の jobs を読んで、load_rendered が期待するファイルを書く偽の Blender。"""

    def __init__(
        self,
        *,
        rect_h: int = 30,
        fail: bool = False,
        skip: frozenset[str] = frozenset(),
        bad_boxes: bool = False,
        hook=None,
        check_mutate=None,
        write_png: bool = False,
    ) -> None:
        self.write_png = write_png
        self.rect_h = rect_h
        self.fail = fail
        self.skip = skip
        self.bad_boxes = bad_boxes
        self.hook = hook
        self.check_mutate = check_mutate
        self.calls: list[str] = []
        self.payloads: list[dict] = []

    def rect(self, k: int) -> tuple[int, int, int, int]:
        x0 = 10 + 35 * k
        return (x0, 30, x0 + 20, 30 + self.rect_h)

    def __call__(self, mode: str, payload: Path, workdir: Path) -> str:
        spec = json.loads(payload.read_text(encoding="utf-8"))
        self.calls.append(mode)
        self.payloads.append(spec)
        if self.hook is not None:
            self.hook(mode)
        if self.fail:
            raise synth.SynthError("Blender が失敗した（偽）")
        if mode == "check":
            self._check(spec, workdir)
            return ""
        width, height = spec["size"]
        for job in spec["jobs"]:
            n = len(job["deer"])
            rgba = np.zeros((height, width, 4), dtype=np.uint8)
            for k in range(n):
                x0, y0, x1, y1 = self.rect(k)
                rgba[y0:y1, x0:x1] = (100, 100, 100, 255)
                if n > 1 and "mask" not in self.skip:
                    mask = np.zeros_like(rgba)
                    mask[y0:y1, x0:x1] = 255
                    if not (k == 1 and "mask1" in self.skip):
                        save_npy(workdir / f"{job['id']}_m{k}.png", mask)
            if "png" not in self.skip:
                save_npy(workdir / f"{job['id']}.png", rgba)
            boxes = [list(self.rect(k)) for k in range(n)]
            meta = {"boxes": [] if self.bad_boxes else boxes, "frames": [0] * n}
            if "json" not in self.skip:
                (workdir / f"{job['id']}.json").write_text(json.dumps(meta), encoding="utf-8")
        (workdir / "render.json").write_text(
            json.dumps({"blender": "4.5.15-fake", "jobs": len(spec["jobs"])}), encoding="utf-8"
        )
        return "4.5.15-fake"

    def _check(self, spec: dict, workdir: Path) -> None:
        camera = {"size": spec["size"], **spec["camera"]}
        result = {
            "projection": [
                {
                    "point": p["point"],
                    "pitch_deg": p["pitch_deg"],
                    "uv": list(synth.project(camera, p["pitch_deg"], p["point"])),
                }
                for p in spec["check_points"]
            ],
            "models": {
                mid: {
                    "shoulder_units": 1.0,
                    "actions": {a: {"pose_change": 0.5} for a in m["actions"]},
                    "textured": list(m["textures"]),
                }
                for mid, m in spec["models"].items()
            },
        }
        if self.check_mutate is not None:
            self.check_mutate(result)
        if "check" not in self.skip:
            (workdir / "check.json").write_text(json.dumps(result), encoding="utf-8")
        if self.write_png:
            (workdir / "check.png").write_bytes(b"png")


def sha_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


@dataclass
class World:
    root: Path
    footage: Path
    models: Path
    out: Path
    cfg_path: Path
    config: synth.Config
    blender: FakeBlender
    io: synth.IO

    def run(self, name: str = "s1", count: int = 9, seed: int = 7) -> synth.Summary:
        return synth.run(
            self.config, self.footage, self.models, self.out, name, count, seed, self.io
        )

    def manifest(self, name: str = "s1") -> dict:
        return json.loads((self.out / name / "manifest.json").read_text(encoding="utf-8"))

    def cli(self, *args: str) -> list[str]:
        return [
            *args,
            "--config",
            str(self.cfg_path),
            "--blender",
            str(self.root / "blender"),
            "--footage",
            str(self.footage),
            "--models",
            str(self.models),
            "--out",
            str(self.out),
        ]


def make_world(tmp_path: Path, mutate=None, **blender_kw) -> World:
    root = tmp_path / "dataset"
    footage = root / "private" / "self-footage"
    models = root / "external" / "deer3d"
    out = root / "private" / "self-synth"
    (footage / "frames").mkdir(parents=True)
    models.mkdir(parents=True)
    cfg_path = write_config(tmp_path / "synth.toml", mutate)
    config = synth.load_config(cfg_path)

    def frame(i: int, name: str, clip: str, group: str, uses: list[str], split: str) -> dict:
        arr = np.random.default_rng(i).integers(60, 100, size=(H, W, 3), dtype=np.uint8)
        x, y, w, h = OVERLAY
        arr[y : y + h, x : x + w] = 200  # 焼き込みの文字（明るい）
        buf = BytesIO()
        np.save(buf, arr)
        (footage / "frames" / name).write_bytes(buf.getvalue())
        return {
            "image": f"frames/{name}",
            "sha256": sha_of(buf.getvalue()),
            "video": clip,
            "group": group,
            "uses": uses,
            "split": split,
            "blur_boxes": [{"box": [0, 0, 3, 3]}],
        }

    syn = ["synth_background", "negative"]
    files = [
        frame(0, "c1_000.jpg", "c1", "self:drive1", syn, "train"),
        frame(1, "c1_001.jpg", "c1", "self:drive1", syn, "train"),
        frame(2, "c1_002.jpg", "c1", "self:drive2", syn, "train"),
        frame(3, "c2_000.jpg", "c2", "self:drive3", syn, "train"),  # 一覧に無いクリップ
        frame(4, "c1_val.jpg", "c1", "self:drive1", ["fp_eval"], "val"),
        frame(5, "c1_deer.jpg", "c1", "self:drive1", ["label"], "train"),  # 鹿あり
        frame(6, "c3_val.jpg", "c3", "self:drive4", ["fp_eval"], "val"),
    ]
    clip = {"size": [W, H], "overlay_masks": [list(OVERLAY)], "time_of_day": "night"}
    manifest = {
        "version": 1,
        "files": files,
        "clips": {"c1": dict(clip), "c2": dict(clip), "c3": {**clip, "time_of_day": "day"}},
        "distribution": "not_allowed",
        "blur_reviewed": False,
    }
    (footage / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    entries = []
    for model in config.models:
        folder = models / model.id
        folder.mkdir()
        content = f"model-{model.id}".encode()
        (folder / model.file).write_bytes(content)
        entries.append(
            {
                "id": model.id,
                "name": f"deer {model.id}",
                "author": "tester",
                "license": "CC0 1.0 Universal",
                "files": [
                    {"path": model.file, "sha256": sha_of(content)},
                    {"path": "unused.7z", "sha256": "0" * 64},  # 使わない（見ない）
                ],
            }
        )
    (models / "manifest.json").write_text(json.dumps({"models": entries}), encoding="utf-8")

    blender = FakeBlender(**blender_kw)
    io = synth.IO(fake_read_image, fake_read_png, fake_encode_jpeg, blender)
    return World(root, footage, models, out, cfg_path, config, blender, io)


def edit_json(path: Path, fn) -> None:
    data = json.loads(path.read_text(encoding="utf-8"))
    fn(data)
    path.write_text(json.dumps(data), encoding="utf-8")


@pytest.fixture
def world(tmp_path: Path) -> World:
    return make_world(tmp_path)


@pytest.fixture
def cfg_factory(tmp_path: Path):
    def make(mutate=None) -> synth.Config:
        return synth.load_config(write_config(tmp_path / "cfg.toml", mutate))

    return make


def backgrounds(n: int = 3, overlay=(), blur=()) -> list[synth.Background]:
    return [
        synth.Background(
            f"frames/c1_{i:03d}.jpg", f"{i:064x}", "c1", f"self:d{i}", "night", overlay, blur
        )
        for i in range(n)
    ]


# 合成のテスト用の部品
RectXY = tuple[int, int, int, int]  # x0, y0, x1, y1


def make_rendered(
    rects: list[RectXY],
    *,
    color: int = 100,
    proj: list[tuple[float, float, float, float]] | None = None,
    masks: list[np.ndarray] | None = None,
) -> synth.Rendered:
    rgba = np.zeros((H, W, 4), dtype=np.uint8)
    for x0, y0, x1, y1 in rects:
        rgba[y0:y1, x0:x1] = (color, color, color, 255)
    if len(rects) > 1 and masks is None:
        masks = []
        for x0, y0, x1, y1 in rects:
            m = np.zeros((H, W))
            m[y0:y1, x0:x1] = 1.0
            masks.append(m)
    boxes = tuple(proj) if proj is not None else tuple(tuple(map(float, r)) for r in rects)
    return synth.Rendered(rgba, tuple(masks or ()), boxes, (0,) * len(rects))  # type: ignore[arg-type]


def make_job(n: int = 1, *, blur: float = 0.0, noise: float = 0.0, seed: int = 1) -> dict:
    spec = {"model": "M01", "action": "Idle", "x": 0.0, "y": 10.0, "yaw_deg": 0.0}
    return {"blur_px": blur, "noise": noise, "seed": seed, "deer": [dict(spec) for _ in range(n)]}


def const_bg(value: int) -> np.ndarray:
    return np.full((H, W, 3), value, dtype=np.uint8)


def bg_info(overlay=(), blur=()) -> synth.Background:
    return backgrounds(1, overlay, blur)[0]


RECT = (20, 30, 60, 60)


# ---------------------------------------------------------------- AC-1 受け入れ


def test_ac1_run_makes_images_labels_manifest_from_listed_train_negatives_only(world):
    """AC-1: 一覧のクリップの train の鹿なしだけが背景で、焼き込みが黒、ラベルが外接矩形。"""
    summary = world.run("s1", 9, 7)
    m = world.manifest("s1")
    allowed = {"frames/c1_000.jpg", "frames/c1_001.jpg", "frames/c1_002.jpg"}
    used = {f["background"]["image"] for f in m["files"]}
    assert summary.written == len(m["files"]) > 0
    assert used <= allowed
    assert {f["video"] for f in m["files"]} == {"synth:c1"}
    final = world.out / "s1"
    for f in m["files"]:
        img = fake_read_image(final / f["image"])
        x, y, w, h = OVERLAY
        assert (img[y : y + h, x : x + w] == 0).all()
        label = (final / f["label"]).read_text(encoding="utf-8").splitlines()
        assert len(label) == len(f["deer"])
        for k, d in enumerate(f["deer"]):
            assert d["box"] == [10 + 35 * k, 30, 20, 30]  # 見えているマスクの外接矩形
            cx, cy, bw, bh = (float(v) for v in label[k].split()[1:])
            assert (cx, cy) == pytest.approx(((d["box"][0] + 10) / W, 0.5), abs=1e-6)
            assert (bw, bh) == pytest.approx((20 / W, 30 / H), abs=1e-6)


def test_ac1_manifest_has_no_absolute_path(world, tmp_path):
    """AC-1: manifest に絶対パス（このマシンのパス）が無い。"""
    world.run("s1")
    text = (world.out / "s1" / "manifest.json").read_text(encoding="utf-8")
    assert str(tmp_path) not in text
    assert "/Users" not in text


def test_ac1_same_seed_second_run_gives_same_jobs_and_labels(world):
    """AC-1: 同じシードで別の run 名を回すと、同じ jobs（deer・light・camera）と同じラベル。"""
    world.run("s1", 9, 7)
    world.run("s2", 9, 7)
    a, b = world.manifest("s1")["files"], world.manifest("s2")["files"]
    assert len(a) == len(b) > 0
    for fa, fb in zip(a, b, strict=True):
        assert (fa["deer"], fa["light"], fa["camera"]) == (fb["deer"], fb["light"], fb["camera"])
        la = (world.out / "s1" / fa["label"]).read_text(encoding="utf-8")
        lb = (world.out / "s2" / fb["label"]).read_text(encoding="utf-8")
        assert la == lb


# ---------------------------------------------------------------- CFG-1 一覧


def test_cfg_1a_repository_synth_toml_loads():
    """CFG-1a: リポジトリの dataset/synth.toml を読める。"""
    config = synth.load_config(synth.CONFIG)
    assert [m.id for m in config.models] == ["M01", "M02", "M03", "M04"]
    assert config["camera"]["size"] == (1920, 1080)
    assert config["placement"]["max_deer"] == 3
    assert config.models[2].textures["Body"] == "body"


def test_cfg_1a_repository_synth_toml_weights_and_clips():
    """CFG-1a: 重みの合計が 1、背景のクリップが 1 つ以上。"""
    config = synth.load_config(synth.CONFIG)
    assert sum(m.weight for m in config.models) == pytest.approx(1.0)
    assert len(config["background"]["clips"]) >= 1


def test_cfg_1a_test_base_config_loads(cfg_factory):
    """CFG-1a: このテストの基本の一覧も読める（以降の壊し方の土台）。"""
    assert cfg_factory()["camera"]["pitch_deg"] == (-1.0, 1.0)


def _setter(section: str, key: str, value):
    return lambda d: d[section].__setitem__(key, value)


CFG_BAD = [
    ("unknown-key", lambda d: d["camera"].update(fov=1.0), "fov"),
    ("unknown-section", lambda d: d.update(extra={"a": 1}), "extra"),
    ("missing-key", lambda d: d["camera"].pop("focal_px"), "focal_px"),
    ("missing-section", lambda d: d.pop("accept"), "accept"),
    ("range-reversed", _setter("placement", "distance_m", [50.0, 8.0]), "distance_m"),
    ("negative-range", _setter("headlight", "power_w", [-1.0, 5.0]), "power_w"),
    ("negative-noise", _setter("composite", "noise", [-1.0, 2.0]), "noise"),
    ("negative-pos", _setter("camera", "height_m", -1.0), "height_m"),
    ("nan", _setter("camera", "focal_px", float("nan")), "focal_px"),
    ("inf", _setter("camera", "height_m", float("inf")), "height_m"),
    ("bool-int", _setter("render", "samples", True), "samples"),
    ("bool-float", _setter("camera", "focal_px", True), "focal_px"),
    ("string-number", _setter("camera", "focal_px", "abc"), "focal_px"),
    ("unknown-model", lambda d: d["model"][0].update(id="M09"), "M09"),
    ("duplicate-model", lambda d: d["model"].append(copy.deepcopy(d["model"][0])), "M01"),
    ("no-model", lambda d: d.__setitem__("model", []), "model"),
    ("actions-empty", lambda d: d["model"][0].update(actions=[]), "actions"),
    ("actions-duplicate", lambda d: d["model"][0].update(actions=["Idle", "Idle"]), "actions"),
    ("model-missing-file", lambda d: d["model"][0].pop("file"), "file"),
    ("model-unknown-key", lambda d: d["model"][0].update(bogus=1), "bogus"),
    ("model-file-slash", lambda d: d["model"][0].update(file="a/b.glb"), "file"),
    ("model-weight-zero", lambda d: d["model"][0].update(weight=0.0), "weight"),
    ("model-textures-bad", lambda d: d["model"][2].update(textures={"Body": 3}), "textures"),
    ("max-deer-4", _setter("placement", "max_deer", 4), "max_deer"),
    ("max-deer-0", _setter("placement", "max_deer", 0), "max_deer"),
    ("clips-empty", _setter("background", "clips", []), "clips"),
    ("clips-duplicate", _setter("background", "clips", ["c1", "c1"]), "clips"),
    ("quality-0", _setter("composite", "jpeg_quality", 0), "jpeg_quality"),
    ("quality-float", _setter("composite", "jpeg_quality", 95.5), "jpeg_quality"),
    ("percentile-101", _setter("composite", "floor_percentile", 101.0), "floor_percentile"),
    ("jitter-half", _setter("placement", "shoulder_jitter", 0.5), "shoulder_jitter"),
    ("spot-180", _setter("headlight", "spot_deg", 180.0), "spot_deg"),
    ("prob-over-1", _setter("placement", "extra_deer_p", 1.5), "extra_deer_p"),
    ("size-zero", _setter("camera", "size", [0, 90]), "size"),
    ("size-float", _setter("camera", "size", [120.0, 90]), "size"),
    ("tries-0", _setter("placement", "tries", 0), "tries"),
]


@pytest.mark.parametrize(("mutate", "key"), [c[1:] for c in CFG_BAD], ids=[c[0] for c in CFG_BAD])
def test_cfg_1b_invalid_config_raises_error_with_key_name(tmp_path, mutate, key):
    """CFG-1b: 一覧を 1 か所壊すと、キー名つきのエラーになる。"""
    path = write_config(tmp_path / "bad.toml", mutate)
    with pytest.raises(synth.SynthError, match=re.escape(key)):
        synth.load_config(path)


def test_cfg_1b_unreadable_toml_raises(tmp_path):
    """CFG-1b: TOML として読めない・ファイルが無い → エラー。"""
    bad = tmp_path / "bad.toml"
    bad.write_text("[render\nsamples =", encoding="utf-8")
    with pytest.raises(synth.SynthError, match=r"bad\.toml"):
        synth.load_config(bad)
    with pytest.raises(synth.SynthError, match=r"nothing\.toml"):
        synth.load_config(tmp_path / "nothing.toml")


def test_cfg_1b_invalid_config_writes_nothing(tmp_path):
    """CFG-1b: 違反があれば何も書かない（main は終了コード 2）。"""
    world = make_world(tmp_path)
    write_config(world.cfg_path, _setter("camera", "focal_px", float("nan")))
    code = synth.main(world.cli("run", "--run", "s1", "--count", "3", "--seed", "1"))
    assert code == 2
    assert not world.out.exists()


# ---------------------------------------------------------------- BG-2 背景


def test_bg_2a_selects_only_listed_clip_synth_background_frames(world):
    """BG-2a: 一覧のクリップの synth_background だけ（val・鹿あり・一覧に無いクリップは除く）。"""
    footage = synth.load_footage(world.footage, world.config)
    assert [b.image for b in footage.backgrounds] == [
        "frames/c1_000.jpg",
        "frames/c1_001.jpg",
        "frames/c1_002.jpg",
    ]
    assert {b.clip for b in footage.backgrounds} == {"c1"}


def test_bg_2a_reads_overlay_blur_and_inherits_flags(world):
    """BG-2a: overlay_masks・blur_boxes を読み、distribution・blur_reviewed を引き継ぐ。"""
    footage = synth.load_footage(world.footage, world.config)
    first = footage.backgrounds[0]
    assert first.overlay == (OVERLAY,)
    assert first.blur == ((0, 0, 3, 3),)
    assert first.time_of_day == "night"
    assert (footage.distribution, footage.blur_reviewed) == ("not_allowed", False)


def test_bg_2a_zero_backgrounds_raises(tmp_path):
    """BG-2a: 一覧のクリップに synth_background が 0 枚 → エラー。"""
    world = make_world(tmp_path, _setter("background", "clips", ["c3"]))
    with pytest.raises(synth.SynthError, match="0 枚"):
        synth.load_footage(world.footage, world.config)


def test_bg_2a_clip_missing_from_footage_manifest_raises(tmp_path):
    """BG-2a: 一覧のクリップが背景の manifest に無い → エラー。"""
    world = make_world(tmp_path, _setter("background", "clips", ["zz"]))
    with pytest.raises(synth.SynthError, match="zz"):
        synth.load_footage(world.footage, world.config)


def test_bg_2a_size_mismatch_raises(world):
    """BG-2a: クリップの size が camera.size と違う → エラー。"""
    edit_json(world.footage / "manifest.json", lambda m: m["clips"]["c1"].update(size=[64, 48]))
    with pytest.raises(synth.SynthError, match="大きさ"):
        synth.load_footage(world.footage, world.config)


def test_bg_2b_sha256_mismatch_stops_run_and_writes_nothing(world):
    """BG-2b: 背景の SHA-256 が違う → エラーで、run も一時フォルダも残らない。"""
    target = world.footage / "frames" / "c1_001.jpg"
    target.write_bytes(target.read_bytes() + b"x")
    with pytest.raises(synth.SynthError, match="SHA-256"):
        world.run("s1")
    assert not (world.out / "s1").exists()
    assert not (world.out / ".tmp-s1").exists()


def test_bg_2b_sha256_mismatch_is_found_before_any_render(world):
    """BG-2b: 照合は計画の前に全部の背景で行う（Blender は呼ばれない）。"""
    target = world.footage / "frames" / "c1_002.jpg"
    target.write_bytes(b"broken")
    with pytest.raises(synth.SynthError, match="SHA-256"):
        world.run("s1")
    assert world.blender.calls == []


def test_bg_2b_symlinked_background_raises(world):
    """BG-2b: 背景がリンクなら受けない。"""
    target = world.footage / "frames" / "c1_000.jpg"
    other = world.footage / "frames" / "c1_001.jpg"
    target.unlink()
    target.symlink_to(other)
    with pytest.raises(synth.SynthError, match="SHA-256"):
        world.run("s1")


def test_bg_2b_background_size_differs_from_camera_raises(world):
    """BG-2b: 背景の画像の大きさが camera.size と違う → エラー。"""
    small = np.zeros((10, 10, 3), dtype=np.uint8)
    buf = BytesIO()
    np.save(buf, small)
    target = world.footage / "frames" / "c1_000.jpg"
    target.write_bytes(buf.getvalue())
    edit_json(
        world.footage / "manifest.json",
        lambda m: m["files"][0].update(sha256=sha_of(buf.getvalue())),
    )
    with pytest.raises(synth.SynthError, match="大きさ"):
        world.run("s1")


def test_bg_2b_synth_background_not_train_raises(world):
    """BG-2b: synth_background なのに split が train でない → エラー。"""
    edit_json(world.footage / "manifest.json", lambda m: m["files"][1].update(split="val"))
    with pytest.raises(synth.SynthError, match="train"):
        synth.load_footage(world.footage, world.config)


@pytest.mark.parametrize(
    "image", ["../outside.jpg", "/abs/frame.jpg", "frames/../../x.jpg", "a\\b.jpg"]
)
def test_bg_2b_image_outside_footage_raises(world, image):
    """BG-2b: 背景の image が self-footage の外を指す（..・絶対パス・\\）→ エラー。"""
    edit_json(world.footage / "manifest.json", lambda m: m["files"][0].update(image=image))
    with pytest.raises(synth.SynthError, match="外を指す"):
        synth.load_footage(world.footage, world.config)


FOOTAGE_BAD = [
    ("version", lambda m: m.update(version=2)),
    ("files-missing", lambda m: m.pop("files")),
    ("files-dict", lambda m: m.update(files={})),
    ("clips-list", lambda m: m.update(clips=[])),
    ("distribution-int", lambda m: m.update(distribution=1)),
    ("blur-reviewed-str", lambda m: m.update(blur_reviewed="no")),
    ("entry-no-uses", lambda m: m["files"][0].pop("uses")),
    ("entry-no-blur-boxes", lambda m: m["files"][0].pop("blur_boxes")),
    ("entry-bad-box", lambda m: m["files"][0].update(blur_boxes=[{"box": [1, 2]}])),
    ("overlay-bad-rect", lambda m: m["clips"]["c1"].update(overlay_masks=[[1, 2, 3]])),
    ("overlay-float-rect", lambda m: m["clips"]["c1"].update(overlay_masks=[[1.5, 2, 3, 4]])),
]


@pytest.mark.parametrize(
    ("mutate",), [(c[1],) for c in FOOTAGE_BAD], ids=[c[0] for c in FOOTAGE_BAD]
)
def test_bg_2b_malformed_footage_manifest_raises(world, mutate):
    """BG-2b: 背景の manifest の形が違う → エラー。"""
    edit_json(world.footage / "manifest.json", mutate)
    with pytest.raises(synth.SynthError):
        synth.load_footage(world.footage, world.config)


def test_bg_2b_invalid_json_and_missing_manifest_raise(world):
    """BG-2b: JSON として読めない・manifest が無い → エラー。"""
    path = world.footage / "manifest.json"
    path.write_text("{", encoding="utf-8")
    with pytest.raises(synth.SynthError, match=r"manifest\.json"):
        synth.load_footage(world.footage, world.config)
    path.unlink()
    with pytest.raises(synth.SynthError, match=r"manifest\.json"):
        synth.load_footage(world.footage, world.config)


# ---------------------------------------------------------------- MDL-3 モデル


def test_mdl_3a_matching_models_pass_and_unused_7z_is_not_checked(world):
    """MDL-3a: SHA-256 が合うモデルは通る。使わない unused.7z（ファイルも無い）は見ない。"""
    models, manifest_sha = synth.load_models(world.models, world.config)
    assert set(models) == {"M01", "M02", "M03"}
    assert models["M01"].sha256 == sha_of(b"model-M01")
    assert models["M01"].license.startswith("CC0")
    assert manifest_sha == sha_of((world.models / "manifest.json").read_bytes())


def test_mdl_3a_sha256_mismatch_raises(world):
    """MDL-3a: ファイルの SHA-256 が manifest と違う → エラー。"""
    (world.models / "M01" / "Stag.glb").write_bytes(b"tampered")
    with pytest.raises(synth.SynthError, match="SHA-256"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_missing_file_raises(world):
    """MDL-3a: ファイルが無い → エラー。"""
    (world.models / "M02" / "Deer.glb").unlink()
    with pytest.raises(synth.SynthError, match="M02"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_symlinked_file_raises(world):
    """MDL-3a: リンクは受けない（中身が同じでも）。"""
    real = world.models / "M01" / "Stag.glb"
    copy_path = world.models / "M01" / "copy.glb"
    copy_path.write_bytes(real.read_bytes())
    real.unlink()
    real.symlink_to(copy_path)
    with pytest.raises(synth.SynthError, match="リンク"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_model_not_in_manifest_raises(world):
    """MDL-3a: deer3d の manifest に無いモデル → エラー。"""
    edit_json(
        world.models / "manifest.json",
        lambda m: m.update(models=[e for e in m["models"] if e["id"] != "M03"]),
    )
    with pytest.raises(synth.SynthError, match="M03"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_file_not_in_manifest_raises(world):
    """MDL-3a: manifest の files[] に使うファイルが無い → エラー。"""
    edit_json(
        world.models / "manifest.json",
        lambda m: m["models"][0].update(files=[{"path": "other.glb", "sha256": "0" * 64}]),
    )
    with pytest.raises(synth.SynthError, match=r"Stag\.glb"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_non_cc0_license_raises(world):
    """MDL-3a: ライセンスが CC0 で始まらない → エラー。"""
    edit_json(world.models / "manifest.json", lambda m: m["models"][0].update(license="CC-BY 4.0"))
    with pytest.raises(synth.SynthError, match="CC0"):
        synth.load_models(world.models, world.config)


def test_mdl_3a_unreadable_manifest_raises(world):
    """MDL-3a: deer3d の manifest が読めない → エラー。"""
    (world.models / "manifest.json").write_text("not json", encoding="utf-8")
    with pytest.raises(synth.SynthError, match=r"manifest\.json"):
        synth.load_models(world.models, world.config)


# ---------------------------------------------------------------- PLAN-4 計画


def road_for(bgs: list[synth.Background], value: float = 20.0) -> dict[str, float]:
    return {b.image: value for b in bgs}


def test_plan_4a_same_seed_same_jobs_different_seed_different(cfg_factory):
    """PLAN-4a: 同じシードで同じ jobs、違うシードで違う jobs。"""
    cfg, bgs = cfg_factory(), backgrounds()
    a = synth.plan_jobs(cfg, bgs, 12, 7, road_for(bgs))
    b = synth.plan_jobs(cfg, bgs, 12, 7, road_for(bgs))
    c = synth.plan_jobs(cfg, bgs, 12, 8, road_for(bgs))
    assert a.jobs == b.jobs
    assert a.jobs != c.jobs


def test_plan_4a_uses_all_backgrounds_before_repeating(cfg_factory):
    """PLAN-4a: 背景は使い切ってから繰り返す（3 枚ずつの組に重複が無い）。"""
    cfg, bgs = cfg_factory(), backgrounds(3)
    plan = synth.plan_jobs(cfg, bgs, 9, 1, road_for(bgs))
    assert plan.planned == 9
    for group in range(3):
        used = [j["background"] for j in plan.jobs if int(j["id"]) // 3 == group]
        assert len(used) == len(set(used))
    assert {j["background"] for j in plan.jobs} == {b.image for b in bgs}


def test_plan_4a_deer_counts_and_models_and_ranges(cfg_factory):
    """PLAN-4a: 鹿は 1〜max_deer 頭・同じモデルは 1 回まで・値が一覧の範囲の中。"""
    cfg, bgs = cfg_factory(), backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 80, 3, road_for(bgs))
    shoulder = {m.id: m.shoulder_m for m in cfg.models}
    assert {len(j["deer"]) for j in plan.jobs} == {1, 2, 3}
    for job in plan.jobs:
        models = [d["model"] for d in job["deer"]]
        assert len(models) == len(set(models))
        assert -1.0 <= job["pitch_deg"] <= 1.0
        assert 400.0 <= job["light"]["power_w"] <= 1200.0  # 路面 = road_ref なので倍率 1
        assert 0.002 <= job["light"]["ambient"] <= 0.02
        assert 0.4 <= job["blur_px"] <= 0.8
        assert 1.0 <= job["noise"] <= 2.0
        for d in job["deer"]:
            assert 8.0 <= d["y"] <= 50.0
            assert -3.0 <= d["x"] <= 3.0
            assert 0.0 <= d["yaw_deg"] < 360.0
            assert 0.9 * shoulder[d["model"]] <= d["shoulder_m"] <= 1.1 * shoulder[d["model"]]
            assert d["action"] in next(m for m in cfg.models if m.id == d["model"]).actions


def test_plan_4a_one_model_means_one_deer_even_with_max_deer_3(cfg_factory):
    """PLAN-4a: モデルが 1 つしか無ければ、同じモデルは 1 回までなので 1 頭。"""

    def only_one(d):
        d["model"] = d["model"][:1]
        d["placement"]["extra_deer_p"] = 1.0

    cfg, bgs = cfg_factory(only_one), backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 10, 1, road_for(bgs))
    assert {len(j["deer"]) for j in plan.jobs} == {1}


def test_plan_4a_job_ids_and_fields(cfg_factory):
    """PLAN-4a: job に id・背景・合成のシードが入る。"""
    cfg, bgs = cfg_factory(), backgrounds()
    job = synth.plan_jobs(cfg, bgs, 3, 1, road_for(bgs)).jobs[0]
    assert re.fullmatch(r"\d{5}", job["id"])
    assert isinstance(job["seed"], int)
    assert job["background"] in {b.image for b in bgs}


CAM = {"size": (W, H), "focal_px": 100.0, "height_m": 1.35}


def test_plan_4b_horizon_row_follows_pitch():
    """PLAN-4b: 地平線の y。下向き 0° で画面の中央、3° 下向きで tan(3°) × 焦点距離だけ上。"""
    assert synth.project(CAM, 0.0, (0.0, 1e7, 1.35))[1] == pytest.approx(H / 2, abs=1e-3)
    expected = H / 2 - 100.0 * math.tan(math.radians(3.0))
    assert synth.project(CAM, 3.0, (0.0, 1e7, 1.35))[1] == pytest.approx(expected, abs=1e-2)


def test_plan_4b_farther_is_smaller_and_closer_to_horizon():
    """PLAN-4b: 遠いほど足元は地平線に寄り、箱は小さい。"""
    horizon = synth.project(CAM, 0.0, (0.0, 1e7, 1.35))[1]
    near = synth.project(CAM, 0.0, (0.0, 10.0, 0.0))[1]
    far = synth.project(CAM, 0.0, (0.0, 40.0, 0.0))[1]
    assert near > far > horizon
    box_near = synth.rough_box(CAM, 0.0, 0.0, 10.0, 1.0)
    box_far = synth.rough_box(CAM, 0.0, 0.0, 40.0, 1.0)
    assert (box_near[3] - box_near[1]) > (box_far[3] - box_far[1])


def test_plan_4b_left_is_left_and_right_is_right():
    """PLAN-4b: 左右の向き。x < 0 は画面の中心の左、x > 0 は右。"""
    assert synth.project(CAM, 0.0, (-2.0, 10.0, 0.0))[0] < W / 2
    assert synth.project(CAM, 0.0, (0.0, 10.0, 0.0))[0] == pytest.approx(W / 2)
    assert synth.project(CAM, 0.0, (2.0, 10.0, 0.0))[0] > W / 2


def test_plan_4b_point_behind_camera_raises():
    """PLAN-4b: カメラの後ろの点は射影できない。"""
    with pytest.raises(synth.SynthError):
        synth.project(CAM, 0.0, (0.0, -1.0, 0.0))


def test_plan_4b_fits_rejects_edge_and_overlay():
    """PLAN-4b: 端から 2% の内側・焼き込みの外だけ置ける。"""
    size = (100, 100)
    assert synth._fits((3, 3, 50, 50), size, [])
    assert not synth._fits((1, 3, 50, 50), size, [])  # 左の余白に入る
    assert not synth._fits((3, 3, 99, 50), size, [])  # 右の余白に入る
    assert not synth._fits((3, 3, 50, 50), size, [(40, 40, 20, 20)])  # 焼き込みと重なる
    assert synth._fits((3, 3, 50, 50), size, [(50, 3, 20, 20)])  # 接するだけは重ならない


def test_plan_4b_overlay_covering_everything_discards_all_and_counts(cfg_factory):
    """PLAN-4b: 1 頭も置けなければその枚を捨てて数える。"""
    cfg = cfg_factory()
    bgs = backgrounds(overlay=((0, 0, W, H),))
    plan = synth.plan_jobs(cfg, bgs, 6, 1, road_for(bgs))
    assert plan.jobs == []
    assert (plan.unplaced, plan.planned) == (6, 6)


def test_plan_4b_off_screen_placement_is_retried_then_discarded(cfg_factory):
    """PLAN-4b: 画面の外になる置き方は置き直し、tries を超えたら置かない。"""
    cfg = cfg_factory(_setter("placement", "lateral_m", [40.0, 50.0]))
    bgs = backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 5, 1, road_for(bgs))
    assert plan.jobs == []
    assert plan.unplaced == 5


def _stack_at_one_spot(gap: float):
    def mutate(d):
        d["placement"].update(
            distance_m=[10.0, 10.0], lateral_m=[0.0, 0.0], extra_deer_p=1.0, min_gap_m=gap
        )

    return mutate


def test_plan_4b_too_close_deer_are_dropped(cfg_factory):
    """PLAN-4b: 鹿どうしが min_gap_m より近い置き方は置かず、鹿を減らす（1 頭は置ける）。"""
    cfg, bgs = cfg_factory(_stack_at_one_spot(100.0)), backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 6, 1, road_for(bgs))
    assert len(plan.jobs) == 6
    assert {len(j["deer"]) for j in plan.jobs} == {1}


def test_plan_4b_zero_gap_allows_all_deer(cfg_factory):
    """PLAN-4b: min_gap_m が 0 なら同じ場所にも置ける（max_deer 頭）。"""
    cfg, bgs = cfg_factory(_stack_at_one_spot(0.0)), backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 6, 1, road_for(bgs))
    assert {len(j["deer"]) for j in plan.jobs} == {3}


def test_plan_4b_band_of_distance():
    """PLAN-4b: 距離の帯（8〜20・20〜35・35〜50 m）。"""
    assert synth.band_of(8.0) == "8-20"
    assert synth.band_of(19.9) == "8-20"
    assert synth.band_of(20.0) == "20-35"
    assert synth.band_of(40.0) == "35-50"
    assert synth.band_of(60.0) == "35-50"
    assert synth.band_of(5.0) == "near"


def test_plan_4c_road_luma_is_median_of_bottom_quarter_center_third():
    """PLAN-4c: 路面の帯は画面の下 1/4 の中央 1/3 の中央値（外の画素・外れ値に左右されない）。"""
    img = np.full((H, W, 3), 255, dtype=np.uint8)
    img[H * 3 // 4 :, W // 3 : W * 2 // 3] = 100
    img[H - 1, W // 2] = 255  # 外れ値 1 画素
    assert synth.road_luma(img) == pytest.approx(100.0)


def test_plan_4c_exposure_scales_by_gamma_and_has_floor():
    """PLAN-4c: road_ref で 1 倍、2 倍の明るさで 2^2.2 倍、真っ黒でも 0 にならない。"""
    assert synth.exposure(20.0, 20.0) == pytest.approx(1.0)
    assert synth.exposure(40.0, 20.0) == pytest.approx(2**2.2)
    assert synth.exposure(0.0, 20.0) == pytest.approx((synth.ROAD_FLOOR / 20.0) ** 2.2)
    assert synth.exposure(0.0, 20.0) > 0
    assert synth.exposure(1.0, 20.0) == synth.exposure(0.0, 20.0)


@pytest.mark.parametrize("road", [20.0, 40.0, 10.0, 0.0])
def test_plan_4c_light_power_follows_road_brightness(cfg_factory, road):
    """PLAN-4c: ヘッドライトの強さ = power_w × (max(路面, 2) / road_ref)^2.2。"""
    cfg = cfg_factory(_setter("headlight", "power_w", [1000.0, 1000.0]))
    bgs = backgrounds()
    plan = synth.plan_jobs(cfg, bgs, 4, 1, road_for(bgs, road))
    want = 1000.0 * (max(road, 2.0) / 20.0) ** 2.2
    assert plan.jobs
    for job in plan.jobs:
        assert job["light"]["power_w"] == pytest.approx(want)
        assert job["light"]["road"] == road
        assert job["light"]["power_w"] > 0


def test_plan_4c_run_measures_road_from_each_background(world):
    """PLAN-4c: run は各背景の路面の帯を測って manifest の light.road に残す。"""
    world.run("s1")
    for f in world.manifest()["files"]:
        bg = fake_read_image(world.footage / f["background"]["image"])
        assert f["light"]["road"] == pytest.approx(synth.road_luma(bg), abs=0.01)


# ---------------------------------------------------------------- COMP-5 合成と採否


def test_comp_5a_edge_pixels_are_not_darker_than_background_or_deer(cfg_factory):
    """COMP-5a: premultiply で重ね、縁の画素は鹿の内側と背景の両方より暗くならない。"""
    cfg = cfg_factory()
    out = synth.composite(
        const_bg(100), make_rendered([RECT], color=150), make_job(blur=1.5), bg_info(), cfg
    )
    assert out.image is not None
    assert out.image.min() >= 100  # 背景（100）より暗い縁が無い
    assert out.image.max() <= 250  # 鹿の内側（150 + 床 100）より明るい縁が無い


def test_comp_5a_burned_in_overlay_stays_black_even_with_noise(cfg_factory):
    """COMP-5a: 焼き込みの矩形はノイズを足した後も黒（0）のまま。"""
    cfg = cfg_factory()
    out = synth.composite(
        const_bg(100),
        make_rendered([RECT]),
        make_job(blur=1.0, noise=3.0),
        bg_info(overlay=(OVERLAY,)),
        cfg,
    )
    x, y, w, h = OVERLAY
    assert out.image is not None
    assert (out.image[y : y + h, x : x + w] == 0).all()


def test_comp_5a_zero_noise_keeps_background_where_there_is_no_deer(cfg_factory):
    """COMP-5a: σ 0 なら、鹿の無い画素は背景のまま。"""
    cfg = cfg_factory()
    out = synth.composite(const_bg(100), make_rendered([RECT]), make_job(blur=1.0), bg_info(), cfg)
    assert out.image is not None
    assert (out.image[:20, :20] == 100).all()


def test_comp_5a_noise_is_added_to_whole_frame(cfg_factory):
    """COMP-5a: ノイズは画面全体に（鹿の無い隅にも、鹿の中にも同じように）。"""
    cfg = cfg_factory()
    out = synth.composite(const_bg(100), make_rendered([RECT]), make_job(noise=3.0), bg_info(), cfg)
    assert out.image is not None
    corner = out.image[:20, :20].astype(float)
    inside = out.image[35:55, 25:55].astype(float)
    assert corner.std() > 1.0
    assert inside.std() == pytest.approx(corner.std(), rel=0.3)


def test_comp_5a_dark_floor_is_added_to_deer_pixels(cfg_factory):
    """COMP-5a: 黒の床。真っ黒な鹿の画素に背景の暗部（2 百分位）の明るさが足される。"""
    bg = const_bg(100)
    bg[:, : W // 2] = 40
    out = synth.composite(
        bg, make_rendered([(70, 30, 100, 60)], color=0), make_job(), bg_info(), cfg_factory()
    )
    assert out.image is not None
    assert (out.image[40:50, 80:90] == 40).all()


def test_comp_5b_box_is_circumscribed_rect_of_visible_mask(cfg_factory):
    """COMP-5b: 箱は見えているマスクの外接矩形 [x, y, w, h]。"""
    out = synth.composite(
        const_bg(100), make_rendered([RECT]), make_job(), bg_info(), cfg_factory()
    )
    assert out.deer[0]["box"] == [20, 30, 40, 30]


def test_comp_5b_mask_threshold_is_half(cfg_factory):
    """COMP-5b: アルファ 0.5 未満の縁は箱に入らず、0.5 以上は入る。"""
    rendered = make_rendered([(30, 30, 50, 60)])
    rgba = rendered.rgba.copy()
    rgba[28:30, 30:50, 3] = 127  # 0.498（入らない）
    rgba[60:62, 30:50, 3] = 128  # 0.502（入る）
    rendered = synth.Rendered(rgba, (), ((30.0, 28.0, 50.0, 62.0),), (0,))
    out = synth.composite(const_bg(100), rendered, make_job(), bg_info(), cfg_factory())
    assert out.deer[0]["box"] == [30, 30, 20, 32]


def test_comp_5b_box_excludes_pixels_under_burned_in_overlay(cfg_factory):
    """COMP-5b: 焼き込みの矩形の下の画素は箱に入らない。"""
    strip = (100, 0, 20, H)
    out = synth.composite(
        const_bg(100),
        make_rendered([(70, 30, 110, 60)]),
        make_job(),
        bg_info(overlay=(strip,)),
        cfg_factory(),
    )
    assert out.reason is None
    assert out.deer[0]["box"] == [70, 30, 30, 30]


def test_comp_5b_occluded_part_is_not_in_back_deer_box(cfg_factory):
    """COMP-5b: 2 頭で手前の鹿に隠れた部分は、奥の鹿の箱に入らない。"""
    back, front = (20, 30, 60, 60), (40, 30, 80, 60)
    m_back = np.zeros((H, W))
    m_back[30:60, 20:40] = 1.0  # 手前に隠れていない左半分だけ（holdout したアルファ）
    m_front = np.zeros((H, W))
    m_front[30:60, 40:80] = 1.0
    rendered = make_rendered([back, front], masks=[m_back, m_front])

    def loose(d):
        d["accept"]["max_cut"] = 0.9

    out = synth.composite(const_bg(100), rendered, make_job(2), bg_info(), cfg_factory(loose))
    assert out.reason is None
    assert [d["box"] for d in out.deer] == [[20, 30, 20, 30], [40, 30, 40, 30]]


def _reason(cfg, rendered, *, bg=None, background=None, noise=0.0):
    n = len(rendered.boxes)
    out = synth.composite(
        const_bg(100) if bg is None else bg,
        rendered,
        make_job(n, noise=noise),
        background or bg_info(),
        cfg,
    )
    return out


def test_comp_5c_accepted_deer_gives_image_and_no_reason(cfg_factory):
    """COMP-5c: 条件に合えば画像ができて reason は None。"""
    out = _reason(cfg_factory(), make_rendered([RECT]))
    assert out.reason is None
    assert out.image is not None
    assert out.image.shape == (H, W, 3)


def test_comp_5c_small_uses_l0_pixels(cfg_factory):
    """COMP-5c: small。箱の高さは L0 の画素（縦 ×0.5）に直して min_box_h と比べる。"""

    def half(d):
        d["accept"].update(l0_size=[W // 2, H // 2], min_box_h=10.0)

    cfg = cfg_factory(half)
    assert _reason(cfg, make_rendered([(20, 30, 60, 45)])).reason == "small"  # 15 → 7.5
    assert _reason(cfg, make_rendered([(20, 30, 60, 55)])).reason is None  # 25 → 12.5


def test_comp_5c_few_uses_l0_pixels(cfg_factory):
    """COMP-5c: few。見えている画素数も L0 の面積（×0.25）に直して min_visible と比べる。"""

    def half(d):
        d["accept"].update(l0_size=[W // 2, H // 2], min_visible=40.0)

    assert _reason(cfg_factory(half), make_rendered([(20, 30, 30, 40)])).reason == "few"


def test_comp_5c_few_when_nothing_is_visible(cfg_factory):
    """COMP-5c: マスクが空（見えている画素 0）なら few。"""
    rendered = synth.Rendered(
        np.zeros((H, W, 4), dtype=np.uint8), (), (tuple(map(float, RECT)),), (0,)
    )
    out = _reason(cfg_factory(), rendered)
    assert (out.reason, out.image) == ("few", None)
    assert out.deer[0]["visible_px"] == 0


def test_comp_5c_dark_even_when_noise_is_large(cfg_factory):
    """COMP-5c: dark。ノイズを足す前に測るので、ノイズを大きくしても暗い鹿は捨てる。"""
    out = _reason(cfg_factory(), make_rendered([RECT], color=0), noise=50.0)
    assert (out.reason, out.image) == ("dark", None)


def test_comp_5c_bright_deer_on_dark_background(cfg_factory):
    """COMP-5c: bright。真っ暗な背景に明るい鹿だけが浮く画像は捨てる。"""
    out = _reason(cfg_factory(), make_rendered([RECT], color=200), bg=const_bg(10))
    assert out.reason == "bright"


def test_comp_5c_cut_when_projected_box_is_larger_than_visible(cfg_factory):
    """COMP-5c: cut。射影の箱（画面で切らない）より見えている箱が小さい → 画面の端で切れた鹿。"""
    rendered = make_rendered([RECT], proj=[(20.0, 30.0, 140.0, 60.0)])
    assert _reason(cfg_factory(), rendered).reason == "cut"


def test_comp_5c_cut_by_burned_in_overlay(cfg_factory):
    """COMP-5c: cut。焼き込みの矩形に半分隠れた鹿も cut。"""
    background = bg_info(overlay=((90, 0, 30, H),))
    rendered = make_rendered([(70, 30, 110, 60)])
    assert _reason(cfg_factory(), rendered, background=background).reason == "cut"


def test_comp_5c_blurbox_when_overlapping_blurred_person_or_car(cfg_factory):
    """COMP-5c: blurbox。箱が背景のぼかしの箱（人・車）と重なる。"""
    background = bg_info(blur=((30, 35, 5, 5),))
    assert _reason(cfg_factory(), make_rendered([RECT]), background=background).reason == "blurbox"


def test_comp_5c_blur_box_that_only_touches_does_not_reject(cfg_factory):
    """COMP-5c: ぼかしの箱が接するだけ（重ならない）なら捨てない。"""
    background = bg_info(blur=((60, 30, 5, 5),))
    assert _reason(cfg_factory(), make_rendered([RECT]), background=background).reason is None


def test_comp_5c_one_bad_deer_discards_whole_image(cfg_factory):
    """COMP-5c: 1 頭でも採らない鹿があれば、その 1 枚を捨てる。"""

    def mutate(d):
        d["accept"]["min_box_h"] = 20.0

    rendered = make_rendered([(20, 30, 40, 60), (50, 30, 70, 40)])  # 2 頭目は高さ 10
    out = _reason(cfg_factory(mutate), rendered)
    assert (out.reason, out.image) == ("small", None)
    assert len(out.deer) == 2


def test_comp_5c_run_counts_rejections_by_reason_and_writes_nothing(tmp_path):
    """COMP-5c: run は捨てた枚を理由ごとに数え、画像もラベルも書かない。"""
    world = make_world(tmp_path, _setter("accept", "min_box_h", 10.0), rect_h=5)
    summary = world.run("s1", 6)
    m = world.manifest()
    placed = m["counts"]["planned"] - m["counts"]["unplaced"]
    assert summary.written == 0
    assert m["counts"]["rejected"]["small"] == placed > 0
    assert m["files"] == []
    assert list((world.out / "s1" / "images" / "train").iterdir()) == []


def test_comp_5d_same_seed_gives_same_pixels(cfg_factory):
    """COMP-5d: 同じ合成のシードで同じ画素。"""
    cfg = cfg_factory()
    a = synth.composite(
        const_bg(100), make_rendered([RECT]), make_job(noise=3.0, seed=5), bg_info(), cfg
    )
    b = synth.composite(
        const_bg(100), make_rendered([RECT]), make_job(noise=3.0, seed=5), bg_info(), cfg
    )
    assert a.image is not None
    assert np.array_equal(a.image, b.image)


def test_comp_5d_different_seed_gives_different_noise(cfg_factory):
    """COMP-5d: 違う合成のシードではノイズが違う。"""
    cfg = cfg_factory()
    a = synth.composite(
        const_bg(100), make_rendered([RECT]), make_job(noise=3.0, seed=5), bg_info(), cfg
    )
    b = synth.composite(
        const_bg(100), make_rendered([RECT]), make_job(noise=3.0, seed=6), bg_info(), cfg
    )
    assert a.image is not None
    assert b.image is not None
    assert not np.array_equal(a.image, b.image)


def test_comp_5_gaussian_and_luma_helpers():
    """COMP-5a: ぼかしは一様な画像を変えず、σ 0 は何もしない。luma は Rec. 601。"""
    flat = np.full((10, 10), 7.0)
    assert synth.gaussian(flat, 1.5) == pytest.approx(flat)
    assert np.array_equal(synth.gaussian(flat, 0.0), flat)
    bgr = np.array([[[10, 20, 30]]], dtype=np.uint8)
    assert synth.luma(bgr)[0, 0] == pytest.approx(0.114 * 10 + 0.587 * 20 + 0.299 * 30)


# ---------------------------------------------------------------- OUT-6 書き出し


def test_out_6a_yolo_lines_format():
    """OUT-6a: `0 cx cy w h`（中心基準の正規化、小数 6 桁、鹿ごとに 1 行）。"""
    text = synth.yolo_lines([(10, 30, 20, 30), (0, 0, 120, 90)], (120, 90))
    assert text == (
        "0 0.166667 0.500000 0.166667 0.333333\n0 0.500000 0.500000 1.000000 1.000000\n"
    )
    assert synth.yolo_lines([], (120, 90)) == ""


def test_out_6a_labels_match_images_one_line_per_deer(world):
    """OUT-6a: 画像とラベルが同じ名前で対応し、行の形が正しい。"""
    world.run("s1")
    final = world.out / "s1"
    images = sorted(p.stem for p in (final / "images" / "train").glob("*.jpg"))
    labels = sorted(p.stem for p in (final / "labels" / "train").glob("*.txt"))
    assert images == labels
    assert images
    line = re.compile(r"0 \d\.\d{6} \d\.\d{6} \d\.\d{6} \d\.\d{6}")
    for f in world.manifest()["files"]:
        rows = (final / f["label"]).read_text(encoding="utf-8").splitlines()
        assert len(rows) == len(f["deer"])
        assert all(line.fullmatch(r) for r in rows)


def test_out_6a_jpeg_has_only_allowed_markers_before_sos(world):
    """OUT-6a: 書いた JPEG の SOS より前に、許していないマーカーが無い。"""
    from self_footage import jpeg_metadata

    world.run("s1")
    for p in (world.out / "s1" / "images" / "train").glob("*.jpg"):
        assert jpeg_metadata(p.read_bytes()) == []


def test_out_6a_disallowed_jpeg_marker_raises_and_cleans_up(world):
    """OUT-6a: 許していないマーカー（APP1 = EXIF）があればエラー。何も残らない。"""
    exif = b"\xff\xd8\xff\xe1\x00\x04Ex\xff\xda\x00\x00"
    world.io = synth.IO(fake_read_image, fake_read_png, lambda img, q: exif, world.blender)
    with pytest.raises(synth.SynthError, match="0xFFE1"):
        synth.run(world.config, world.footage, world.models, world.out, "s1", 6, 7, world.io)
    assert not (world.out / "s1").exists()
    assert not (world.out / ".tmp-s1").exists()


def test_out_6a_non_jpeg_bytes_raise_and_clean_up(world):
    """OUT-6a: JPEG でないバイト列もエラーで、一時フォルダが消える。"""
    io = synth.IO(fake_read_image, fake_read_png, lambda img, q: b"not a jpeg", world.blender)
    with pytest.raises(FootageError):
        synth.run(world.config, world.footage, world.models, world.out, "s1", 6, 7, io)
    assert not (world.out / ".tmp-s1").exists()


def test_out_6b_manifest_top_level(world):
    """OUT-6b: manifest の全体（種類・シード・ライセンス・照合用の SHA・版・一覧）。"""
    world.run("s1", 9, 7)
    m = world.manifest()
    assert (m["version"], m["kind"], m["run"], m["seed"]) == (1, "synth", "s1", 7)
    assert (m["license"], m["allowed_use"]) == ("self", ["train"])
    assert m["footage_manifest_sha256"] == sha_of((world.footage / "manifest.json").read_bytes())
    assert m["deer3d_manifest_sha256"] == sha_of((world.models / "manifest.json").read_bytes())
    assert m["blender"] == "4.5.15-fake"
    assert m["numpy"] == np.__version__
    assert m["config"] == world.config.raw
    assert set(m["models"]) == {"M01", "M02", "M03"}
    assert set(m["models"]["M01"]) == {"file", "sha256", "license", "author", "name"}
    assert m["models"]["M01"]["file"] == "Stag.glb"


def test_out_6b_distribution_and_blur_reviewed_are_inherited(world):
    """OUT-6b: distribution・blur_reviewed は背景の manifest から引き継ぐ。"""
    edit_json(
        world.footage / "manifest.json",
        lambda m: m.update(distribution="allowed", blur_reviewed=True),
    )
    world.run("s1")
    m = world.manifest()
    assert (m["distribution"], m["blur_reviewed"]) == ("allowed", True)


def test_out_6b_sources_per_background_clip(world):
    """OUT-6b: sources は synth:<クリップ> → license self・背景のクリップ・時間帯。"""
    world.run("s1")
    assert world.manifest()["sources"] == {
        "synth:c1": {"license": "self", "background": "c1", "time_of_day": "night"}
    }


def test_out_6b_files_entries(world):
    """OUT-6b: files[] の項目（group・split・video・background・camera・deer・light）。"""
    world.run("s1")
    m = world.manifest()
    groups = {"frames/c1_000.jpg": "self:drive1", "frames/c1_002.jpg": "self:drive2"}
    for f in m["files"]:
        assert f["split"] == "train"
        assert f["video"] == "synth:c1"
        assert f["image"].startswith("images/train/s1_")
        assert f["label"] == f["image"].replace("images", "labels").replace(".jpg", ".txt")
        assert f["sha256"] == sha_of((world.out / "s1" / f["image"]).read_bytes())
        bg_path = f["background"]["image"]
        assert f["background"]["sha256"] == sha_of((world.footage / bg_path).read_bytes())
        if bg_path in groups:
            assert f["group"] == groups[bg_path]
        assert set(f["camera"]) == {"pitch_deg"}
        assert set(f["light"]) == {"power_w", "ambient", "road", "blur_px", "noise", "seed"}
        for d in f["deer"]:
            assert set(d) == {
                "model", "action", "frame", "distance_m", "lateral_m", "yaw_deg",
                "shoulder_m", "box", "visible_px", "contrast", "bright_ratio",
            }  # fmt: skip


def test_out_6b_counts_by_reason_and_band_and_heads(world):
    """OUT-6b: counts（計画・書いた・理由ごと・距離の帯 × 頭数）。"""
    world.run("s1", 30)
    c = world.manifest()["counts"]
    assert c["planned"] == 30
    assert set(c["rejected"]) == set(synth.REASONS)
    assert c["written"] == len(world.manifest()["files"])
    planned_cells = [cell for heads in c["by_band"].values() for cell in heads.values()]
    assert sum(cell["planned"] for cell in planned_cells) == 30 - c["unplaced"]
    assert sum(cell["written"] for cell in planned_cells) == c["written"]
    assert set(c["by_band"]) <= {"8-20", "20-35", "35-50"}
    assert {h for heads in c["by_band"].values() for h in heads} <= {"1", "2", "3"}


def test_out_6b_run_folder_has_no_intermediate_files(world):
    """OUT-6b: 中間の PNG・JSON・jobs.json・一時フォルダは残らない。"""
    world.run("s1")
    assert {p.name for p in (world.out / "s1").iterdir()} == {"images", "labels", "manifest.json"}
    assert not (world.out / ".tmp-s1").exists()
    assert list((world.out / "s1").rglob("*.png")) == []


def test_out_6b_review_folder_has_boxed_half_size_images(world):
    """OUT-6b: 目で見る一覧が <run>-review/ にできる（半分の大きさ・manifest の外）。"""
    world.run("s1")
    review = world.out / "s1-review"
    names = sorted(p.stem for p in review.glob("*.jpg"))
    assert names
    assert set(names) <= {Path(f["image"]).stem for f in world.manifest()["files"]}
    assert fake_read_image(next(review.glob("*.jpg"))).shape == (H // 2, W // 2, 3)
    assert "-review" not in json.dumps(world.manifest())


def test_out_6b_review_is_capped(world, monkeypatch):
    """OUT-6b: 目で見る一覧は最大 REVIEW_MAX 枚。"""
    monkeypatch.setattr(synth, "REVIEW_MAX", 2)
    world.run("s1", 12)
    assert len(list((world.out / "s1-review").glob("*.jpg"))) == 2


def test_out_6b_review_image_draws_red_box_on_half_size():
    """OUT-6b: 箱は赤（BGR）で半分の大きさの画像に描く。"""
    img = np.full((H, W, 3), 50, dtype=np.uint8)
    small = synth.review_image(img, [(20, 20, 40, 30)])
    assert small.shape == (H // 2, W // 2, 3)
    assert tuple(small[10, 20]) == (0, 0, 255)  # 上の辺
    assert tuple(small[20, 15]) == (50, 50, 50)  # 箱の内側


def test_out_6b_batches_call_blender_once_per_batch(world, monkeypatch):
    """OUT-6b: Blender は BATCH 枚ごとに 1 回呼ぶ。"""
    monkeypatch.setattr(synth, "BATCH", 2)
    summary = world.run("s1", 7)
    placed = summary.planned - summary.counts["unplaced"]
    assert world.blender.calls == ["render"] * math.ceil(placed / 2)
    assert world.manifest()["counts"]["written"] == summary.written


def test_out_6b_render_payload_has_no_leak_into_manifest(world):
    """OUT-6b: Blender に渡す絶対パスは payload だけで、manifest には写らない。"""
    world.run("s1")
    payload = world.blender.payloads[0]
    assert str(world.models) in json.dumps(payload)
    assert str(world.models) not in (world.out / "s1" / "manifest.json").read_text(encoding="utf-8")
    assert payload["jobs"][0]["id"] == "00000"
    assert set(payload["jobs"][0]) == {"id", "pitch_deg", "light", "deer"}
    assert payload["models"]["M03"]["kind"] == "blend"
    assert payload["models"]["M01"]["kind"] == "glb"


def test_out_6b_report_lists_counts_without_paths(world, tmp_path):
    """OUT-6b: 終わりの表示に枚数・理由・帯・明るさが出て、パスは出ない。"""
    summary = world.run("s1", 12)
    stream = StringIO()
    synth.report(summary, stream)
    text = stream.getvalue()
    assert "書いた" in text
    assert "捨てた" in text
    assert "明るさ" in text
    assert str(tmp_path) not in text


@pytest.mark.parametrize("place", ["out", "footage", "models"])
def test_out_6c_wrong_place_raises(tmp_path, place):
    """OUT-6c: --out・--footage・--models がちょうどの置き場所でない → エラー。"""
    root = tmp_path / "dataset"
    args = {
        "out": root / "private" / "self-synth",
        "footage": root / "private" / "self-footage",
        "models": root / "external" / "deer3d",
    }
    for p in args.values():
        p.mkdir(parents=True)
    synth.check_locations(args["out"], args["footage"], args["models"])  # 正しければ通る
    args[place] = tmp_path / "elsewhere"
    args[place].mkdir()
    with pytest.raises(synth.SynthError, match="リンクも受けない"):
        synth.check_locations(args["out"], args["footage"], args["models"])


def test_out_6c_symlink_alias_raises(tmp_path):
    """OUT-6c: リンクを通した別名（途中のフォルダがリンク）もエラー。"""
    real = tmp_path / "real_ds"
    (real / "private" / "self-synth").mkdir(parents=True)
    (real / "private" / "self-footage").mkdir()
    (real / "external" / "deer3d").mkdir(parents=True)
    alias = tmp_path / "x" / "dataset"
    alias.parent.mkdir()
    alias.symlink_to(real)
    with pytest.raises(synth.SynthError):
        synth.check_locations(
            alias / "private" / "self-synth",
            alias / "private" / "self-footage",
            alias / "external" / "deer3d",
        )


def test_out_6c_symlink_as_last_component_raises(tmp_path):
    """OUT-6c: 置き場所そのものがリンクでもエラー。"""
    root = tmp_path / "dataset"
    (root / "private").mkdir(parents=True)
    (root / "elsewhere").mkdir()
    (root / "private" / "self-synth").symlink_to(root / "elsewhere")
    (root / "private" / "self-footage").mkdir()
    (root / "external" / "deer3d").mkdir(parents=True)
    with pytest.raises(synth.SynthError):
        synth.check_locations(
            root / "private" / "self-synth",
            root / "private" / "self-footage",
            root / "external" / "deer3d",
        )


def test_out_6c_main_wrong_out_exits_2_and_creates_nothing(tmp_path, capsys):
    """OUT-6c: 置き場所が違えば終了コード 2、何も作らない。"""
    world = make_world(tmp_path)
    bad = tmp_path / "other"
    argv = world.cli("run", "--run", "s1", "--count", "3", "--seed", "1")
    argv[argv.index("--out") + 1] = str(bad)
    assert synth.main(argv) == 2
    assert not bad.exists()
    assert "エラー" in capsys.readouterr().err


@pytest.mark.parametrize("name", ["", "A", "-a", "a_b", "a/b", "x" * 33, "../s1"])
def test_out_6c_invalid_run_name_raises_and_creates_nothing(world, name):
    """OUT-6c: run の名前の書式違い → エラー、何も作らない。"""
    with pytest.raises(synth.SynthError, match="書式"):
        world.run(name)
    assert not world.out.exists()


def test_out_6c_run_name_ending_with_review_raises(world):
    """OUT-6c: 一覧 <run>-review/ とぶつかる名前（-review で終わる）→ エラー、何も作らない。"""
    with pytest.raises(synth.SynthError, match="-review"):
        world.run("s1-review")
    assert not world.out.exists()


def test_out_6c_valid_run_names_are_accepted(world):
    """OUT-6c: 英小文字・数字・- の 32 文字までは通る。"""
    assert synth.RUN_RE.fullmatch("a" * 32)
    assert synth.RUN_RE.fullmatch("0-a")


def test_out_6c_count_must_be_positive(world):
    """OUT-6c: count は正の整数。"""
    with pytest.raises(synth.SynthError, match="count"):
        world.run("s1", 0)


def test_out_6c_main_runs_end_to_end_with_fake_io(tmp_path, monkeypatch, capsys):
    """OUT-6c: 正しい置き場所なら main は 0 を返し、表示が出る（Blender・opencv は偽物）。"""
    world = make_world(tmp_path)
    monkeypatch.setattr(synth, "real_io", lambda blender: world.io)
    assert synth.main(world.cli("run", "--run", "s1", "--count", "6", "--seed", "7")) == 0
    assert (world.out / "s1" / "manifest.json").is_file()
    assert "書いた" in capsys.readouterr().out


def test_out_6c_main_invalid_run_name_exits_2(tmp_path, monkeypatch):
    """OUT-6c: main でも run の名前の書式違いは終了コード 2、何も作らない。"""
    world = make_world(tmp_path)
    monkeypatch.setattr(synth, "real_io", lambda blender: world.io)
    assert synth.main(world.cli("run", "--run", "Bad_Name", "--count", "3", "--seed", "1")) == 2
    assert not list(world.out.glob("*"))


@pytest.mark.parametrize("skip", ["png", "json", "mask", "mask1"])
def test_out_6d_missing_render_file_cleans_up_and_makes_no_run(tmp_path, skip):
    """OUT-6d / S-1: 描画のファイルが欠ける → エラーで一時フォルダが消え、run ができない。"""
    world = make_world(tmp_path, _setter("placement", "extra_deer_p", 1.0), skip=frozenset({skip}))
    with pytest.raises(synth.SynthError, match="描画"):
        world.run("s1")
    assert list(world.out.glob("*")) == []


def test_out_6d_render_shape_mismatch_raises(tmp_path):
    """OUT-6d: 描画の箱の数が鹿の数と合わない → エラー、何も残らない。"""
    world = make_world(tmp_path, bad_boxes=True)
    with pytest.raises(synth.SynthError, match="形が違う"):
        world.run("s1")
    assert list(world.out.glob("*")) == []


def test_out_6d_blender_failure_cleans_up_and_makes_no_run(tmp_path):
    """OUT-6d / S-1: 子プロセスの失敗 → 一時フォルダが消え、run ができない。"""
    world = make_world(tmp_path, fail=True)
    with pytest.raises(synth.SynthError, match="Blender"):
        world.run("s1")
    assert list(world.out.glob("*")) == []


def test_out_6d_failure_midway_in_composite_cleans_up(world):
    """OUT-6d / S-1: 合成の途中のエラー（2 枚目で失敗）でも、一時フォルダが消える。"""
    calls = []

    def flaky(img, quality):
        calls.append(1)
        if len(calls) == 2:
            raise synth.SynthError("JPEG に書けない")
        return fake_encode_jpeg(img, quality)

    io = synth.IO(fake_read_image, fake_read_png, flaky, world.blender)
    with pytest.raises(synth.SynthError, match="JPEG"):
        synth.run(world.config, world.footage, world.models, world.out, "s1", 9, 7, io)
    assert len(calls) == 2
    assert list(world.out.glob("*")) == []


def test_out_6d_failed_run_can_be_retried_with_same_name(tmp_path):
    """OUT-6d: 失敗の後は一時フォルダが無いので、同じ名前でやり直せる。"""
    world = make_world(tmp_path, fail=True)
    with pytest.raises(synth.SynthError):
        world.run("s1")
    world.blender.fail = False
    assert world.run("s1").written > 0


def test_out_6d_existing_lock_folder_is_error_and_not_removed(world):
    """OUT-6d: 一時フォルダ（鍵）が既にある → エラーで、消さない。"""
    lock = world.out / ".tmp-s1"
    lock.mkdir(parents=True)
    (lock / "keep.txt").write_text("other run", encoding="utf-8")
    with pytest.raises(synth.SynthError, match=r"\.tmp-s1"):
        world.run("s1")
    assert (lock / "keep.txt").read_text(encoding="utf-8") == "other run"
    assert not (world.out / "s1").exists()
    assert world.blender.calls == []


def test_s2_existing_run_is_error_and_previous_run_unchanged(world):
    """S-2: 同じ run 名 → エラーで、前の run は変わらない。"""
    world.run("s1")
    before = (world.out / "s1" / "manifest.json").read_bytes()
    with pytest.raises(synth.SynthError, match="既にある"):
        world.run("s1")
    assert (world.out / "s1" / "manifest.json").read_bytes() == before
    assert not (world.out / ".tmp-s1").exists()


def test_s2_existing_run_folder_is_not_touched_even_if_empty(world):
    """S-2: 空の run フォルダがあっても上書きしない（何も作らない）。"""
    (world.out / "s1").mkdir(parents=True)
    with pytest.raises(synth.SynthError, match="既にある"):
        world.run("s1")
    assert list((world.out / "s1").iterdir()) == []
    assert world.blender.calls == []


def test_s2_run_folder_appearing_during_run_is_not_overwritten(tmp_path):
    """OUT-6d: 名前を変える直前にもう一度確かめる。途中で現れた run は消さない。"""
    holder: dict = {}

    def appear(mode):
        final = holder["world"].out / "s1"
        final.mkdir(exist_ok=True)
        (final / "theirs.txt").write_text("theirs", encoding="utf-8")

    world = make_world(tmp_path, hook=appear)
    holder["world"] = world
    with pytest.raises(synth.SynthError, match="既にある"):
        world.run("s1")
    assert (world.out / "s1" / "theirs.txt").read_text(encoding="utf-8") == "theirs"
    assert not (world.out / ".tmp-s1").exists()


# ---------------------------------------------------------------- CHK-7 射影の突き合わせ


def run_check(world: World) -> tuple[list[str], dict]:
    return synth.check(world.config, world.models, world.out, world.io)


def test_chk_7a_check_points_are_five_with_pitch_variety(cfg_factory):
    """CHK-7a: 突き合わせの点は 5 つで、下向きの角が 3 通り。"""
    points = synth.check_points(cfg_factory())
    assert len(points) == 5
    assert len({p["pitch_deg"] for p in points}) == 3


def test_chk_7a_passes_when_blender_matches_python(world):
    """CHK-7a: Blender の射影が Python と一致すれば通る（問題なし）。"""
    problems, result = run_check(world)
    assert problems == []
    assert len(result["projection"]) == 5
    assert world.blender.calls == ["check"]
    assert len(world.blender.payloads[0]["check_points"]) == 5


@pytest.mark.parametrize(("shift", "ok"), [(1.9, True), (2.5, False)])
def test_chk_7a_projection_gap_threshold_is_two_pixels(world, shift, ok):
    """CHK-7a: 射影のずれが 2 px 以内なら通り、超えれば失敗。"""

    def move(result):
        result["projection"][0]["uv"][0] += shift

    world.blender.check_mutate = move
    problems, _ = run_check(world)
    assert (problems == []) is ok
    if not ok:
        assert "射影のずれ" in problems[0]


def test_chk_7a_missing_projection_points_fail(world):
    """CHK-7a: 射影の点が足りなければ失敗。"""
    world.blender.check_mutate = lambda r: r["projection"].pop()
    problems, _ = run_check(world)
    assert any("足りない" in p for p in problems)


def test_chk_7a_action_that_does_not_change_pose_fails(world):
    """CHK-7a: 動作が姿勢を変えない → 失敗。"""
    world.blender.check_mutate = lambda r: r["models"]["M01"]["actions"]["Walk"].update(
        pose_change=0.0
    )
    problems, _ = run_check(world)
    assert problems == ["M01: 動作 Walk が姿勢を変えない"]


def test_chk_7a_missing_action_result_fails(world):
    """CHK-7a: 動作の結果が無い → 失敗。"""
    world.blender.check_mutate = lambda r: r["models"]["M02"]["actions"].pop("Gallop")
    problems, _ = run_check(world)
    assert problems == ["M02: 動作 Gallop が姿勢を変えない"]


def test_chk_7a_untextured_model_fails(world):
    """CHK-7a: テクスチャが張れていないモデル → 失敗。"""
    world.blender.check_mutate = lambda r: r["models"]["M03"].update(textured=[])
    problems, _ = run_check(world)
    assert len(problems) == 1
    assert "M03" in problems[0]
    assert "テクスチャ" in problems[0]


def test_chk_7a_model_without_result_fails(world):
    """CHK-7a: モデルの結果が無い → 失敗。"""
    world.blender.check_mutate = lambda r: r["models"].pop("M01")
    problems, _ = run_check(world)
    assert problems == ["M01: 結果が無い"]


def test_chk_7a_check_json_not_written_raises(tmp_path):
    """CHK-7a: check.json が書かれていなければエラー。"""
    world = make_world(tmp_path, skip=frozenset({"check"}))
    with pytest.raises(synth.SynthError, match=r"check\.json"):
        run_check(world)


def test_chk_7a_check_leaves_no_temp_folder_and_keeps_check_png(tmp_path):
    """CHK-7a: 一時フォルダは残らず、check.png があれば out にコピーする。"""
    world = make_world(tmp_path, write_png=True)
    run_check(world)
    assert [p.name for p in world.out.iterdir()] == ["check.png"]


def test_chk_7a_blender_failure_in_check_raises(tmp_path):
    """CHK-7a: Blender が失敗すればエラー（一時フォルダは残らない）。"""
    world = make_world(tmp_path, fail=True)
    with pytest.raises(synth.SynthError):
        run_check(world)
    assert list(world.out.glob(".tmp-check-*")) == []


def test_chk_7a_main_check_exit_codes(tmp_path, monkeypatch, capsys):
    """CHK-7a: main check は合格で 0、問題があれば 1。"""
    world = make_world(tmp_path)
    monkeypatch.setattr(synth, "real_io", lambda blender: world.io)
    argv = world.cli("check")
    assert synth.main(argv) == 0
    assert "check: 合格" in capsys.readouterr().out
    world.blender.check_mutate = lambda r: r["models"]["M03"].update(textured=[])
    assert synth.main(argv) == 1
    out = capsys.readouterr().out
    assert "check: 不合格" in out
    assert "問題:" in out
