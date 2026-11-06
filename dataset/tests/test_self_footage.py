"""self_footage.py のテスト（docs/specs/dataset-footage の Test List）。

元の映像・opencv・ultralytics は使わない。
偽の映像（numpy のフレーム）・偽の検出器・偽の JPEG で回す。
"""

from __future__ import annotations

import hashlib
import io
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pytest

import self_footage as sf
from self_footage import DeerSpan, Detection, FootageError, Settings

W, H = 80, 60
MASK = (56, 46, 24, 14)  # 右下の焼き込み
FPS = 5.0
COUNT = 60  # 12 秒
HEADER = b"\xff\xd8\xff\xe0\x00\x04JF\xff\xda"


# ---------------------------------------------------------------- 偽物


def frame_at(
    i: int,
    *,
    overlay: tuple[int, int] | None = (60, 50),
    digit: tuple[int, int] | None = None,
    size: tuple[int, int] = (W, H),
) -> np.ndarray:
    """動く暗い背景（毎フレーム変わる）と、動かない明るい格子（焼き込みの文字の代わり）。

    digit は毎フレーム形が変わる明るい桁（GPS の下の桁・秒の代わり）。
    """
    rng = np.random.default_rng(i)
    frame = rng.integers(0, 120, size=(size[1], size[0], 3), dtype=np.uint8)
    if overlay is not None:
        x, y = overlay
        patch = np.zeros((6, 12, 3), dtype=np.uint8)
        patch[::2, ::2] = 255
        frame[y : y + 6, x : x + 12] = patch
    if digit is not None:
        x, y = digit
        cell = np.zeros((6, 4, 3), dtype=np.uint8)
        cell[i % 6, :] = 255
        cell[:, i % 4] = 255
        frame[y : y + 6, x : x + 4] = cell
    return frame


@dataclass
class FakeVideo:
    fps: float = FPS
    frame_count: int = COUNT
    size: tuple[int, int] = (W, H)
    overlay: tuple[int, int] | None = (60, 50)
    digit: tuple[int, int] | None = None
    stop_at: int | None = None

    def frames(self, wanted: set[int]):
        for i in sorted(wanted):
            if self.stop_at is not None and i >= self.stop_at:
                return
            yield i, frame_at(i, overlay=self.overlay, digit=self.digit)


class FakeDetector:
    name = "fake-coco.pt"
    sha256 = "0" * 64

    def __init__(self, dets: list[Detection] | None = None) -> None:
        self.dets = (
            dets
            if dets is not None
            else [
                Detection("person", 0.9, (4.0, 4.0, 10.0, 20.0)),
                Detection("car", 0.8, (24.0, 10.0, 20.0, 20.0)),
                Detection("bicycle", 0.9, (2.0, 40.0, 8.0, 8.0)),
            ]
        )
        self.seen: list[np.ndarray] = []

    def __call__(self, frame: np.ndarray) -> list[Detection]:
        self.seen.append(frame.copy())
        return list(self.dets)


def fake_jpeg(frame: np.ndarray) -> bytes:
    return HEADER + frame.tobytes()


def decode(data: bytes) -> np.ndarray:
    return np.frombuffer(data[len(HEADER) :], dtype=np.uint8).reshape(H, W, 3)


CONFIG = """
[settings]
deer_every_s = 0.4
no_deer_every_s = 1.0
margin_s = 1.0

[camera.cam]
kind = "dashcam"
facing = "front"
size = [80, 60]
overlay_masks = [[56, 46, 24, 14]]
overlay_min_pixels = 5

[[drive]]
id = "2026-11-06"
split = "train"

[[drive]]
id = "2026-09-07"
split = "val"
{extra_drives}
[[clip]]
id = "20261106_deer"
file = "deer.mp4"
sha256 = "{sha_deer}"
drive = "2026-11-06"
camera = "cam"
time_of_day = "night"
area = "道東"
deer = [{{ start = 6.0, end = 8.0 }}]

[[clip]]
id = "20261106_night"
file = "night.mp4"
sha256 = "{sha_night}"
drive = "2026-11-06"
camera = "cam"
time_of_day = "night"
area = "道東"
deer = []

[[clip]]
id = "20260907_morning"
file = "morning.mp4"
sha256 = "{sha_morning}"
drive = "2026-09-07"
camera = "cam"
time_of_day = "day"
area = "道東"
deer = []
{extra_clips}
"""


def make_raw(root: Path, names: dict[str, str]) -> dict[str, str]:
    """偽の元の映像（中身は id の文字列）とサイドカーを置き、SHA-256 を返す。"""
    shas = {}
    for cid, file in names.items():
        folder = root / cid
        folder.mkdir(parents=True)
        body = f"video {cid}".encode()
        (folder / file).write_bytes(body)
        sha = hashlib.sha256(body).hexdigest()
        (folder / f"{file}.sha256").write_text(f"{sha}  {file}\n", encoding="utf-8")
        shas[cid] = sha
    return shas


RAW_NAMES = {
    "20261106_deer": "deer.mp4",
    "20261106_night": "night.mp4",
    "20260907_morning": "morning.mp4",
}


