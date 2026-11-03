"""edge-l1-calibration: sim のトレース → 正解付き JudgeRequest（export_l1_labels.py）。

書き出しは tmp_path だけ。合成トレースは numpy の default_rng（シード付き）。
"""

import json
import math
import re
from collections import Counter

import numpy as np
import pytest

import export_l1_labels as ex
from detector.l1.calibrate import Labels, Sample, sample_to_row
from detector.l1.calibrate import main as calibrate_main
from detector.l1.calibration import load_calibration
from detector.l1.client import L1Answer
from detector.l1.request import VehicleContext
from detector.schema import JUDGE_QUESTIONS, JudgeRequest
from export_l1_labels import (
    Tick,
    Trace,
    TraceError,
    _Motion,
    build_example,
    confidences,
    export,
    label_at,
    load_traces,
    main,
    query_times,
    synthetic_traces,
    trace_to_json,
    track_at,
    visible,
)

MODEL = "llm-qwen2.5-1.5b"
NOUL = ("on_roadway", "static_shoulder", "false_positive")
CAR_D = -1.75


def make_trace(
    obj_d,
    *,
    kind="deer",
    pattern="crossing",
    speed_kmh=60.0,
    gap0=110.0,
    n=60,
    light="night",
    zone="inside",
    occluded=lambda i: False,
    conf=None,
    tid="t",
):
    """車は一定の速さ。obj_d(t_ms) で物の横の位置を決める。"""
    v = speed_kmh / 3.6
    ticks = []
    for i in range(n):
        t = i * 100.0
        ticks.append(
            Tick(
                t=t,
                car_s=v * t / 1000.0,
                car_d=CAR_D,
                car_speed=v,
                obj_s=gap0,
                obj_d=obj_d(t),
                occluded=occluded(i),
                pose=None,
                conf=None if conf is None else conf(i),
            )
        )
    return Trace(
        tid, "sim", 1, light, "clear", zone, kind, pattern if kind == "deer" else None, tuple(ticks)
    )


def at(trace, t_ms):
    return next(i for i, k in enumerate(trace.ticks) if k.t == t_ms)


HIGH = lambda i: 0.9  # noqa: E731


# ---- 受け入れ ----


@pytest.fixture(scope="module")
def synthetic_rows():
    rows, summary = export(synthetic_traces(7), seed=7, examples=240)
    return rows, summary


# AC-1
def test_ac1_合成240件は_JudgeRequest_に通り_固定の車の状態で_赤の候補の場面_各問の両クラスがそろう(
    synthetic_rows,
):
    rows, summary = synthetic_rows
    assert len(rows) == 240
    assert summary["traces"] == 240
    fixed = VehicleContext()
    for r in rows:
        req = JudgeRequest.model_validate(r.request)
        state = r.request["state"]
        assert (state["speedKmh"], state["zone"], state["light"], state["headlight"]) == (
            fixed.speed_kmh,
            fixed.zone,
            fixed.light,
            fixed.headlight,
        )
        assert [q["id"] for q in r.request["questions"]] == [q["id"] for q in JUDGE_QUESTIONS]
        track = state["track"]
        assert track[-1]["conf"] >= 0.8
        assert track[0]["t"] >= -1.0
        assert req.model == "jev-latest"
        assert set(r.labels) == {"alert_level", *NOUL}
    for q in NOUL:
        counts = Counter(r.labels[q] for r in rows)
        assert counts[True] >= 10 and counts[False] >= 10, q
    levels = Counter(r.labels["alert_level"] for r in rows)
    assert levels["zone"] >= 10 and levels["danger"] >= 10
    assert "none" not in levels  # 固定の zone=inside では none の正解は出ない（R5）
    for q in ("alert_level", *NOUL):
        assert 100 <= summary["perQuestion"][q]["n"] <= 300


