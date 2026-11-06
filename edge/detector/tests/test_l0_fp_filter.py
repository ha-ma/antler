"""FPF・FPC: L0 の誤検出の後処理（l0-fp-filter R1〜R7）。"""

import itertools
import sys
import time
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from detector.config import Config, ConfigError, InferConfig, L0FilterConfig, load_config
from detector.l0.coreml import LoadedModel, load_coreml_detector
from detector.l0.fp_filter import BoxFilter, build_box_filter
from detector.l0.inference import DeerDetector, ScriptedDetector
from detector.ports import Detection

from .conftest import Clock, named
from .fp_geometry import ASPECTS, deer_box

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"
IMAGE = np.zeros((4, 4, 3), dtype=np.uint8)


def write(tmp_path, text: str):
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


def box(w: float, h: float, x: float = 0.5, y: float = 0.5, conf: float = 0.9) -> Detection:
    return Detection("deer", conf, (x, y, w, h))


def keep(cfg: L0FilterConfig, dets: list[Detection]) -> list[Detection]:
    return BoxFilter(cfg)(dets)


def region(*xyxy: float, **kw) -> L0FilterConfig:
    return L0FilterConfig(ignore_regions=(xyxy,), **kw)


# ---- UC-1: 大きすぎる枠 ----


# FPF-1a
def test_fpf1a_面積07ちょうどは除き06999は残す():
    cfg = L0FilterConfig()
    assert keep(cfg, [box(0.7, 1.0)]) == []
    assert keep(cfg, [box(0.8, 0.875)]) == []  # 0.7 ちょうど（浮動小数でも）
    small = box(0.6999, 1.0)
    assert keep(cfg, [small]) == [small]


# FPF-1b
def test_fpf1b_幅085かつ高さ05は除き片方でも足りなければ残す():
    cfg = L0FilterConfig()
    assert keep(cfg, [box(0.85, 0.5)]) == []
    short = box(0.85, 0.49)  # 遠くの横長の群れ
    narrow = box(0.84, 0.8)  # 面積 0.672
    assert keep(cfg, [short, narrow]) == [short, narrow]


# 設定で下げられるいちばん下の組（l0-fp-filter R6）
FLOOR = L0FilterConfig(max_area=0.65, max_width=0.7, min_height_at_max_width=0.4)


# FPF-1c
@pytest.mark.parametrize("cfg", [L0FilterConfig(), FLOOR], ids=["default", "floor"])
@pytest.mark.parametrize("aspect", sorted(ASPECTS))
def test_fpf1c_2m以上の鹿は画面のどこにいても除かれない(aspect, cfg):
    # 横向き（小・大・角のある雄鹿）、正面
    sizes = [(1.6, 1.5), (1.8, 1.7), (1.9, 1.9), (0.5, 1.7)]
    distances = [2.0, 2.2, 2.5, 3.0, 4.0, 6.0, 10.0, 20.0, 40.0, 60.0]
    checked = 0
    for (length, height), d in itertools.product(sizes, distances):
        half = d * 0.7  # 画面の端までの横の距離（tan 35° ≒ 0.7）
        for k in range(-10, 11):
            xywh = deer_box(d, half * k / 10, length, height, aspect)
            if xywh is None:
                continue
            det = box(xywh[2], xywh[3], xywh[0], xywh[1])
            assert keep(cfg, [det]) == [det], (aspect, length, height, d, k, xywh)
            checked += 1
    assert checked > 700


def test_fpf1c_至近の鹿は除かれる():
    # 1.2 m（ボンネットの上）では 16:9・4:3 とも除かれる。境界の見積もりがずれていないことの確認
    for aspect in ASPECTS:
        x, y, w, h = deer_box(1.2, 0.0, 1.7, 1.6, aspect)
        assert keep(L0FilterConfig(), [box(w, h, x, y)]) == []


