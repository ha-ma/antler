"""edge-day0: bench（L1 の p50/p95・YOLO 併走の fps 低下・--compare）。実機は使わない。"""

import asyncio
import json
import time
from pathlib import Path

import pytest

from detector import bench
from detector.config import Config
from detector.l1.client import make_client
from detector.ports import Detection
from detector.schema import JUDGE_QUESTIONS, JudgeRequest

from .l1_fakes import FakeClient, JevServer, answer, jev_body, unavailable


def track_point(**kw: object) -> dict:
    base = {
        "t": 0.0,
        "conf": 0.9,
        "distanceM": 20.0,
        "lateralMps": 0.0,
        "side": "L",
        "pos": "shoulder",
    }
    return {**base, **kw}


def request_dict(model: str = "jev-latest", **point: object) -> dict:
    return JudgeRequest.model_validate(
        {
            "model": model,
            "state": {
                "speedKmh": 60.0,
                "zone": "inside",
                "light": "night",
                "headlight": "low",
                "track": [track_point(t=-0.4, **point), track_point(**point)],
                "ttcSec": None,
                "recentAlerts30s": 1,
            },
            "questions": list(JUDGE_QUESTIONS),
        }
    ).model_dump(mode="json")


def example(
    level: str = "danger",
    on_roadway: bool = False,
    still: bool = True,
    fp: bool = False,
    **pt: object,
) -> dict:
    return {
        "id": "x",
        "request": request_dict(**pt),
        "labels": {
            "alert_level": level,
            "on_roadway": on_roadway,
            "static_shoulder": still,
            "false_positive": fp,
        },
        "meta": {},
    }


class SlowDetector:
    def __init__(self, delay: float = 0.002, fail: bool = False) -> None:
        self.delay = delay
        self.fail = fail
        self.calls = 0

    def detect(self, image: object) -> list[Detection]:
        self.calls += 1
        time.sleep(self.delay)
        if self.fail:
            msg = "boom"
            raise RuntimeError(msg)
        return []


class ContendedDetector(SlowDetector):
    """L1 が走っている間だけ遅くなる（併走の fps 低下が数字に出ることを確かめる）。"""

    def __init__(self, client: FakeClient) -> None:
        super().__init__(0.002)
        self.client = client

    def detect(self, image: object) -> list[Detection]:
        if self.client.in_flight:
            self.delay = 0.02
        return super().detect(image)


def requests(n: int = 3) -> list[JudgeRequest]:
    return [JudgeRequest.model_validate(request_dict()) for _ in range(n)]


# ---- 統計 ----


# BEN-1a
def test_percentile_and_summary() -> None:
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert bench.percentile(values, 50) == 30.0
    assert bench.percentile(values, 95) == pytest.approx(48.0)
    assert bench.percentile([7.0], 95) == 7.0
    s = bench.summarize_ms([5.0, 1.0, 3.0])
    assert (s["n"], s["p50_ms"], s["max_ms"]) == (3, 3.0, 5.0)
    empty = bench.summarize_ms([])
    assert empty["n"] == 0
    assert empty["p95_ms"] is None
    json.dumps(empty, allow_nan=False)


# CMP-1e
def test_ece() -> None:
    assert bench.ece([]) is None
    assert bench.ece([(1.0, True), (1.0, True)]) == 0.0
    assert bench.ece([(1.0, False), (1.0, False)]) == 1.0
    assert bench.ece([(0.5, True), (0.5, False)]) == 0.0
    assert bench.ece([(0.0, False)]) == 0.0  # 確信度 0 の端も数える


# ---- 計測 ----


