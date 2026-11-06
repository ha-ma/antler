"""dataset-train 2026-11-07 更新: 自分の映像・S データ・鹿のいない画像・後処理・連続した誤報。

R9〜R13 と R4 の追記（docs/specs/dataset-train）。Ultralytics・画像の読み込みは偽物。
"""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path

import numpy as np
import pytest
from test_train_l0 import BOX, FakeTrainer, block, commons, manifest, read_any, sha

import train_l0
from train_l0 import TrainError

META = """[meta]
labeler = "t"
method = "m"
date = "2026-11-07"
negatives_checked = "n"
"""
SIZE = [100, 50]


# ---------------------------------------------------------------- 素材を作る道具


def self_source(
    root: Path,
    rel: str,
    drives: dict[str, str],
    clips: dict[str, tuple[str, list[tuple[int, bool]]]],
    *,
    blur: dict[tuple[str, int], list] | None = None,
    allowed: tuple[str, ...] = ("train", "eval"),
    license_: str = "self",
) -> Path:
    """clips: 動画 → (走行, [(フレーム, 鹿あり)])。fps 10、鹿なしの間隔 10 フレーム（1 秒）。"""
    base = root / rel
    blur = blur or {}
    files = []
    for video, (drive, frames) in clips.items():
        for frame, deer in frames:
            image = f"frames/{video}/{video}_f{frame:06d}.jpg"
            data = f"self:{rel}:{video}:{frame}".encode()
            (base / image).parent.mkdir(parents=True, exist_ok=True)
            (base / image).write_bytes(data)
            files.append(
                {
                    "image": image,
                    "label": None,
                    "video": video,
                    "drive": drive,
                    "group": f"self:{drive}",
                    "split": drives[drive],
                    "frame": frame,
                    "t": frame / 10,
                    "deer": deer,
                    "uses": ["label"] if deer else ["synth_background", "negative"],
                    "sha256": sha(data),
                    "blur_boxes": [{"cls": "car", "box": b} for b in blur.get((video, frame), [])],
                }
            )
    m = {
        "version": 1,
        "license": license_,
        "allowed_use": list(allowed),
        "distribution": "not_allowed",
        "drives": drives,
        "clips": {
            v: {
                "drive": d,
                "split": drives[d],
                "area": "道東",
                "fps": 10.0,
                "size": SIZE,
                "every_frames": {"deer": 2, "no_deer": 10},
            }
            for v, (d, _) in clips.items()
        },
        "sources": {v: {"license": "self", "area": "道東"} for v in clips},
        "files": files,
    }
    base.mkdir(parents=True, exist_ok=True)
    (base / "manifest.json").write_text(json.dumps(m, ensure_ascii=False))
    return base


def ledger(cfg: Path, body: str = "", name: str = "labels.toml") -> str:
    cfg.mkdir(parents=True, exist_ok=True)
    (cfg / name).write_text(META + body, encoding="utf-8")
    return name


def self_block(
    name: str, path: str, use: str = "train", labels: str = "labels.toml", every: int | None = None
) -> str:
    text = block(name, "self", path, "self", use) + f'labels = "{labels}"\n'
    if every is not None:
        text += f"negative_every = {every}\n"
    return text


def track(video: str, keys: str, tid: str = "a") -> str:
    return f'[[track]]\nvideo = "{video}"\nid = "{tid}"\nkeys = {keys}\nnote = ""\n'


def mark(video: str, frames: str, status: str) -> str:
    return f'[[mark]]\nvideo = "{video}"\nframes = {frames}\nstatus = "{status}"\nreason = "r"\n'