# FPF-1d
def test_fpf1d_直前1秒に通した枠から続く大きい枠は通る(logbuf):
    clock = Clock()
    f = BoxFilter(L0FilterConfig(), clock)
    near = box(0.6, 0.8, x=0.5, y=0.6)  # 面積 0.48: 通す
    whole = box(0.9, 0.95, x=0.5, y=0.5)  # 面積 0.855: 大きすぎる。near と IoU 0.56
    assert f([near]) == [near]
    clock.advance(1.0)  # ちょうど 1 秒は続き
    assert f([whole]) == [whole]
    assert named(logbuf, "l0.filtered")[-1]["continued"] == 1
    clock.advance(0.5)
    assert f([whole]) == [whole]  # 続きで通した枠も次の元になる（止まった車の前の鹿）

    clock.advance(1.1)  # 1 秒を超えて空いた
    assert f([whole]) == []
    clock.advance(0.1)
    assert f([whole]) == []  # 除いた枠は続きの元にならない（ぶれが続いても通らない）


def test_fpf1d_IoUが03未満なら続きにならず元は1フレーム16枠まで():
    clock = Clock()
    f = BoxFilter(L0FilterConfig(), clock)
    small = box(0.1, 0.1, x=0.5, y=0.5)
    f([small])
    clock.advance(0.1)
    assert f([box(0.9, 0.95)]) == []  # IoU 0.01

    g = BoxFilter(L0FilterConfig(), clock)
    many = [box(0.02, 0.02, x=0.03 * i + 0.02, y=0.1, conf=0.9) for i in range(16)]
    low = box(0.6, 0.8, x=0.5, y=0.6, conf=0.3)  # 17 番目（確信度がいちばん低い）
    g([*many, low])
    clock.advance(0.1)
    assert g([box(0.9, 0.95)]) == []  # low は元に入っていない


# ---- UC-2: 無視する領域 ----


# FPF-2a
def test_fpf2a_8割以上入る枠は確信度が半分になり座標そのままで並び直る():
    cfg = region(0.9, 0.3, 1.0, 0.5)
    inside = box(0.08, 0.1, x=0.96, y=0.4, conf=0.9)  # 全部が領域の中
    other = box(0.05, 0.1, x=0.3, y=0.5, conf=0.6)
    out = keep(cfg, [inside, other])
    assert out == [other, Detection("deer", 0.45, inside.xywh)]


# FPF-2b
def test_fpf2b_はみ出す枠は変わらない():
    cfg = region(0.0, 0.8, 1.0, 1.0)  # ボンネットの帯
    straddle = box(0.2, 0.25, x=0.5, y=0.875)  # 0.75〜1.0 → 中は 0.2/0.25 = 0.8 ちょうど → 弱める
    big = box(0.3, 0.5, x=0.3, y=0.7)  # 0.45〜0.95 → 中は 0.3 → 変わらない
    almost = box(0.2, 0.25, x=0.5, y=0.8749)  # 中は 0.7996 → 変わらない
    out = keep(cfg, [straddle, big, almost])
    assert big in out and almost in out
    assert [d.conf for d in out if d.xywh == straddle.xywh] == [pytest.approx(0.45)]


# FPF-2c
def test_fpf2c_倍率0なら除く():
    cfg = region(0.9, 0.3, 1.0, 0.5, region_conf_scale=0.0)
    assert keep(cfg, [box(0.08, 0.1, x=0.96, y=0.4)]) == []


# FPF-2d
def test_fpf2d_割合は足さず一番大きい領域で1回だけ掛ける():
    two = L0FilterConfig(ignore_regions=((0.0, 0.8, 0.2, 1.0), (0.2, 0.8, 0.4, 1.0)))
    halves = box(0.2, 0.2, x=0.2, y=0.9)  # 半分ずつ
    assert keep(two, [halves]) == [halves]
    overlap = L0FilterConfig(ignore_regions=((0.0, 0.8, 0.3, 1.0), (0.0, 0.8, 0.4, 1.0)))
    in_both = box(0.2, 0.2, x=0.15, y=0.9)
    assert [d.conf for d in keep(overlap, [in_both])] == [pytest.approx(0.45)]
    flat = box(0.0, 0.1, x=0.1, y=0.9)  # 面積 0（_valid を通る）。0 で割らず、領域に入らない
    assert keep(overlap, [flat]) == [flat]