def fake_l1(rows, seed=3, k=2.0, noise=0.8):
    """ラベルから作る偽の L1 の過信した答え（ときどき外す。危険な鹿には強く外さない）。"""
    rng = np.random.default_rng(seed)
    out = []
    for r in rows:
        labels = Labels(**r.labels)
        danger = labels.alert_level == "danger"
        noul = {}
        for q in NOUL:
            s = (1.2 if labels.noul(q) else -1.2) + float(
                np.clip(rng.normal(0, noise), -2 * noise, 2 * noise)
            )
            if danger and q == "false_positive":
                s = min(s, -0.8)
            noul[q] = float(1.0 / (1.0 + math.exp(-k * s)))
        logits = np.array([-1.5, 0.0, 0.0])
        logits[("none", "zone", "danger").index(labels.alert_level)] = 1.2
        logits = logits + np.clip(rng.normal(0, noise, size=3), -2 * noise, 2 * noise)
        if danger:
            logits[:2] = np.minimum(logits[:2], logits[2] - 0.8)
        e = np.exp(k * (logits - logits.max()))
        p = e / e.sum()
        answer = L1Answer(
            MODEL, dict(zip(("none", "zone", "danger"), map(float, p), strict=True)), **noul
        )
        out.append(
            Sample(
                r.id,
                answer,
                labels,
                str(r.meta["traceId"]),
                str(r.meta["source"]),
                r.meta["pattern"],
            )
        )
    return out


# AC-3
def test_ac3_ラベル_偽の_L1_学習_書き出し_edge_l1_が読める(synthetic_rows, tmp_path, capsys):
    rows, _ = synthetic_rows
    answers = tmp_path / "answers.jsonl"
    answers.write_text(
        "".join(json.dumps(sample_to_row(s)) + "\n" for s in fake_l1(rows)), encoding="utf-8"
    )
    out = tmp_path / "calibration.json"
    assert calibrate_main(["fit", str(answers), "--out", str(out), "--allow-synthetic"]) == 0
    summary = json.loads(capsys.readouterr().out)
    cal = load_calibration(out)
    assert cal is not None
    assert cal.matches(MODEL)
    assert cal.temperatures == summary["temperatures"]
    assert summary["validation"]["after"]["override"]["dangerDowngraded"] == 0
    # 合成のまま --allow-synthetic なしでは書かない
    assert calibrate_main(["fit", str(answers), "--out", str(tmp_path / "x.json")]) == 1
    capsys.readouterr()


# ---- UC-1 トレース ----


# TR-1a
def test_tr1a_正しいトレースが読め_往復する():
    deer = make_trace(lambda t: 5.0, conf=lambda i: 0.85, tid="a")
    sign = make_trace(lambda t: -4.0, kind="sign", tid="b")
    lines = [json.dumps(trace_to_json(tr)) for tr in (deer, sign)]
    loaded = load_traces(["", *lines, "  "])
    assert loaded == [deer, sign]
    assert loaded[0].ticks[0].conf == 0.85
    assert loaded[1].ticks[0].conf is None


def _good() -> dict:
    return trace_to_json(make_trace(lambda t: 5.0, n=3))


# TR-1b / AUTH-1
@pytest.mark.parametrize(
    ("mutate", "field"),
    [
        (lambda r: r.update(format="other"), "format/version"),
        (lambda r: r.update(version=2), "format/version"),
        (lambda r: r["object"].update(kind="moose"), "object.kind"),
        (lambda r: r["object"].update(pattern="leap"), "object.pattern"),
        (lambda r: r["object"].update(kind="sign"), "object.pattern"),
        (lambda r: r.update(light="noon"), "light"),
        (lambda r: r.update(zone="near"), "zone"),
        (lambda r: r.update(source="camera"), "source"),
        (lambda r: r["ticks"][1].update(pose="fly"), "ticks[1].pose"),
        (lambda r: r["ticks"][1].update(t=0.0), "ticks[1].t"),
        (lambda r: r["ticks"][0].pop("objD"), "ticks[0].objD"),
        (lambda r: r["ticks"][0].update(carS="1"), "ticks[0].carS"),
        (lambda r: r["ticks"][0].update(occluded=0), "ticks[0].occluded"),
        (lambda r: r["ticks"][0].update(conf=1.5), "ticks[0].conf"),
        (lambda r: r.update(ticks=[]), "ticks"),
        (lambda r: r.update(seed="1"), "seed"),
        (lambda r: r.update(id=""), "id"),
    ],
)
def test_tr1b_auth1_形が違えば行番号つきで全体を拒否(mutate, field):
    bad = _good()
    bad["id"] = "bad"
    mutate(bad)
    with pytest.raises(TraceError, match="^" + re.escape(f"2 行目: {field}:")):
        load_traces([json.dumps(_good()), json.dumps(bad)])