def synth_source(root: Path, rel: str, footage: Path, picks: list[str], **over: object) -> Path:
    """picks: 背景にする footage の画像（manifest の image）。1 枚に 1 頭。"""
    base = root / rel
    shutil.rmtree(base, ignore_errors=True)  # 作り直す
    fm = json.loads((footage / "manifest.json").read_text())
    rows = {r["image"]: r for r in fm["files"]}
    files = []
    for i, image in enumerate(picks):
        img = base / "images/train" / f"s_{i:03d}.jpg"
        lbl = base / "labels/train" / f"s_{i:03d}.txt"
        img.parent.mkdir(parents=True, exist_ok=True)
        lbl.parent.mkdir(parents=True, exist_ok=True)
        data = f"synth:{rel}:{i}".encode()
        img.write_bytes(data)
        lbl.write_text(BOX + "\n")
        row = rows[image]
        files.append(
            {
                "image": f"images/train/s_{i:03d}.jpg",
                "label": f"labels/train/s_{i:03d}.txt",
                "sha256": sha(data),
                "video": f"synth:{row['video']}",
                "group": row["group"],
                "split": "train",
                "background": {"image": image, "sha256": row["sha256"]},
            }
        )
    m = {
        "version": 1,
        "kind": "synth",
        "license": "self",
        "allowed_use": ["train"],
        "distribution": "not_allowed",
        "footage_manifest_sha256": hashlib.sha256(
            (footage / "manifest.json").read_bytes()
        ).hexdigest(),
        "files": files,
        **over,
    }
    (base / "manifest.json").write_text(json.dumps(m))
    return base


def negatives_source(
    root: Path, rel: str, creators: list[str], license_: str = "CC BY-SA 4.0"
) -> Path:
    base = root / rel
    files = []
    for i, creator in enumerate(creators):
        img = base / "images" / f"{1000 + i}.jpg"
        img.parent.mkdir(parents=True, exist_ok=True)
        data = f"neg:{i}".encode()
        img.write_bytes(data)
        files.append(
            {
                "image": f"images/{1000 + i}.jpg",
                "image_id": 1000 + i,
                "sha256": sha(data),
                "creator_username": creator,
                "attribution": f"{creator} / Mapillary",
                "region": "根室",
                "area_rough": [145.2, 43.3],
                "sequence": "seq",
                "month": 6,
                "camera_type": "perspective",
            }
        )
    m = {"license": license_, "split_rule": "撮影者の単位", "files": files}
    base.mkdir(parents=True, exist_ok=True)
    (base / "manifest.json").write_text(json.dumps(m, ensure_ascii=False))
    return base


def world(tmp_path: Path, *, synth: bool = True, every: int = 1) -> tuple[Path, Path]:
    """train の走行 D1（鹿あり・鹿なし）、val の走行 D2（鹿なし）、test の走行 D3（鹿あり）。"""
    root = tmp_path / "dataset"
    cfg = tmp_path / "cfg"
    footage = self_source(
        root,
        "private/sf",
        {"D1": "train", "D2": "val", "D3": "test"},
        {
            "d1-deer": ("D1", [(0, False), (10, True), (12, True), (14, True), (30, False)]),
            "d1-night": ("D1", [(0, False), (10, False), (20, False), (30, False)]),
            "d2-day": ("D2", [(0, False), (10, False), (20, False)]),
            "d3-deer": ("D3", [(0, False), (10, False), (20, True), (22, True), (30, False)]),
        },
    )
    led = ledger(
        cfg,
        track("d1-deer", "[[10, 10, 10, 30, 30], [14, 20, 10, 40, 30]]")
        + track("d3-deer", "[[20, 40, 10, 60, 40]]")
        + mark("d3-deer", "[22]", "empty"),
    )
    blocks = [commons(root), self_block("own", "private/sf", labels=led, every=every)]
    if synth:
        synth_source(
            root,
            "private/syn",
            footage,
            ["frames/d1-night/d1-night_f000000.jpg", "frames/d1-night/d1-night_f000010.jpg"],
        )
        blocks.append(block("syn", "synth", "private/syn", "self", "train") + 'footage = "own"\n')
    negatives_source(root, "private/neg", ["alice", "bob"])
    blocks.append(block("neg", "negatives", "private/neg", "CC-BY-SA", "eval"))
    toml = cfg / "train_sources.toml"
    toml.write_text("\n".join(blocks))
    return root, toml


