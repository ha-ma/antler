"""edge-l1-calibration: 温度の学習・書き出し・評価（l1/calibrate.py、R7〜R10）。

答えはすべて合成（tests/l1_synth.py）。書き出しは tmp_path だけ。
"""

import json
import math
from dataclasses import replace

import numpy as np
import pytest

from detector.l1.calibrate import (
    MIN_SAFE_T,
    CalibrationDataError,
    CalibrationRefused,
    CalibrationWriteError,
    Labels,
    calibrate,
    ece,
    evaluate,
    fit_temperature,
    fit_temperatures,
    is_validation,
    load_samples,
    main,
    nll,
    override_metrics,
    parse_samples,
    sample_to_row,
    wilson_lower,
    write_calibration,
)
from detector.l1.calibration import MAX_T, MIN_T, Calibration, load_calibration
from detector.l1.client import L1Answer

from .conftest import named
from .l1_fakes import MODEL
from .l1_synth import NOUL, overconfident, scenario

IDS = ("alert_level", "on_roadway", "static_shoulder", "false_positive")


def jsonl(path, samples, extra=None):
    rows = []
    for s in samples:
        row = sample_to_row(s)
        if extra:
            row.update(extra)
        rows.append(json.dumps(row))
    path.write_text("\n".join(rows) + "\n", encoding="utf-8")
    return path


def row(**over) -> dict:
    base = sample_to_row(scenario(1, 1)[0])
    base.update(over)
    return base


def manual_nll(qid, answers, samples):
    total = 0.0
    for a, s in zip(answers, samples, strict=True):
        if qid == "alert_level":
            total -= math.log(a.alert_level[s.labels.alert_level])
        else:
            q = getattr(a, qid)
            total -= math.log(q if s.labels.noul(qid) else 1.0 - q)
    return total / len(samples)


# ---- 受け入れ ----


# AC-2
def test_ac2_過信した答えから温度を取り戻し_書いたファイルを読み込み側が同じ値で読む(tmp_path):
    samples = overconfident(2000, 2.5, seed=11)
    temps = fit_temperatures(samples)
    for q in IDS:
        assert temps[q] == pytest.approx(2.5, abs=0.3), q
    cal = Calibration(MODEL, temps)
    out = tmp_path / "calibration.json"
    write_calibration(out, cal)
    assert load_calibration(out) == cal
    before = evaluate(samples, None, 0.9)["questions"]
    after = evaluate(samples, cal, 0.9)["questions"]
    for q in IDS:
        assert after[q]["ece"] < before[q]["ece"], q
        assert after[q]["nll"] < before[q]["nll"], q


# ---- UC-6 学習 ----


# FIT-1a
@pytest.mark.parametrize("k", [2.5, 0.5])
def test_fit1a_過信と過小の両方で_T_は_k_に戻り_NLL_が下がる(k):
    samples = overconfident(2000, k, seed=12)
    for q in IDS:
        t = fit_temperature(q, samples)
        assert t == pytest.approx(k, rel=0.12), q
        assert nll(q, samples, t) < nll(q, samples, 1.0)


# FIT-1b
def test_fit1b_学習の式は_Calibration_apply_と同じ():
    samples = overconfident(500, 2.0, seed=3)
    cal = Calibration(MODEL, fit_temperatures(samples))
    answers = [cal.apply(s.answer) for s in samples]
    for q in IDS:
        assert nll(q, samples, cal.temperatures[q]) == pytest.approx(
            manual_nll(q, answers, samples), abs=1e-9
        )


# FIT-1c
def test_fit1c_件数不足と片クラスでは書かない():
    with pytest.raises(CalibrationRefused, match="学習用の別々のトレース"):
        calibrate(scenario(120, 1), allow_synthetic=True)
    with pytest.raises(CalibrationRefused, match="検証用の別々のトレース"):
        calibrate(scenario(160, 1), allow_synthetic=True, holdout=0.1)
    flat = [replace(s, labels=replace(s.labels, false_positive=False)) for s in scenario(400, 5)]
    with pytest.raises(CalibrationRefused, match="false_positive"):
        calibrate(flat, allow_synthetic=True)
    one = [replace(s, labels=replace(s.labels, alert_level="zone")) for s in scenario(400, 5)]
    with pytest.raises(CalibrationRefused, match="alert_level"):
        calibrate(one, allow_synthetic=True)


# FIT-1d / AUTH-7
def test_fit1d_auth7_分離できるデータは_T_が下限に寄るので書かない():
    samples = scenario(400, 5, noise=0.05)  # 雑音がほぼ無い → 正解で完全に分かれる
    with pytest.raises(CalibrationRefused, match=f"T が {MIN_SAFE_T} 未満"):
        calibrate(samples, allow_synthetic=True)