@pytest.fixture
def setup(tmp_path: Path):
    raw = tmp_path / "dataset/raw/self"
    shas = make_raw(raw, RAW_NAMES)
    cfg = tmp_path / "self_footage.toml"

    def write(extra_drives: str = "", extra_clips: str = "", **override: str) -> Path:
        values = {
            "sha_deer": shas["20261106_deer"],
            "sha_night": shas["20261106_night"],
            "sha_morning": shas["20260907_morning"],
            "extra_drives": extra_drives,
            "extra_clips": extra_clips,
            **override,
        }
        cfg.write_text(CONFIG.format(**values), encoding="utf-8")
        return cfg

    write()
    return raw, tmp_path / "dataset/private/self-footage", write, shas


def keys_of(value: object) -> set[str]:
    if isinstance(value, dict):
        return set(value) | {k for v in value.values() for k in keys_of(v)}
    if isinstance(value, list):
        return {k for v in value for k in keys_of(v)}
    return set()


def run(config_path: Path, raw: Path, out: Path, *, video: FakeVideo | None = None, **kw):
    config = sf.load_config(config_path)
    return sf.ingest(
        config,
        raw,
        out,
        open_video=lambda _path: video or FakeVideo(),
        detector=kw.pop("detector", FakeDetector()),
        encode=kw.pop("encode", fake_jpeg),
        **kw,
    )


# ---------------------------------------------------------------- 受け入れ


def test_ac1_ingest_end_to_end(setup):
    raw, out, write, _ = setup
    before = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in raw.rglob("*") if p.is_file()}
    summary = run(write(), raw, out)
    assert sorted(summary.done) == sorted(RAW_NAMES)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["license"] == "self"
    assert manifest["distribution"] == "not_allowed"
    assert manifest["blur_reviewed"] is False
    assert manifest["drives"] == {"2026-09-07": "val", "2026-11-06": "train"}
    files = manifest["files"]
    assert files, "フレームが書かれていない"
    for f in files:
        data = (out / f["image"]).read_bytes()
        assert hashlib.sha256(data).hexdigest() == f["sha256"]
        img = decode(data)
        x, y, w, h = MASK
        assert not img[y : y + h, x : x + w].any(), "焼き込みの矩形が黒でない"
        assert f["blur_boxes"] == [
            {"cls": "person", "box": [3, 3, 12, 22]},
            {"cls": "car", "box": [23, 20, 22, 11]},
        ]
        assert f["label"] is None
        assert f["group"] == f"self:{f['drive']}"
    morning = [f for f in files if f["video"] == "20260907_morning"]
    assert {tuple(f["uses"]) for f in morning} == {("fp_eval",)}
    night = [f for f in files if f["video"] == "20261106_night"]
    assert {tuple(f["uses"]) for f in night} == {("synth_background", "negative")}
    deer = [f for f in files if f["video"] == "20261106_deer" and f["deer"]]
    assert deer
    assert {tuple(f["uses"]) for f in deer} == {("label",)}
    assert not any("synth_background" in f["uses"] for f in files if f["split"] != "train")
    clip = manifest["clips"]["20261106_deer"]
    assert clip["overlay_pixels"]["inside_before"] >= 5
    assert clip["overlay_pixels"]["outside_after"] == 0
    assert clip["overlay_pixels"]["near_after"] == 0
    text = (out / "manifest.json").read_text(encoding="utf-8")
    for bad in (str(out), str(raw.parent), "creation_time"):
        assert bad not in text
    forbidden = {"lat", "lon", "latitude", "longitude", "gps", "speed", "model", "make", "time"}
    assert not keys_of(manifest) & forbidden
    assert not (out / ".ingest.lock").exists()
    after = {p: (p.read_bytes(), p.stat().st_mtime_ns) for p in raw.rglob("*") if p.is_file()}
    assert after == before, "元の映像が変わった"
    again = run(write(), raw, out)
    assert again.done == []
    assert sorted(again.skipped) == sorted(RAW_NAMES)
    assert json.loads((out / "manifest.json").read_text(encoding="utf-8")) == manifest


# ---------------------------------------------------------------- UC-1 一覧


def test_cfg_1a_reads_config_and_defaults(setup, tmp_path):
    _, _, write, shas = setup
    config = sf.load_config(write())
    assert config.settings == Settings(0.4, 1.0, 1.0)
    assert config.drives == {"2026-11-06": "train", "2026-09-07": "val"}
    assert config.cameras["cam"].overlay_masks == (MASK,)
    deer = next(c for c in config.clips if c.id == "20261106_deer")
    assert deer.deer == (DeerSpan(6.0, 8.0),)
    assert deer.sha256 == shas["20261106_deer"]
    text = write().read_text(encoding="utf-8").split("[camera.cam]")[1]
    plain = tmp_path / "plain.toml"
    plain.write_text("[camera.cam]" + text, encoding="utf-8")
    assert sf.load_config(plain).settings == Settings(0.2, 1.0, 5.0)


