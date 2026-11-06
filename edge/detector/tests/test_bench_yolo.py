"""edge-run R7: YOLO 単独の計測（`scripts/bench_l1.py --no-l1 --model X`）。L1 には触れない。"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from detector import bench
from detector.config import Config


class Tick:
    """注入する時計。検出器が呼ばれるたびに step 秒進める。"""

    def __init__(self) -> None:
        self.t = 0.0

    def __call__(self) -> float:
        return self.t


class TimedDetector:
    def __init__(self, clock: Tick, ms: float, fail_on: set[int] | None = None) -> None:
        self.clock = clock
        self.ms = ms
        self.fail_on = fail_on or set()
        self.calls = 0

    def detect(self, image: np.ndarray) -> list:
        n = self.calls
        self.calls += 1
        self.clock.t += (200.0 if n == 0 else self.ms) / 1000.0  # 1 回目はコンパイルで遅い
        if n in self.fail_on:
            raise RuntimeError("predict failed")
        return []


FRAMES = bench.make_frames(7)


def never(*_a, **_k):
    raise AssertionError("L1 側の部品を作った")


# RUN-6b
def test_RUN_6b_最初の5回を測らずp50_p95とfpsとch6の判定を出す() -> None:
    clock = Tick()
    det = TimedDetector(clock, ms=10.0)
    report = bench.run_yolo_alone(det, FRAMES, 1.0, target_fps=10, clock=clock)
    alone, v = report["l0_alone"], report["verdict"]
    assert report["mode"] == "yolo"
    assert alone["first_ms"] == 200.0
    assert alone["infer"]["p50_ms"] == 10.0 and alone["infer"]["p95_ms"] == 10.0
    assert alone["frames"] == 100 and alone["fps"] == 100.0
    assert det.calls == 5 + 100
    assert v["valid"] is True and v["l0_meets_target_fps"] is True
    assert (v["infer_budget_ms"], v["infer_target_ms"]) == (100.0, 50.0)
    assert v["infer_p95_within_budget"] and v["infer_p95_within_target"] and v["meets_ch6"]


# RUN-6b
def test_RUN_6b_予算100msを超えるとmeets_ch6が偽_目標50msだけ超えるのは合格() -> None:
    clock = Tick()
    slow = bench.run_yolo_alone(TimedDetector(clock, ms=120.0), FRAMES, 1.2, clock=clock)
    assert slow["verdict"]["valid"] and not slow["verdict"]["infer_p95_within_budget"]
    assert slow["verdict"]["l0_meets_target_fps"] is False  # 120 ms → 8.3 fps
    assert slow["verdict"]["meets_ch6"] is False
    clock = Tick()
    mid = bench.run_yolo_alone(TimedDetector(clock, ms=60.0), FRAMES, 1.2, clock=clock)
    assert mid["verdict"]["infer_p95_within_target"] is False
    assert mid["verdict"]["meets_ch6"] is True


# RUN-6c
def test_RUN_6c_例外が出ると無効() -> None:
    clock = Tick()
    report = bench.run_yolo_alone(TimedDetector(clock, 10.0, {20}), FRAMES, 1.0, clock=clock)
    v = report["verdict"]
    assert (v["valid"], v["invalid_reason"]) == (False, "yolo_errors")
    assert report["l0_alone"]["last_error"] == "RuntimeError"
    assert v["meets_ch6"] is False and bench._problem(report)


# RUN-6c
def test_RUN_6c_立ち上がらないと無効で測らない() -> None:
    clock = Tick()
    det = TimedDetector(clock, 10.0, set(range(5)))
    report = bench.run_yolo_alone(det, FRAMES, 1.0, clock=clock)
    assert report["verdict"]["invalid_reason"] == "yolo_not_ready"
    assert det.calls == 5 and report["l0_alone"]["first_ms"] is None


# RUN-6d
def test_RUN_6d_表にYOLO単独の行と判定() -> None:
    clock = Tick()
    report = bench.run_yolo_alone(TimedDetector(clock, 10.0), FRAMES, 1.0, clock=clock)
    table = bench.render_table(report)
    assert "| L1 なし | 100.0 | 100 | 10.0 | 10.0 |" in table
    assert "合格（推論だけ・乱数画像の参考値）" in table and "目標 10 fps を保てる" in table
    clock = Tick()
    bad = bench.run_yolo_alone(TimedDetector(clock, 10.0, {9}), FRAMES, 1.0, clock=clock)
    assert "判定できない: yolo_errors（RuntimeError）" in bench.render_table(bad)


class Fast:
    def detect(self, image: np.ndarray) -> list:
        return []


# RUN-AC-3・RUN-6a
def test_RUN_AC_3_no_l1はL1を作らずにyoloのJSONと表を出す(tmp_path: Path, capsys) -> None:
    seen = {}

    def detector_factory(config: Config, path: Path) -> Fast:
        seen["model"], seen["units"] = path, config.coreml.compute_units
        return Fast()

    out = tmp_path / "yolo.json"
    code = bench.main(
        ["--no-l1", "--model", "m.mlpackage", "--yolo-seconds", "0.2", "--out", str(out)],
        examples_loader=never,
        client_factory=never,
        detector_factory=detector_factory,
    )
    stdout = capsys.readouterr().out
    report = json.loads(out.read_text(encoding="utf-8"))
    assert code == 0
    assert report["schema"] == bench.SCHEMA and report["mode"] == "yolo"
    assert report["params"]["no_l1"] is True and report["params"]["model"] == "m.mlpackage"
    assert "l1_alone" not in report and report["verdict"]["valid"] is True
    assert "| L0（YOLO 単独）" in stdout
    assert seen == {"model": Path("m.mlpackage"), "units": "cpu_and_ne"}


# RUN-6a
@pytest.mark.parametrize(
    ("argv", "message"),
    [
        (["--no-l1"], "--model"),
        (["--no-l1", "--compare", "--model", "m.mlpackage"], "--compare"),
    ],
)
def test_RUN_6a_no_l1はmodelが要りcompareと一緒は不可(argv, message, capsys) -> None:
    assert bench.main(argv, client_factory=never, examples_loader=never) == 2
    assert message in capsys.readouterr().err


# RUN-6a
def test_RUN_6a_検出器を作れないとexit2(capsys) -> None:
    def boom(_c, _p):
        raise RuntimeError("no coremltools")

    assert bench.main(["--no-l1", "--model", "m.mlpackage"], detector_factory=boom) == 2


# RUN-6c
def test_RUN_6c_無効はexit3_遅いとexit4(capsys, monkeypatch) -> None:
    def report(valid: bool, meets: bool) -> dict:
        return {
            "mode": "yolo",
            "l0_alone": {
                "fps": 1.0,
                "infer": bench.summarize_ms([1.0]),
                "first_ms": 1.0,
                "errors": 0,
                "last_error": None,
            },
            "verdict": {
                "valid": valid,
                "invalid_reason": None if valid else "yolo_errors",
                "meets_ch6": meets,
                "infer_budget_ms": 100.0,
                "infer_target_ms": 50.0,
                "infer_p95_within_budget": meets,
                "infer_p95_within_target": meets,
                "l0_meets_target_fps": meets,
                "target_fps": 10,
            },
        }

    argv = ["--no-l1", "--model", "m.mlpackage"]
    factory = {"detector_factory": lambda _c, _p: Fast()}
    monkeypatch.setattr(bench, "run_yolo_alone", lambda *a, **k: report(False, False))
    assert bench.main(argv, **factory) == 3
    monkeypatch.setattr(bench, "run_yolo_alone", lambda *a, **k: report(True, False))
    assert bench.main(argv, **factory) == bench.EXIT_SLOW
    assert "ch6 の予算" in capsys.readouterr().err


def test_RUN_AC_3_outに書けないとexit2(tmp_path: Path, capsys) -> None:
    code = bench.main(
        [
            "--no-l1",
            "--model",
            "m.mlpackage",
            "--yolo-seconds",
            "0.05",
            "--out",
            str(tmp_path / "no" / "x.json"),
        ],
        detector_factory=lambda _c, _p: Fast(),
    )
    assert code == 2 and "--out に書けない" in capsys.readouterr().err