# ---- UC-3: 位置・失敗・ログ ----


# FPF-3a
def test_fpf3a_deer以外と不正を捨てた後に当たり_last_invalidは後処理を数えない():
    seen = []

    def spy(dets):
        seen.append(list(dets))
        return BoxFilter(L0FilterConfig())(dets)

    whole = box(0.96, 1.0, conf=0.95)
    ok = box(0.05, 0.1, x=0.3, conf=0.8)
    car = Detection("car", 0.99, (0.5, 0.5, 0.1, 0.1))
    bad = Detection("deer", float("nan"), (0.5, 0.5, 0.1, 0.1))
    det = DeerDetector(ScriptedDetector([[car, whole, bad, ok]]), box_filter=spy)
    assert det.detect(IMAGE) == [ok]
    assert seen == [[whole, ok]]
    assert det.last_invalid == 1


# FPF-3b
def test_fpf3b_後処理が壊れたら元の検出を返し警告は1秒に1回(logbuf):
    def boom(_dets):
        raise RuntimeError("boom")

    clock = Clock()
    low, high = box(0.96, 1.0, conf=0.6), box(0.05, 0.1, conf=0.95)
    det = DeerDetector(ScriptedDetector([[low, high]] * 4), box_filter=boom, clock=clock)
    assert det.detect(IMAGE) == [high, low]  # 除かない側。確信度の順
    clock.advance(0.5)
    det.detect(IMAGE)
    clock.advance(0.6)
    det.detect(IMAGE)
    det.detect(IMAGE)
    failed = named(logbuf, "l0.fp_filter_failed")
    assert len(failed) == 2
    assert failed[0]["error_type"] == "RuntimeError"


# FPF-3c
def test_fpf3c_除いた弱めたフレームだけl0_filteredが残る(logbuf):
    f = BoxFilter(region(0.9, 0.3, 1.0, 0.5))
    f([box(0.05, 0.1, x=0.3)])
    assert named(logbuf, "l0.filtered") == []
    f(
        [
            box(0.96, 1.0, conf=0.7),
            box(0.9, 0.6, conf=0.4),
            box(0.08, 0.1, x=0.96, y=0.4, conf=0.85),
            box(0.05, 0.1, x=0.3),
        ]
    )
    (e,) = named(logbuf, "l0.filtered")
    assert (e["area"], e["width"], e["region_drop"], e["region_scaled"]) == (1, 1, 0, 1)
    assert e["max_conf_removed"] == 0.85
    assert e["kept"] == 2


# FPF-3d
def test_fpf3d_load_coreml_detectorが設定の後処理を使う():
    out = {
        "confidence": [[0.95], [0.9]],
        "coordinates": [[0.5, 0.5, 0.96, 1.0], [0.3, 0.5, 0.05, 0.1]],
    }

    def loader(_path, _units):
        class Model:
            def predict(self, _data):
                return out

        return LoadedModel(Model(), "image", (640, 480), {"names": "{0: 'deer'}"})

    base = Config(infer=InferConfig(model_path="deer.mlpackage"))
    det = load_coreml_detector(base, loader=loader, prepare=lambda a: a)
    assert [d.xywh for d in det.detect(IMAGE)] == [(0.3, 0.5, 0.05, 0.1)]
    off = replace(base, l0_filter=L0FilterConfig(enabled=False))
    det = load_coreml_detector(off, loader=loader, prepare=lambda a: a)
    assert len(det.detect(IMAGE)) == 2


# FPF-3e・S-2
def test_fpf3e_切ったときと後処理なしは従来と同じ():
    assert build_box_filter(L0FilterConfig(enabled=False)) is None
    assert isinstance(build_box_filter(L0FilterConfig()), BoxFilter)
    script = [[box(0.96, 1.0, conf=0.6), box(0.05, 0.1, conf=0.95)]]
    plain = DeerDetector(ScriptedDetector(script)).detect(IMAGE)
    off = DeerDetector(ScriptedDetector(script), box_filter=None).detect(IMAGE)
    assert plain == off == [script[0][1], script[0][0]]


