"""「実写のみ」と「実写＋S データ」の比較（docs/specs/dataset-train R14）。

同じ一覧・同じ seed から 2 つの run（<prefix>-real は synth を外す、<prefix>-mix は全部）を作り、
val と評価側が同じことを確かめる。学習と評価は train_l0 の train・evaluate を arm × seed で
1 回ずつ回す（重い処理を 1 つずつ鍵を取って回せるように）。summarize が条件をそろえて表にする。
評価は実写の鹿だけ（synth は評価側に入らない）。

    python dataset/compare_l0.py build --prefix c1 --seed 7 --root <main の dataset>
    python dataset/train_l0.py train --run c1-real --name c1-real-s1 --seed 1 ...（arm × seed）
    python dataset/train_l0.py evaluate --run c1-real --model .../c1-real-s1.pt ...
    python dataset/compare_l0.py summarize --prefix c1 --root <main の dataset> --models <dir>
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Final

import train_l0
from train_l0 import NAME, TrainError

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

ARMS: Final = ("real", "mix")
REAL_KINDS: Final = ("self", "yolo")  # 実写の鹿の正解を持つ kind（R14）
SAME: Final = ("epochs", "imgsz", "batch", "device", "ultralytics")
TFP: Final = ("tp", "fn", "fp")
PROVISIONAL: Final = "暫定（テスト専用の走行の実写の鹿なし）"


def _manifest(run_dir: Path) -> dict:
    try:
        return json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        msg = f"build の出力を読めない（{run_dir.name}）"
        raise TrainError(msg) from exc


def check_same(real: Path, mix: Path) -> None:
    """real と mix の val・評価側と、synth 以外の train が同じ画像（SHA-256）であること。"""
    rm, mm = _manifest(real), _manifest(mix)
    kinds = {name: s["kind"] for name, s in mm["sources"].items()}

    def side(m: Mapping, split: str) -> list[str]:
        return sorted(
            f["sha256"]
            for f in m["files"]
            if f["split"] == split and kinds.get(f["source"]) != "synth"
        )

    for split in ("train", "val", "eval"):
        if side(rm, split) != side(mm, split):
            msg = f"real と mix の {split} が違う（synth 以外）"
            raise TrainError(msg)
    if any(kinds.get(f["source"]) == "synth" and f["split"] != "train" for f in mm["files"]):
        msg = "synth が train の外にある"
        raise TrainError(msg)


def build(
    sources: Path,
    root: Path = train_l0.HERE,
    prefix: str = "",
    seed: int = 0,
    val_ratio: float = 0.2,
    is_valid: Callable[[object], bool] | None = None,
) -> tuple[Path, Path]:
    if not NAME.match(prefix):
        msg = f"prefix は英小文字・数字・- だけ（{prefix!r}）"
        raise TrainError(msg)
    synth = [s.name for s in train_l0.load_sources(sources, root.resolve()) if s.kind == "synth"]
    if not synth:
        msg = "一覧に synth の素材が無い（比べられない）"
        raise TrainError(msg)
    real = train_l0.build(sources, root, f"{prefix}-real", seed, val_ratio, is_valid, skip=synth)
    made = [real]
    try:
        made.append(train_l0.build(sources, root, f"{prefix}-mix", seed, val_ratio, is_valid))
        check_same(real, made[1])
    except BaseException:
        for run_dir in made:
            shutil.rmtree(run_dir, ignore_errors=True)
        raise
    return real, made[1]


# ---------------------------------------------------------------- summarize


def _load(path: Path, what: str) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        msg = f"{what} を読めない（{path.name}）"
        raise TrainError(msg) from exc


def _cards(models: Path, prefix: str, arm: str) -> dict[int, dict]:
    pattern = re.compile(rf"^{re.escape(prefix)}-{arm}-s(\d+)\.json$")
    out = {}
    for path in sorted(models.glob(f"{prefix}-{arm}-s*.json")):
        if found := pattern.match(path.name):
            out[int(found.group(1))] = _load(path, "model card")
    return out


def _rate(num: int, den: int) -> float | None:
    return num / den if den else None


def metrics(report: Mapping, kinds: Mapping[str, str]) -> dict[str, float | int | None]:
    """評価の JSON → 平らな指標。実写の鹿は REAL_KINDS の素材だけを足す。"""
    out: dict[str, float | int | None] = {}
    posts = {"raw": report, "fp_filter": report["fp_filter"]}
    for side in ("val", "eval"):
        for post, rep in posts.items():
            for thr, v in rep[side].items():
                key = f"{side}/{post}/{thr}"
                tp = fn = fp = neg = neg_hit = 0
                for source, t in v["by_source"].items():
                    if kinds.get(source) in REAL_KINDS:
                        tp, fn, fp = tp + t["tp"], fn + t["fn"], fp + t["fp"]
                        out[f"{key}/{source}/tp"] = t["tp"]
                        out[f"{key}/{source}/fn"] = t["fn"]
                        out[f"{key}/{source}/fp"] = t["fp"]
                    elif kinds.get(source) == "negatives":
                        neg += t["images"]
                        neg_hit += t["negative_images_with_detection"]
                out[f"{key}/deer_tp"], out[f"{key}/deer_fn"], out[f"{key}/deer_fp"] = tp, fn, fp
                out[f"{key}/deer_recall"] = _rate(tp, tp + fn)
                out[f"{key}/deer_precision"] = _rate(tp, tp + fp)
                out[f"{key}/neg_images"] = neg
                out[f"{key}/neg_images_with_detection"] = neg_hit
                out[f"{key}/neg_rate"] = _rate(neg_hit, neg)
                runs = report["fp_runs"][side][post][thr]["total"]
                out[f"{key}/runs_per_min"] = runs["runs_per_min"]
                out[f"{key}/fp_frames_per_min"] = runs["frames_with_detection_per_min"]
                out[f"{key}/fp_minutes"] = runs["seconds"] / 60
    return out


SEPARATE: Final = (
    "deer_recall",
    "deer_fp",
    "neg_rate",
    "runs_per_min",
    "fp_frames_per_min",
)


def separated(results: Mapping[str, Mapping[int, Mapping]]) -> dict[str, dict]:
    """主な数について arm ごとの seed の最小〜最大。範囲が重ならないときだけ separated。"""
    out = {}
    keys = sorted(next(iter(results["real"].values())))
    for key in keys:
        if key.rsplit("/", 1)[-1] not in SEPARATE:
            continue
        spans = {}
        for arm in ARMS:
            values = [m[key] for m in results[arm].values()]
            if any(v is None for v in values):
                break
            spans[arm] = [min(values), max(values)]
        else:
            r, x = spans["real"], spans["mix"]
            out[key] = {**spans, "separated": r[1] < x[0] or x[1] < r[0]}
    return out


def summarize(
    root: Path,
    prefix: str,
    models: Path,
    out_dir: Path | None = None,
    known_bases: Mapping[str, train_l0.Base] | None = None,
) -> tuple[Path, str]:
    if not NAME.match(prefix):
        msg = f"prefix は英小文字・数字・- だけ（{prefix!r}）"
        raise TrainError(msg)
    known_bases = train_l0.KNOWN_BASES if known_bases is None else known_bases
    root = root.resolve()
    out_dir = out_dir or root / "out/compare"
    target = out_dir / f"{prefix}.json"
    if target.exists():
        msg = f"{target.name} は既にある（上書きしない）"
        raise TrainError(msg)
    runs = {arm: root / "out/train" / f"{prefix}-{arm}" for arm in ARMS}
    manifests = {arm: _manifest(runs[arm]) for arm in ARMS}
    cards = {arm: _cards(models, prefix, arm) for arm in ARMS}
    seeds = sorted(cards["real"])
    if sorted(cards["mix"]) != seeds:
        msg = f"seed の集まりが arm で違う（real {seeds}・mix {sorted(cards['mix'])}）"
        raise TrainError(msg)
    if len(seeds) < 2:
        msg = f"seed が 2 つ以上要る（{seeds}）"
        raise TrainError(msg)
    check_same(runs["real"], runs["mix"])  # build の後に run が変わっていない
    first = cards["real"][seeds[0]]
    reports: dict[str, dict[int, dict]] = {arm: {} for arm in ARMS}
    for arm in ARMS:
        manifest_sha = train_l0.sha256_file(runs[arm] / "manifest.json")
        for seed, card in cards[arm].items():
            name = f"{prefix}-{arm}-s{seed}"
            _check_card(card, first, runs[arm], name, known_bases)
            if card.get("seed") != seed:  # 名前の -s<N> と学習の seed の打ち間違い
                msg = f"{name}: model card の seed が {card.get('seed')}（名前は s{seed}）"
                raise TrainError(msg)
            if card.get("manifest_sha256") != manifest_sha:
                msg = f"{name}: 学習した run の manifest が今の {runs[arm].name} と違う"
                raise TrainError(msg)
            report = _load(root / "out/eval" / f"{name}.pt.{prefix}-{arm}.json", "評価の JSON")
            _check_report(report, reports, card, prefix, arm, name)
            reports[arm][seed] = report
    kinds = {n: s["kind"] for n, s in manifests["mix"]["sources"].items()}
    results = {arm: {seed: metrics(reports[arm][seed], kinds) for seed in seeds} for arm in ARMS}
    deer_test = sum(
        1
        for f in manifests["mix"]["files"]
        if kinds.get(f["source"]) == "self" and f["split"] == "eval" and f["boxes"]
    )
    steps = {
        arm: math.ceil(manifests[arm]["counts"]["train"] / int(first["batch"])) for arm in ARMS
    }
    any_report = reports["real"][seeds[0]]
    summary = {
        "prefix": prefix,
        "provisional": deer_test == 0,
        "self_test_deer_images": deer_test,
        "conditions": {
            "base": first["base"],
            **{k: first[k] for k in SAME},
            "seeds": seeds,
            "thresholds": any_report["thresholds"],
            "preprocess": any_report["preprocess"],
            "filter_config": any_report["filter_config"],
            "weights": ".pt（export と同じ 640×480 の入力）",
        },
        "arms": {
            arm: {
                "run": runs[arm].name,
                "train_images": manifests[arm]["counts"]["train"],
                "steps_per_epoch": steps[arm],
                "excluded_sources": manifests[arm].get("excluded_sources", []),
            }
            for arm in ARMS
        },
        "step_ratio_mix_to_real": steps["mix"] / steps["real"] if steps["real"] else None,
        "counts": {
            arm: {**manifests[arm]["counts"], "by_source": _side_counts(manifests[arm])}
            for arm in ARMS
        },
        "results": {arm: {str(s): v for s, v in results[arm].items()} for arm in ARMS},
        "separated": separated(results),
        "note": (
            "実写の鹿は self・yolo の素材だけ（synth は評価側に無い）。範囲が重なる差は"
            "「seed のばらつきの中」で、良くなったとは書かない"
        ),
    }
    text = markdown(summary)
    out_dir.mkdir(parents=True, exist_ok=True)
    with target.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(summary, ensure_ascii=False, indent=1) + "\n")
    with target.with_suffix(".md").open("x", encoding="utf-8") as handle:
        handle.write(text)
    return target, text


def _side_counts(manifest: Mapping) -> dict[str, dict[str, int]]:
    return {name: s["used"] for name, s in manifest["sources"].items()}


def _check_card(
    card: Mapping,
    first: Mapping,
    run_dir: Path,
    name: str,
    known_bases: Mapping[str, train_l0.Base],
) -> None:
    known = known_bases.get(str(card.get("base", {}).get("sha256")))
    if known is None:
        msg = f"{name}: 元の重みの出所が分からない（SHA-256 が train_l0 の一覧に無い）"
        raise TrainError(msg)
    if known.by_sa or card.get("base", {}).get("by_sa"):  # 自己申告でなく SHA から引く
        msg = f"{name}: 元の重みが CC BY-SA を含む（評価側の BY-SA の鹿が学習に入っている）"
        raise TrainError(msg)
    if card.get("base", {}).get("sha256") != first["base"]["sha256"]:
        msg = f"{name}: 元の重みが ほかの重みと違う"
        raise TrainError(msg)
    for key in SAME:
        if card.get(key) != first.get(key):
            msg = f"{name}: {key} が ほかの重みと違う（{card.get(key)} と {first.get(key)}）"
            raise TrainError(msg)
    if not str(card.get("run", "")).endswith(f"out/train/{run_dir.name}"):
        msg = f"{name}: model card の run が {run_dir.name} でない"
        raise TrainError(msg)


def _check_report(
    report: Mapping,
    reports: Mapping[str, Mapping[int, Mapping]],
    card: Mapping,
    prefix: str,
    arm: str,
    name: str,
) -> None:
    if report.get("run") != f"{prefix}-{arm}":
        msg = f"{name}: 評価の JSON の run が {prefix}-{arm} でない"
        raise TrainError(msg)
    if not str(report.get("model", "")).endswith(".pt"):
        msg = f"{name}: 比較は .pt の評価だけ"
        raise TrainError(msg)
    if not card.get("sha256") or report.get("model_sha256") != card.get("sha256"):
        msg = f"{name}: 評価した重みの SHA-256 が model card と違う"
        raise TrainError(msg)
    other = next((r for rs in reports.values() for r in rs.values()), None)
    if other is not None:
        for key in ("thresholds", "preprocess", "filter_config", "iou"):
            if report.get(key) != other.get(key):
                msg = f"{name}: 評価の {key} が ほかの評価と違う"
                raise TrainError(msg)


def _fmt(value: float | int | None, digits: int = 2) -> str:
    if value is None:
        return "—"
    if isinstance(value, int):
        return str(value)
    return f"{value:.{digits}f}"


def markdown(summary: Mapping) -> str:
    c = summary["conditions"]
    lines = [f"# 比較 {summary['prefix']}", ""]
    if summary["provisional"]:
        lines += [f"**{PROVISIONAL}**", ""]
    lines += [
        f"- 条件: 元の重み {c['base']['name']}・{c['epochs']} epoch・imgsz {c['imgsz']}・"
        f"batch {c['batch']}・{c['device']}・ultralytics {c['ultralytics']}・seed {c['seeds']}",
        f"- 評価: {c['weights']}、{c['preprocess']}",
    ]
    for arm, a in summary["arms"].items():
        lines.append(
            f"- {arm}: train {a['train_images']} 枚、1 epoch {a['steps_per_epoch']} ステップ"
        )
    ratio = summary["step_ratio_mix_to_real"]
    lines += [f"- mix ÷ real のステップ数: {_fmt(ratio)}（同じ epochs）", ""]
    thresholds = [str(t) for t in c["thresholds"]]
    for side in ("eval", "val"):
        for post in ("raw", "fp_filter"):
            lines += [
                f"## {side}・後処理 {'なし' if post == 'raw' else 'あり'}",
                "",
                "| arm | seed | 閾値 | 実写の鹿 TP/FN/FP | 再現率 | 連続した誤報 /分 | "
                "誤報のサンプル /分 | 鹿のいない画像の誤報 |",
                "| --- | --- | --- | --- | --- | --- | --- | --- |",
            ]
            for arm in summary["results"]:
                for seed, m in summary["results"][arm].items():
                    for thr in thresholds:
                        k = f"{side}/{post}/{thr}"
                        lines.append(
                            f"| {arm} | {seed} | {thr} | {m[f'{k}/deer_tp']}/{m[f'{k}/deer_fn']}/"
                            f"{m[f'{k}/deer_fp']} | {_fmt(m[f'{k}/deer_recall'])} | "
                            f"{_fmt(m[f'{k}/runs_per_min'])} | "
                            f"{_fmt(m[f'{k}/fp_frames_per_min'])} | "
                            f"{m[f'{k}/neg_images_with_detection']}/{m[f'{k}/neg_images']} |"
                        )
            lines.append("")
    lines += [
        "## eval・実写の鹿の素材ごと（TP/FN/FP、後処理なし → あり）",
        "",
        "| arm | seed | 閾値 | 素材 | なし | あり |",
        "| --- | --- | --- | --- | --- | --- |",
    ]
    for arm in summary["results"]:
        for seed, m in summary["results"][arm].items():
            for thr in thresholds:
                prefix = f"eval/raw/{thr}/"
                for key in sorted(k for k in m if k.startswith(prefix) and k.endswith("/tp")):
                    source = key[len(prefix) : -len("/tp")]
                    cells = [
                        "/".join(str(m[f"eval/{post}/{thr}/{source}/{x}"]) for x in TFP)
                        for post in ("raw", "fp_filter")
                    ]
                    lines.append(f"| {arm} | {seed} | {thr} | {source} | {cells[0]} | {cells[1]} |")
    lines.append("")
    sep = {k: v for k, v in summary["separated"].items() if v["separated"]}
    lines += [
        "## seed の範囲が重ならない数",
        "",
        *(
            [f"- {k}: real {v['real']}・mix {v['mix']}" for k, v in sep.items()]
            or ["- なし（どの差も seed のばらつきの中）"]
        ),
        "",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------- CLI


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--sources", type=Path, default=train_l0.HERE / "train_sources.toml")
    b.add_argument("--root", type=Path, default=train_l0.HERE)
    b.add_argument("--prefix", required=True)
    b.add_argument("--seed", type=int, required=True)
    b.add_argument("--val-ratio", type=float, default=0.2)
    s = sub.add_parser("summarize")
    s.add_argument("--root", type=Path, default=train_l0.HERE)
    s.add_argument("--prefix", required=True)
    s.add_argument("--models", type=Path, default=train_l0.MODELS)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "build":
            real, mix = build(args.sources, args.root, args.prefix, args.seed, args.val_ratio)
            for run_dir in (real, mix):
                c = _manifest(run_dir)["counts"]
                sys.stdout.write(
                    f"{run_dir.name}: train {c['train']} / val {c['val']} / eval {c['eval']}\n"
                )
        else:
            target, text = summarize(args.root, args.prefix, args.models)
            sys.stdout.write(text + f"\n{target}\n")
    except TrainError as exc:
        sys.stderr.write(f"エラー: {exc}\n")
        return 2
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
