"""capture.recorder（docs/specs/edge-capture UC-3・UC-4）: 何を保存するか、赤の経路を待たせない。

Test List: REC-1a REC-1b REC-1c REC-1d REC-1e（FAIL_1・FAIL_2）REC-1f REC-1g REC-1h REC-1i REC-1j
REC-1k REC-1l L1P-1a L1P-1b L1P-1c L1P-1d L1P-1f
障害: FAIL-1 FAIL-2 FAIL-3 FAIL-5、競合: CONC-2 CONC-3
"""

from __future__ import annotations

import io
import json
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

from detector.capture.jpeg import EncodeError
from detector.capture.recorder import CaptureRecorder
from detector.capture.store import CaptureStore
from detector.config import CaptureConfig, JudgeConfig
from detector.l1.client import L1Answer
from detector.log import configure_logging
from detector.pipeline import FrameResult
from detector.ports import Detection

JST = timezone(timedelta(hours=9))
T0 = datetime(2027, 2, 15, 16, 30, 0, tzinfo=JST)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00fake\xff\xd9"
ANSWER = L1Answer(
    model="jev-test",
    alert_level={"none": 0.1, "zone": 0.2, "danger": 0.7},
    on_roadway=0.6,
    static_shoulder=0.1,
    false_positive=0.05,
)


class FakeEncoder:
    def __init__(self) -> None:
        self.shapes: list[tuple[int, ...]] = []
        self.fail = False
        self.gate: threading.Event | None = None
        self.entered = threading.Event()

    def encode(self, image: np.ndarray, quality: int) -> bytes:
        self.entered.set()
        if self.gate is not None:
            assert self.gate.wait(5.0)
        if self.fail:
            msg = "boom"
            raise EncodeError(msg)
        self.shapes.append(image.shape)
        return JPEG