# BEN-1b BEN-1c
def test_bench_without_yolo_counts_failures_and_models() -> None:
    client = FakeClient([answer(), unavailable("timeout"), answer(model="other")])
    bench_cfg = bench.Bench("http://127.0.0.1:1", 800, n=6, warmup=1, interval_ms=0)
    report = asyncio.run(bench.run_bench(bench_cfg, client, requests(), None))
    alone = report["l1_alone"]
    assert len(client.requests) == 7  # warmup 1 + n 6
    assert alone["n"] == 5
    assert alone["failures"] == {"timeout": 1}
    assert alone["answered_by"] == {"other": 5}
    assert alone["answered_ratio"] == pytest.approx(5 / 6, abs=1e-3)
    assert alone["warmup_ms"] is not None
    assert report["verdict"]["fps_drop_pct"] is None
    assert "l0_alone" not in report


# BEN-2a
def test_bench_with_yolo_measures_fps_drop() -> None:
    client = FakeClient([answer()], delay=0.01)
    detector = ContendedDetector(client)
    cfg = bench.Bench("http://127.0.0.1:1", 800, n=15, warmup=0, interval_ms=0, yolo_seconds=0.3)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), detector))
    assert report["l0_alone"]["fps"] > 0
    assert report["l0_with_l1"]["fps"] < report["l0_alone"]["fps"]
    verdict = report["verdict"]
    assert verdict["fps_drop_pct"] > bench.FPS_DROP_LIMIT_PCT
    assert verdict["fps_drop_ok"] is False
    assert report["l1_with_yolo"]["n"] == 15
    json.dumps(report, allow_nan=False)


# BEN-2b
def test_bench_with_yolo_within_limit() -> None:
    client = FakeClient([answer()], delay=0.005)
    cfg = bench.Bench("http://127.0.0.1:1", 800, n=10, warmup=0, interval_ms=0, yolo_seconds=0.3)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), SlowDetector()))
    assert report["verdict"]["fps_drop_ok"] is True
    assert report["verdict"]["valid"] is True
    assert report["verdict"]["l0_meets_target_fps"] is True  # 目標 10 fps
    assert report["l0_alone"]["frames"] > 0


# BEN-2c
def test_detector_errors_are_counted_not_raised() -> None:
    client = FakeClient([answer()])
    cfg = bench.Bench(
        "http://127.0.0.1:1",
        800,
        n=3,
        warmup=0,
        interval_ms=0,
        yolo_seconds=0.1,
        ready_timeout_s=0.3,
    )
    report = asyncio.run(bench.run_bench(cfg, client, requests(), SlowDetector(fail=True)))
    assert report["l0_alone"]["errors"] > 0
    assert report["l0_alone"]["last_error"] == "RuntimeError"
    assert report["verdict"]["l0_errors"] > 0
    # 推論が一度も成功しない = 立ち上がらない。数字を合格にしない
    assert report["verdict"]["valid"] is False
    assert report["verdict"]["invalid_reason"] == "yolo_not_ready"
    assert report["verdict"]["fps_drop_ok"] is False


# ---- 比較 ----


# CMP-1a
def test_rule_answer_uses_track_only() -> None:
    lane = bench.rule_answer(request_dict(pos="lane"))
    assert lane["alert_level"] == ("danger", 1.0)
    assert lane["on_roadway"][0] is True
    assert lane["static_shoulder"][0] is False
    still = bench.rule_answer(request_dict(pos="shoulder", lateralMps=0.0))
    assert still["static_shoulder"][0] is True
    moving = bench.rule_answer(request_dict(pos="shoulder", lateralMps=1.0))
    assert moving["static_shoulder"][0] is False
    assert bench.rule_answer(request_dict())["false_positive"] == (False, 1.0)