def test_tr1b_NaN_重複_JSON_でない():
    good = json.dumps(_good())
    nan = _good()
    nan["id"] = "n"
    nan["ticks"][0]["objD"] = "__NAN__"
    with pytest.raises(TraceError, match="2 行目: 行: JSON ではない"):
        load_traces([good, json.dumps(nan).replace('"__NAN__"', "NaN")])
    with pytest.raises(TraceError, match="2 行目: id: 重複"):
        load_traces([good, good])
    with pytest.raises(TraceError, match="1 行目: 行"):
        load_traces(["[1]"])


# ---- UC-2 合成トレース ----


def _first(seed, n):
    it = synthetic_traces(seed)
    return [next(it) for _ in range(n)]


# GEN-1a
def test_gen1a_同じシードで同じトレース_違うシードで違う():
    a = [trace_to_json(t) for t in _first(5, 30)]
    b = [trace_to_json(t) for t in _first(5, 30)]
    c = [trace_to_json(t) for t in _first(6, 30)]
    assert a == b
    assert a != c
    it = synthetic_traces(5, start=10)  # i 番目は (seed, i) だけで決まる
    assert trace_to_json(next(it)) == a[10]


# GEN-1b
def test_gen1b_鹿でない物とパターンの割合_eyeshine_は遮蔽():
    traces = _first(11, 2000)
    kinds = Counter(t.kind for t in traces)
    assert 0.22 < (2000 - kinds["deer"]) / 2000 < 0.28
    deer = [t for t in traces if t.kind == "deer"]
    patterns = Counter(t.pattern for t in deer)
    for p, w in ex.PATTERN_WEIGHTS.items():
        assert abs(patterns[p] / len(deer) - w) < 0.04, p
    assert all(k.occluded for t in deer if t.pattern == "eyeshine" for k in t.ticks)
    assert all(t.zone == "inside" and t.source == "synthetic" for t in traces)


# GEN-1c
def test_gen1c_横断は手前で静止し反対側へ渡る_群れは遅れる_立ちすくみは車線の中央で止まる():
    crossing = next(t for t in _first(11, 300) if t.pattern == "crossing")
    far = [k.obj_d for k in crossing.ticks if k.gap > 100.0]
    assert len(set(far)) == 1  # 動き出す距離（80〜100 m）の手前では動かない
    assert crossing.ticks[-1].obj_d * crossing.ticks[0].obj_d < 0  # 反対側へ

    lead = _Motion("herd", 5.0, -1.0, 90.0, 3.0, 0.0)
    late = _Motion("herd", 7.1, -1.0, 90.0, 3.0, 1000.0)
    starts = {}
    for i in range(40):
        t = i * 100.0
        for name, m in (("lead", lead), ("late", late)):
            before = m.d
            m.step(t, 80.0, 0.1)
            if m.d != before and name not in starts:
                starts[name] = t
    assert starts["late"] - starts["lead"] == pytest.approx(1000.0, abs=100.0)

    frozen = _Motion("frozen", 5.0, -1.0, 90.0, 3.0, 0.0)
    for i in range(80):
        frozen.step(i * 100.0, 50.0, 0.1)
    assert frozen.d == CAR_D
    assert frozen.pose == "look"


# ---- UC-3 問い合わせの場面 ----


def tick(**kw):
    base = {
        "t": 0.0,
        "car_s": 0.0,
        "car_d": CAR_D,
        "car_speed": 10.0,
        "obj_s": 50.0,
        "obj_d": -1.75,
        "occluded": False,
    }
    base.update(kw)
    return Tick(**base)


# TRK-1a
def test_trk1a_見える条件():
    assert visible(tick())
    assert not visible(tick(occluded=True))
    assert not visible(tick(obj_s=1.0))  # カメラ（前 1.2 m）の後ろ
    assert not visible(tick(obj_s=125.0))  # 120 m 超
    assert not visible(tick(obj_s=10.0, obj_d=-1.75 + 10.0))  # 画角 35° 超
    assert visible(tick(obj_s=30.0, obj_d=-1.75 + 10.0))