def per_call_s(call, repeat: int) -> float:
    """1 回あたりの秒。repeat 回の平均を 5 組とり、いちばん速い組（同時に走る処理の揺れを避ける）。

    計測の間だけカバレッジのトレースを外す（行ごとのトレースで数倍遅くなり、本番の速さを測れない）。
    """
    saved = sys.gettrace()
    sys.settrace(None)
    try:
        call()  # 暖める
        batches = []
        for _ in range(5):
            started = time.perf_counter()
            for _ in range(repeat):
                call()
            batches.append((time.perf_counter() - started) / repeat)
    finally:
        sys.settrace(saved)
    return min(batches)


# FPF-4a
def test_fpf4a_300枠と8領域で1回1ms未満():
    regions = tuple((0.0, 0.95 + 0.0, 0.1 + 0.1 * i, 1.0) for i in range(8))
    f = BoxFilter(L0FilterConfig(ignore_regions=regions))
    dets = [box(0.01 + 0.003 * i, 0.02 + 0.003 * i, x=(i % 10) / 10 + 0.05) for i in range(300)]
    assert per_call_s(lambda: f(dets), 100) < 0.001  # 手元で 0.23 ms


def test_fpf4a_続きの元が満杯で大きい枠が300でも2ms未満():
    # 最悪: 直前 12 フレームに面積の近い 16 枠ずつ（重ならない）、今のフレームは大きい枠が 300
    clock = Clock()
    f = BoxFilter(L0FilterConfig(), clock)
    for _ in range(12):
        # 面積 0.25（大きい枠の 0.3 倍以上なので IoU を計算する）。IoU は 0.2 前後で続きにならない
        f([box(0.5, 0.5, x=0.01 * i + 0.25, y=0.25, conf=0.5) for i in range(16)])
        clock.advance(0.05)
    large = [box(0.9, 0.9, x=0.5, y=0.55 + 0.0001 * i, conf=0.9) for i in range(300)]
    # 除かれるので元は増えない（空のフレームは元を押し出さない）
    assert per_call_s(lambda: f(large), 20) < 0.002  # 手元で 0.5 ms
    assert sum(len(b) for _, b in f._seeds) == 12 * 16  # 最後まで満杯のまま測った


def test_fpf1d_続きを調べるのは確信度の高い16枠まで():
    clock = Clock()
    f = BoxFilter(L0FilterConfig(), clock)
    f([box(0.6, 0.8, x=0.5, y=0.6)])
    clock.advance(0.1)
    larges = [box(0.9, 0.95, conf=0.5 + 0.01 * i) for i in range(17)]
    out = f(larges)
    assert len(out) == 16 and min(d.conf for d in out) == pytest.approx(0.51)  # 0.50 だけ除かれる


# ---- UC-4: 設定 ----


# FPC-1a
def test_fpc1a_空なら既定値で見本の設定ファイルも既定値と一致する(tmp_path):
    f = load_config(write(tmp_path, "")).l0_filter
    assert f == L0FilterConfig()
    assert f.enabled is True
    assert (f.max_area, f.max_width, f.min_height_at_max_width) == (0.7, 0.85, 0.5)
    assert f.ignore_regions == ()
    assert (f.region_min_inside, f.region_conf_scale) == (0.8, 0.5)
    assert load_config(EXAMPLE) == Config()