# CMP-1b
def test_compare_scores_rule_and_systems() -> None:
    examples = [example(), example(fp=True), example(level="zone", on_roadway=True, pos="lane")]
    client = FakeClient([answer(levels={"none": 0.0, "zone": 0.0, "danger": 1.0})])
    report = asyncio.run(bench.run_compare(examples, ["llm-qwen2.5-1.5b"], client, warmup=1))
    assert report["scenarios"] == 3
    rule = report["systems"]["rule"]["questions"]
    assert rule["alert_level"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    assert rule["false_positive"]["accuracy"] == pytest.approx(2 / 3, abs=1e-4)
    qwen = report["systems"]["llm-qwen2.5-1.5b"]
    assert qwen["latency"]["n"] == 3
    assert qwen["questions"]["alert_level"]["n"] == 3
    models = {r.model for r in client.requests}
    assert models == {"llm-qwen2.5-1.5b"}  # システムごとにモデル名を請求に入れる
    json.dumps(report, allow_nan=False)


# CMP-1c
def test_compare_counts_failures() -> None:
    client = FakeClient([unavailable("timeout")])
    report = asyncio.run(bench.run_compare([example()], ["m"], client, warmup=0))
    system = report["systems"]["m"]
    assert system["latency"]["failures"] == {"timeout": 1}
    assert system["questions"]["alert_level"]["accuracy"] is None


# ---- 実物の SDK（MockTransport）越しの CLI ----


def factory(server: JevServer):
    return lambda url, timeout_ms: make_client(url, timeout_ms, transport=server.transport)


def loader(count: int, seed: int) -> list[dict]:
    return [example() for _ in range(count)]


# DAC-1
def test_main_writes_json_and_table(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    server = JevServer(body=jev_body())
    out = tmp_path / "bench.json"
    code = bench.main(
        ["--n", "5", "--warmup", "1", "--interval-ms", "0", "--out", str(out)],
        examples_loader=loader,
        client_factory=factory(server),
    )
    assert code == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["schema"] == bench.SCHEMA
    assert report["l1_alone"]["n"] == 5
    assert report["l1_alone"]["answered_by"] == {"llm-qwen2.5-1.5b": 5}
    assert len(server.requests) == 6
    assert "environment" in report
    printed = capsys.readouterr().out
    assert "| YOLO なし |" in printed
    assert printed.startswith("{")


# BEN-2d
def test_main_with_model_uses_detector_factory(capsys: pytest.CaptureFixture[str]) -> None:
    server = JevServer(body=jev_body())
    seen: list[tuple[Config, Path]] = []

    def detector_factory(config: Config, path: Path) -> SlowDetector:
        seen.append((config, path))
        return SlowDetector()

    code = bench.main(
        [
            "--n",
            "3",
            "--warmup",
            "0",
            "--interval-ms",
            "0",
            "--yolo-seconds",
            "0.2",
            "--model",
            "m.mlpackage",
            "--compute-units",
            "cpu_only",
        ],
        examples_loader=loader,
        client_factory=factory(server),
        detector_factory=detector_factory,
    )
    assert code == 0
    assert seen[0][0].coreml.compute_units == "cpu_only"
    assert seen[0][1] == Path("m.mlpackage")
    assert "併走" in capsys.readouterr().out


# CMP-1d
def test_main_compare_from_labels_file(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    labels = tmp_path / "labels.jsonl"
    labels.write_text("\n".join(json.dumps(example()) for _ in range(4)) + "\n", encoding="utf-8")
    server = JevServer(body=jev_body())
    code = bench.main(
        ["--compare", "--labels", str(labels), "--systems", "llm-qwen2.5-1.5b", "--warmup", "0"],
        client_factory=factory(server),
    )
    assert code == 0
    out = capsys.readouterr().out
    payload = json.loads(out.split("\n\n")[0])
    assert set(payload["systems"]) == {"rule", "llm-qwen2.5-1.5b"}
    assert payload["systems"]["llm-qwen2.5-1.5b"]["valid"] is True
    assert next(p["model"] for p in server.payloads()) == "llm-qwen2.5-1.5b"
    assert "回答率" in out


def test_main_compare_with_other_model_answering_is_invalid(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    labels = tmp_path / "labels.jsonl"
    labels.write_text(json.dumps(example()) + "\n", encoding="utf-8")
    server = JevServer(body=jev_body())  # 何を請求しても llm-qwen2.5-1.5b が答える
    code = bench.main(
        ["--compare", "--labels", str(labels), "--systems", "nli-deberta-large", "--warmup", "0"],
        client_factory=factory(server),
    )
    captured = capsys.readouterr()
    assert code == 3
    payload = json.loads(captured.out.split("\n\n")[0])
    system = payload["systems"]["nli-deberta-large"]
    assert system["valid"] is False
    assert "answered_by_other_model" in system["invalid_reason"]
    assert "無効" in captured.out


# BEN-1d
def test_main_l1_unreachable_is_exit_3(capsys: pytest.CaptureFixture[str]) -> None:
    client = FakeClient([unavailable("connect")])
    code = bench.main(
        ["--n", "2", "--warmup", "0", "--interval-ms", "0"],
        examples_loader=loader,
        client_factory=lambda url, ms: client,
    )
    assert code == 3
    assert "local-jev は起動済みか" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [["--n", "0"], ["--yolo-seconds", "0"], ["--warmup", "-1"], ["--interval-ms", "-1"]],
)
def test_main_rejects_bad_numbers(argv: list[str]) -> None:
    assert bench.main(argv, examples_loader=loader) == 2


# BEN-3a
def test_main_input_errors(tmp_path: Path) -> None:
    assert bench.main(["--labels", str(tmp_path / "none.jsonl")]) == 2
    bad = tmp_path / "bad.jsonl"
    bad.write_text("{not json\n", encoding="utf-8")
    assert bench.main(["--labels", str(bad)]) == 2
    bad.write_text('{"id": 1}\n', encoding="utf-8")
    assert bench.main(["--labels", str(bad)]) == 2
    bad.write_text("\n", encoding="utf-8")
    assert bench.main(["--labels", str(bad)]) == 2
    assert bench.main([], examples_loader=None) == 2  # 合成の入口が無い
    remote = bench.main(["--base-url", "http://example.com:8766"], examples_loader=loader)
    assert remote == 2  # ループバック以外へは送らない


# BEN-1e
def test_environment_is_json() -> None:
    env = bench.environment()
    json.dumps(env, allow_nan=False)
    assert env["python"]


# ---- spec-adversary の指摘 ----


# ADV-4
def test_warmup_retries_until_first_success_and_keeps_failures() -> None:
    client = FakeClient([unavailable("timeout"), unavailable("timeout"), answer()])
    run = asyncio.run(bench.run_l1(client, requests(), n=2, warmup=3))
    assert run.warmup_ms is not None
    assert run.warmup_failures == {"timeout": 2}
    assert len(client.requests) == 5  # warmup 3 回(2 失敗 + 成功) + n 2 回


def test_warmup_failing_every_time_is_recorded() -> None:
    client = FakeClient([unavailable("connect")])
    run = asyncio.run(bench.run_l1(client, requests(), n=1, warmup=2))
    assert run.warmup_ms is None
    assert run.warmup_failures == {"connect": 2}


def test_warmup_uses_its_own_client() -> None:
    main_client = FakeClient([answer()])
    warm = FakeClient([answer()])
    asyncio.run(bench.run_l1(main_client, requests(), n=2, warmup=1, warmup_client=warm))
    assert len(warm.requests) == 1
    assert len(main_client.requests) == 2


# ADV-2
def test_overlap_with_dead_l1_is_not_a_pass() -> None:
    # 単独では答え、YOLO と併走する区間では L1 が落ちる(OOM など): YOLO は負荷なしで回る
    client = FakeClient([answer()] * 5 + [unavailable("connect")])
    cfg = bench.Bench("http://127.0.0.1:1", 800, n=5, warmup=0, interval_ms=0, yolo_seconds=0.2)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), SlowDetector()))
    verdict = report["verdict"]
    assert report["l1_with_yolo"]["n"] == 0
    assert verdict["valid"] is False
    assert verdict["invalid_reason"] == "l1_failed_during_overlap"
    assert verdict["fps_drop_ok"] is False
    assert bench._problem({"mode": "bench", **report}) is not None