def by_name(m: dict) -> dict[str, dict]:
    return {f["file"]: f for f in m["files"]}


# ---------------------------------------------------------------- UC-8


# SELF-1a
def test_self1a_走行の分割と台帳の状態(tmp_path):
    root, toml = world(tmp_path)
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    files = by_name(m)
    f = files["own__d1-deer_f000012.jpg"]
    assert f["split"] == "train" and f["group"] == "self:D1"
    assert f["boxes"] == [pytest.approx([0.25, 0.4, 0.2, 0.4])]  # (15,10)-(35,30) を 100×50 で
    assert files["own__d2-day_f000010.jpg"]["split"] == "val"
    assert files["own__d3-deer_f000020.jpg"]["split"] == "eval"
    assert files["own__d3-deer_f000022.jpg"]["boxes"] == []  # empty
    assert files["own__d3-deer_f000022.jpg"]["seq"]["no_deer"] is False
    assert files["own__d3-deer_f000030.jpg"]["seq"] == {
        "video": "d3-deer",
        "frame": 30,
        "t": 3.0,
        "step": 10,
        "fps": 10.0,
        "no_deer": True,
    }


def test_self1a_使わない走行とignore(tmp_path):
    root, toml = world(tmp_path, synth=False)
    (toml.parent / "labels.toml").write_text(
        META
        + track("d1-deer", "[[10, 10, 10, 30, 30], [14, 20, 10, 40, 30]]")
        + track("d3-deer", "[[20, 40, 10, 60, 40]]")
        + mark("d3-deer", "[22]", "empty")
        + mark("d1-deer", "[12]", "ignore")
        + mark("d1-night", "[20]", "ignore")
    )
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    names = set(by_name(m))
    assert "own__d1-deer_f000012.jpg" not in names
    assert "own__d1-night_f000020.jpg" not in names
    assert m["sources"]["own"]["skipped"] == {"ignore": 2}


def test_self1a_台帳に無い鹿ありはエラー(tmp_path):
    root, toml = world(tmp_path, synth=False)
    (toml.parent / "labels.toml").write_text(META + track("d1-deer", "[[10, 10, 10, 30, 30]]"))
    with pytest.raises(TrainError, match="台帳に無い鹿あり"):
        train_l0.build(toml, root=root, run="r1", seed=7)
    assert not (root / "out/train/r1").exists()


def test_self1a_evalの素材は全部評価側(tmp_path):
    root, toml = world(tmp_path, synth=False)
    toml.write_text(commons(root) + self_block("own", "private/sf", use="eval") + "\n")
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    assert {f["split"] for f in m["files"] if f["source"] == "own"} == {"eval"}


# SELF-1b
def test_self1b_鹿なしの間引きはtrainだけ(tmp_path):
    root, toml = world(tmp_path, synth=False, every=2)
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    names = set(by_name(m))
    night = sorted(n for n in names if "d1-night" in n)
    assert night == ["own__d1-night_f000000.jpg", "own__d1-night_f000020.jpg"]
    assert sum("d2-day" in n for n in names) == 3  # val は間引かない
    assert m["sources"]["own"]["skipped"]["thinned"] == 3  # d1-night 2 枚・d1-deer の鹿なし 1 枚


@pytest.mark.parametrize(
    ("change", "msg"),
    [
        (lambda m: m.update(license="CC0"), "license"),
        (lambda m: m.update(allowed_use=["eval"]), "allowed_use"),
        (lambda m: m["files"][0].update(split="val"), "分割"),
        (lambda m: m["files"][0].update(group="self:D9"), "group"),
        (lambda m: m["files"][0].update(sha256="0" * 64), "SHA-256"),
        (lambda m: m["clips"].pop("d1-deer"), "clips"),
    ],
)
def test_self1b_manifestの食い違い(tmp_path, change, msg):
    root, toml = world(tmp_path, synth=False)
    path = root / "private/sf/manifest.json"
    m = json.loads(path.read_text())
    change(m)
    path.write_text(json.dumps(m))
    with pytest.raises(TrainError, match=msg):
        train_l0.build(toml, root=root, run="r1", seed=7)


