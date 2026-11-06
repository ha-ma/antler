"""dataset-train: 学習スクリプト（docs/specs/dataset-train）。

Ultralytics・CoreML・画像の読み込みは偽物。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest

import train_l0
from train_l0 import TrainError

REPO = Path(__file__).resolve().parents[2]
FIXTURE = REPO / "packages/schema/fixtures/capture/valid/ch7-example.json"
COCO_SHA = "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef"


# ---------------------------------------------------------------- 素材を作る道具


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def yolo_source(root: Path, rel: str, files: list[tuple], licenses: dict[str, str]) -> Path:
    """files: (分割, 動画, 名前, 箱の行のリスト or None=ラベルファイルなし)。manifest も書く。"""
    base = root / rel
    entries = []
    for split, video, name, rows in files:
        img = base / "images" / split / f"{name}.jpg"
        img.parent.mkdir(parents=True, exist_ok=True)
        data = f"img:{rel}:{name}".encode()
        img.write_bytes(data)
        label = base / "labels" / split / f"{name}.txt"
        if rows is not None:
            label.parent.mkdir(parents=True, exist_ok=True)
            label.write_text("".join(f"{r}\n" for r in rows))
        entries.append(
            {
                "image": f"images/{split}/{name}.jpg",
                "label": f"labels/{split}/{name}.txt",
                "video": video,
                "original_split": split,
                "sha256": sha(data),
            }
        )
    manifest = {
        "labels_note": "AI による目視の概算ラベル",
        "sources": {v: {"license": lic} for v, lic in licenses.items()},
        "files": entries,
    }
    (base / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False))
    return base


def capture(cid: str, **over: object) -> dict:
    cap = json.loads(FIXTURE.read_text())
    cap.update({"id": cid, "image": f"captures/{cid}.jpg"}, **over)
    return cap


def api_capture(folder: Path, cap: dict, data: bytes | None = None) -> Path:
    folder.mkdir(parents=True, exist_ok=True)
    key = cap["id"].lower()
    data = data if data is not None else f"cap:{key}".encode()
    file = f"{key}-{sha(data)[:12]}.jpg"
    (folder / file).write_bytes(data)
    stored = {"capture": cap, "file": file, "bodyHash": "x", "receivedAt": "2026-11-06T00:00:00Z"}
    (folder / f"{key}.json").write_text(json.dumps(stored))
    return folder / file


def edge_capture(folder: Path, cap: dict, data: bytes | None = None) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{cap['id']}.jpg").write_bytes(
        data if data is not None else b"e:" + cap["id"].encode()
    )
    (folder / f"{cap['id']}.json").write_text(json.dumps(cap))


def sources_toml(root: Path, *blocks: str) -> Path:
    path = root / "train_sources.toml"
    path.write_text("\n".join(blocks))
    return path


def block(name: str, kind: str, path: str, lic: str, use: str, reviewed: str | None = None) -> str:
    text = f'[[source]]\nname = "{name}"\nkind = "{kind}"\npath = "{path}"\n'
    text += f'license = "{lic}"\nuse = "{use}"\n'
    if reviewed is not None:
        text += f'reviewed = "{reviewed}"\n'
    return text


BOX = "0 0.5 0.5 0.2 0.2"


def commons(root: Path) -> str:
    yolo_source(
        root,
        "external/c",
        [
            ("train", "V002", "V002_00", [BOX]),
            ("train", "V002", "V002_01", []),
            ("train", "V009", "V009_00", [BOX]),
            ("val", "V003", "V003_00", [BOX, "0 0.2 0.3 0.1 0.1"]),
            ("test", "V010", "V010_00", [BOX]),
        ],
        {"V002": "CC0 1.0", "V009": "CC BY 4.0", "V003": "CC BY 2.0", "V010": "CC0 1.0"},
    )
    return block("commons", "yolo", "external/c", "CC-BY", "train")


def by_sa(root: Path) -> str:
    yolo_source(
        root,
        "private/sa",
        [("train", "V006", "V006_00", [BOX]), ("test", "V001", "V001_00", [])],
        {"V006": "CC BY-SA 4.0", "V001": "CC BY-SA 3.0"},
    )
    return block("by-sa", "yolo", "private/sa", "CC-BY-SA", "eval")


def build(root: Path, toml: Path, run: str = "r1", seed: int = 7, **kw: object) -> Path:
    return train_l0.build(toml, root=root, run=run, seed=seed, **kw)


def manifest(run_dir: Path) -> dict:
    return json.loads((run_dir / "manifest.json").read_text())


# ---------------------------------------------------------------- AC-1


class FakeTrainer:
    def __init__(self) -> None:
        self.calls: list[tuple[Path, dict]] = []

    def __call__(self, base: Path, args: dict) -> train_l0.TrainResult:
        self.calls.append((base, args))
        weights = Path(args["project"]) / "train" / "weights"
        weights.mkdir(parents=True)
        (weights / "best.pt").write_bytes(b"best")
        (weights / "last.pt").write_bytes(b"last")
        return train_l0.TrainResult(last=weights / "last.pt", version="8.4.202")


class FakeExporter:
    def __init__(self) -> None:
        self.calls: list[tuple[Path, dict]] = []

    def __call__(self, weights: Path, args: dict) -> Path:
        self.calls.append((weights, args))
        out = weights.with_suffix(".mlpackage")
        out.mkdir()
        (out / "Manifest.json").write_text("{}")
        return out


def fake_factory(preds: dict[str, list[tuple[float, tuple]]], names: tuple[str, ...] = ("deer",)):
    seen: list[tuple[int, ...]] = []

    def factory(model: Path) -> train_l0.Detector:
        def detect(frame: np.ndarray, image: Path) -> list[tuple[float, tuple]]:
            seen.append(frame.shape)
            return preds.get(image.name.split("__", 1)[1].rsplit(".", 1)[0], [])

        return train_l0.Detector(names=names, detect=detect)

    return factory, seen


def read_any(path: Path) -> np.ndarray:
    return np.zeros((720, 1280, 3), dtype=np.uint8)


# AC-1
def test_ac1_データループが1周回る(tmp_path):
    root = tmp_path / "dataset"
    caps = root / "private/caps"
    reviewed = [f"cap_{i:012x}" for i in range(1, 6)]
    for i, cid in enumerate(reviewed[:3]):
        api_capture(caps, capture(cid, createdAt=f"2026-11-0{i + 1}T10:00:00+09:00"))
    api_capture(caps, capture(reviewed[3], consent=False))
    api_capture(caps, capture(reviewed[4], source="vehicle"))
    model_box = {"label": "deer", "xywh": [0.1, 0.1, 0.2, 0.2], "by": "model"}
    edge_capture(caps / "edge", capture("cap_00000000aaaa", boxes=[model_box]))
    api_capture(caps, capture("cap_notreviewed"))
    (root / "private/reviewed.txt").write_text("\n".join([*reviewed, "cap_00000000aaaa"]))
    toml = sources_toml(
        root,
        commons(root),
        by_sa(root),
        block("caps", "capture", "private/caps", "self", "train", "private/reviewed.txt"),
        block("caps-edge", "capture", "private/caps/edge", "self", "train", "private/reviewed.txt"),
    )
    run = build(root, toml)
    m = manifest(run)
    assert m["sources"]["caps"]["skipped"] == {
        "no_consent": 1,
        "vehicle_pending": 1,
        "not_reviewed": 1,
    }
    assert m["sources"]["caps-edge"]["skipped"] == {"no_user_box": 1}
    train_side = [f for f in m["files"] if f["split"] in ("train", "val")]
    assert all(f["source"] not in ("by-sa",) for f in train_side)
    assert {f["source"] for f in train_side} == {"commons", "caps"}
    assert sum(f["source"] == "caps" for f in train_side) == 3

    models = tmp_path / "models"
    models.mkdir()
    base = models / "base.pt"
    base.write_bytes(b"coco")
    known = {sha(b"coco"): train_l0.Base("COCO（テスト）", by_sa=False)}
    trainer = FakeTrainer()
    pt = train_l0.train(
        run,
        models_dir=models,
        name="deer-a",
        seed=3,
        base=base,
        trainer=trainer,
        known_bases=known,
        mps_available=lambda: True,
    )
    assert pt.read_bytes() == b"last"
    card = json.loads((models / "deer-a.json").read_text())
    assert card["base"]["by_sa"] is False and card["seed"] == 3

    verified: list[Path] = []
    ml = train_l0.export(pt, exporter=FakeExporter(), verify=verified.append)
    assert ml == models / "deer-a.mlpackage" and verified == [ml]

    factory, seen = fake_factory({"V003_00": [(0.9, (0.5, 0.5, 0.2, 0.2))]})
    out = train_l0.evaluate(ml, run, out_dir=tmp_path / "eval", factory=factory, reader=read_any)
    report = json.loads(out.read_text())
    assert report["val"]["0.25"]["total"]["tp"] == 1
    assert report["eval"]["0.25"]["total"]["fn"] == 2  # commons の test と by-sa の V006
    assert set(seen) == {(480, 640, 3)}


# ---------------------------------------------------------------- UC-1 素材の一覧


# SRC-1a
def test_src1a_一覧の誤りはキー名つきのエラー(tmp_path):
    root = tmp_path / "dataset"
    good = commons(root)
    cases = {
        "知らないキー": good + 'color = "red"\n',
        "kind": good.replace('kind = "yolo"', 'kind = "video"'),
        "license": good.replace('"CC-BY"', '"MIT"'),
        "use": good.replace('use = "train"', 'use = "test"'),
        "name": good.replace('"commons"', '"Commons"'),
    }
    for word, text in cases.items():
        with pytest.raises(TrainError, match=r"commons|Commons|source"):
            train_l0.load_sources(sources_toml(root, text), root=root)
        assert word
    with pytest.raises(TrainError, match="重複"):
        train_l0.load_sources(sources_toml(root, good, good), root=root)
    cap = block("caps", "capture", "external/c", "self", "train")
    with pytest.raises(TrainError, match="reviewed"):
        train_l0.load_sources(sources_toml(root, cap), root=root)


# SRC-1b
def test_src1b_BY_SAはevalだけ(tmp_path):
    root = tmp_path / "dataset"
    by_sa(root)
    with pytest.raises(TrainError, match="CC-BY-SA"):
        train_l0.load_sources(
            sources_toml(root, block("x", "yolo", "private/sa", "CC-BY-SA", "train")), root=root
        )
    assert train_l0.load_sources(sources_toml(root, by_sa(root)), root=root)[0].use == "eval"


# SRC-1c
def test_src1c_外を指すパスとリンクは拒否(tmp_path):
    root = tmp_path / "dataset"
    commons(root)
    outside = tmp_path / "outside"
    outside.mkdir()
    (root / "raw").mkdir()
    (root / "out").mkdir()
    for path in [str(outside), "../outside", "raw", "out", "external/none"]:
        with pytest.raises(TrainError, match="path"):
            train_l0.load_sources(
                sources_toml(root, block("x", "yolo", path, "CC-BY", "train")), root=root
            )
    alias = block("y", "yolo", "external/C", "CC-BY", "eval")
    if (root / "external/C").exists():  # 大文字小文字を区別しないファイルシステム（APFS）
        with pytest.raises(TrainError, match="同じ実体"):
            train_l0.load_sources(sources_toml(root, commons(root), alias), root=root)
    (root / "external/link").symlink_to(root / "private")
    with pytest.raises(TrainError, match="リンク"):
        train_l0.load_sources(
            sources_toml(root, block("z", "yolo", "external/link", "CC-BY", "train")), root=root
        )
    img = root / "external/c/images/train/V002_00.jpg"
    img.unlink()
    img.symlink_to(outside / "x.jpg")
    with pytest.raises(TrainError, match="リンク"):
        build(root, sources_toml(root, commons(root).replace("external/c", "external/c")))


# ---------------------------------------------------------------- UC-2 YOLO


# YOLO-1a
def test_yolo1a_分割と評価側と負例(tmp_path):
    root = tmp_path / "dataset"
    run = build(root, sources_toml(root, commons(root), by_sa(root)))
    m = manifest(run)
    split = {f["name"]: f["split"] for f in m["files"]}
    assert split["V002_00.jpg"] == "train" and split["V003_00.jpg"] == "val"
    assert split["V010_00.jpg"] == "eval" and split["V006_00.jpg"] == "eval"
    assert (run / "labels/train/commons__V002_01.txt").read_text() == ""
    assert (run / "images/train/commons__V002_01.jpg").exists()
    assert m["counts"] == {"train": 3, "val": 1, "eval": 3}


# YOLO-1b
def test_yolo1b_ラベルの誤り(tmp_path):
    root = tmp_path / "dataset"
    toml = sources_toml(root, commons(root))
    label = root / "external/c/labels/train/V002_00.txt"
    for bad in ["1 0.5 0.5 0.2 0.2", "0 1.2 0.5 0.2 0.2", "0 0.5 0.5 0 0.2", "0 0.5 0.5 0.2"]:
        label.write_text(bad + "\n")
        with pytest.raises(TrainError, match=r"V002_00\.txt:1"):
            build(root, toml, run=f"r{abs(hash(bad)) % 1000}")
    label.unlink()
    with pytest.raises(TrainError, match="ラベルファイルが無い"):
        build(root, toml)
    label.write_text(BOX + "\n")
    (root / "external/c/labels/train/ghost.txt").write_text(BOX + "\n")
    with pytest.raises(TrainError, match="画像の無いラベル"):
        build(root, toml)
    (root / "external/c/labels/train/ghost.txt").unlink()
    (root / "external/c/images/train/x.png").write_bytes(b"png")
    with pytest.raises(TrainError, match="jpg"):
        build(root, toml)


# YOLO-1c
def test_yolo1c_manifestとSHAとライセンスの照合(tmp_path):
    root = tmp_path / "dataset"
    toml = sources_toml(root, commons(root))
    extra = root / "external/c/images/train/V002_99.jpg"
    extra.write_bytes(b"new")
    (root / "external/c/labels/train/V002_99.txt").write_text("")
    with pytest.raises(TrainError, match="manifest に無い"):
        build(root, toml)
    extra.unlink()
    (root / "external/c/labels/train/V002_99.txt").unlink()
    img = root / "external/c/images/train/V002_00.jpg"
    img.write_bytes(b"changed")
    with pytest.raises(TrainError, match="SHA-256"):
        build(root, toml)
    img.unlink()
    with pytest.raises(TrainError, match="manifest にあって無い"):
        build(root, toml)

    root2 = tmp_path / "d2"
    by_sa(root2)
    lie = sources_toml(root2, block("lie", "yolo", "private/sa", "CC-BY", "train"))
    with pytest.raises(TrainError, match="CC-BY-SA"):
        build(root2, lie)
    honest = sources_toml(root2, by_sa(root2))
    m = json.loads((root2 / "private/sa/manifest.json").read_text())
    m["sources"]["V006"]["license"] = "All rights reserved"
    (root2 / "private/sa/manifest.json").write_text(json.dumps(m))
    with pytest.raises(TrainError, match="分類できない"):
        build(root2, honest)
    root3 = tmp_path / "d3"
    commons(root3)
    perm = sources_toml(root3, block("p", "yolo", "external/c", "permission", "train"))
    with pytest.raises(TrainError, match="permission"):
        build(root3, perm)


# ---------------------------------------------------------------- UC-3 Capture


def caps_root(tmp_path: Path, ids: list[str]) -> tuple[Path, Path]:
    root = tmp_path / "dataset"
    (root / "private").mkdir(parents=True, exist_ok=True)
    (root / "private/reviewed.txt").write_text("\n".join(ids))
    return root, root / "private/caps"


def caps_toml(root: Path, use: str = "train", path: str = "private/caps") -> Path:
    return sources_toml(
        root, commons(root), block("caps", "capture", path, "self", use, "private/reviewed.txt")
    )


# CAP-1a
def test_cap1a_apiとedgeの置き方_imageは使わない(tmp_path):
    root, caps = caps_root(tmp_path, ["cap_a1", "cap_0000000000b1"])
    api_capture(caps, capture("cap_A1", image="/etc/passwd.jpg"))
    edge_capture(caps, capture("cap_0000000000b1"))
    (caps / "cap_orphan-000000000000.jpg").write_bytes(b"orphan")
    m = manifest(build(root, caps_toml(root)))
    ids = sorted(f["capture"]["id"] for f in m["files"] if f["source"] == "caps")
    assert ids == ["cap_0000000000b1", "cap_A1"]
    assert m["sources"]["caps"]["skipped"] == {}


# CAP-1b
def test_cap1b_使わないCaptureを理由ごとに数える(tmp_path):
    ids = [f"cap_{i:012x}" for i in range(1, 9)]
    root, caps = caps_root(tmp_path, ids)
    api_capture(caps, capture(ids[0]))
    api_capture(caps, capture(ids[1], consent=False))
    api_capture(caps, capture(ids[2], distanceM="far"))
    api_capture(caps, capture(ids[3], source="vehicle"))
    api_capture(
        caps, capture(ids[4], boxes=[{"label": "deer", "xywh": [0, 0, 0.1, 0.1], "by": "model"}])
    )
    gone = api_capture(caps, capture(ids[5]))
    gone.unlink()
    api_capture(caps, capture("cap_unknown"))
    edge_capture(caps, capture(ids[6]), data=b"cap:" + ids[0].encode())  # 同じ画像
    mixed = [
        {"label": "deer", "xywh": [0.1, 0.1, 0.2, 0.2], "by": "model"},
        {"label": "deer", "xywh": [0.5, 0.5, 0.2, 0.2], "by": "user"},
    ]
    api_capture(caps, capture(ids[7], boxes=mixed))
    m = manifest(build(root, caps_toml(root)))
    assert m["sources"]["caps"]["skipped"] == {
        "no_consent": 1,
        "invalid": 1,
        "vehicle_pending": 1,
        "no_user_box": 1,
        "no_image": 1,
        "not_reviewed": 1,
        "duplicate": 1,
    }
    used = [f for f in m["files"] if f["source"] == "caps"]
    assert sorted(f["capture"]["id"] for f in used) == [ids[0], ids[7]]
    lbl = next(f for f in used if f["capture"]["id"] == ids[7])
    run = tmp_path / "dataset/out/train/r1"
    text = (run / "labels" / lbl["split"] / (Path(lbl["file"]).stem + ".txt")).read_text()
    assert text.strip() == "0 0.6 0.6 0.2 0.2"


# CAP-1c
def test_cap1c_角を切ってから中心基準に():
    assert train_l0.tl_to_center([0.31, 0.49, 0.1, 0.14]) == pytest.approx((0.36, 0.56, 0.1, 0.14))
    assert train_l0.tl_to_center([0.9, 0.5, 0.3, 0.2]) == pytest.approx((0.95, 0.6, 0.1, 0.2))
    assert train_l0.tl_to_center([1.0, 0.5, 0.0, 0.2]) is None
    assert train_l0.tl_to_center([0.95, 0.0, 0.05, 0.0]) is None


# CAP-1d
def test_cap1d_日本時間の日付のグループで分ける():
    assert train_l0.capture_group("sim", "2026-11-07T08:55:00+09:00") == train_l0.capture_group(
        "sim", "2026-11-07T00:05:00Z"
    )
    assert train_l0.capture_group("sim", "2026-11-06T23:59:00Z") == "sim:2026-11-07"
    one = train_l0.val_groups(["a"], seed=7, ratio=0.2)
    assert one == set()
    two = train_l0.val_groups(["a", "b"], seed=7, ratio=0.2)
    assert len(two) == 1
    five = [f"g{i}" for i in range(5)]
    for seed in range(20):
        assert len(train_l0.val_groups(five, seed=seed, ratio=0.2)) == 1
    assert train_l0.val_groups(five, seed=3, ratio=0.2) == train_l0.val_groups(five, 3, 0.2)


def test_cap1d_グループ1つならvalなしと書く(tmp_path):
    root, caps = caps_root(tmp_path, ["cap_000000000001", "cap_000000000002"])
    api_capture(caps, capture("cap_000000000001"))
    api_capture(caps, capture("cap_000000000002"))
    m = manifest(build(root, caps_toml(root)))
    assert {f["split"] for f in m["files"] if f["source"] == "caps"} == {"train"}
    assert any("val なし" in n for n in m["notes"])


# CAP-1e
def test_cap1e_パスの決まりに合わないものはbad_path(tmp_path):
    ids = ["cap_000000000001", "cap_000000000002", "cap_000000000003", "cap_000000000004"]
    root, caps = caps_root(tmp_path, [*ids, "cap_000000000005", "cap_x"])
    api_capture(caps, capture(ids[0]))
    stored = json.loads((caps / f"{ids[0]}.json").read_text())
    stored["capture"]["id"] = ids[1]  # key と id が違う
    (caps / f"{ids[0]}.json").write_text(json.dumps(stored))
    api_capture(caps, capture(ids[2]))
    stored = json.loads((caps / f"{ids[2]}.json").read_text())
    stored["file"] = "../reviewed.txt"
    (caps / f"{ids[2]}.json").write_text(json.dumps(stored))
    img = api_capture(caps, capture(ids[3]))
    img.write_bytes(b"swapped")  # SHA の先頭 12 桁が合わない
    edge_capture(caps / "e", capture("cap_000000000005", id="cap_000000000006"))
    (caps / "e/cap_000000000006.json").replace(caps / "e/cap_000000000005.json")
    (caps / "e/cap_000000000005.jpg").write_bytes(b"x")
    real = api_capture(tmp_path / "elsewhere", capture("cap_x"))
    (caps / "cap_x.json").write_text((tmp_path / "elsewhere/cap_x.json").read_text())
    (caps / real.name).symlink_to(real)
    toml = sources_toml(
        root,
        commons(root),
        block("caps", "capture", "private/caps", "self", "train", "private/reviewed.txt"),
        block("e", "capture", "private/caps/e", "self", "train", "private/reviewed.txt"),
    )
    with pytest.raises(TrainError, match="リンク"):
        build(root, toml)
    (caps / real.name).unlink()
    (caps / "cap_x.json").unlink()
    m = manifest(build(root, toml))
    assert m["sources"]["caps"]["skipped"] == {"bad_path": 3}
    assert m["sources"]["e"]["skipped"] == {"bad_path": 1}


# ---------------------------------------------------------------- UC-4 漏れと出力


# OUT-1a・S-1
def test_out1a_漏れと学習にならないデータ(tmp_path):
    root = tmp_path / "dataset"
    commons(root)
    yolo_source(root, "private/dup", [("test", "V002", "V002_00", [BOX])], {"V002": "CC0 1.0"})
    dup = block("dup", "yolo", "private/dup", "CC0", "eval")
    with pytest.raises(TrainError, match=r"SHA-256|グループ"):
        build(root, sources_toml(root, commons(root), dup))
    yolo_source(root, "private/grp", [("test", "V009", "V009_77", [BOX])], {"V009": "CC0 1.0"})
    grp = block("grp", "yolo", "private/grp", "CC0", "eval")
    with pytest.raises(TrainError, match="グループ"):
        build(root, sources_toml(root, commons(root), grp))
    root2 = tmp_path / "d2"
    yolo_source(
        root2, "e/x", [("train", "A", "A_0", []), ("val", "B", "B_0", [])], {"A": "CC0", "B": "CC0"}
    )
    with pytest.raises(TrainError, match="鹿の箱が 0"):
        build(root2, sources_toml(root2, block("x", "yolo", "e/x", "CC0", "train")))
    root3 = tmp_path / "d3"
    yolo_source(root3, "e/x", [("train", "A", "A_0", [BOX])], {"A": "CC0"})
    with pytest.raises(TrainError, match="val"):
        build(root3, sources_toml(root3, block("x", "yolo", "e/x", "CC0", "train")))
    root4 = tmp_path / "d4"
    yolo_source(
        root4, "e/x", [("train", "A", "A_0", [BOX]), ("val", "A", "A_1", [BOX])], {"A": "CC0"}
    )
    with pytest.raises(TrainError, match="グループ"):
        build(root4, sources_toml(root4, block("x", "yolo", "e/x", "CC0", "train")))
    assert not (root4 / "out/train/r1").exists()


# OUT-1b
def test_out1b_yamlとmanifest(tmp_path):
    root, caps = caps_root(tmp_path, ["cap_000000000001"])
    api_capture(caps, capture("cap_000000000001"))
    toml = caps_toml(root)
    run = build(root, toml)
    yaml = (run / "dataset.yaml").read_text()
    assert f"path: {run.resolve()}" in yaml and "0: deer" in yaml
    assert "train: images/train" in yaml and "val: images/val" in yaml
    m = manifest(run)
    assert m["labels_note"] == {"commons": "AI による目視の概算ラベル"}
    f = next(f for f in m["files"] if f["source"] == "caps")
    assert f["capture"] == {"id": "cap_000000000001", "source": "sim", "date": "2027-02-15"}
    assert f["license"] == "self" and len(f["sha256"]) == 64
    assert "R241" not in (run / "manifest.json").read_text()
    again = manifest(build(root, toml, run="r2"))
    for d in (m, again):
        d.pop("created")
    assert m == again


# OUT-1c・S-2
def test_out1c_上書きしない_作りかけを残さない(tmp_path):
    root = tmp_path / "dataset"
    toml = sources_toml(root, commons(root))
    build(root, toml)
    with pytest.raises(TrainError, match="既にある"):
        build(root, toml)
    for bad in ["R1", "../x", "a/b", ""]:
        with pytest.raises(TrainError, match="run"):
            build(root, toml, run=bad)
    (root / "external/c/labels/val/V003_00.txt").write_text("9 0 0 0 0\n")
    with pytest.raises(TrainError):
        build(root, toml, run="r9")
    assert not (root / "out/train/r9").exists()


def test_out1c_出力の名前の衝突():
    def item(name: str, split: str, digest: str) -> train_l0.Item:
        return train_l0.Item(
            "x",
            split,
            f"yolo:{split}",
            Path(name),
            name,
            name,
            digest,
            "CC0",
            ((0.5, 0.5, 0.2, 0.2),),
        )

    # Linux では a.jpg と A.jpg を同じフォルダに置ける。APFS ではコピーが上書きし合う
    with pytest.raises(TrainError, match="衝突"):
        train_l0.check_leaks(
            [item("a.jpg", "train", "1"), item("A.jpg", "train", "2"), item("b.jpg", "val", "3")]
        )
    train_l0.check_leaks([item("a.jpg", "train", "1"), item("b.jpg", "val", "3")])


# ---------------------------------------------------------------- UC-5 学習


def trained(tmp_path: Path, **kw: object) -> tuple[Path, Path, FakeTrainer]:
    root = tmp_path / "dataset"
    run = build(root, sources_toml(root, commons(root)))
    models = tmp_path / "models"
    models.mkdir(exist_ok=True)
    base = models / "base.pt"
    base.write_bytes(b"coco")
    trainer = FakeTrainer()
    known = {sha(b"coco"): train_l0.Base("COCO（テスト）", by_sa=False)}
    args = {
        "name": "deer-a",
        "seed": 3,
        "base": base,
        "known_bases": known,
        "mps_available": lambda: False,
        **kw,
    }
    return run, models, trainer, args


# TR-1a
def test_tr1a_学習器に渡す引数とmodel_card(tmp_path):
    run, models, trainer, args = trained(tmp_path)
    pt = train_l0.train(run, models_dir=models, trainer=trainer, epochs=5, batch=4, **args)
    base, passed = trainer.calls[0]
    assert base == models / "base.pt"
    assert passed["data"] == str(run / "dataset.yaml")
    assert passed["project"] == str(run / "ultralytics")
    assert passed | {} == passed and passed["seed"] == 3 and passed["epochs"] == 5
    assert passed["imgsz"] == 640 and passed["batch"] == 4 and passed["device"] == "cpu"
    assert passed["plots"] is False and passed["deterministic"] is True
    assert pt == models / "deer-a.pt" and pt.read_bytes() == b"last"
    card = json.loads((models / "deer-a.json").read_text())
    assert card["base"] == {
        "name": "base.pt",
        "sha256": sha(b"coco"),
        "origin": "COCO（テスト）",
        "by_sa": False,
    }
    assert card["manifest_sha256"] == sha((run / "manifest.json").read_bytes())
    assert card["weights"] == "last.pt" and card["ultralytics"] == "8.4.202"
    assert card["sources"] == [{"name": "commons", "license": "CC-BY", "use": "train"}]
    assert "MPS" in card["note"]
    assert str(tmp_path) not in json.dumps(card)


# TR-1b
def test_tr1b_上書きしない_元の重み_名前_device(tmp_path):
    run, models, trainer, args = trained(tmp_path)
    for ext in (".pt", ".json", ".mlpackage"):
        (models / f"deer-a{ext}").write_text("x")
        with pytest.raises(TrainError, match="既にある"):
            train_l0.train(run, models_dir=models, trainer=trainer, **args)
        (models / f"deer-a{ext}").unlink()
    with pytest.raises(TrainError, match="名前"):
        train_l0.train(run, models_dir=models, trainer=trainer, **{**args, "name": "../x"})
    with pytest.raises(TrainError, match="元の重み"):
        train_l0.train(
            run, models_dir=models, trainer=trainer, **{**args, "base": models / "no.pt"}
        )
    assert train_l0.pick_device("auto", lambda: True) == "mps"
    assert train_l0.pick_device("auto", lambda: False) == "cpu"
    assert train_l0.pick_device("cpu", lambda: True) == "cpu"
    assert trainer.calls == []


# TR-1c・REV-1（*.cache）
def test_tr1c_buildのあとの改変と元の重みの出所(tmp_path):
    run, models, trainer, args = trained(tmp_path)
    extra = run / "images/train/commons__extra.jpg"
    extra.write_bytes(b"x")
    with pytest.raises(TrainError, match="manifest"):
        train_l0.train(run, models_dir=models, trainer=trainer, **args)
    extra.unlink()
    (run / "labels/train.cache").write_bytes(b"ultralytics")  # 学習で書かれるものは数えない
    img = run / "images/train/commons__V002_00.jpg"
    keep = img.read_bytes()
    img.write_bytes(b"swapped")
    with pytest.raises(TrainError, match="SHA-256"):
        train_l0.train(run, models_dir=models, trainer=trainer, **args)
    img.write_bytes(keep)
    yaml = run / "dataset.yaml"
    text = yaml.read_text()
    yaml.write_text(text.replace(str(run.resolve()), "/elsewhere"))
    with pytest.raises(TrainError, match=r"dataset\.yaml"):
        train_l0.train(run, models_dir=models, trainer=trainer, **args)
    yaml.write_text(text)
    deer = {sha(b"coco"): train_l0.Base("deer", by_sa=True)}
    with pytest.raises(TrainError, match="allow-by-sa-base"):
        train_l0.train(run, models_dir=models, trainer=trainer, **{**args, "known_bases": deer})
    with pytest.raises(TrainError, match="出所"):
        train_l0.train(run, models_dir=models, trainer=trainer, **{**args, "known_bases": {}})
    assert trainer.calls == []
    train_l0.train(
        run,
        models_dir=models,
        trainer=trainer,
        allow_by_sa_base=True,
        **{**args, "known_bases": deer},
    )
    assert json.loads((models / "deer-a.json").read_text())["base"]["by_sa"] is True
    assert set(train_l0.KNOWN_BASES) >= {COCO_SHA}


# ---------------------------------------------------------------- UC-6 書き出し


# EXP-1a
def test_exp1a_NMS付きで書き出してL0で確かめる(tmp_path):
    models = tmp_path / "models"
    models.mkdir()
    pt = models / "deer-a.pt"
    pt.write_bytes(b"w")
    exporter = FakeExporter()
    seen: list[Path] = []
    ml = train_l0.export(pt, exporter=exporter, verify=seen.append)
    weights, args = exporter.calls[0]
    assert weights.parent != models  # 一時フォルダで書き出す
    assert args == {"format": "coreml", "nms": True, "imgsz": [480, 640], "conf": 0.25, "iou": 0.7}
    assert ml == models / "deer-a.mlpackage" and (ml / "Manifest.json").exists()
    assert seen == [ml]


# EXP-1b
def test_exp1b_閾値_上書き_確かめの失敗(tmp_path):
    models = tmp_path / "models"
    models.mkdir()
    pt = models / "deer-a.pt"
    pt.write_bytes(b"w")
    exporter = FakeExporter()
    with pytest.raises(TrainError, match="min_conf"):
        train_l0.export(pt, conf=0.5, exporter=exporter, verify=lambda p: None)
    (models / "deer-a.mlpackage").mkdir()
    with pytest.raises(TrainError, match="既にある"):
        train_l0.export(pt, exporter=exporter, verify=lambda p: None)
    assert exporter.calls == []
    (models / "deer-a.mlpackage").rmdir()

    def broken(path: Path) -> None:
        raise ValueError("CoreML の出力の形が違う")

    with pytest.raises(train_l0.VerifyError, match="形が違う"):
        train_l0.export(pt, exporter=exporter, verify=broken)
    assert (models / "deer-a.mlpackage").exists()


# ---------------------------------------------------------------- UC-7 評価


# EV-1a・REV-1（当て方の順）
def test_ev1a_当て方():
    gts = [(0.5, 0.5, 0.2, 0.2), (0.52, 0.5, 0.2, 0.2)]
    preds = [
        (0.6, (0.5, 0.5, 0.2, 0.2)),
        (0.9, (0.51, 0.5, 0.2, 0.2)),
        (0.25, (0.9, 0.9, 0.1, 0.1)),
    ]
    # 0.9 が先: IoU が最大の正解（2 つ目と同じくらい → 先の正解との比較）。0.6 は残りの正解へ
    assert train_l0.match(preds, gts, threshold=0.25) == (2, 0, 1)
    assert train_l0.match(preds, gts, threshold=0.4) == (2, 0, 0)
    assert train_l0.match([(0.24, (0.5, 0.5, 0.2, 0.2))], gts, threshold=0.25) == (0, 2, 0)
    same = [(0.5, (0.5, 0.5, 0.2, 0.2)), (0.5, (0.5, 0.5, 0.2, 0.2))]
    assert train_l0.match(same, [(0.5, 0.5, 0.2, 0.2)], threshold=0.25) == (1, 0, 1)
    assert train_l0.match([(0.9, (0.1, 0.1, 0.05, 0.05))], [], threshold=0.25) == (0, 0, 1)
    assert train_l0.rates(0, 0, 0) == {"recall": None, "precision": None}
    # IoU が同じなら先の正解へ当てる（逆にすると 2 つとも TP になる）
    g0, g1 = (0.375, 0.5, 0.25, 0.25), (0.625, 0.5, 0.25, 0.25)
    wide = (0.5, 0.5, 0.5, 0.25)  # g0・g1 とちょうど IoU 0.5
    assert train_l0.match([(0.9, wide), (0.5, g0)], [g0, g1], threshold=0.25) == (1, 1, 1)
    # 確信度が同じなら出てきた順（逆にすると g0 が先に g0 へ当たって 2 つとも TP になる）
    assert train_l0.match([(0.5, wide), (0.5, g0)], [g0, g1], threshold=0.25) == (1, 1, 1)


# EV-1b・REV-1（評価の画像の SHA）
def test_ev1b_評価側とvalを別々に数えJSONに書く(tmp_path):
    root = tmp_path / "dataset"
    run = build(root, sources_toml(root, commons(root), by_sa(root)))
    preds = {
        "V003_00": [(0.3, (0.5, 0.5, 0.2, 0.2))],
        "V001_00": [(0.8, (0.1, 0.1, 0.1, 0.1))],
        "V006_00": [(0.95, (0.5, 0.5, 0.2, 0.2))],
    }
    factory, seen = fake_factory(preds)
    model = tmp_path / "deer-a.pt"
    model.write_bytes(b"w")
    out = train_l0.evaluate(model, run, out_dir=tmp_path / "eval", factory=factory, reader=read_any)
    assert out.name == "deer-a.pt.r1.json"
    r = json.loads(out.read_text())
    assert r["val"]["0.25"]["total"] == {
        "tp": 1,
        "fn": 1,
        "fp": 0,
        "images": 1,
        "negative_images_with_detection": 0,
        "recall": 0.5,
        "precision": 1.0,
    }
    assert r["val"]["0.4"]["total"]["tp"] == 0
    assert r["eval"]["0.25"]["by_source"]["by-sa"]["negative_images_with_detection"] == 1
    assert r["eval"]["0.25"]["by_group"]["yolo:V006"]["tp"] == 1
    assert r["eval"]["0.25"]["by_group"]["yolo:V010"]["fn"] == 1
    assert r["labels_note"]["by-sa"] == "AI による目視の概算ラベル"
    assert r["preprocess"] == train_l0.PREPROCESS
    img = root / "private/sa/images/test/V001_00.jpg"
    img.write_bytes(b"changed")
    with pytest.raises(TrainError, match="manifest と違う"):
        train_l0.evaluate(model, run, out_dir=tmp_path / "e3", factory=factory, reader=read_any)
    assert set(seen) == {(480, 640, 3)}
    with pytest.raises(TrainError, match="既にある"):
        train_l0.evaluate(model, run, out_dir=tmp_path / "eval", factory=factory, reader=read_any)
    nodeer, _ = fake_factory({}, names=("person",))
    with pytest.raises(TrainError, match="deer"):
        train_l0.evaluate(model, run, out_dir=tmp_path / "e2", factory=nodeer, reader=read_any)


def test_resizeはL0と同じ最近傍():
    img = np.arange(4 * 6 * 3, dtype=np.uint8).reshape(4, 6, 3)
    out = train_l0.resize(img, (3, 2))
    assert out.shape == (2, 3, 3)
    assert (out[0, 0] == img[0, 0]).all() and (out[1, 2] == img[2, 4]).all()


# ---------------------------------------------------------------- CLI


def test_cli_エラーは2で終わり理由を出す(tmp_path, capsys):
    root = tmp_path / "dataset"
    toml = sources_toml(root, commons(root).replace("CC-BY", "CC-BY-SA").replace("eval", "train"))
    code = train_l0.main(
        ["build", "--sources", str(toml), "--root", str(root), "--run", "r1", "--seed", "1"]
    )
    assert code == 2
    assert "CC-BY-SA" in capsys.readouterr().err
    toml = sources_toml(root, commons(root))
    code = train_l0.main(
        ["build", "--sources", str(toml), "--root", str(root), "--run", "r1", "--seed", "1"]
    )
    assert code == 0
    assert "train 3" in capsys.readouterr().out


# REV-1（CLI の終了コード）
def test_cli_確かめの失敗は1で終わる(tmp_path, monkeypatch, capsys):
    def broken(weights, conf):
        raise train_l0.VerifyError("CoreML の出力の形が違う")

    monkeypatch.setattr(train_l0, "export", broken)
    assert train_l0.main(["export", "--weights", str(tmp_path / "x.pt")]) == 1
    assert "形が違う" in capsys.readouterr().err
    assert train_l0.main.__module__ == "train_l0"
