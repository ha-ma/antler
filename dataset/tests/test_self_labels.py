"""dataset-train R12: 実写の鹿の箱の台帳（docs/specs/dataset-train）。"""

from __future__ import annotations

from pathlib import Path

import pytest

import self_labels
from self_labels import FrameLabel, LabelError

META = """[meta]
labeler = "t"
method = "m"
date = "2026-11-07"
negatives_checked = "n"
"""


def manifest(
    frames: dict[int, bool], video: str = "v1", blur: dict[int, list] | None = None
) -> dict:
    blur = blur or {}
    return {
        "clips": {video: {"size": [100, 50]}},
        "files": [
            {
                "image": f"frames/{video}/{video}_f{f:06d}.jpg",
                "video": video,
                "frame": f,
                "deer": deer,
                "blur_boxes": [{"cls": "car", "box": b} for b in blur.get(f, [])],
            }
            for f, deer in sorted(frames.items())
        ],
    }


def ledger(tmp_path: Path, body: str, meta: str = META) -> dict:
    path = tmp_path / "labels.toml"
    path.write_text(meta + body, encoding="utf-8")
    return self_labels.load_ledger(path)


def track(keys: str, video: str = "v1", tid: str = "a") -> str:
    return f'[[track]]\nvideo = "{video}"\nid = "{tid}"\nkeys = {keys}\nnote = ""\n'


def mark(spec: str, status: str, video: str = "v1") -> str:
    return f'[[mark]]\nvideo = "{video}"\n{spec}\nstatus = "{status}"\nreason = "r"\n'


DEER = {0: True, 6: True, 12: True, 18: True}


# ---------------------------------------------------------------- LBL-1a


def test_interpolates_between_keys_only(tmp_path: Path) -> None:
    led = ledger(
        tmp_path,
        track("[[0, 10, 10, 20, 20], [12, 30, 10, 50, 30]]") + mark("frames = [18]", "empty"),
    )
    out = self_labels.resolve(led, manifest(DEER))
    assert out[("v1", 0)] == FrameLabel("box", ((10.0, 10.0, 20.0, 20.0),), "")
    assert out[("v1", 6)].boxes == ((20.0, 10.0, 35.0, 25.0),)
    assert out[("v1", 12)].boxes == ((30.0, 10.0, 50.0, 30.0),)
    assert out[("v1", 18)] == FrameLabel("empty", (), "")  # キーの外には伸ばさない


def test_two_tracks_give_two_boxes(tmp_path: Path) -> None:
    body = track("[[0, 1, 1, 5, 5], [6, 1, 1, 5, 5]]") + track("[[6, 60, 1, 70, 9]]", tid="b")
    out = self_labels.resolve(ledger(tmp_path, body), manifest({0: True, 6: True}))
    assert out[("v1", 6)].boxes == ((1.0, 1.0, 5.0, 5.0), (60.0, 1.0, 70.0, 9.0))


def test_center_box() -> None:
    assert self_labels.to_center((10, 10, 30, 20), (100, 50)) == pytest.approx((0.2, 0.3, 0.2, 0.2))


@pytest.mark.parametrize(
    ("keys", "frames", "msg"),
    [
        ("[[3, 1, 1, 5, 5]]", DEER, "manifest に無い"),
        ("[[0, 1, 1, 5, 5]]", {0: False}, "鹿なし"),
        ("[[6, 1, 1, 5, 5], [0, 1, 1, 5, 5]]", DEER, "昇順"),
        ("[[0, 1, 1, 5, 5], [0, 1, 1, 5, 5]]", DEER, "昇順"),
        ("[[0, 5, 1, 5, 5]]", DEER, "x1 < x2"),
        ("[[0, 1, 9, 5, 5]]", DEER, "y1 < y2"),
        ("[[0, 1, 1, 101, 5]]", DEER, "画面"),
        ("[[0, -1, 1, 5, 5]]", DEER, "画面"),
        ("[[0, 1, 1, 5]]", DEER, "5 つ"),
        ("[[0, 1, 1, 5, 5], [12, 1, 1, 5, 5]]", {0: True, 6: False, 12: True}, "鹿なし"),
    ],
)
def test_bad_keys(tmp_path: Path, keys: str, frames: dict, msg: str) -> None:
    with pytest.raises(LabelError, match=msg):
        self_labels.resolve(ledger(tmp_path, track(keys)), manifest(frames))


def test_range_is_inclusive_and_ignore_wins(tmp_path: Path) -> None:
    body = track("[[0, 1, 1, 5, 5], [18, 1, 1, 5, 5]]") + mark("range = [6, 12]", "ignore")
    out = self_labels.resolve(ledger(tmp_path, body), manifest(DEER))
    assert out[("v1", 6)] == FrameLabel("ignore", (), "ignore")
    assert out[("v1", 12)] == FrameLabel("ignore", (), "ignore")
    assert out[("v1", 18)].status == "box"