def test_self1b_manifestに無い画像(tmp_path):
    root, toml = world(tmp_path, synth=False)
    (root / "private/sf/frames/d1-night/extra.jpg").write_bytes(b"x")
    with pytest.raises(TrainError, match="manifest に無い画像"):
        train_l0.build(toml, root=root, run="r1", seed=7)


def test_self1b_台帳は一覧のフォルダから読む(tmp_path):
    root, toml = world(tmp_path, synth=False)
    assert not (root / "labels.toml").exists()  # root（dataset/）には置いていない
    assert train_l0.build(toml, root=root, run="r1", seed=7).is_dir()


# SYN-1a
def test_syn1a_Sデータはtrainで背景の走行のグループ(tmp_path):
    root, toml = world(tmp_path)
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    syn = [f for f in m["files"] if f["source"] == "syn"]
    assert len(syn) == 2 and {f["split"] for f in syn} == {"train"}
    assert {f["group"] for f in syn} == {"self:D1"}
    assert m["notes"] == []


def _edit_synth(root: Path, fn) -> None:
    path = root / "private/syn/manifest.json"
    m = json.loads(path.read_text())
    fn(m)
    path.write_text(json.dumps(m))


@pytest.mark.parametrize(
    ("fn", "msg"),
    [
        (lambda m: m["files"][0]["background"].update(sha256="0" * 64), "背景"),
        (lambda m: m["files"][0]["background"].update(image="frames/x.jpg"), "背景"),
        (lambda m: m["files"][0].update(group="self:D2"), "group"),
        (lambda m: m.update(kind="photo"), "kind"),
        (lambda m: m.update(allowed_use=["eval"]), "allowed_use"),
    ],
)
def test_syn1a_背景の誤り(tmp_path, fn, msg):
    root, toml = world(tmp_path)
    _edit_synth(root, fn)
    with pytest.raises(TrainError, match=msg):
        train_l0.build(toml, root=root, run="r1", seed=7)


def test_syn1a_背景の走行がtrainでない(tmp_path):
    root, toml = world(tmp_path)
    synth_source(root, "private/syn", root / "private/sf", ["frames/d2-day/d2-day_f000000.jpg"])
    with pytest.raises(TrainError, match="train でない"):
        train_l0.build(toml, root=root, run="r1", seed=7)


def test_syn1a_背景のusesと台帳のignore(tmp_path):
    root, toml = world(tmp_path)
    path = root / "private/sf/manifest.json"
    m = json.loads(path.read_text())
    for row in m["files"]:
        if row["image"] == "frames/d1-night/d1-night_f000000.jpg":
            row["uses"] = ["negative"]
    path.write_text(json.dumps(m))
    synth_source(root, "private/syn", root / "private/sf", ["frames/d1-night/d1-night_f000000.jpg"])
    with pytest.raises(TrainError, match="synth_background"):
        train_l0.build(toml, root=root, run="r1", seed=7)

    root2, toml2 = world(tmp_path / "b")
    with (toml2.parent / "labels.toml").open("a") as handle:
        handle.write(mark("d1-night", "[10]", "ignore"))
    with pytest.raises(TrainError, match="ignore"):
        train_l0.build(toml2, root=root2, run="r1", seed=7)


def test_syn1a_footageのmanifestが変わったらnotes(tmp_path):
    root, toml = world(tmp_path)
    _edit_synth(root, lambda m: m.update(footage_manifest_sha256="0" * 64))
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    assert any("footage" in n for n in m["notes"])


SYN = '[[source]]\nname = "syn"\nkind = "synth"\npath = "private/syn"\nlicense = "self"\n'