def _clip(**kw: str) -> str:
    base = {
        "id": '"20261106_x"',
        "file": '"x.mp4"',
        "sha256": '"' + "a" * 64 + '"',
        "drive": '"2026-11-06"',
        "camera": '"cam"',
        "time_of_day": '"night"',
        "area": '"道東"',
        "deer": "[]",
    }
    base.update(kw)
    body = "\n".join(f"{k} = {v}" for k, v in base.items() if v is not None)
    return f"\n[[clip]]\n{body}\n"


@pytest.mark.parametrize(
    ("extra", "message"),
    [
        (_clip(id='"x"'), "書式"),
        (_clip(id='"20261106_deer"'), "重複"),
        (_clip(file='"../x.mp4"'), "file"),
        (_clip(file='"a/x.mp4"'), "file"),
        (_clip(sha256='"abc"'), "sha256"),
        (_clip(drive='"2026-01-01"'), "知らない走行"),
        (_clip(camera='"other"'), "知らないカメラ"),
        (_clip(id='"20261108_x"'), "日付"),
        (_clip(id='"20261105_x"'), "日付"),
        (_clip(id='"20261131_x"'), "日付ではない"),
        (_clip(id='"20261106_213512"'), "時刻の形"),
        (_clip(id='"20261106_x-2135"'), "時刻の形"),
        (_clip(file='"20261106_213512.mp4"'), "日付・時刻"),
        (_clip(sha256='"{sha}"'.replace("{sha}", "0" * 64), id='"20261106_y"'), None),
        (_clip(area='"43.123,145.456"'), "area"),
        (_clip(area='"根室市 R44-37km"'), "area"),
        (_clip(time_of_day='"noon"'), "time_of_day"),
        (_clip(deer="[{ start = 5.0, end = 3.0 }]"), "end"),
        (_clip(deer="[{ start = -1.0 }]"), "負"),
        (_clip(deer="[{ start = 1.0 }, { start = 5.0 }]"), "重なる"),
        (_clip(deer="[{ start = 1.0, end = 6.0 }, { start = 5.0 }]"), "重なる"),
        (_clip(deer='[{ start = "a" }]'), "数ではない"),
        (_clip(deer="[{ start = 1.0, stop = 2.0 }]"), "知らないキー"),
        (_clip(note='"x"'), "知らないキー"),
        (_clip(area=None), "キーが無い"),
    ],
)
def test_cfg_1b_rejects_bad_clip(setup, extra, message):
    _, _, write, _ = setup
    if message is None:  # 正しい行（パラメータの組み立ての確かめ）
        assert sf.load_config(write(extra_clips=extra))
        return
    with pytest.raises(FootageError, match=message):
        sf.load_config(write(extra_clips=extra))


def test_cfg_1b_night_across_midnight_and_duplicate_sha(setup):
    """C3: 0 時を跨ぐ夜は翌日の日付のクリップも同じ走行に置ける。C2: 同じ映像の 2 行はエラー。"""
    _, _, write, shas = setup
    config = sf.load_config(write(extra_clips=_clip(id='"20261107_after-midnight"')))
    assert next(c for c in config.clips if c.id == "20261107_after-midnight").drive == "2026-11-06"
    dup = _clip(sha256=f'"{shas["20261106_night"]}"')
    with pytest.raises(FootageError, match="SHA-256 の重複"):
        sf.load_config(write(extra_clips=dup))


@pytest.mark.parametrize(
    ("old", "new", "message"),
    [
        ("overlay_masks = [[56, 46, 24, 14]]", "overlay_masks = [[70, 46, 24, 14]]", "画面の外"),
        ("overlay_masks = [[56, 46, 24, 14]]", "overlay_masks = [[56, 46, 0, 14]]", "幅"),
        ("overlay_masks = [[56, 46, 24, 14]]", "overlay_masks = [[56, 46, 24]]", "整数"),
        ("size = [80, 60]", "size = [80]", "size"),
        ('kind = "dashcam"', 'kind = "drone"', "kind"),
        ('facing = "front"', 'facing = "cabin"', "facing"),
        ('facing = "front"', 'facing = "rear"', "facing"),
        ("overlay_min_pixels = 5", "overlay_min_pixels = 0", "矩形があれば正"),
        ("overlay_min_pixels = 5", "overlay_min_pixels = -1", "0 以上"),
        (
            "overlay_masks = [[56, 46, 24, 14]]\noverlay_min_pixels = 5",
            "overlay_masks = []\noverlay_min_pixels = 5",
            "無ければ 0",
        ),
        ("margin_s = 1.0", "margin_s = 0.0", "正の数"),
        ("margin_s = 1.0", "margin = 1.0", "知らないキー"),
        ('id = "2026-09-07"', 'id = "2026-9-7"', "書式"),
        ('id = "2026-09-07"', 'id = "2026-11-06"', "重複"),
        ('split = "val"', 'split = "dev"', "split"),
        ("[camera.cam]", "[camera.Cam]", "書式"),
    ],
)
def test_cfg_1b_rejects_bad_camera_drive_settings(setup, old, new, message):
    _, _, write, _ = setup
    path = write()
    text = path.read_text(encoding="utf-8").replace(old, new, 1)
    path.write_text(text, encoding="utf-8")
    with pytest.raises(FootageError, match=message):
        sf.load_config(path)