# FPC-1b
def test_fpc1b_指定した値と領域が読める(tmp_path):
    c = load_config(
        write(
            tmp_path,
            "[l0_filter]\nenabled = false\nmax_area = 0.8\nmax_width = 0.9\n"
            "min_height_at_max_width = 0.6\nregion_min_inside = 0.9\nregion_conf_scale = 0\n"
            "ignore_regions = [[0, 0.85, 1, 1], [0.92, 0.3, 1.0, 0.5]]\n",
        )
    )
    f = c.l0_filter
    assert f == L0FilterConfig(
        enabled=False,
        max_area=0.8,
        max_width=0.9,
        min_height_at_max_width=0.6,
        ignore_regions=((0.0, 0.85, 1.0, 1.0), (0.92, 0.3, 1.0, 0.5)),
        region_min_inside=0.9,
        region_conf_scale=0.0,
    )
    assert all(isinstance(v, float) for r in f.ignore_regions for v in r)
    assert isinstance(f.region_conf_scale, float)


# FPC-1c
@pytest.mark.parametrize(
    "text",
    [
        "max_area = 0.64",
        "max_area = 1.01",
        "max_width = 0.69",
        "min_height_at_max_width = 0.39",
        "region_min_inside = 0.79",
        "region_conf_scale = 0.96",
        "region_conf_scale = -0.1",
        'max_area = "big"',
        "enabled = 1",
        "ignore_regions = [[0.5, 0.9, 0.4, 1.0]]",  # x1 ≥ x2
        "ignore_regions = [[0.0, 0.9, 1.0, 0.9]]",  # y1 ≥ y2
        "ignore_regions = [[-0.1, 0.9, 0.2, 1.0]]",  # 0〜1 の外
        "ignore_regions = [[0.8, 0.9, 1.2, 1.0]]",
        "ignore_regions = [[0.05, 0.85, 0.2, 0.95]]",  # 辺に接しない
        "ignore_regions = [[0.3, 0.55, 0.7, 1.0]]",  # 見張りの帯と交わる（正面の車線）
        "ignore_regions = [[0.0, 0.4, 0.3, 0.6]]",  # 端に接していても帯に食い込む
        "ignore_regions = [[0.0, 0.0, 1.0, 0.3]]",  # 面積 0.3 > 0.25
        "ignore_regions = [[0.0, 0.8, 1.0, 1.0], [0.0, 0.0, 1.0, 0.25]]",  # 和 0.45 > 0.4
        "ignore_regions = [[0.0, 0.9, 1.0]]",  # 形が違う
        'ignore_regions = [[0.0, 0.9, 1.0, "x"]]',
        "ignore_regions = [[0.0, 0.9, 1.0, true]]",
        "ignore_regions = [0.0, 0.9, 1.0, 1.0]",
        'ignore_regions = "bottom"',
        "ignore_regions = [" + ", ".join(["[0.0, 0.95, 0.1, 1.0]"] * 9) + "]",  # 9 個
        "speed = 1",
    ],
)
def test_fpc1c_不正はキー名つきのConfigError(tmp_path, text):
    key = text.split(" =")[0]
    with pytest.raises(ConfigError, match=rf"l0_filter\.{key}"):
        load_config(write(tmp_path, f"[l0_filter]\n{text}\n"))


def test_fpc1c_境界の値は読める(tmp_path):
    c = load_config(
        write(
            tmp_path,
            "[l0_filter]\nmax_area = 0.65\nmax_width = 0.7\nmin_height_at_max_width = 0.4\n"
            "region_min_inside = 0.8\nregion_conf_scale = 0.95\n"
            "ignore_regions = [" + ", ".join(["[0.0, 0.95, 0.1, 1.0]"] * 8) + ", ]\n",
        )
    )
    assert len(c.l0_filter.ignore_regions) == 8


def test_fpc1c_見張りの帯に接するだけの領域と和04ちょうどは書ける(tmp_path):
    # 帯 (0.25, 0.3)〜(0.75, 0.8) の下の辺に接するボンネット（面積 0.2）と、右端の帯（0.2）
    text = "[l0_filter]\nignore_regions = [[0.0, 0.8, 1.0, 1.0], [0.75, 0.0, 1.0, 0.8]]\n"
    c = load_config(write(tmp_path, text))
    assert c.l0_filter.ignore_regions == ((0.0, 0.8, 1.0, 1.0), (0.75, 0.0, 1.0, 0.8))