@pytest.mark.parametrize(
    ("text", "msg"),
    [
        (SYN + 'use = "eval"\nfootage = "own"\n', "train だけ"),
        (SYN + 'use = "train"\n', "footage"),
        (SYN + 'use = "train"\nfootage = "nope"\n', "footage"),
    ],
)
def test_syn1a_一覧の誤り(tmp_path, text, msg):
    root, toml = world(tmp_path)
    toml.write_text(self_block("own", "private/sf") + "\n" + text)
    with pytest.raises(TrainError, match=msg):
        train_l0.load_sources(toml, root=root)


# NEG-1a・PRIV-1a
def test_neg1a_鹿のいない画像は評価側で撮影者のハッシュ(tmp_path):
    root, toml = world(tmp_path)
    m = manifest(train_l0.build(toml, root=root, run="r1", seed=7))
    neg = [f for f in m["files"] if f["source"] == "neg"]
    assert len(neg) == 2 and {f["split"] for f in neg} == {"eval"}
    assert all(f["boxes"] == [] for f in neg)
    want = "negatives:neg:c-" + hashlib.sha256(b"alice").hexdigest()[:10]
    assert want in {f["group"] for f in neg}
    text = (root / "out/train/r1/manifest.json").read_text()
    for word in ("alice", "bob", "145.2", "根室", "Mapillary", "perspective", "道東", "area"):
        assert word not in text


def test_neg1a_一覧の誤り(tmp_path):
    root, toml = world(tmp_path)
    text = toml.read_text().replace(
        'kind = "negatives"\npath = "private/neg"\nlicense = "CC-BY-SA"\nuse = "eval"',
        'kind = "negatives"\npath = "private/neg"\nlicense = "CC-BY-SA"\nuse = "train"',
    )
    toml.write_text(text)
    with pytest.raises(TrainError, match=r"CC-BY-SA|eval だけ"):
        train_l0.load_sources(toml, root=root)
    root2, toml2 = world(tmp_path / "b")
    toml2.write_text(
        toml2.read_text().replace(
            'path = "private/neg"\nlicense = "CC-BY-SA"', 'path = "private/neg"\nlicense = "CC-BY"'
        )
    )
    with pytest.raises(TrainError, match="license"):
        train_l0.build(toml2, root=root2, run="r1", seed=7)


# LEAK-1a
def test_leak1a_同じ走行が2つのselfの素材に分かれても止まる(tmp_path):
    root, toml = world(tmp_path, synth=False)
    self_source(root, "private/sf2", {"D1": "test"}, {"other": ("D1", [(0, False), (10, False)])})
    led2 = ledger(
        toml.parent, name="labels2.toml"
    )  # 台帳は素材ごと（行が manifest に解決すること）
    with toml.open("a") as handle:
        handle.write("\n" + self_block("own2", "private/sf2", labels=led2))
    with pytest.raises(TrainError, match="学習側と評価側"):
        train_l0.build(toml, root=root, run="r1", seed=7)


def test_leak1a_evalの素材のtrainの走行を背景にしたSデータ(tmp_path):
    root, toml = world(tmp_path)
    text = toml.read_text().replace(
        'name = "own"\nkind = "self"\npath = "private/sf"\nlicense = "self"\nuse = "train"',
        'name = "own"\nkind = "self"\npath = "private/sf"\nlicense = "self"\nuse = "eval"',
    )
    toml.write_text(text)
    with pytest.raises(TrainError, match="学習側と評価側"):
        train_l0.build(toml, root=root, run="r1", seed=7)


# SRC-2a
@pytest.mark.parametrize(
    ("extra", "msg"),
    [
        ("negative_every = 0", "negative_every"),
        ("negative_every = -1", "negative_every"),
        ("negative_every = 1.5", "negative_every"),
        ("negative_every = true", "negative_every"),
        ('footage = "x"', "知らないキー"),
        ('reviewed = "x"', "知らないキー"),
    ],
)
def test_src2a_selfのキーの誤り(tmp_path, extra, msg):
    root, toml = world(tmp_path, synth=False)
    toml.write_text(self_block("own", "private/sf") + extra + "\n")
    with pytest.raises(TrainError, match=msg):
        train_l0.load_sources(toml, root=root)