def test_empty_and_ignore_gives_ignore(tmp_path: Path) -> None:
    body = mark("frames = [0]", "empty") + mark("frames = [0]", "ignore")
    out = self_labels.resolve(ledger(tmp_path, body), manifest(DEER))
    assert out[("v1", 0)].status == "ignore"


def test_empty_on_track_is_error(tmp_path: Path) -> None:
    body = track("[[0, 1, 1, 5, 5], [12, 1, 1, 5, 5]]") + mark("frames = [6]", "empty")
    with pytest.raises(LabelError, match="empty"):
        self_labels.resolve(ledger(tmp_path, body), manifest(DEER))


@pytest.mark.parametrize(
    ("spec", "msg"),
    [
        ("frames = [7]", "manifest に無い"),
        ("range = [1, 5]", "1 つも無い"),
        ("range = [9, 3]", "range"),
        ("frames = [0]\nrange = [0, 6]", "どちらか 1 つ"),
        ("", "どちらか 1 つ"),
    ],
)
def test_bad_marks(tmp_path: Path, spec: str, msg: str) -> None:
    with pytest.raises(LabelError, match=msg):
        self_labels.resolve(ledger(tmp_path, mark(spec, "ignore")), manifest(DEER))


# ---------------------------------------------------------------- LBL-1b


def test_box_over_blur_is_blurred(tmp_path: Path) -> None:
    body = track("[[0, 10, 10, 20, 20], [6, 10, 10, 20, 20]]")
    m = manifest({0: True, 6: True}, blur={0: [[15, 15, 10, 10]], 6: [[20, 10, 5, 5]]})
    out = self_labels.resolve(ledger(tmp_path, body), m)
    assert out[("v1", 0)] == FrameLabel("ignore", (), "blurred")
    assert out[("v1", 6)].status == "box"  # 辺が接するだけは重ならない


def test_empty_with_blur_is_blurred(tmp_path: Path) -> None:
    m = manifest({0: True}, blur={0: [[50, 20, 5, 5]]})
    out = self_labels.resolve(ledger(tmp_path, mark("frames = [0]", "empty")), m)
    assert out[("v1", 0)] == FrameLabel("ignore", (), "blurred")


def test_ignore_on_negative_frame(tmp_path: Path) -> None:
    out = self_labels.resolve(
        ledger(tmp_path, mark("frames = [0]", "ignore")), manifest({0: False})
    )
    assert out[("v1", 0)].status == "ignore"


# ---------------------------------------------------------------- LBL-1c


def test_unknown_video(tmp_path: Path) -> None:
    with pytest.raises(LabelError, match="manifest に無い動画"):
        self_labels.resolve(
            ledger(tmp_path, mark("frames = [0]", "empty", video="v9")), manifest(DEER)
        )
    with pytest.raises(LabelError, match="manifest に無い動画"):
        self_labels.resolve(
            ledger(tmp_path, track("[[0, 1, 1, 5, 5]]", video="v9")), manifest(DEER)
        )


def test_duplicate_track_id(tmp_path: Path) -> None:
    body = track("[[0, 1, 1, 5, 5]]") + track("[[6, 1, 1, 5, 5]]")
    with pytest.raises(LabelError, match="id が重複"):
        self_labels.resolve(ledger(tmp_path, body), manifest(DEER))


@pytest.mark.parametrize(
    ("meta", "body", "msg"),
    [
        (META.replace('negatives_checked = "n"\n', ""), "", "negatives_checked"),
        ("", "", "meta"),
        (META, "[other]\n", "知らない"),
        (
            META,
            '[[track]]\nvideo = "v1"\nid = "a"\nkeys = [[0, 1, 1, 5, 5]]\nnote = ""\nx = 1\n',
            "知らないキー",
        ),
        (META, '[[mark]]\nvideo = "v1"\nframes = [0]\nstatus = "maybe"\nreason = "r"\n', "status"),
        (META, '[[mark]]\nvideo = "v1"\nframes = [0]\nstatus = "empty"\nreason = ""\n', "reason"),
        (META, "[[track]\n", "読めない"),
    ],
)
def test_bad_ledger(tmp_path: Path, meta: str, body: str, msg: str) -> None:
    with pytest.raises(LabelError, match=msg):
        self_labels.resolve(ledger(tmp_path, body, meta=meta), manifest(DEER))


def test_repo_ledger_parses() -> None:
    """Git の台帳がそもそも読めること（manifest との解決は実データで確かめる）。"""
    led = self_labels.load_ledger(Path(self_labels.__file__).with_name("self_labels.toml"))
    assert led["meta"]["labeler"]
    assert led["track"]