# TRK-1b
def test_trk1b_点は窓1秒で_t_は0以下の昇順_pos_と_side():
    trace = make_trace(lambda t: CAR_D - 1.75 if t < 3000 else CAR_D - 1.76, conf=lambda i: 0.9)
    conf = confidences(trace, 1)
    q = at(trace, 3000.0)
    points, _ = track_at(trace, conf, q)
    ts = [p["t"] for p in points]
    assert ts == sorted(ts) and ts[-1] == 0.0 and ts[0] == -1.0
    assert len(points) == 11
    assert points[0]["pos"] == "lane"  # |lateral| = 1.75 は lane
    assert points[-1]["pos"] == "shoulder"  # 1.76 は shoulder
    assert {p["side"] for p in points} == {"L"}
    right = make_trace(lambda t: 3.0, conf=lambda i: 0.9)
    assert track_at(right, confidences(right, 1), 20)[0][-1]["side"] == "R"


# TRK-1c
def test_trk1c_lateralMps_は近づく向きが正_TTC_は_edge_l0_の式():
    left = make_trace(lambda t: -6.0 + t / 1000.0, conf=lambda i: 0.9)  # 左から右へ 1 m/s
    right = make_trace(lambda t: 4.0 - t / 1000.0, conf=lambda i: 0.9)  # 右から左へ 1 m/s
    for trace in (left, right):
        points, ttc = track_at(trace, confidences(trace, 1), 20)
        assert points[-1]["lateralMps"] == pytest.approx(1.0, abs=1e-3)
        assert points[0]["lateralMps"] == 0.0
        first, last = trace.ticks[10], trace.ticks[20]
        closing = (first.distance - last.distance) / 1.0
        assert ttc == pytest.approx(last.distance / closing, abs=1e-3)
    parked = make_trace(lambda t: 3.0, speed_kmh=0.0, gap0=40.0, conf=lambda i: 0.9)
    assert track_at(parked, confidences(parked, 1), 20)[1] is None  # 近づかない
    short = make_trace(
        lambda t: 3.0, conf=lambda i: 0.9 if i >= 19 else 0.1, occluded=lambda i: i < 19
    )
    points, ttc = track_at(short, confidences(short, 1), 20)
    assert len(points) == 2 and ttc is None  # 0.1 秒しか無い


# TRK-1d
def test_trk1d_問い合わせは_JudgeRequest_に通り_既定は固定値_actual_は実値():
    trace = make_trace(
        lambda t: 3.0, conf=lambda i: 0.9, light="day", zone="outside", speed_kmh=45.0
    )
    conf = confidences(trace, 1)
    fixed = build_example(trace, conf, 20, recent_alerts=1, model="jev-latest", context="fixed")
    JudgeRequest.model_validate(fixed.request)
    assert fixed.request["state"]["speedKmh"] == 60.0
    actual = build_example(trace, conf, 20, recent_alerts=2, model="jev-latest", context="actual")
    state = actual.request["state"]
    assert (state["speedKmh"], state["light"], state["zone"], state["headlight"]) == (
        45.0,
        "day",
        "outside",
        "off",
    )
    assert state["recentAlerts30s"] == 2
    night = make_trace(lambda t: 3.0, conf=lambda i: 0.9, light="dusk")
    assert (
        build_example(night, conf, 20, recent_alerts=1, model="m", context="actual").request[
            "state"
        ]["headlight"]
        == "low"
    )
    with pytest.raises(TraceError, match="JudgeRequest に通らない"):
        build_example(trace, conf, 20, recent_alerts=1, model="BAD MODEL!", context="fixed")


# TRK-1e
def test_trk1e_確信度はトレースの値か仮の式():
    given = make_trace(lambda t: 3.0, conf=lambda i: 0.61)
    assert set(confidences(given, 1)) == {0.61}
    trace = make_trace(lambda t: 3.0)
    a = confidences(trace, 1)
    assert a == confidences(trace, 1)
    assert a != confidences(trace, 2)
    assert all(0.40 <= c <= 0.99 for c in a)
    decoy = make_trace(lambda t: 3.0, kind="sign", light="day")
    assert np.mean(confidences(decoy, 1)) < np.mean(
        confidences(make_trace(lambda t: 3.0, light="day"), 1)
    )