def test_src2a_kindごとのキーとlicense(tmp_path):
    root, toml = world(tmp_path, synth=False)
    cases = [
        (commons(root) + 'labels = "labels.toml"\n', "知らないキー"),
        (
            block("n", "negatives", "private/neg", "CC-BY-SA", "eval") + "negative_every = 2\n",
            "知らないキー",
        ),
        (self_block("own", "private/sf").replace('license = "self"', 'license = "CC0"'), "license"),
        (self_block("own", "private/sf", labels="../labels.toml"), "labels"),
        (self_block("own", "private/sf", labels="none.toml"), "labels"),
        (block("own", "self", "private/sf", "self", "train"), "labels"),
    ]
    for text, msg in cases:
        toml.write_text(text)
        with pytest.raises(TrainError, match=msg):
            train_l0.load_sources(toml, root=root)
    (toml.parent / "link.toml").symlink_to(toml.parent / "labels.toml")
    toml.write_text(self_block("own", "private/sf", labels="link.toml"))
    with pytest.raises(TrainError, match="リンク"):
        train_l0.load_sources(toml, root=root)


# ---------------------------------------------------------------- UC-9 後処理と連続した誤報


def factory_by_name(preds: dict[str, list]):
    def factory(model: Path) -> train_l0.Detector:
        def detect(frame: np.ndarray, image: Path) -> list:
            return preds.get(image.name.split("__", 1)[1].rsplit(".", 1)[0], [])

        return train_l0.Detector(names=("deer",), detect=detect)

    return factory


def eval_world(tmp_path: Path, preds: dict[str, list]) -> dict:
    root, toml = world(tmp_path, synth=False)
    run = train_l0.build(toml, root=root, run="r1", seed=7)
    model = tmp_path / "m.pt"
    model.write_bytes(b"weights")
    out = train_l0.evaluate(
        model, run, out_dir=tmp_path / "eval", factory=factory_by_name(preds), reader=read_any
    )
    return json.loads(out.read_text())


BIG = (0.5, 0.5, 0.95, 0.95)  # 規則 a（面積 0.7 以上）で後処理が除く
SMALL = (0.5, 0.5, 0.1, 0.1)


# EV-2a・EV-2c
def test_ev2a_後処理ありとなしと3つの閾値(tmp_path):
    r = eval_world(
        tmp_path,
        {
            "d3-deer_f000020": [(0.9, (0.5, 0.5, 0.2, 0.6))],  # 正解 (40,10)-(60,40)
            "d3-deer_f000030": [(0.85, BIG)],
            "1000": [(0.5, BIG)],
        },
    )
    raw, filt = r["eval"], r["fp_filter"]["eval"]
    assert set(raw) == {"0.25", "0.4", "0.8"}
    assert raw["0.25"]["total"]["tp"] == 1 and filt["0.25"]["total"]["tp"] == 1
    assert raw["0.25"]["by_source"]["neg"]["negative_images_with_detection"] == 1
    assert filt["0.25"]["by_source"]["neg"]["negative_images_with_detection"] == 0
    assert raw["0.8"]["by_source"]["own"]["fp"] == 1 and filt["0.8"]["by_source"]["own"]["fp"] == 0
    assert r["filter_config"]["max_area"] == 0.7 and r["filter_config"]["ignore_regions"] == []
    assert r["model_sha256"] == sha(b"weights")


def test_ev2a_動画はtの順に流して続きが効く(tmp_path):
    # 小さい枠のあとに同じ場所の大きい枠 → 「続き」で除かない（3 秒以内）
    near = (0.5, 0.5, 0.86, 0.86)  # 面積 0.74
    r = eval_world(
        tmp_path,
        {
            "d3-deer_f000020": [(0.9, (0.5, 0.5, 0.6, 0.6))],
            "d3-deer_f000022": [(0.9, near)],
        },
    )
    assert (
        r["fp_filter"]["eval"]["0.25"]["by_source"]["own"]["fp"]
        == r["eval"]["0.25"]["by_source"]["own"]["fp"]
    )


