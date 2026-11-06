"""compare_l0 の検査（docs/specs/dataset-train の CMP-1a〜1c・AC-2）。

学習器と検出器は偽物。実際の学習は報告（docs/reports/2026-11-07-dataset-train-sdata-run.md）。
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from test_train_l0 import read_any, sha
from test_train_l0_sdata import factory_by_name, ledger, mark, track, world

import compare_l0
import train_l0
from train_l0 import TrainError

COCO = b"coco"


@pytest.fixture(autouse=True)
def coco_base(monkeypatch):
    """summarize は元の重みの BY-SA を SHA-256 から引く。偽の元の重みを一覧に足す。"""
    monkeypatch.setattr(train_l0, "KNOWN_BASES", {sha(COCO): train_l0.Base("COCO", by_sa=False)})


class SeedTrainer:
    """FakeTrainer と同じだが、同じ run を何度も学習できる（Ultralytics の exist_ok=False）。"""

    def __init__(self, tag: bytes = b"") -> None:
        self.tag = tag

    def __call__(self, base: Path, args: dict) -> train_l0.TrainResult:
        weights = Path(args["project"]) / f"train-s{args['seed']}" / "weights"
        weights.mkdir(parents=True)
        (weights / "last.pt").write_bytes(b"last:" + str(args["seed"]).encode() + self.tag)
        return train_l0.TrainResult(last=weights / "last.pt", version="8.4.202")


def train_arm(
    root: Path,
    models: Path,
    arm: str,
    seed: int,
    *,
    prefix: str = "c1",
    by_sa: bool = False,
    epochs: int = 3,
    tag: bytes = b"",
) -> Path:
    base = models / "base.pt"
    if not base.exists():
        base.write_bytes(COCO)
    return train_l0.train(
        root / "out/train" / f"{prefix}-{arm}",
        models_dir=models,
        name=f"{prefix}-{arm}-s{seed}",
        seed=seed,
        base=base,
        epochs=epochs,
        trainer=SeedTrainer(tag),
        known_bases={sha(COCO): train_l0.Base("COCO", by_sa=by_sa)},
        allow_by_sa_base=by_sa,
        mps_available=lambda: False,
    )


def eval_arm(root: Path, pt: Path, arm: str, preds: dict, prefix: str = "c1") -> Path:
    return train_l0.evaluate(
        pt, root / "out/train" / f"{prefix}-{arm}", factory=factory_by_name(preds), reader=read_any
    )


PREDS = {
    "d3-deer_f000020": [(0.9, (0.5, 0.5, 0.2, 0.6))],  # test の走行の鹿（正解）
    "d2-day_f000000": [(0.5, (0.5, 0.5, 0.1, 0.1))],
    "d2-day_f000010": [(0.5, (0.5, 0.5, 0.1, 0.1))],
    "1000": [(0.5, (0.5, 0.5, 0.1, 0.1))],
}


def full(tmp_path: Path, seeds: tuple[int, ...] = (1, 2), preds: dict | None = None) -> dict:
    root, toml = world(tmp_path)
    compare_l0.build(toml, root, "c1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    for arm in compare_l0.ARMS:
        for seed in seeds:
            pt = train_arm(root, models, arm, seed)
            eval_arm(root, pt, arm, PREDS if preds is None else preds)
    return {"root": root, "toml": toml, "models": models}


def runs(root: Path) -> list[str]:
    base = root / "out/train"
    return sorted(p.name for p in base.iterdir()) if base.exists() else []


# AC-2
def test_ac2_比較が1周回る(tmp_path):
    w = full(tmp_path)
    target, text = compare_l0.summarize(w["root"], "c1", w["models"])
    s = json.loads(target.read_text())
    assert target == w["root"] / "out/compare/c1.json" and target.with_suffix(".md").exists()
    real = json.loads((w["root"] / "out/train/c1-real/manifest.json").read_text())
    mix = json.loads((w["root"] / "out/train/c1-mix/manifest.json").read_text())
    kinds = {n: v["kind"] for n, v in mix["sources"].items()}
    # synth は mix の train だけ。real には無い
    assert all(f["split"] == "train" for f in mix["files"] if kinds[f["source"]] == "synth")
    assert not any(kinds.get(f["source"]) == "synth" for f in real["files"])
    assert "syn" in real["excluded_sources"]
    # test の走行（D3）のフレームは学習側に無い
    assert all(f["split"] == "eval" for f in mix["files"] if f.get("group") == "self:D3")
    assert s["arms"]["mix"]["train_images"] == s["arms"]["real"]["train_images"] + 2
    assert s["provisional"] is False and s["self_test_deer_images"] == 1
    assert "暫定" not in text
    m = s["results"]["real"]["1"]
    assert m["eval/raw/0.25/deer_tp"] == 1  # 実写の鹿（self と yolo の合計）
    assert m["eval/raw/0.25/own/tp"] == 1
    assert m["eval/raw/0.25/neg_images_with_detection"] == 1 and m["eval/raw/0.25/neg_images"] == 2
    assert m["val/raw/0.25/runs_per_min"] == pytest.approx(20.0)  # d2-day の 0・10 が続く
    assert "eval/raw/0.25/syn/tp" not in m
    assert s["conditions"]["seeds"] == [1, 2] and s["conditions"]["epochs"] == 3
    assert s["step_ratio_mix_to_real"] >= 1
    assert "| real | 1 | 0.25 | own | 1/0/0 |" in text
    # 同じ予測 → 範囲が重なる → separated にならない
    assert not any(v["separated"] for v in s["separated"].values())
    assert "seed のばらつきの中" in text


# CMP-1a
def test_cmp1a_realとmixのval_eval_synth以外のtrainが同じ(tmp_path):
    root, toml = world(tmp_path)
    real, mix = compare_l0.build(toml, root, "c1", seed=7)
    compare_l0.check_same(real, mix)
    assert runs(root) == ["c1-mix", "c1-real"]


def test_cmp1a_違えば2つのrunを消す(tmp_path, monkeypatch):
    root, toml = world(tmp_path)
    original = train_l0.build

    def skewed(*args: object, **kw: object) -> Path:
        run_dir = original(*args, **kw)
        if run_dir.name.endswith("-mix"):
            m = json.loads((run_dir / "manifest.json").read_text())
            m["files"] = [f for f in m["files"] if f["split"] != "val"]
            (run_dir / "manifest.json").write_text(json.dumps(m))
        return run_dir

    monkeypatch.setattr(train_l0, "build", skewed)
    with pytest.raises(TrainError, match="val が違う"):
        compare_l0.build(toml, root, "c1", seed=7)
    assert runs(root) == []


def test_cmp1a_synthがtrainの外(tmp_path):
    root, toml = world(tmp_path)
    real, mix = compare_l0.build(toml, root, "c1", seed=7)
    m = json.loads((mix / "manifest.json").read_text())
    for f in m["files"]:
        if f["source"] == "syn":
            f["split"] = "eval"
    (mix / "manifest.json").write_text(json.dumps(m))
    with pytest.raises(TrainError, match="synth が train の外"):
        compare_l0.check_same(real, mix)


@pytest.mark.parametrize(("prefix", "msg"), [("C1", "prefix"), ("", "prefix")])
def test_cmp1a_prefixの誤り(tmp_path, prefix, msg):
    root, toml = world(tmp_path)
    with pytest.raises(TrainError, match=msg):
        compare_l0.build(toml, root, prefix, seed=7)


def test_cmp1a_synthが無ければ比べられない(tmp_path):
    root, toml = world(tmp_path, synth=False)
    with pytest.raises(TrainError, match="synth の素材が無い"):
        compare_l0.build(toml, root, "c1", seed=7)
    assert runs(root) == []


def test_cmp1a_buildの出力が無い(tmp_path):
    with pytest.raises(TrainError, match="build の出力を読めない"):
        compare_l0.check_same(tmp_path / "a", tmp_path / "b")


# CMP-1b
def test_cmp1b_seedが1つはエラー(tmp_path):
    w = full(tmp_path, seeds=(1,))
    with pytest.raises(TrainError, match="seed が 2 つ以上"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1b_seedの集まりがarmで違う(tmp_path):
    w = full(tmp_path)
    eval_arm(w["root"], train_arm(w["root"], w["models"], "real", 3), "real", PREDS)
    with pytest.raises(TrainError, match="seed の集まり"):
        compare_l0.summarize(w["root"], "c1", w["models"])


@pytest.mark.parametrize(("key", "value"), [("epochs", 5), ("imgsz", 320), ("ultralytics", "9")])
def test_cmp1b_学習の条件がそろわない(tmp_path, key, value):
    w = full(tmp_path)
    card = w["models"] / "c1-mix-s2.json"
    c = json.loads(card.read_text())
    c[key] = value
    card.write_text(json.dumps(c))
    with pytest.raises(TrainError, match=key):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1b_元の重みが違う(tmp_path):
    w = full(tmp_path)
    card = w["models"] / "c1-mix-s2.json"
    c = json.loads(card.read_text())
    c["base"]["sha256"] = "0" * 64
    card.write_text(json.dumps(c))
    with pytest.raises(TrainError, match="元の重み"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1b_評価側にselfの鹿が無ければ暫定(tmp_path):
    root, toml = world(tmp_path)
    ledger(  # test の走行の鹿は暗くて「無視」→ 評価側に self の鹿の箱が無い
        toml.parent,
        track("d1-deer", "[[10, 10, 10, 30, 30], [14, 20, 10, 40, 30]]")
        + mark("d3-deer", "[20, 22]", "ignore"),
    )
    compare_l0.build(toml, root, "c1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    for arm in compare_l0.ARMS:
        for seed in (1, 2):
            eval_arm(root, train_arm(root, models, arm, seed), arm, PREDS)
    target, text = compare_l0.summarize(root, "c1", models)
    s = json.loads(target.read_text())
    assert s["provisional"] is True and s["self_test_deer_images"] == 0
    assert text.splitlines()[2] == f"**{compare_l0.PROVISIONAL}**"


# CMP-1c
def _edit_report(w: dict, name: str, fn) -> None:
    path = w["root"] / "out/eval" / name
    r = json.loads(path.read_text())
    fn(r)
    path.write_text(json.dumps(r))


@pytest.mark.parametrize(
    ("fn", "msg"),
    [
        (lambda r: r.update(run="c1-real"), "run が c1-mix でない"),
        (lambda r: r.update(model="c1-mix-s2.mlpackage"), r"\.pt の評価だけ"),
        (lambda r: r.update(model_sha256="0" * 64), "SHA-256 が model card と違う"),
        (lambda r: r["filter_config"].update(max_area=0.5), "filter_config"),
        (lambda r: r.update(thresholds=[0.5]), "thresholds"),
    ],
)
def test_cmp1c_評価の条件(tmp_path, fn, msg):
    w = full(tmp_path)
    _edit_report(w, "c1-mix-s2.pt.c1-mix.json", fn)
    with pytest.raises(TrainError, match=msg):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1c_評価のJSONが無い(tmp_path):
    w = full(tmp_path)
    (w["root"] / "out/eval/c1-mix-s2.pt.c1-mix.json").unlink()
    with pytest.raises(TrainError, match="評価の JSON を読めない"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1c_cardのrunがarmのrunでない(tmp_path):
    w = full(tmp_path)
    card = w["models"] / "c1-mix-s1.json"
    c = json.loads(card.read_text())
    c["run"] = "out/train/c1-real"
    card.write_text(json.dumps(c))
    with pytest.raises(TrainError, match="run が c1-mix でない"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1c_元の重みがBY_SAならエラー(tmp_path):
    root, toml = world(tmp_path)
    compare_l0.build(toml, root, "c1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    for arm in compare_l0.ARMS:
        for seed in (1, 2):
            eval_arm(root, train_arm(root, models, arm, seed, by_sa=True), arm, PREDS)
    with pytest.raises(TrainError, match="BY-SA"):
        compare_l0.summarize(root, "c1", models)


def test_cmp1c_BY_SAはcardの自己申告でなくSHAから引く(tmp_path, monkeypatch):
    w = full(tmp_path)
    monkeypatch.setattr(train_l0, "KNOWN_BASES", {sha(COCO): train_l0.Base("派生", by_sa=True)})
    with pytest.raises(TrainError, match="BY-SA"):
        compare_l0.summarize(w["root"], "c1", w["models"])
    monkeypatch.setattr(train_l0, "KNOWN_BASES", {})
    with pytest.raises(TrainError, match="出所が分からない"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1b_cardのseedが名前と違う(tmp_path):
    w = full(tmp_path)
    card = w["models"] / "c1-mix-s2.json"
    c = json.loads(card.read_text())
    c["seed"] = 1
    card.write_text(json.dumps(c))
    with pytest.raises(TrainError, match="seed が 1（名前は s2）"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1b_学習の後にrunが変わった(tmp_path):
    w = full(tmp_path)
    path = w["root"] / "out/train/c1-real/manifest.json"
    path.write_text(path.read_text() + "\n")
    with pytest.raises(TrainError, match="manifest が今の c1-real と違う"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1c_範囲が重なればseparatedでない():
    def res(values: dict[str, list[float]]) -> dict:
        return {
            arm: {i: {"eval/raw/0.25/deer_recall": v} for i, v in enumerate(vs)}
            for arm, vs in values.items()
        }

    over = compare_l0.separated(res({"real": [0.2, 0.5], "mix": [0.4, 0.9]}))
    assert over["eval/raw/0.25/deer_recall"]["separated"] is False
    touch = compare_l0.separated(res({"real": [0.2, 0.4], "mix": [0.4, 0.9]}))
    assert touch["eval/raw/0.25/deer_recall"]["separated"] is False  # 端が同じも重なり
    apart = compare_l0.separated(res({"real": [0.6, 0.9], "mix": [0.1, 0.5]}))
    assert apart["eval/raw/0.25/deer_recall"]["separated"] is True
    none = compare_l0.separated(
        {
            "real": {1: {"eval/raw/0.25/deer_recall": None}},
            "mix": {1: {"eval/raw/0.25/deer_recall": 0.5}},
        }
    )
    assert none == {}


# EV-2b の境界（ちょうど 2 枚・間が空く・後処理の側）
def test_ev2b_連続した誤報の境界():
    hit, miss = [(0.5, (0.5, 0.5, 0.1, 0.1))], []

    def row(frame: int, raw: list, filt: list) -> tuple:
        seq = {"video": "v", "frame": frame, "step": 10, "fps": 10.0}
        return ("own", seq, {"raw": raw, "fp_filter": filt})

    rows = [
        row(0, hit, hit),  # raw: 0・10・20 で 1 回、filter: 0 だけ（1 枚は数えない）
        row(10, hit, miss),
        row(20, hit, miss),
        row(40, hit, hit),  # 30 が無い（間が空いた）→ 別の塊（ちょうど 2 枚）で 1 回
        row(50, hit, hit),
    ]
    out = train_l0.fp_runs(rows)
    assert out["raw"]["0.25"]["total"]["runs"] == 2
    assert out["fp_filter"]["0.25"]["total"]["runs"] == 1
    assert out["raw"]["0.25"]["total"]["seconds"] == pytest.approx(5.0)


@pytest.mark.parametrize("prefix", ["../x", "C1", ""])
def test_cmp1c_summarizeのprefixの誤り(tmp_path, prefix):
    with pytest.raises(TrainError, match="prefix"):
        compare_l0.summarize(tmp_path, prefix, tmp_path)


def test_cmp1c_比較のJSONが既にある(tmp_path):
    w = full(tmp_path)
    compare_l0.summarize(w["root"], "c1", w["models"])
    with pytest.raises(TrainError, match="既にある"):
        compare_l0.summarize(w["root"], "c1", w["models"])


def test_cmp1c_seedの範囲が重ならないときだけseparated(tmp_path):
    root, toml = world(tmp_path)
    compare_l0.build(toml, root, "c1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    hit = {"d3-deer_f000020": PREDS["d3-deer_f000020"]}
    for seed in (1, 2):
        eval_arm(root, train_arm(root, models, "real", seed), "real", {})  # 鹿を見逃す
        eval_arm(root, train_arm(root, models, "mix", seed), "mix", hit)
    target, text = compare_l0.summarize(root, "c1", models)
    sep = json.loads(target.read_text())["separated"]
    key = "eval/raw/0.25/deer_recall"
    assert sep[key]["separated"] is True
    assert sep[key]["real"][1] < sep[key]["mix"][0]
    assert sep["eval/raw/0.25/deer_fp"]["separated"] is False  # どちらも 0
    assert key in text


def test_cmp1c_cardに重みのSHA(tmp_path):
    w = full(tmp_path)
    for path in w["models"].glob("c1-*.json"):
        card = json.loads(path.read_text())
        assert card["sha256"] == sha((w["models"] / f"{card['name']}.pt").read_bytes())


# CLI
def test_cli_buildとsummarize(tmp_path, capsys):
    root, toml = world(tmp_path)
    args = ["--sources", str(toml), "--root", str(root), "--prefix", "c1"]
    assert compare_l0.main(["build", *args, "--seed", "7"]) == 0
    assert "c1-real: train" in capsys.readouterr().out
    models = tmp_path / "models"
    models.mkdir()
    for arm in compare_l0.ARMS:
        for seed in (1, 2):
            eval_arm(root, train_arm(root, models, arm, seed), arm, PREDS)
    summ = ["summarize", "--root", str(root), "--prefix", "c1", "--models", str(models)]
    assert compare_l0.main(summ) == 0
    assert "c1.json" in capsys.readouterr().out
    assert compare_l0.main(summ) == 2
    assert "既にある" in capsys.readouterr().err


def test_cli_trainの重みの置き場(tmp_path, capsys):
    root, toml = world(tmp_path)
    compare_l0.build(toml, root, "c1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    (models / "base.pt").write_bytes(COCO)
    (models / "x1.json").write_text("{}")
    code = train_l0.main(
        [
            "train",
            *("--run", "c1-real", "--root", str(root), "--name", "x1", "--seed", "1"),
            *("--base", str(models / "base.pt"), "--models", str(models)),
        ]
    )
    assert code == 2
    assert "x1.json は既にある" in capsys.readouterr().err  # --models の置き場を見に行った