# ADV-6
def test_l0_errors_are_per_window() -> None:
    cfg = bench.Bench(
        "http://127.0.0.1:1",
        800,
        n=2,
        warmup=0,
        interval_ms=0,
        yolo_seconds=0.1,
        ready_timeout_s=0.2,
    )
    report = asyncio.run(
        bench.run_bench(cfg, FakeClient([answer()]), requests(), SlowDetector(fail=True))
    )
    alone, both = report["l0_alone"], report["l0_with_l1"]
    assert report["verdict"]["l0_errors"] == alone["errors"] + both["errors"]


def test_compare_reports_coverage_and_accuracy_with_failures_counted_wrong() -> None:
    examples = [example(), example(), example()]
    # 3 件中 1 件だけ答える(あとは timeout): 答えた分だけの正解率は高く出るが、回答率で分かる
    client = FakeClient(
        [answer(levels={"none": 0, "zone": 0, "danger": 1.0}), unavailable("timeout")]
    )
    report = asyncio.run(bench.run_compare(examples, ["llm-qwen2.5-1.5b"], client, warmup=0))
    q = report["systems"]["llm-qwen2.5-1.5b"]["questions"]["alert_level"]
    assert q["n"] == 1
    assert q["coverage"] == pytest.approx(1 / 3, abs=1e-3)
    assert q["accuracy"] == 1.0
    assert q["accuracy_all"] == pytest.approx(1 / 3, abs=1e-3)
    assert report["systems"]["llm-qwen2.5-1.5b"]["valid"] is True