def test_ev2c_弱めた確信度に閾値を当てる(tmp_path, monkeypatch):
    from detector.config import L0FilterConfig

    monkeypatch.setattr(train_l0, "FILTER", L0FilterConfig(ignore_regions=((0.0, 0.0, 1.0, 1.0),)))
    r = eval_world(tmp_path, {"1000": [(0.6, SMALL)]})
    assert r["eval"]["0.4"]["by_source"]["neg"]["fp"] == 1
    assert r["fp_filter"]["eval"]["0.4"]["by_source"]["neg"]["fp"] == 0  # 0.6 × 0.5 = 0.3
    assert r["fp_filter"]["eval"]["0.25"]["by_source"]["neg"]["fp"] == 1


# EV-2b
def test_ev2b_連続した誤報(tmp_path):
    hit = [(0.5, SMALL)]
    r = eval_world(
        tmp_path,
        {
            # val の d2-day（0・10・20）: 3 枚続く → 1 回
            "d2-day_f000000": hit,
            "d2-day_f000010": hit,
            "d2-day_f000020": hit,
            # eval の d3-deer の鹿なし（0・10 は隣、30 は間が空く）: 0 だけ → 0 回、30 だけ → 0 回
            "d3-deer_f000000": hit,
            "d3-deer_f000030": hit,
        },
    )
    val = r["fp_runs"]["val"]["raw"]["0.25"]["total"]
    assert val["frames"] == 3 and val["seconds"] == pytest.approx(3.0)
    assert val["runs"] == 1 and val["runs_per_min"] == pytest.approx(20.0)
    assert val["frames_with_detection"] == 3
    ev = r["fp_runs"]["eval"]["raw"]["0.25"]["total"]
    assert ev["frames"] == 3  # 0・10・30（鹿ありの 20・22 は入れない）
    assert ev["runs"] == 0 and ev["frames_with_detection"] == 2
    assert r["fp_runs"]["eval"]["raw"]["0.8"]["total"]["frames_with_detection"] == 0
    assert "近似" in r["fp_runs"]["note"]


def test_ev2b_鹿なしが無ければnull(tmp_path):
    r = eval_world(tmp_path, {})
    assert r["fp_runs"]["eval"]["raw"]["0.25"]["by_source"]["own"]["runs"] == 0
    root, toml = world(tmp_path / "b", synth=False)
    toml.write_text(commons(root))
    run = train_l0.build(toml, root=root, run="r1", seed=7)
    model = tmp_path / "b" / "m.pt"
    model.write_bytes(b"w")
    out = train_l0.evaluate(
        model, run, out_dir=tmp_path / "b/eval", factory=factory_by_name({}), reader=read_any
    )
    total = json.loads(out.read_text())["fp_runs"]["eval"]["raw"]["0.25"]["total"]
    assert total["runs_per_min"] is None and total["frames"] == 0


# ------------------------------------------------------- 学習の model card（CMP-1c の一部）


def test_card_重みのSHAと配布不可(tmp_path):
    root, toml = world(tmp_path)
    run = train_l0.build(toml, root=root, run="r1", seed=7)
    models = tmp_path / "models"
    models.mkdir()
    base = models / "base.pt"
    base.write_bytes(b"coco")
    train_l0.train(
        run,
        models_dir=models,
        name="m1",
        seed=1,
        base=base,
        trainer=FakeTrainer(),
        known_bases={sha(b"coco"): train_l0.Base("COCO", by_sa=False)},
        mps_available=lambda: False,
    )
    card = json.loads((models / "m1.json").read_text())
    assert card["sha256"] == sha(b"last")
    assert card["distribution"] == "not_allowed"
    assert card["train_images"] == manifest(run)["counts"]["train"]