# FIT-1d
def test_fit1d_上限に張り付く温度は書いて_bound_を残す(logbuf):
    rng = np.random.default_rng(9)
    noisy = []
    for s in scenario(400, 5):
        p = rng.uniform(0.05, 0.95, size=3)
        levels = rng.dirichlet([1.0, 1.0, 1.0])
        answer = L1Answer(
            model=MODEL,
            alert_level=dict(zip(("none", "zone", "danger"), map(float, levels), strict=True)),
            **dict(zip(NOUL, map(float, p), strict=True)),
        )
        noisy.append(replace(s, answer=answer))
    result = calibrate(noisy, allow_synthetic=True)
    assert result.at_bound
    assert all(result.calibration.temperatures[q] >= MAX_T * 0.999 for q in result.at_bound)
    assert named(logbuf, "l1.calibrate.bound")


# FIT-1e / AUTH-4
@pytest.mark.parametrize(
    ("model", "match"),
    [("jev-latest", "別名"), ("", "空"), (" llm-qwen2.5-1.5b", "空白")],
)
def test_fit1e_モデル名が別名_空_空白なら書かない(model, match):
    samples = [replace(s, answer=replace(s.answer, model=model)) for s in scenario(400, 5)]
    with pytest.raises(CalibrationRefused, match=match):
        calibrate(samples, allow_synthetic=True)


def test_fit1e_モデル名の混在と_合成は_allow_synthetic_なしでは書かない():
    samples = scenario(400, 5)
    mixed = [*samples[:-1], replace(samples[-1], answer=replace(samples[-1].answer, model="x"))]
    with pytest.raises(CalibrationRefused, match="混在"):
        calibrate(mixed, allow_synthetic=True)
    with pytest.raises(CalibrationRefused, match="合成"):
        calibrate(samples)
    real = [replace(s, source="local-jev") for s in samples]
    assert calibrate(real).calibration.model == MODEL


# FIT-1f
@pytest.mark.parametrize(
    ("mutate", "field"),
    [
        (lambda r: r["probs"].pop("on_roadway"), "probs.on_roadway"),
        (lambda r: r["probs"].update(false_positive=1.5), "probs.false_positive"),
        (lambda r: r["probs"].update(static_shoulder=True), "probs.static_shoulder"),
        (lambda r: r["probs"]["alert_level"].pop("danger"), "probs.alert_level"),
        (lambda r: r["labels"].update(on_roadway="yes"), "labels.on_roadway"),
        (lambda r: r["labels"].update(alert_level="high"), "labels.alert_level"),
        (lambda r: r["meta"].pop("traceId"), "meta.traceId"),
        (lambda r: r["meta"].update(source=""), "meta.source"),
        (lambda r: r.update(model=3), "model"),
        (lambda r: r.pop("labels"), "labels"),
    ],
)
def test_fit1f_答えの行の誤りは行番号つきで全体を拒否(mutate, field):
    good = json.dumps(row())
    bad = row(id="bad")
    mutate(bad)
    with pytest.raises(CalibrationDataError, match=rf"^2 行目: {field}:"):
        parse_samples([good, json.dumps(bad)])


def test_fit1f_NaN_重複_JSON_でない行_空のファイル():
    good = json.dumps(row())
    nan_row = row(id="n")
    nan_row["probs"]["false_positive"] = "__NAN__"
    nan = json.dumps(nan_row).replace('"__NAN__"', "NaN")
    with pytest.raises(CalibrationDataError, match="2 行目: 行: JSON ではない"):
        parse_samples([good, nan])
    with pytest.raises(CalibrationDataError, match="2 行目: id: 重複"):
        parse_samples([good, good])
    with pytest.raises(CalibrationDataError, match="1 行目"):
        parse_samples(["{not json"])
    with pytest.raises(CalibrationDataError, match="1 件も無い"):
        parse_samples(["", "  "])


# FIT-1g
def test_fit1g_構造的に間違う_L1_は検証用で危険な鹿を降格するので書かない():
    with pytest.raises(CalibrationRefused, match=r"正解 danger を \d+ 件降格する.*crossing"):
        calibrate(scenario(400, 5, wrong_on_danger=0.2), allow_synthetic=True)