# ADV-3
def test_compare_system_answered_by_other_model_is_invalid() -> None:
    client = FakeClient([answer(model="llm-qwen2.5-1.5b")])
    report = asyncio.run(bench.run_compare([example()], ["nli-deberta-large"], client, warmup=0))
    system = report["systems"]["nli-deberta-large"]
    assert system["valid"] is False
    assert "llm-qwen2.5-1.5b" in system["invalid_reason"]
    assert bench._problem(report) is not None


def test_compare_system_without_answers_is_invalid() -> None:
    client = FakeClient([unavailable("timeout")])
    report = asyncio.run(bench.run_compare([example()], ["m"], client, warmup=0))
    assert report["systems"]["m"]["invalid_reason"] == "no_answers"


def test_main_rejects_unknown_compute_units() -> None:
    with pytest.raises(SystemExit):
        bench.main(["--compute-units", "ane"], examples_loader=loader)


def test_main_detector_load_failure_is_exit_2() -> None:
    def broken(config: Config, path: Path) -> SlowDetector:
        msg = "model gone"
        raise RuntimeError(msg)

    code = bench.main(
        ["--model", "x.mlpackage"],
        examples_loader=loader,
        client_factory=lambda url, ms: FakeClient([answer()]),
        detector_factory=broken,
    )
    assert code == 2


def test_main_with_dead_overlap_exits_3(capsys: pytest.CaptureFixture[str]) -> None:
    client = FakeClient([answer()] * 3 + [unavailable("connect")])
    code = bench.main(
        [
            "--n",
            "3",
            "--warmup",
            "0",
            "--interval-ms",
            "0",
            "--yolo-seconds",
            "0.1",
            "--model",
            "m.mlpackage",
        ],
        examples_loader=loader,
        client_factory=lambda url, ms: client,
        detector_factory=lambda config, path: SlowDetector(),
    )
    captured = capsys.readouterr()
    assert code == 3
    assert "判定できない" in captured.out
    assert "併走の判定が無効" in captured.err


# ---- edge-latency-reviewer / code-reviewer の指摘 ----