def test_cfg_1b_unreadable_and_unknown_top_level(tmp_path):
    with pytest.raises(FootageError, match="読めない"):
        sf.load_config(tmp_path / "none.toml")
    bad = tmp_path / "bad.toml"
    bad.write_text("[camera.cam]\nkind=\n", encoding="utf-8")
    with pytest.raises(FootageError, match="読めない"):
        sf.load_config(bad)
    extra = tmp_path / "extra.toml"
    extra.write_text("camera = {}\ndrive = []\nclip = []\nother = 1\n", encoding="utf-8")
    with pytest.raises(FootageError, match="知らないキー"):
        sf.load_config(extra)


# ---------------------------------------------------------------- UC-2 照合


def _config_clip(write, cid: str):
    return next(c for c in sf.load_config(write()).clips if c.id == cid)


def test_src_2a_sha_matches_list_and_sidecar(setup):
    raw, _, write, _ = setup
    clip = _config_clip(write, "20261106_night")
    assert sf.verify_source(raw, clip) == (raw / clip.id / clip.file).resolve()


def test_src_2a_sha_mismatch_with_list(setup):
    raw, _, write, _ = setup
    path = write(sha_night="b" * 64)
    clip = next(c for c in sf.load_config(path).clips if c.id == "20261106_night")
    with pytest.raises(FootageError, match="一覧と違う"):
        sf.verify_source(raw, clip)


def test_src_2a_sha_mismatch_with_sidecar_or_missing(setup):
    raw, _, write, _ = setup
    clip = _config_clip(write, "20261106_night")
    side = raw / clip.id / f"{clip.file}.sha256"
    side.write_text("c" * 64 + "\n", encoding="utf-8")
    with pytest.raises(FootageError, match=r"\.sha256 と違う"):
        sf.verify_source(raw, clip)
    side.write_text("", encoding="utf-8")
    with pytest.raises(FootageError, match=r"\.sha256 と違う"):
        sf.verify_source(raw, clip)
    side.unlink()
    with pytest.raises(FootageError, match=r"\.sha256 が無い"):
        sf.verify_source(raw, clip)
    (raw / clip.id / clip.file).unlink()
    with pytest.raises(FootageError, match="元の映像が無い"):
        sf.verify_source(raw, clip)


def test_src_2a_symlinks_and_outside_raw(setup, tmp_path):
    raw, _, write, _ = setup
    clip = _config_clip(write, "20261106_night")
    target = raw / clip.id / clip.file
    elsewhere = tmp_path / "elsewhere.mp4"
    elsewhere.write_bytes(target.read_bytes())
    target.unlink()
    target.symlink_to(elsewhere)
    with pytest.raises(FootageError, match="シンボリックリンク"):
        sf.verify_source(raw, clip)
    other = tmp_path / "other"
    other.mkdir()
    linked_raw = tmp_path / "raw2"
    linked_raw.mkdir()
    (linked_raw / clip.id).symlink_to(other)
    with pytest.raises(FootageError, match="シンボリックリンク"):
        sf.verify_source(linked_raw, clip)


def test_src_2a_outside_raw_through_parent_link(setup, tmp_path):
    """raw の下のフォルダは本物でも、映像の実体が raw の外を指すなら止める。"""
    raw, _, write, _ = setup
    clip = _config_clip(write, "20261106_night")
    real_raw = raw.resolve()
    alias = tmp_path / "alias"
    alias.symlink_to(real_raw)
    assert sf.verify_source(alias, clip).is_file()


def test_src_2b_size_mismatch(setup):
    raw, out, write, _ = setup
    with pytest.raises(FootageError, match="大きさ"):
        run(write(), raw, out, video=FakeVideo(size=(1920, 1080)))


# ---------------------------------------------------------------- UC-3 区間