# FIT-1h
def test_fit1h_学習用と検証用はトレースの_id_で決まり_温度は学習用だけで決まる():
    ids = [f"t-{i}" for i in range(2000)]
    share = sum(is_validation(i, 0.3) for i in ids) / len(ids)
    assert 0.27 < share < 0.33
    assert [is_validation(i, 0.3) for i in ids] == [is_validation(i, 0.3) for i in ids]
    samples = scenario(400, 5)
    result = calibrate(samples, allow_synthetic=True)
    train = [s for s in samples if not is_validation(s.trace_id, 0.3)]
    assert result.calibration.temperatures == fit_temperatures(train)
    assert result.train_traces == len(train)
    assert result.validation_traces == len(samples) - len(train)
    # 検証用の答えを変えても温度は変わらない
    shuffled = [
        s if not is_validation(s.trace_id, 0.3) else replace(s, answer=samples[0].answer)
        for s in samples
    ]
    assert fit_temperatures(
        [s for s in shuffled if not is_validation(s.trace_id, 0.3)]
    ) == fit_temperatures(train)


# ---- UC-7 書き出し ----


# WR-1a
def test_wr1a_書いたファイルは3つのキーだけで読み込み側が同じ値で読む(tmp_path):
    result = calibrate(scenario(400, 5), allow_synthetic=True)
    out = tmp_path / "calibration.json"
    write_calibration(out, result.calibration)
    raw = json.loads(out.read_text(encoding="utf-8"))
    assert set(raw) == {"version", "model", "temperatures"}
    assert raw["version"] == 1
    assert set(raw["temperatures"]) == set(IDS)
    assert load_calibration(out) == result.calibration
    assert load_calibration(out).matches(MODEL)


# WR-1b / AUTH-8
def test_wr1b_auth8_検証に失敗したら前のファイルを残し一時ファイルも残さない(tmp_path):
    out = tmp_path / "calibration.json"
    out.write_text("previous", encoding="utf-8")
    bad = Calibration(MODEL, {**dict.fromkeys(IDS, 1.0), "false_positive": 0.01})
    with pytest.raises(CalibrationWriteError):
        write_calibration(out, bad)
    assert out.read_text(encoding="utf-8") == "previous"
    assert sorted(p.name for p in tmp_path.iterdir()) == ["calibration.json"]
    with pytest.raises(CalibrationWriteError):
        write_calibration(tmp_path / "missing" / "calibration.json", bad)


# AUTH-8
def test_auth8_学んだ温度は必ず読み込み側の範囲に収まる():
    for k in (0.01, 100.0):
        temps = fit_temperatures(overconfident(300, k, seed=4))
        assert all(MIN_T <= t <= MAX_T for t in temps.values())


# ---- UC-8 評価 ----


# EV-1a
def test_ev1a_ECE_は既知の値():
    assert ece([1.0] * 5, [True] * 5) == 0.0
    assert ece([0.9] * 10, [True] * 5 + [False] * 5) == pytest.approx(0.4)
    assert ece([], []) == 0.0


# EV-1b
def test_ev1b_降格の指標():
    zone = Labels("zone", on_roadway=False, static_shoulder=False, false_positive=True)
    danger = Labels("danger", on_roadway=True, static_shoulder=False, false_positive=False)
    base = scenario(1, 1)[0]

    def ans(fp=0.1, levels=(0.1, 0.2, 0.7)):
        return L1Answer(
            MODEL, dict(zip(("none", "zone", "danger"), levels, strict=True)), 0.5, 0.5, fp
        )

    rows = [
        (ans(fp=0.95), replace(base, labels=zone, pattern="sign")),
        (ans(levels=(0.02, 0.95, 0.03)), replace(base, labels=danger, pattern="crossing")),
        (ans(levels=(0.95, 0.03, 0.02)), replace(base, labels=zone, pattern="roadside")),
        (ans(), replace(base, labels=danger, pattern="frozen")),
    ]
    stats = override_metrics([a for a, _ in rows], [s for _, s in rows], 0.9)
    assert (stats.downgraded, stats.right, stats.danger_downgraded) == (3, 2, 1)
    assert stats.danger_by_pattern == {"crossing": 1}
    assert stats.none_over == 1
    data = stats.to_json()
    assert data["precision"] == pytest.approx(0.6667)
    assert data["precisionWilsonLow"] == wilson_lower(2, 3)
    assert wilson_lower(0, 0) is None
    assert 0.0 < wilson_lower(30, 30) < 1.0


# EV-1c
def test_ev1c_evaluate_は校正なしと_モデルが合うときだけ校正ありの指標を出す():
    samples = overconfident(300, 2.5, seed=5)
    cal = Calibration(MODEL, fit_temperatures(samples))
    raw = evaluate(samples, None, 0.9)
    cooked = evaluate(samples, cal, 0.9)
    assert raw["applied"] == 0
    assert cooked["applied"] == 300
    assert set(cooked["questions"]) == set(IDS)
    assert set(cooked["override"]) >= {"downgraded", "dangerDowngraded", "noneOver"}
    other = evaluate(samples, Calibration("other-model", cal.temperatures), 0.9)
    assert other["applied"] == 0
    assert other["questions"] == raw["questions"]


# ---- 実行の口 ----


