#!/usr/bin/env python3
"""Day 0 / Day 2 の L1・YOLO の計測の入口（変更指示 §3.2・§4 Step 0・Step 6）。

本体は edge/detector/src/detector/bench.py（ruff・pytest・カバレッジが効く場所）。ここは
`--compare` のシナリオ（dataset/export_l1_labels.py の合成トレース）を渡すだけ。

    python scripts/bench_l1.py --n 100 --out /tmp/bench-no-yolo.json
    python scripts/bench_l1.py --n 100 --model edge/detector/models/yolov8s-worldv2-deer.mlpackage
    python scripts/bench_l1.py --compare --systems llm-qwen2.5-1.5b nli-deberta-large
    python scripts/bench_l1.py --no-l1 --model edge/detector/models/yolo26n-480.mlpackage

依存: pip install -e "edge/detector[dev,l1]"（YOLO を測るときは [day0] か [run] も）。
`--no-l1` は L1（local-jev・typesafe-sdk）も dataset も使わない（edge-run）。
"""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "dataset"))


def synthetic_examples(count: int, seed: int) -> list[dict[str, object]]:
    """正解付きの合成シナリオ（export_l1_labels の --synthetic と同じ）。"""
    from export_l1_labels import export, synthetic_traces

    rows, _ = export(synthetic_traces(seed), seed=seed, examples=count, max_traces=count * 50)
    return [r.to_json() for r in rows]


def run(argv: list[str] | None = None) -> int:
    from detector.bench import main

    return main(argv, examples_loader=synthetic_examples)


if __name__ == "__main__":
    raise SystemExit(run())
