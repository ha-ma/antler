"""FPA-1〜4: L0 の誤検出の後処理を入れても、近づく鹿・路肩の鹿・止まった車の前の鹿の赤は落とさない。

偽の推論の枠の列を、既定の後処理つき DeerDetector → パイプライン → AlertHub に流し、送られた旗を見る
（l0-fp-filter の受け入れ）。時計は 1 フレーム 0.1 秒の偽物を、後処理と AlertHub で共有する。
"""

import json
from dataclasses import replace

from detector.config import Config, L0FilterConfig
from detector.hub import AlertHub
from detector.inference import DeerDetector, ScriptedDetector
from detector.l0.fp_filter import build_box_filter
from detector.l0.stage import L0Stage
from detector.pipeline import process_frames

from .conftest import Clock, frames_at_fps, named
from .fp_geometry import approach, deer, deer_box
from .test_runner import ListSource


def run(script, config=None):
    """枠の列を流し、送った旗と L0 の段（トラッカーを見る）を返す。"""
    config = config or Config()
    clock = Clock()
    box_filter = build_box_filter(config.l0_filter, clock=clock)
    detector = DeerDetector(ScriptedDetector(script), box_filter=box_filter, clock=clock)
    stage = L0Stage(config.judge, config.tracker)
    hub = AlertHub(config.judge, clock=clock, l0=stage)
    sent = []
    hub.sender = lambda t: sent.append(json.loads(t)) or 1
    for r in process_frames(ListSource(frames_at_fps(10, len(script))), config, detector):
        clock.advance(0.1)
        hub.on_result(r)
    return sent, stage


def red_from_second_deer_to_end(sent) -> bool:
    flags = [f["deer"] for f in sent]
    return flags[:2] == [False, True] and all(flags[1:])


# FPA-1・S-1
def test_fpa1_近づく鹿は2フレーム目で赤になり至近でも続きで通り赤のまま(logbuf):
    # 車線の中央。至近（1.2 m）の枠は面積 0.7 を超えるが、遠くから続いているので通る
    boxes = [deer_box(d, 0.0) for d in approach(40.0, 1.2)]
    assert all(b is not None for b in boxes)
    assert boxes[-1][2] * boxes[-1][3] >= 0.7
    sent, _ = run([[], []] + [[deer(b)] for b in boxes])

    assert red_from_second_deer_to_end(sent)
    filtered = named(logbuf, "l0.filtered")
    assert filtered and all(e["continued"] == 1 and e["area"] + e["width"] == 0 for e in filtered)


# FPA-2
def test_fpa2_画面全体のぶれは赤にならずトラッカーにも入らない(logbuf):
    script = [[deer((0.5, 0.5, 0.96, 1.0), conf=0.95)] for _ in range(10)]
    sent, stage = run(script)
    assert sent and not any(f["deer"] for f in sent)
    assert stage.tracker.tracks == ()
    filtered = named(logbuf, "l0.filtered")
    assert len(filtered) == 10 and all(e["area"] == 1 for e in filtered)


# FPA-3
def test_fpa3_左の路肩から出る鹿は既定でも隅の領域があっても赤になる():
    # x 0.0〜0.2・y 0.6〜1.0（R16 のミラーと同じ辺り）
    shoulder = deer((0.1, 0.8, 0.2, 0.4), conf=0.9)
    sent, _ = run([[shoulder], [shoulder]])
    assert sent[-1]["deer"] is True

    corner = replace(Config(), l0_filter=L0FilterConfig(ignore_regions=((0.0, 0.7, 0.15, 1.0),)))
    sent, _ = run([[shoulder], [shoulder]], corner)  # 領域に入るのは 56%（8 割未満）
    assert sent[-1]["deer"] is True


# FPA-4・S-1
def test_fpa4_止まった車の前に3秒とどまる鹿は最後まで赤():
    walk = [4.0 - 0.1 * i for i in range(31)]  # 1 m/s で 4 m → 1 m
    stay = [1.0] * 30  # 3 秒
    boxes = [deer_box(d, 0.0) for d in walk + stay]
    assert boxes[-1][2] * boxes[-1][3] >= 0.7  # 除かれる大きさ
    sent, _ = run([[], []] + [[deer(b)] for b in boxes])
    assert red_from_second_deer_to_end(sent)