# CLI-1a / AUTH-4
def test_cli1a_fit_と_evaluate_の_exit_と要約(tmp_path, capsys):
    answers = jsonl(tmp_path / "answers.jsonl", scenario(400, 5))
    out = tmp_path / "calibration.json"
    report = tmp_path / "report.json"
    assert (
        main(["fit", str(answers), "--out", str(out), "--allow-synthetic", "--report", str(report)])
        == 0
    )
    summary = json.loads(capsys.readouterr().out)
    assert summary["model"] == MODEL
    assert set(summary["temperatures"]) == set(IDS)
    assert summary["validation"]["after"]["override"]["dangerDowngraded"] == 0
    assert json.loads(report.read_text(encoding="utf-8")) == summary
    assert load_calibration(out) is not None

    # 合成を --allow-synthetic なしで → 1、書かない
    out2 = tmp_path / "c2.json"
    assert main(["fit", str(answers), "--out", str(out2)]) == 1
    assert "合成" in capsys.readouterr().err
    assert not out2.exists()

    # 入力の誤り → 2
    broken = tmp_path / "broken.jsonl"
    broken.write_text("{nope\n", encoding="utf-8")
    assert main(["fit", str(broken), "--out", str(out2)]) == 2
    assert "1 行目" in capsys.readouterr().err
    assert main(["fit", str(tmp_path / "none.jsonl"), "--out", str(out2)]) == 2

    # evaluate
    assert main(["evaluate", str(answers), "--calibration", str(out)]) == 0
    ev = json.loads(capsys.readouterr().out)
    assert ev["calibrated"]["applied"] == 400
    assert ev["raw"]["applied"] == 0
    assert main(["evaluate", str(answers), "--calibration", str(broken)]) == 2


# AUTH-2
def test_auth2_書かない条件に当たると前の_calibration_json_も変えない(tmp_path, capsys):
    answers = jsonl(tmp_path / "a.jsonl", scenario(400, 5, wrong_on_danger=0.2))
    out = tmp_path / "calibration.json"
    out.write_text("previous", encoding="utf-8")
    assert main(["fit", str(answers), "--out", str(out), "--allow-synthetic"]) == 1
    assert "danger" in capsys.readouterr().err
    assert out.read_text(encoding="utf-8") == "previous"


# AUTH-3
def test_auth3_evaluate_は_calibration_json_を読むだけ(tmp_path, capsys):
    answers = jsonl(tmp_path / "a.jsonl", scenario(400, 5))
    out = tmp_path / "calibration.json"
    write_calibration(out, Calibration(MODEL, dict.fromkeys(IDS, 1.5)))
    before = (out.read_bytes(), out.stat().st_mtime_ns)
    assert main(["evaluate", str(answers), "--calibration", str(out)]) == 0
    capsys.readouterr()
    assert (out.read_bytes(), out.stat().st_mtime_ns) == before


# AUTH-5 / AUTH-6
@pytest.mark.parametrize(
    "extra",
    [
        ["--model", "llm-qwen2.5-1.5b"],
        ["--min-t", "0.05"],
        ["--max-t", "50"],
        ["--override-conf", "0.8"],
        ["--min-samples", "10"],
        ["--holdout", "0.9"],
    ],
)
def test_auth5_auth6_モデル名と温度の範囲と閾値の下限は引数で変えられない(tmp_path, extra, capsys):
    answers = jsonl(tmp_path / "a.jsonl", scenario(400, 5))
    with pytest.raises(SystemExit) as exc:
        main(["fit", str(answers), "--out", str(tmp_path / "c.json"), "--allow-synthetic", *extra])
    assert exc.value.code == 2
    capsys.readouterr()
    assert not (tmp_path / "c.json").exists()


# AUTH-9
def test_auth9_答えの行の余分な項目で閾値_温度_モデル名は変わらない(tmp_path):
    samples = scenario(400, 5)
    plain = load_samples(jsonl(tmp_path / "p.jsonl", samples))
    extra = {
        "temperatures": dict.fromkeys(IDS, 0.05),
        "override_conf": 0.1,
        "model_override": "jev-latest",
        "version": 99,
    }
    noisy = load_samples(jsonl(tmp_path / "n.jsonl", samples, extra=extra))
    assert noisy == plain
    assert (
        calibrate(noisy, allow_synthetic=True).calibration
        == calibrate(plain, allow_synthetic=True).calibration
    )


def test_sample_to_row_と_parse_samples_は往復する():
    samples = scenario(20, 2)
    rows = [json.dumps(sample_to_row(s)) for s in samples]
    assert parse_samples(rows) == samples
    no_pattern = replace(samples[0], pattern=None)
    assert "pattern" not in sample_to_row(no_pattern)["meta"]