def test_seg_3a_segments_and_margins():
    segs = sf.segments([DeerSpan(6.0, 8.0)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in segs] == [
        (0, 25, False),
        (30, 40, True),
        (45, 60, False),
    ]
    open_end = sf.segments([DeerSpan(6.0, None)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in open_end] == [(0, 25, False), (30, 60, True)]
    none = sf.segments([], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in none] == [(0, 60, False)]
    beyond = sf.segments([DeerSpan(10.0, 99.0)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in beyond] == [(0, 45, False), (50, 60, True)]


def test_seg_3a_boundaries():
    """I2: 先頭から・余白が 0 秒より前・区間の間が余白 2 つ分より狭い。"""
    first = sf.segments([DeerSpan(0.0, 2.0)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in first] == [(0, 10, True), (15, 60, False)]
    early = sf.segments([DeerSpan(0.4, 2.0)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in early] == [(2, 10, True), (15, 60, False)]
    close = sf.segments([DeerSpan(2.0, 4.0), DeerSpan(5.0, 6.0)], FPS, COUNT, 1.0)
    assert [(s.start, s.end, s.deer) for s in close] == [
        (0, 5, False),
        (10, 20, True),
        (25, 30, True),
        (35, 60, False),
    ]


def test_seg_3a_every_frames_at_dashcam_fps():
    assert sf.every(0.2, 27.5) == 6
    assert sf.every(1.0, 27.5) == 28
    assert sf.every(0.01, 27.5) == 1
    assert sf.every(0.5, 5.0) == 3  # 2.5 は切り上げ（偶数丸めの 2 にしない）
    segs = sf.segments([DeerSpan(6.0, 8.0)], FPS, COUNT, 1.0)
    picked = sf.select_frames(segs, FPS, Settings(0.4, 1.0, 1.0))
    assert [i for i, _ in picked] == [0, 5, 10, 15, 20, 30, 32, 34, 36, 38, 45, 50, 55]
    assert {n for i, n in picked if 30 <= i < 40} == {1}


def test_seg_3b_start_beyond_duration():
    with pytest.raises(FootageError, match="長さ"):
        sf.segments([DeerSpan(12.0, None)], FPS, COUNT, 1.0)


# ---------------------------------------------------------------- UC-4 匿名化


def test_anon_4a_fill_masks_only_inside():
    frame = frame_at(3)
    out = sf.fill_masks(frame, [MASK])
    x, y, w, h = MASK
    assert not out[y : y + h, x : x + w].any()
    keep = np.ones((H, W), dtype=bool)
    keep[y : y + h, x : x + w] = False
    assert np.array_equal(out[keep], frame[keep])
    assert frame[y : y + h, x : x + w].any(), "元の配列を書き換えた"


def test_anon_4b_person_full_vehicle_lower_others_untouched():
    frame = frame_at(7, overlay=None)
    det = FakeDetector()
    out, blurred = sf.anonymize(frame, [MASK], det)
    assert blurred == [("person", (3, 3, 12, 22)), ("car", (23, 20, 22, 11))]
    for _, (x, y, w, h) in blurred:
        for top in range(y, y + h, 12):  # 1 マス = max(12, 短辺 // 4) = 12 px
            for left in range(x, x + w, 12):
                cell = out[top : min(top + 12, y + h), left : min(left + 12, x + w)].reshape(-1, 3)
                assert (cell == cell[0]).all(), "モザイク（1 マス）になっていない"
        assert not np.array_equal(out[y : y + h, x : x + w], frame[y : y + h, x : x + w])
    assert np.array_equal(out[40:48, 2:3], frame[40:48, 2:3]), "自転車をぼかした"
    assert np.array_equal(out[10:19, 30:40], frame[10:19, 30:40]), "車の上半分をぼかした"
    assert not det.seen[0][46:60, 56:80].any(), "塗りつぶす前の画像を検出器に渡した"


def test_anon_4b_blur_rect_edges_and_classes():
    assert sf.blur_rect(Detection("person", 0.9, (-5.0, -5.0, 10.0, 10.0)), W, H) == (0, 0, 6, 6)
    assert sf.blur_rect(Detection("truck", 0.9, (60.0, 40.0, 20.0, 20.0)), W, H) == (59, 50, 21, 10)
    assert sf.blur_rect(Detection("truck", 0.9, (70.0, 50.0, 20.0, 20.0)), W, H) is None
    assert sf.blur_rect(Detection("person", 0.9, (90.0, 70.0, 5.0, 5.0)), W, H) is None
    assert sf.blur_rect(Detection("deer", 0.9, (1.0, 1.0, 5.0, 5.0)), W, H) is None
    assert sf.blur_rect(Detection("person", 0.1, (1.0, 1.0, 5.0, 5.0)), W, H) is None
    assert sf.blur_rect(Detection("bus", 0.15, (0.0, 0.0, 10.0, 10.0)), W, H) == (0, 5, 11, 6)


def test_anon_4b_block_size_is_coarse_for_large_boxes():
    frame = np.arange(200 * 200 * 3, dtype=np.uint8).reshape(200, 200, 3).copy()
    sf.pixelate(frame, (0, 0, 200, 100))
    assert (frame[0:25, 0:25] == frame[0, 0]).all()
    assert not (frame[0:25, 0:26] == frame[0, 0]).all()


BIG = (240, 160)
BIG_MASK = (200, 140, 40, 20)


def test_anon_4c_overlay_meter_inside_outside_near():
    """動かない文字は外に残れば数える。変わる桁は帯の中なら数え、帯の外の動くものは数えない。"""
    meters = {k: sf.OverlayMeter() for k in ("inside", "outside", "digit", "far")}
    for i in range(20):
        meters["inside"].add(frame_at(i, overlay=(210, 145), size=BIG))
        meters["outside"].add(frame_at(i, overlay=(20, 20), size=BIG))
        meters["digit"].add(
            sf.fill_masks(frame_at(i, overlay=(210, 145), digit=(194, 145), size=BIG), [BIG_MASK])
        )
        meters["far"].add(frame_at(i, overlay=None, digit=(10 + i * 3, 10), size=BIG))
    assert meters["inside"].inside([BIG_MASK]) > 0
    assert meters["inside"].outside([BIG_MASK]) == 0
    assert meters["inside"].near([BIG_MASK]) == 0
    assert meters["outside"].outside([BIG_MASK]) > 0
    assert meters["digit"].outside([BIG_MASK]) == 0, "変わる桁は持続の数え方では見えない"
    assert meters["digit"].near([BIG_MASK]) > 0, "C1: はみ出した変わる桁を帯で見つける"
    assert meters["far"].outside([BIG_MASK]) == 0
    assert meters["far"].near([BIG_MASK]) == 0
    assert meters["far"].near([]) == 0
    few = sf.OverlayMeter()
    few.add(frame_at(0))
    with pytest.raises(FootageError, match="足りない"):
        few.outside([MASK])


def _camera(masks=(MASK,), least=5):
    return sf.Camera("cam", "dashcam", "front", (W, H), tuple(masks), least)


def _meters(**video):
    before, after = sf.OverlayMeter(), sf.OverlayMeter()
    for i in range(12):
        frame = frame_at(i, **video)
        before.add(frame)
        after.add(sf.fill_masks(frame, [MASK]))
    return before, after


def test_anon_4c_check_overlay_rules():
    ok = sf.check_overlay("c", _camera(), *_meters())
    assert ok["inside_before"] >= 5
    assert ok["outside_after"] == 0
    assert ok["near_after"] == 0
    with pytest.raises(FootageError, match="見つからない"):
        sf.check_overlay("c", _camera(), *_meters(overlay=None))
    with pytest.raises(FootageError, match="まわり"):
        sf.check_overlay("c", _camera(), *_meters(digit=(50, 50)))
    big = np.zeros((H, W, 3), dtype=np.uint8)
    big[5:35:2, 5:45:2] = 255
    before, after = sf.OverlayMeter(), sf.OverlayMeter()
    for i in range(12):
        frame = frame_at(i)
        frame[5:35, 5:45] = big[5:35, 5:45]
        before.add(frame)
        after.add(sf.fill_masks(frame, [MASK]))
    with pytest.raises(FootageError, match="動かない明るい文字"):
        sf.check_overlay("c", _camera(), before, after)
    none = sf.check_overlay("c", _camera(masks=(), least=0), *_meters(overlay=None))
    assert none == {"inside_before": 0, "outside_after": 0, "near_after": 0}


def test_anon_4c_ingest_stops_when_overlay_outside_mask(setup):
    raw, out, write, _ = setup
    with pytest.raises(FootageError, match="焼き込み"):
        run(write(), raw, out, video=FakeVideo(overlay=(10, 10)))
    assert not (out / "manifest.json").exists()
    assert list((out / "frames").iterdir()) == []
    with pytest.raises(FootageError, match="まわり"):
        run(write(), raw, out, video=FakeVideo(digit=(50, 48)))
    assert not (out / "manifest.json").exists()


# ---------------------------------------------------------------- UC-5 書き出しと manifest


def test_out_5a_jpeg_metadata_markers():
    app0 = b"\xff\xe0\x00\x04JF"
    exif = b"\xff\xe1\x00\x06Exif"
    icc = b"\xff\xe2\x00\x04IC"
    iptc = b"\xff\xed\x00\x04PS"
    com = b"\xff\xfe\x00\x04hi"
    app14 = b"\xff\xee\x00\x04Ad"
    tables = b"\xff\xdb\x00\x03\x00\xff\xc0\x00\x03\x00\xff\xc4\x00\x03\x00\xff\xdd\x00\x04\x00\x00"
    sos = b"\xff\xda\x00\x02\xff\xe1"
    assert sf.jpeg_metadata(b"\xff\xd8" + app0 + tables + sos) == []
    found = sf.jpeg_metadata(b"\xff\xd8" + app0 + exif + icc + iptc + com + app14 + sos)
    assert found == ["0xFFE1", "0xFFE2", "0xFFED", "0xFFFE", "0xFFEE"]
    with pytest.raises(FootageError, match="JPEG ではない"):
        sf.jpeg_metadata(b"PNG")
    with pytest.raises(FootageError, match="壊れて"):
        sf.jpeg_metadata(b"\xff\xd8\x00\x00\x00\x00")
    with pytest.raises(FootageError, match="壊れて"):
        sf.jpeg_metadata(b"\xff\xd8" + app0)  # SOS が無い


def test_out_5a_ingest_stops_on_metadata(setup):
    raw, out, write, _ = setup
    with pytest.raises(FootageError, match="許していないマーカー"):
        run(write(), raw, out, encode=lambda f: b"\xff\xd8\xff\xe1\x00\x02" + fake_jpeg(f)[2:])
    assert not (out / "manifest.json").exists()


def test_out_5b_manifest_records(setup):
    raw, out, write, _ = setup
    run(write(), raw, out)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    clip = manifest["clips"]["20261106_deer"]
    assert clip["drive"] == "2026-11-06"
    assert clip["split"] == "train"
    detector = clip["redo"]["detector"]
    assert detector["sha256"] == "0" * 64
    assert detector["name"] == "fake-coco.pt"
    assert detector["imgsz"] == 1280
    assert clip["fixed"] == {
        "sha256": clip["sha256"],
        "file": "deer.mp4",
        "drive": "2026-11-06",
        "split": "train",
    }
    assert clip["every_frames"] == {"deer": 2, "no_deer": 5}
    assert [s["deer"] for s in clip["segments"]] == [False, True, False]
    assert clip["frames"] == 13
    assert clip["blur_boxes"] == 26
    assert manifest["sources"]["20260907_morning"] == {
        "license": "self",
        "camera": "cam",
        "time_of_day": "day",
        "area": "道東",
    }
    frames = [f["frame"] for f in manifest["files"] if f["video"] == "20261106_deer"]
    assert frames == [0, 5, 10, 15, 20, 30, 32, 34, 36, 38, 45, 50, 55]
    assert manifest["files"][0]["image"].startswith("frames/")


def test_out_5c_failure_keeps_previous_clips(setup):
    """S-1: 途中の失敗では、そのクリップの一時フォルダを消し、済みのクリップの manifest は残る。"""
    raw, out, write, _ = setup
    calls = {"n": 0}

    def open_video(_path):
        calls["n"] += 1
        return FakeVideo(stop_at=20) if calls["n"] == 2 else FakeVideo()

    config = sf.load_config(write())
    with pytest.raises(FootageError, match="途中で終わった"):
        sf.ingest(
            config, raw, out, open_video=open_video, detector=FakeDetector(), encode=fake_jpeg
        )
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert list(manifest["clips"]) == ["20261106_deer"]
    assert sorted(p.name for p in (out / "frames").iterdir()) == ["20261106_deer"]
    summary = run(write(), raw, out)
    assert summary.skipped == ["20261106_deer"]
    assert sorted(summary.done) == ["20260907_morning", "20261106_night"]


def test_out_5c_unreadable_video_metadata(setup):
    raw, out, write, _ = setup
    with pytest.raises(FootageError, match="fps"):
        run(write(), raw, out, video=FakeVideo(fps=0.0))


# ---------------------------------------------------------------- UC-6 追加


NEW_DRIVE = '\n[[drive]]\nid = "2026-11-07"\nsplit = "test"\n'


def test_add_6a_second_batch_adds_only_new_clips(setup):
    raw, out, write, _ = setup
    run(write(), raw, out)
    shas = make_raw(raw, {"20261107_deer": "deer.mp4"})
    extra = _clip(
        id='"20261107_deer"',
        file='"deer.mp4"',
        sha256=f'"{shas["20261107_deer"]}"',
        drive='"2026-11-07"',
        deer="[{ start = 2.0 }]",
    )
    detector = FakeDetector()
    summary = run(write(extra_drives=NEW_DRIVE, extra_clips=extra), raw, out, detector=detector)
    assert summary.done == ["20261107_deer"]
    assert sorted(summary.skipped) == sorted(RAW_NAMES)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["drives"]["2026-11-07"] == "test"
    new = [f for f in manifest["files"] if f["video"] == "20261107_deer"]
    assert {f["split"] for f in new} == {"test"}
    assert not any("synth_background" in f["uses"] for f in new)
    assert summary.test_deer_drives == 1
    stream = io.StringIO()
    sf.report(summary, stream)
    assert "テスト専用の鹿の走行: 1" in stream.getvalue()


def test_add_6a_changed_clip_needs_redo(setup):
    raw, out, write, _ = setup
    run(write(), raw, out)
    path = write()
    path.write_text(
        path.read_text(encoding="utf-8").replace("end = 8.0", "end = 9.0"), encoding="utf-8"
    )
    with pytest.raises(FootageError, match="--redo 20261106_deer"):
        run(path, raw, out)
    old = (out / "frames/20261106_deer/20261106_deer_f000040.jpg").exists()
    summary = run(path, raw, out, redo={"20261106_deer"})
    assert summary.done == ["20261106_deer"]
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    deer = [f["frame"] for f in manifest["files"] if f["video"] == "20261106_deer" and f["deer"]]
    assert deer == [30, 32, 34, 36, 38, 40, 42, 44]
    assert old is False
    names = sorted(p.name for p in (out / "frames/20261106_deer").iterdir())
    assert names == sorted(Path(f["image"]).name for f in manifest["files"] if "deer" in f["video"])
    with pytest.raises(FootageError, match="一覧に無い"):
        run(path, raw, out, redo={"20991231_none"})
    other = FakeDetector()
    other.sha256 = "1" * 64
    with pytest.raises(FootageError, match="作り方が違う"):
        run(path, raw, out, detector=other)


def test_add_6a_redo_cannot_move_clip_to_another_drive(setup):
    """C2: --redo でも、済みのクリップの走行・分割・元の映像は変えられない。"""
    raw, out, write, _ = setup
    run(write(), raw, out)
    path = write(extra_drives=NEW_DRIVE)
    text = path.read_text(encoding="utf-8").replace(
        'id = "20261106_deer"\nfile = "deer.mp4"',
        'id = "20261107_deer"\nfile = "deer.mp4"',
    )
    path.write_text(text, encoding="utf-8")
    with pytest.raises(FootageError, match="済みの 20261106_deer と同じ"):
        run(path, raw, out)
    moved = write(extra_drives=NEW_DRIVE)
    text = moved.read_text(encoding="utf-8")
    deer_block = text.split('id = "20261106_deer"')[1].split("[[clip]]")[0]
    text = text.replace(
        deer_block, deer_block.replace('drive = "2026-11-06"', 'drive = "2026-11-07"')
    )
    moved.write_text(text, encoding="utf-8")
    with pytest.raises(FootageError, match="日付"):
        sf.load_config(moved)
    night_moved = write(extra_drives='\n[[drive]]\nid = "2026-11-06-b"\nsplit = "test"\n')
    text = night_moved.read_text(encoding="utf-8")
    block = text.split('id = "20261106_night"')[1].split("[[clip]]")[0]
    text = text.replace(block, block.replace('drive = "2026-11-06"', 'drive = "2026-11-06-b"'))
    night_moved.write_text(text, encoding="utf-8")
    for redo in (set(), {"20261106_night"}):
        with pytest.raises(FootageError, match="走行・分割は変えられない"):
            run(night_moved, raw, out, redo=redo)


def test_add_6a_unlisted_clip_stays_in_manifest(setup):
    """W4 (a): 一覧から消したクリップは manifest に残し、そう表示する。"""
    raw, out, write, _ = setup
    run(write(), raw, out)
    path = write()
    text = path.read_text(encoding="utf-8")
    path.write_text(text.split('[[clip]]\nid = "20260907_morning"')[0], encoding="utf-8")
    summary = run(path, raw, out)
    assert summary.unlisted == ["20260907_morning"]
    stream = io.StringIO()
    sf.report(summary, stream)
    assert "20260907_morning: 一覧に無いが manifest に残す" in stream.getvalue()
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert "20260907_morning" in manifest["clips"]


def test_add_6a_lock_and_locations(setup, tmp_path):
    """W4 (e): 同時の ingest はエラー。W1: --out・--raw は private・raw の下だけ。"""
    raw, out, write, _ = setup
    (out / ".ingest.lock").mkdir(parents=True)
    with pytest.raises(FootageError, match="別の ingest"):
        run(write(), raw, out)
    assert (out / ".ingest.lock").exists(), "他の実行の鍵を消した"
    (out / ".ingest.lock").rmdir()
    with pytest.raises(FootageError, match="dataset/private/"):
        run(write(), raw, tmp_path / "dataset/self-footage")
    with pytest.raises(FootageError, match="dataset/private/"):
        run(write(), raw, tmp_path / "dataset/private")
    with pytest.raises(FootageError, match="dataset/raw/"):
        run(write(), tmp_path / "elsewhere", out)
    assert not (tmp_path / "dataset/self-footage").exists()


def test_add_6a_orphan_frames_folder(setup):
    raw, out, write, _ = setup
    (out / "frames/20261106_night").mkdir(parents=True)
    with pytest.raises(FootageError, match="manifest に無いフレーム"):
        run(write(), raw, out)
    (out / "frames/.tmp-20261106_deer").mkdir()
    (out / "frames/20261106_night").rmdir()
    run(write(), raw, out)
    assert not (out / "frames/.tmp-20261106_deer").exists()


def test_add_6b_split_change_of_known_drive(setup):
    raw, out, write, _ = setup
    run(write(), raw, out)
    path = write()
    path.write_text(
        path.read_text(encoding="utf-8").replace('split = "val"', 'split = "test"'),
        encoding="utf-8",
    )
    with pytest.raises(FootageError, match="分割を val から test"):
        run(path, raw, out)


def test_add_6b_broken_manifest(setup):
    raw, out, write, _ = setup
    out.mkdir(parents=True)
    (out / "manifest.json").write_text("{", encoding="utf-8")
    with pytest.raises(FootageError, match="読めない"):
        run(write(), raw, out)
    (out / "manifest.json").write_text('{"version": 2}', encoding="utf-8")
    with pytest.raises(FootageError, match="version"):
        run(write(), raw, out)


def test_add_6c_reports_missing_test_deer_drive(setup):
    """S-2: test の鹿の走行が無ければ表示する（エラーにはしない）。"""
    raw, out, write, _ = setup
    summary = run(write(), raw, out)
    assert summary.test_deer_drives == 0
    stream = io.StringIO()
    sf.report(summary, stream)
    text = stream.getvalue()
    assert "テスト専用の鹿の走行がまだ無い" in text
    assert "20261106_deer: 13 枚（train）" in text


# ---------------------------------------------------------------- CLI


def test_main_reports_config_error(tmp_path, capsys):
    bad = tmp_path / "bad.toml"
    bad.write_text("x = 1\n", encoding="utf-8")
    assert sf.main(["ingest", "--config", str(bad)]) == 2
    assert "エラー" in capsys.readouterr().err


def test_repository_config_is_valid():
    config = sf.load_config(sf.CONFIG)
    assert {c.drive for c in config.clips} <= set(config.drives)
    assert all(c.area == "道東" for c in config.clips)
