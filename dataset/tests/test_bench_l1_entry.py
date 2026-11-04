"""edge-day0: scripts/bench_l1.py（入口）が export_l1_labels の合成シナリオを渡せる。"""

import importlib.util
from pathlib import Path

from detector.schema import JudgeRequest

ENTRY = Path(__file__).resolve().parents[2] / "scripts" / "bench_l1.py"


def load_entry():
    spec = importlib.util.spec_from_file_location("bench_l1_entry", ENTRY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_synthetic_examples_are_labelled_judge_requests() -> None:
    rows = load_entry().synthetic_examples(6, 7)
    assert len(rows) == 6
    for row in rows:
        JudgeRequest.model_validate(row["request"])
        assert set(row["labels"]) == {
            "alert_level",
            "on_roadway",
            "static_shoulder",
            "false_positive",
        }


def test_synthetic_examples_are_reproducible() -> None:
    entry = load_entry()
    assert entry.synthetic_examples(4, 3) == entry.synthetic_examples(4, 3)


def test_run_rejects_bad_arguments() -> None:
    assert load_entry().run(["--n", "0"]) == 2