# ADV-7
def test_p95_with_failures_counted_as_timeout() -> None:
    # 5 回中 2 回が 800 ms で落ちた: 成功だけの p95 は低く見える。タイムアウトを混ぜた p95 を並べる
    client = FakeClient([answer(), answer(), unavailable("timeout"), unavailable("timeout")])
    run = asyncio.run(bench.run_l1(client, requests(), n=4, warmup=0, timeout_ms=800.0))
    report = run.report()
    assert report["answered_ratio"] == 0.5
    assert report["p95_ms_failures_as_timeout"] == pytest.approx(800.0, abs=1.0)
    assert report["p95_ms"] < 100


def test_low_answered_ratio_makes_the_run_a_problem() -> None:
    client = FakeClient([answer(), unavailable("timeout")])
    cfg = bench.Bench("http://127.0.0.1:1", 800, n=10, warmup=0, interval_ms=0)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), None))
    problem = bench._problem({"mode": "bench", **report})
    assert problem is not None
    assert "回答率" in problem


def test_warmup_never_succeeding_makes_the_run_a_problem() -> None:
    # warmup は落ち続けたが本計測は答えた(ロードに失敗し続けたのに通った = 数字を信用しない)
    client = FakeClient([unavailable("timeout"), answer()])
    cfg = bench.Bench("http://127.0.0.1:1", 800, n=3, warmup=1, interval_ms=0)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), None))
    assert report["l1_alone"]["warmup_failures"] == {"timeout": 1}
    assert "warmup" in bench._problem({"mode": "bench", **report})


def test_yolo_errors_invalidate_the_fps_verdict() -> None:
    class Flaky(SlowDetector):
        def detect(self, image: object) -> list[Detection]:
            self.calls += 1
            time.sleep(0.002)
            if self.calls == 20:
                msg = "once"
                raise RuntimeError(msg)
            return []

    cfg = bench.Bench("http://127.0.0.1:1", 800, n=20, warmup=0, interval_ms=0, yolo_seconds=0.3)
    client = FakeClient([answer()], delay=0.01)
    report = asyncio.run(bench.run_bench(cfg, client, requests(), Flaky()))
    verdict = report["verdict"]
    assert verdict["l0_errors"] == 1
    assert verdict["valid"] is False
    assert verdict["invalid_reason"] == "yolo_errors"
    assert verdict["fps_drop_ok"] is False


# ADV-8
def test_scenarios_zero_and_empty_loader_are_input_errors() -> None:
    assert bench.main(["--scenarios", "0"], examples_loader=loader) == 2
    assert bench.main([], examples_loader=lambda n, seed: []) == 2


def test_labels_without_the_four_questions_are_rejected(tmp_path: Path) -> None:
    path = tmp_path / "labels.jsonl"
    path.write_text(json.dumps({"request": request_dict(), "labels": {"alert_level": "x"}}) + "\n")
    assert bench.main(["--labels", str(path)]) == 2


def test_invalid_request_shape_does_not_echo_the_content(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    path = tmp_path / "labels.jsonl"
    labels = example()["labels"]
    row = {"request": {"model": "SECRET-INPUT-VALUE", "state": {}}, "labels": labels}
    path.write_text(json.dumps(row) + "\n")
    assert bench.main(["--labels", str(path)]) == 2
    assert "SECRET-INPUT-VALUE" not in capsys.readouterr().err


def test_out_failure_still_prints_the_result(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    server = JevServer(body=jev_body())
    code = bench.main(
        [
            "--n",
            "2",
            "--warmup",
            "1",
            "--interval-ms",
            "0",
            "--out",
            str(tmp_path / "no" / "x.json"),
        ],
        examples_loader=loader,
        client_factory=factory(server),
    )
    captured = capsys.readouterr()
    assert code == 2
    assert captured.out.startswith("{")  # 計測は再現できないので先に出す
    assert "--out に書けない" in captured.err