# TRK-1f
def test_trk1f_問い合わせの時刻は赤の始まりと0_4秒ごとの赤の候補():
    conf = [0.5] * 5 + [0.85] + [0.5] + [0.9] * 40 + [0.5] * 13
    trace = make_trace(lambda t: 3.0, conf=lambda i: conf[i])
    times = query_times(trace, confidences(trace, 1))
    assert times[0] == 8  # 7・8 で 2 tick 続いた
    assert all((trace.ticks[i].t - trace.ticks[8].t) % 400 == 0 for i in times)
    assert times[-1] <= 46
    lone = make_trace(lambda t: 3.0, conf=lambda i: 0.9 if i % 2 else 0.5)
    assert query_times(lone, confidences(lone, 1)) == []


# TRK-1g
def test_trk1g_1秒以下の途切れは続き_1秒を超えると新しいトラック():
    short_gap = make_trace(lambda t: 3.0, conf=lambda i: 0.9, occluded=lambda i: 15 <= i < 20)
    points, _ = track_at(short_gap, confidences(short_gap, 1), 22)
    # 0.6 秒の途切れ（15〜19）では切れない。窓 1 秒: 12・13・14 と 20・21・22
    assert [p["t"] for p in points] == [-1.0, -0.9, -0.8, -0.2, -0.1, 0.0]
    long_gap = make_trace(lambda t: 3.0, conf=lambda i: 0.9, occluded=lambda i: 5 <= i < 17)
    points, _ = track_at(long_gap, confidences(long_gap, 1), 18)
    assert [p["t"] for p in points] == [-0.1, 0.0]  # 1.2 秒の途切れで新しいトラック


# ---- UC-4 正解ラベル ----


def labels(trace, t_ms, speed=60.0, zone="inside"):
    return label_at(trace, at(trace, t_ms), speed, zone)


# LBL-1a
def test_lbl1a_鹿でない物():
    sign = make_trace(lambda t: -5.0, kind="sign")
    assert labels(sign, 1000.0) == {
        "alert_level": "zone",
        "on_roadway": False,
        "static_shoulder": False,
        "false_positive": True,
    }
    assert labels(sign, 1000.0, zone="outside")["alert_level"] == "none"


# LBL-1b
def test_lbl1b_路肩で静止した鹿():
    deer = make_trace(lambda t: -5.0, pattern="roadside")
    assert labels(deer, 1000.0) == {
        "alert_level": "zone",
        "on_roadway": False,
        "static_shoulder": True,
        "false_positive": False,
    }


# LBL-1c
def test_lbl1c_車線へ渡ってくる鹿は100m以内で_danger_それより先は_zone():
    near = make_trace(lambda t: 5.0 - 3.0 * t / 1000.0, gap0=90.0)  # 右から 3 m/s
    lab = labels(near, 500.0)
    assert lab["on_roadway"] and lab["alert_level"] == "danger" and not lab["static_shoulder"]
    far = make_trace(lambda t: 5.0 - 3.0 * t / 1000.0, gap0=200.0, speed_kmh=30.0, n=120)
    lab = labels(far, 500.0)
    assert lab["on_roadway"] and lab["alert_level"] == "zone"


# LBL-1d
def test_lbl1d_車線で立ちすくむ鹿():
    deer = make_trace(lambda t: CAR_D, pattern="frozen", gap0=60.0)
    lab = labels(deer, 500.0)
    assert lab == {
        "alert_level": "danger",
        "on_roadway": True,
        "static_shoulder": False,
        "false_positive": False,
    }


# LBL-1e
def test_lbl1e_渡りきって離れていく鹿():
    deer = make_trace(lambda t: 0.5 + 3.0 * t / 1000.0, gap0=60.0)  # 車線の外を右へ離れる
    lab = labels(deer, 500.0)
    assert not lab["on_roadway"] and not lab["static_shoulder"]
    assert lab["alert_level"] == "zone"


# LBL-1f
def test_lbl1f_動き出す前の横断の鹿は先読みで_danger():
    deer = make_trace(lambda t: 5.0 if t < 2000 else 5.0 - 3.5 * (t - 2000) / 1000.0, gap0=95.0)
    lab = labels(deer, 1000.0)  # まだ静止
    assert lab["on_roadway"] and lab["alert_level"] == "danger" and not lab["static_shoulder"]