class Clock:
    def __init__(self, now: float = 100.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


def frame(
    ms: float = 0.0,
    confs: tuple[float, ...] = (0.9,),
    *,
    image: bool = True,
    failed: bool = False,
    invalid: int = 0,
    seq: int = 0,
) -> FrameResult:
    dets = [Detection("deer", c, (0.5, 0.5, 0.1, 0.2)) for c in confs]
    return FrameResult(
        seq,
        T0 + timedelta(milliseconds=ms),
        dets,
        5.0,
        failed=failed,
        invalid_count=invalid,
        image=np.full((480, 640, 3), 7, dtype=np.uint8) if image else None,
    )


def make(
    tmp_path: Path,
    encoder: FakeEncoder | None = None,
    clock: Clock | None = None,
    store: CaptureStore | None = None,
    **overrides: object,
) -> tuple[CaptureRecorder, CaptureStore, FakeEncoder, Clock]:
    enc = encoder or FakeEncoder()
    clk = clock or Clock()
    cfg = CaptureConfig(**overrides)  # type: ignore[arg-type]
    st = store or CaptureStore(tmp_path / "captures", max_items=cfg.max_items)
    rec = CaptureRecorder(
        cfg,
        st,
        enc,
        distance_table=JudgeConfig().distance_table,
        min_box_conf=0.4,
        clock=clk,
    )
    return rec, st, enc, clk


def test_REC_1a_確信度の閾値以上のフレームだけ保存する(tmp_path: Path) -> None:
    rec, store, _, _ = make(tmp_path, min_interval_s=0.5)
    assert rec.offer(frame(0, (0.8,))) is True  # ちょうど 0.8 は対象
    assert rec.offer(frame(1000, (0.79,))) is False
    assert rec.offer(frame(2000, ())) is False  # 検出なし
    assert rec.offer(frame(3000, (0.95,), failed=True)) is False
    assert rec.offer(frame(4000, (0.95,), invalid=2)) is True  # 一部が不正でも有効な検出がある
    broken = FrameResult(5, T0 + timedelta(seconds=5), [], 5.0, invalid_count=3)
    assert rec.offer(broken) is False  # 全部不正（検出 0 件）
    assert rec.offer(frame(6000, (0.95,), image=False)) is False
    bad_height = FrameResult(
        7,
        T0 + timedelta(seconds=7),
        [Detection("deer", 0.99, (0.5, 0.5, 0.1, float("nan")))],
        5.0,
        image=np.zeros((480, 640, 3), dtype=np.uint8),
    )
    assert rec.offer(bad_height) is False
    assert rec.flush()
    assert store.list()[1] == 2
    rec.close()


def test_REC_1b_間隔未満は保存せず2秒ちょうどは保存する(tmp_path: Path) -> None:
    rec, store, _, _ = make(tmp_path)
    assert rec.offer(frame(0)) is True
    assert rec.offer(frame(1999)) is False
    assert rec.offer(frame(2000)) is True
    assert rec.offer(frame(3500)) is False
    assert rec.offer(frame(4000)) is True
    assert rec.flush()
    assert store.list()[1] == 3
    rec.close()


def test_REC_1c_起動ごとの上限に達したら保存しない(tmp_path: Path) -> None:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    rec, store, _, _ = make(tmp_path, max_per_run=3, min_interval_s=0.5)
    results = [rec.offer(frame(i * 1000)) for i in range(6)]
    assert results == [True, True, True, False, False, False]
    assert rec.flush()
    assert store.list()[1] == 3
    limit_logs = [ln for ln in stream.getvalue().splitlines() if "capture.run_limit" in ln]
    assert len(limit_logs) == 1
    rec.close()


def test_REC_1d_キューが満杯なら捨てて数えofferは待たない(tmp_path: Path) -> None:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    encoder = FakeEncoder()
    encoder.gate = threading.Event()  # 書き込みが止まったエンコーダ
    rec, store, _, _ = make(tmp_path, encoder, queue_size=2, min_interval_s=0.5)
    assert rec.offer(frame(0)) is True
    assert encoder.entered.wait(2.0)  # ワーカーが 1 件目で止まっている
    started = time.perf_counter()
    outcomes = [rec.offer(frame(1000 * i)) for i in range(1, 6)]
    elapsed = time.perf_counter() - started
    assert outcomes == [True, True, False, False, False]
    assert rec.dropped == 3
    assert elapsed < 0.5  # 待たない
    assert "capture.dropped" in stream.getvalue()
    encoder.gate.set()
    assert rec.flush()
    assert store.list()[1] == 3
    rec.close()


def test_CONC_2_offerを続けて呼んでもキューの上限を超えず待たない(tmp_path: Path) -> None:
    encoder = FakeEncoder()
    encoder.gate = threading.Event()
    rec, _, _, _ = make(tmp_path, encoder, queue_size=3, min_interval_s=0.5, max_per_run=500)
    rec.offer(frame(0))
    assert encoder.entered.wait(2.0)
    queued = sum(rec.offer(frame(1000 * i)) for i in range(1, 100))
    assert queued == 3
    assert rec.dropped == 96
    encoder.gate.set()
    rec.close()


def test_REC_1f_縮小して保存しimageSizeが一致する(tmp_path: Path) -> None:
    rec, store, encoder, _ = make(tmp_path, image_width=320)
    rec.offer(frame(0))
    assert rec.flush()
    assert encoder.shapes == [(240, 320, 3)]
    capture = store.list()[0][0]["capture"]
    assert capture["imageSize"] == [320, 240]
    assert capture["source"] == "vehicle"
    assert capture["consent"] is False
    assert store.read_image(capture["id"]) == JPEG
    rec.close()


def test_REC_1f_本物のOpenCVで320pxのJPEGになる(tmp_path: Path) -> None:
    cv2 = pytest.importorskip("cv2")
    from detector.capture.jpeg import OpenCvJpegEncoder

    rec, store, _, _ = make(tmp_path, encoder=OpenCvJpegEncoder())  # type: ignore[arg-type]
    rec.offer(frame(0))
    assert rec.flush()
    capture = store.list()[0][0]["capture"]
    data = store.read_image(capture["id"])
    assert data is not None
    decoded = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    assert decoded.shape == (240, 320, 3)
    rec.close()


def test_REC_1g_closeはキューを吐き出してから止まり2回呼んでも壊れない(tmp_path: Path) -> None:
    encoder = FakeEncoder()
    encoder.gate = threading.Event()
    rec, store, _, _ = make(tmp_path, encoder, min_interval_s=0.5)
    rec.offer(frame(0))
    rec.offer(frame(1000))
    rec.offer(frame(2000))
    assert encoder.entered.wait(2.0)
    threading.Timer(0.1, encoder.gate.set).start()
    rec.close()
    assert store.list()[1] == 3
    rec.close()
    assert rec.offer(frame(9000)) is False  # 閉じたあとは保存しない


def test_REC_1h_ログにはidと時間だけで中身を出さない(tmp_path: Path) -> None:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    rec, store, _, _ = make(tmp_path)
    rec.offer(frame(120))
    assert rec.flush()
    rec.close()
    lines = [json.loads(line) for line in stream.getvalue().splitlines()]
    saved = [line for line in lines if line["event"] == "capture.saved"]
    assert len(saved) == 1
    entry = saved[0]
    capture_id = store.list()[0][0]["capture"]["id"]
    assert entry["id"] == capture_id
    assert entry["t_frame"] == "2027-02-15T16:30:00.120+09:00"
    assert entry["bytes"] == len(JPEG)
    assert isinstance(entry["encode_ms"], float)
    assert isinstance(entry["write_ms"], float)
    text = stream.getvalue()
    assert "roadSegment" not in text
    assert "boxes" not in text
    assert "\\xff" not in text


def test_REC_1i_時計が巻き戻ったらその枚を保存して基準を置き直す(tmp_path: Path) -> None:
    rec, store, _, _ = make(tmp_path)
    assert rec.offer(frame(100_000)) is True
    assert rec.offer(frame(50_000)) is True  # 50 秒戻った
    assert rec.offer(frame(50_500)) is False  # 新しい基準から 2 秒未満
    assert rec.offer(frame(52_000)) is True
    assert rec.flush()
    assert store.list()[1] == 3
    rec.close()


def test_REC_1j_idle_secondsはフレームを受け取るたびに戻る(tmp_path: Path) -> None:
    rec, _, _, clock = make(tmp_path)
    assert rec.idle_seconds() is None
    rec.offer(frame(0, (0.1,)))  # 保存しないフレームでも「動いている」
    assert rec.idle_seconds() == 0.0
    clock.now += 61.0
    assert rec.idle_seconds() == pytest.approx(61.0)
    rec.offer(frame(1000, ()))
    assert rec.idle_seconds() == 0.0
    rec.close()


def test_FAIL_1_エンコーダが例外でもその1枚だけ捨てて次は保存される(tmp_path: Path) -> None:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    rec, store, encoder, _ = make(tmp_path, min_interval_s=0.5)
    encoder.fail = True
    rec.offer(frame(0))
    assert rec.flush()
    assert store.list()[1] == 0
    encoder.fail = False
    rec.offer(frame(1000))
    assert rec.flush()
    assert store.list()[1] == 1
    failed = [json.loads(ln) for ln in stream.getvalue().splitlines() if "capture.failed" in ln]
    assert failed
    assert failed[0]["error_type"] == "EncodeError"
    rec.close()


def test_FAIL_2_20回連続の失敗でdegradedと回復をログに残す(tmp_path: Path) -> None:
    stream = io.StringIO()
    configure_logging("INFO", stream=stream)
    rec, store, encoder, _ = make(tmp_path, min_interval_s=0.5, max_per_run=100, queue_size=64)
    encoder.fail = True
    for i in range(20):
        rec.offer(frame(1000 * i))
    assert rec.flush()
    degraded = [ln for ln in stream.getvalue().splitlines() if "capture.degraded" in ln]
    assert len(degraded) == 1
    assert json.loads(degraded[0])["level"] == "critical"
    encoder.fail = False
    rec.offer(frame(50_000))
    assert rec.flush()
    assert "capture.recovered" in stream.getvalue()
    assert store.list()[1] == 1
    rec.close()


def test_FAIL_3_保存の失敗は赤の経路に出ない(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec, store, _, _ = make(tmp_path)

    def broken(*_: object, **__: object) -> None:
        msg = "disk full"
        raise OSError(msg)

    monkeypatch.setattr(store, "save", broken)
    assert rec.offer(frame(0)) is True  # offer は成功する。失敗はワーカー側
    assert rec.flush()
    rec.close()


def test_REC_1k_idが衝突したら作り直す(tmp_path: Path) -> None:
    ids = iter(["cap_000000000001", "cap_000000000001", "cap_000000000002"])
    enc, clk = FakeEncoder(), Clock()
    cfg = CaptureConfig(min_interval_s=0.5)
    store = CaptureStore(tmp_path / "captures")
    rec = CaptureRecorder(
        cfg,
        store,
        enc,
        distance_table=JudgeConfig().distance_table,
        min_box_conf=0.4,
        clock=clk,
        new_id=lambda: next(ids),
    )
    rec.offer(frame(0))
    rec.offer(frame(1000))
    assert rec.flush()
    assert store.list()[1] == 2
    rec.close()


# --- L1 の確率（UC-4） ---


def test_L1P_1a_答えの前後3秒以内の保存に生の確率が付く(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path, min_interval_s=0.5)
    rec.offer(frame(0))
    clock.now += 1.0
    rec.offer(frame(1000))
    assert rec.flush()
    clock.now += 1.0
    rec.on_l1_answer(ANSWER, at=clock.now, fresh=True)
    assert rec.flush()
    for item in store.list()[0]:
        probs = item["capture"]["l1Probs"]
        assert probs["alert_level"] == {"none": 0.1, "zone": 0.2, "danger": 0.7}
        assert probs["on_roadway"] == 0.6
        assert probs["false_positive"] == 0.05
    rec.close()


def test_CONC_3_答えが先でも保存が先でもl1Probsは一度だけ付く(tmp_path: Path) -> None:
    encoder = FakeEncoder()
    encoder.gate = threading.Event()
    rec, store, _, clock = make(tmp_path, encoder, min_interval_s=0.5)
    rec.offer(frame(0))  # 保存前（エンコーダで止まっている）
    assert encoder.entered.wait(2.0)
    clock.now += 0.5
    rec.on_l1_answer(ANSWER, at=clock.now, fresh=True)  # 答えが先
    encoder.gate.set()
    assert rec.flush()
    assert "l1Probs" in store.list()[0][0]["capture"]
    # 2 つ目の答えは、すでにあるものを書き換えない
    other = L1Answer("jev-test", {"none": 0.9, "zone": 0.05, "danger": 0.05}, 0.0, 0.0, 0.9)
    rec.on_l1_answer(other, at=clock.now + 0.2, fresh=True)
    assert rec.flush()
    assert store.list()[0][0]["capture"]["l1Probs"]["alert_level"]["danger"] == 0.7
    rec.close()


def test_L1P_1a_直前の答えは後から来た保存に付く(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path)
    rec.on_l1_answer(ANSWER, at=clock.now - 1.0, fresh=True)
    rec.offer(frame(0))
    assert rec.flush()
    assert store.list()[0][0]["capture"]["l1Probs"]["on_roadway"] == 0.6
    rec.close()


def test_L1P_1b_窓より離れた答えは付けない(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path)
    rec.offer(frame(0))
    assert rec.flush()
    rec.on_l1_answer(ANSWER, at=clock.now + 3.5, fresh=True)  # 後 3 秒を超えた
    assert rec.flush()
    assert "l1Probs" not in store.list()[0][0]["capture"]
    rec.close()


def test_L1P_1b_古い答えを先に付けて正しい答えを捨てない(tmp_path: Path) -> None:
    # 保存の 1.5 秒前の答え（前の場面）は付かず、そのあとに届いた正しい答えが付く
    rec, store, _, clock = make(tmp_path)
    old = L1Answer("jev-test", {"none": 0.9, "zone": 0.05, "danger": 0.05}, 0.0, 0.0, 0.9)
    rec.on_l1_answer(old, at=clock.now - 1.5, fresh=True)
    rec.offer(frame(0))
    assert rec.flush()
    assert "l1Probs" not in store.list()[0][0]["capture"]
    rec.on_l1_answer(ANSWER, at=clock.now + 0.4, fresh=True)
    assert rec.flush()
    assert store.list()[0][0]["capture"]["l1Probs"]["alert_level"]["danger"] == 0.7
    rec.close()


def test_REC_1l_offerの同期の仕事は軽い_縮小と変換はワーカー(tmp_path: Path) -> None:
    encoder = FakeEncoder()
    encoder.gate = threading.Event()  # ワーカーを止めておく（offer だけを測る）
    rec, _, _, _ = make(tmp_path, encoder, queue_size=64, max_per_run=500, min_interval_s=0.5)
    frames = [frame(1000 * i, seq=i) for i in range(60)]
    durations = []
    for f in frames:
        started = time.perf_counter()
        rec.offer(f)
        durations.append(time.perf_counter() - started)
    durations.sort()
    assert durations[len(durations) // 2] < 0.001  # 中央値が 1 ms 未満
    assert not encoder.shapes  # 縮小・変換はまだ（ワーカーの仕事）
    encoder.gate.set()
    rec.close()


def test_L1P_1c_外れた値の答えは付けない(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path)
    rec.offer(frame(0))
    assert rec.flush()
    bad = L1Answer("jev-test", {"none": 0.1, "zone": 0.2, "danger": float("nan")}, 0.6, 0.1, 0.05)
    rec.on_l1_answer(bad, at=clock.now, fresh=True)
    worse = L1Answer("jev-test", {"none": 0.1, "zone": 0.2, "danger": 0.7}, 1.5, 0.1, 0.05)
    rec.on_l1_answer(worse, at=clock.now, fresh=True)
    assert rec.flush()
    assert "l1Probs" not in store.list()[0][0]["capture"]
    rec.close()


def test_L1P_1d_付ける値は校正前の生の確率(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path)
    rec.offer(frame(0))
    assert rec.flush()
    answer = L1Answer("jev-x", {"none": 0.123, "zone": 0.234, "danger": 0.643}, 0.5, 0.25, 0.125)
    rec.on_l1_answer(answer, at=clock.now, fresh=True)
    assert rec.flush()
    probs = store.list()[0][0]["capture"]["l1Probs"]
    assert probs == {
        "alert_level": {"none": 0.123, "zone": 0.234, "danger": 0.643},
        "on_roadway": 0.5,
        "static_shoulder": 0.25,
        "false_positive": 0.125,
    }
    rec.close()


def test_L1P_1f_新しくない答えは使わず観察者はディスクに触れずに戻る(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path)
    rec.offer(frame(0))
    assert rec.flush()
    rec.on_l1_answer(ANSWER, at=clock.now, fresh=False)
    assert rec.flush()
    assert "l1Probs" not in store.list()[0][0]["capture"]

    gate = threading.Event()
    real = store.attach_l1_probs

    def slow(capture_id: str, probs: object) -> bool:
        assert gate.wait(5.0)
        return real(capture_id, probs)  # type: ignore[arg-type]

    store.attach_l1_probs = slow  # type: ignore[method-assign]
    started = time.perf_counter()
    rec.on_l1_answer(ANSWER, at=clock.now, fresh=True)
    assert time.perf_counter() - started < 0.2  # 書き込みが止まっていても待たない
    gate.set()
    assert rec.flush()
    assert "l1Probs" in store.list()[0][0]["capture"]
    rec.close()


def test_FAIL_5_書き足しが失敗してもワーカーは続く(tmp_path: Path) -> None:
    rec, store, _, clock = make(tmp_path, min_interval_s=0.5)
    rec.offer(frame(0))
    assert rec.flush()

    def broken(*_: object, **__: object) -> bool:
        msg = "disk full"
        raise OSError(msg)

    store.attach_l1_probs = broken  # type: ignore[method-assign]
    rec.on_l1_answer(ANSWER, at=clock.now, fresh=True)
    rec.offer(frame(2000))
    assert rec.flush()
    assert store.list()[1] == 2
    rec.close()


def test_REC_ログの形は標準のloggingで取れる(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    with caplog.at_level(logging.INFO, logger="detector.capture"):
        rec, _, _, _ = make(tmp_path)
        rec.offer(frame(0))
        assert rec.flush()
        rec.close()
    assert any(r.getMessage() == "capture.saved" for r in caplog.records)