# LBL-1g
def test_lbl1g_待っている群れの2頭目と出始めの立ちすくみも先読みで_on_roadway():
    second = make_trace(
        lambda t: 7.1 if t < 3500 else 7.1 - 3.0 * (t - 3500) / 1000.0,
        pattern="herd",
        gap0=100.0,
        n=80,
    )
    assert labels(second, 1000.0)["on_roadway"]
    slow = make_trace(
        lambda t: -5.0 + 0.4 * t / 1000.0, pattern="frozen", gap0=100.0, n=80
    )  # 0.4 m/s
    lab = labels(slow, 500.0)
    assert lab["on_roadway"] and not lab["static_shoulder"]


# LBL-1h
def test_lbl1h_danger_の時間は問い合わせの速さで割る():
    deer = make_trace(lambda t: CAR_D, gap0=95.0, speed_kmh=30.0)  # トレースの車は 30 km/h
    assert labels(deer, 0.0, speed=60.0)["alert_level"] == "danger"  # 90 m ÷ 60 km/h ≤ 6 秒
    assert labels(deer, 0.0, speed=30.0)["alert_level"] == "zone"  # 実値なら 11 秒


# ---- UC-5 出力 ----


def run(args, capsys):
    code = main(args)
    out = capsys.readouterr()
    return code, out.out, out.err


# OUT-1a / CLI-1b
def test_out1a_cli1b_行の形と要約(tmp_path, capsys):
    out = tmp_path / "labels.jsonl"
    code, stdout, _ = run(["--synthetic", "--seed", "7", "--out", str(out)], capsys)
    assert code == 0
    summary = json.loads(stdout)
    assert summary["rows"] == 240 and summary["traces"] == 240
    assert set(summary["perQuestion"]["false_positive"]["classes"]) == {"true", "false"}
    assert summary["skippedTraces"] > 0
    rows = [json.loads(line) for line in out.read_text(encoding="utf-8").splitlines()]
    assert len(rows) == 240
    assert set(rows[0]) == {"id", "request", "labels", "meta"}
    assert set(rows[0]["meta"]) == {
        "traceId",
        "source",
        "kind",
        "pattern",
        "light",
        "zone",
        "speedKmh",
        "context",
    }
    assert [p.name for p in tmp_path.iterdir()] == ["labels.jsonl"]  # 一時ファイルを残さない
    again = tmp_path / "again.jsonl"
    assert run(["--synthetic", "--seed", "7", "--out", str(again)], capsys)[0] == 0
    assert again.read_bytes() == out.read_bytes()  # 決定性


# OUT-1b / AUTH-1
def test_out1b_auth1_足りなければ書かない_トレースの誤りは2(tmp_path, capsys):
    out = tmp_path / "labels.jsonl"
    code, _, err = run(["--synthetic", "--out", str(out), "--min-per-question", "300"], capsys)
    assert code == 1 and "書かない" in err and not out.exists()
    code, stdout, _ = run(["--synthetic", "--out", str(out), "--per-trace", "3"], capsys)
    assert code == 1 and json.loads(stdout)["rows"] == 240 and not out.exists()  # 水増ししない
    bad = tmp_path / "bad.jsonl"
    bad.write_text('{"format": "x"}\n', encoding="utf-8")
    code, _, err = run(["--traces", str(bad), "--out", str(out)], capsys)
    assert code == 2 and "1 行目" in err and not out.exists()
    code, _, _ = run(["--traces", str(tmp_path / "missing.jsonl"), "--out", str(out)], capsys)
    assert code == 2
    assert run(["--synthetic", "--out", str(tmp_path / "no" / "x.jsonl")], capsys)[0] == 2
    assert run(["--synthetic", "--out", str(out), "--per-trace", "0"], capsys)[0] == 2


# OUT-1c
def test_out1c_読んだトレースからも同じ行になる(tmp_path, capsys):
    labels_a = tmp_path / "a.jsonl"
    traces = tmp_path / "traces.jsonl"
    args = ["--synthetic", "--seed", "3", "--out", str(labels_a), "--write-traces", str(traces)]
    assert run(args, capsys)[0] == 0
    labels_b = tmp_path / "b.jsonl"
    assert run(["--traces", str(traces), "--seed", "3", "--out", str(labels_b)], capsys)[0] == 0
    assert labels_b.read_bytes() == labels_a.read_bytes()
