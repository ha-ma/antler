"""L0 の鹿の検出器の学習スクリプト（docs/specs/dataset-train）。

許可された素材 → 学習用データ（build）→ 再学習（train）→ CoreML（export）→ 評価（evaluate）。
素材の用途とライセンスは、一覧（train_sources.toml）の自己申告ではなく、実体のパスと素材の
manifest（SHA-256・動画ごとのライセンス）で確かめる。評価専用・同意なし・確かめていない素材を
学習側に入れない。Ultralytics・coremltools・画像の読み込みは extra `day0` の環境だけにあり、
差し替えられる薄い関数に閉じ込める（テストは偽物を渡す）。

    python dataset/train_l0.py build --run r1 --seed 7
    python dataset/train_l0.py train --run r1 --name yolo26n-deer-r1 --seed 7
    python dataset/train_l0.py export --weights edge/detector/models/yolo26n-deer-r1.pt
    python dataset/train_l0.py evaluate --run r1 \
        --model edge/detector/models/yolo26n-deer-r1.mlpackage
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import tomllib
from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Final

import numpy as np

from detector.config import TrackerConfig

if TYPE_CHECKING:
    from collections.abc import Callable, Iterable, Mapping, Sequence

HERE: Final = Path(__file__).resolve().parent
REPO: Final = HERE.parent
MODELS: Final = REPO / "edge/detector/models"
CAPTURE_SCHEMA: Final = REPO / "packages/schema/json/capture.schema.json"

NAME: Final = re.compile(r"^[a-z0-9][a-z0-9-]*$")
KINDS: Final = ("yolo", "capture")
LICENSES: Final = ("CC0", "CC-BY", "CC-BY-SA", "self", "permission")
USES: Final = ("train", "eval")
STRICTNESS: Final = {"CC0": 0, "CC-BY": 1, "CC-BY-SA": 2}
KEYS: Final = {"name", "kind", "path", "license", "use", "reviewed"}
JST: Final = timezone(timedelta(hours=9))
API_KEY: Final = re.compile(r"^cap_[a-z0-9]+$")
API_FILE: Final = re.compile(r"^(cap_[a-z0-9]+)-([0-9a-f]{12})\.(?:jpg|png)$")
EDGE_ID: Final = re.compile(r"^cap_[0-9a-f]{12}$")
THRESHOLDS: Final = (0.25, 0.4)
IOU: Final = 0.5
FRAME: Final = (640, 480)  # B2-1: L0 に渡るフレーム（幅, 高さ）
PREPROCESS: Final = "resize 640x480 → model input (L0; a 640x640 model is stretched)"
SPLITS: Final = ("train", "val")


class TrainError(Exception):
    """素材・引数・出力の誤り。何も書かずに止まる（main は exit 2）。"""


class VerifyError(Exception):
    """書き出した CoreML を L0 の読み込みで確かめられなかった（main は exit 1）。"""


@dataclass(frozen=True)
class Source:
    name: str
    kind: str
    path: Path  # 実体のパス
    rel: str  # dataset/ からの相対（一覧の値）
    license: str
    use: str
    reviewed: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Item:
    source: str
    split: str  # train / val / eval
    group: str  # <kind>:<グループ>
    image: Path
    origin: str  # dataset/ からの相対
    name: str  # 元のファイル名
    sha256: str
    license: str
    boxes: tuple[tuple[float, float, float, float], ...]
    capture: Mapping[str, str] | None = None

    @property
    def file(self) -> str:
        return f"{self.source}__{self.name}"


@dataclass
class Collected:
    items: list[Item] = field(default_factory=list)
    skipped: Counter[str] = field(default_factory=Counter)
    notes: list[str] = field(default_factory=list)
    labels_note: str | None = None


@dataclass(frozen=True)
class Base:
    origin: str
    by_sa: bool


@dataclass(frozen=True)
class TrainResult:
    last: Path
    version: str


@dataclass(frozen=True)
class Detector:
    names: tuple[str, ...]
    detect: Callable[[np.ndarray, Path], list[tuple[float, tuple[float, float, float, float]]]]


KNOWN_BASES: Final[dict[str, Base]] = {
    "9b09cc8bf347f0fc8a5f7657480587f25db09b34bf33b0652110fb03a8ad4fef": Base(
        "COCO の yolo26n.pt（Ultralytics v8.4.0 の配布物）", by_sa=False
    ),
    "55567b368cb739cba172fbfb93db3b5d301f42ac5608d342afc0b3fd2525f203": Base(
        "yolo26n-deer-20261105（外部の研究。V006〜V008 の CC BY-SA を学習に含む）", by_sa=True
    ),
}


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# ---------------------------------------------------------------- R1 素材の一覧


def _inside(path: Path, parent: Path) -> bool:
    return path == parent or parent in path.parents


def _no_links(start: Path, root: Path, label: str, *, walk: bool = True) -> None:
    """start から root までの各段と（walk なら）start の下のすべてに、リンクが無いこと。"""
    node = start
    while _inside(node, root) and node != root:
        if node.is_symlink():
            msg = f"{label}: path にシンボリックリンクがある（{node.name}）"
            raise TrainError(msg)
        node = node.parent
    if not walk:
        return
    for dirpath, dirnames, filenames in os.walk(start):
        for name in [*dirnames, *filenames]:
            if (Path(dirpath) / name).is_symlink():
                msg = f"{label}: 素材の中にシンボリックリンクがある（{name}）"
                raise TrainError(msg)


def load_sources(toml_path: Path, root: Path) -> list[Source]:
    try:
        data = tomllib.loads(toml_path.read_text(encoding="utf-8"))
    except (OSError, tomllib.TOMLDecodeError) as exc:
        msg = f"素材の一覧を読めない: {toml_path.name}"
        raise TrainError(msg) from exc
    if set(data) - {"source"} or not isinstance(data.get("source"), list):
        msg = "素材の一覧は [[source]] だけを書く"
        raise TrainError(msg)
    root = root.resolve()
    sources: list[Source] = []
    seen: dict[str, str] = {}
    stats: list[tuple[os.stat_result, str]] = []
    for raw in data["source"]:
        if not isinstance(raw, dict):
            msg = "素材の一覧の [[source]] が表でない"
            raise TrainError(msg)
        name = str(raw.get("name", ""))
        label = f"source {name!r}"
        if set(raw) - KEYS:
            msg = f"{label}: 知らないキー {sorted(set(raw) - KEYS)}"
            raise TrainError(msg)
        if not NAME.match(name):
            msg = f"{label}: name は英小文字・数字・- だけ"
            raise TrainError(msg)
        if name in seen:
            msg = f"{label}: name が重複している"
            raise TrainError(msg)
        seen[name] = name
        for key, allowed in (("kind", KINDS), ("license", LICENSES), ("use", USES)):
            if raw.get(key) not in allowed:
                msg = f"{label}: {key} は {', '.join(allowed)} のどれか"
                raise TrainError(msg)
        if raw["use"] == "train" and raw["license"] == "CC-BY-SA":
            msg = f"{label}: CC-BY-SA は ch6 の許可リストの外なので use = eval だけ"
            raise TrainError(msg)
        if raw["kind"] == "capture" and not isinstance(raw.get("reviewed"), str):
            msg = f"{label}: capture には reviewed（人が確かめた id の一覧）が要る"
            raise TrainError(msg)
        if raw["kind"] == "capture" and raw["license"] not in ("self", "permission"):
            msg = f"{label}: capture の license は self か permission"
            raise TrainError(msg)
        path = _source_path(root, raw.get("path"), label)
        st = path.stat()
        for other, other_name in stats:
            if (other.st_dev, other.st_ino) == (st.st_dev, st.st_ino):
                msg = f"{label}: path が素材 {other_name!r} と同じ実体"
                raise TrainError(msg)
        stats.append((st, name))
        reviewed: frozenset[str] = frozenset()
        if raw["kind"] == "capture":
            rpath = _source_path(root, raw["reviewed"], label, want_file=True)
            reviewed = frozenset(
                line.strip().lower() for line in rpath.read_text().splitlines() if line.strip()
            )
        sources.append(
            Source(name, raw["kind"], path, str(raw["path"]), raw["license"], raw["use"], reviewed)
        )
    return sources


def _source_path(root: Path, rel: object, label: str, *, want_file: bool = False) -> Path:
    if not isinstance(rel, str) or not rel or Path(rel).is_absolute():
        msg = f"{label}: path は dataset/ からの相対で書く"
        raise TrainError(msg)
    given = root / rel
    if given.is_symlink():
        msg = f"{label}: path にシンボリックリンクがある（{given.name}）"
        raise TrainError(msg)
    real = given.resolve()
    if not _inside(real, root) or any(_inside(real, root / x) for x in ("raw", "out")):
        msg = f"{label}: path が dataset/ の外か raw/・out/ の中（{rel}）"
        raise TrainError(msg)
    if not (real.is_file() if want_file else real.is_dir()):
        msg = f"{label}: path の置き場所が無い（{rel}）"
        raise TrainError(msg)
    _no_links(given, root, label, walk=not want_file)
    return real


# ---------------------------------------------------------------- R2 YOLO


def license_class(text: str) -> str:
    """manifest のライセンスの文字列 → CC0 / CC-BY / CC-BY-SA。"""
    t = text.strip().upper()
    if re.match(r"^CC0\b", t):
        return "CC0"
    if re.match(r"^CC[ -]BY[ -]SA\b", t):
        return "CC-BY-SA"
    if re.match(r"^CC[ -]BY(?:[ -][0-9.]+)?$", t):
        return "CC-BY"
    msg = f"ライセンスを分類できない: {text!r}"
    raise TrainError(msg)


def parse_label(path: Path) -> tuple[tuple[float, float, float, float], ...]:
    boxes = []
    for no, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        parts = line.split()
        where = f"{path.name}:{no}"
        try:
            values = [float(p) for p in parts]
        except ValueError as exc:
            raise TrainError(f"{where}: 数でない値") from exc
        if len(values) != 5:
            msg = f"{where}: 列は 5 つ（クラス cx cy w h）"
            raise TrainError(msg)
        if values[0] != 0:
            msg = f"{where}: クラスは 0（deer）だけ"
            raise TrainError(msg)
        cx, cy, w, h = values[1:]
        if not all(0.0 <= v <= 1.0 for v in (cx, cy, w, h)) or w <= 0 or h <= 0:
            msg = f"{where}: 座標は 0〜1、幅と高さは 0 より大きい"
            raise TrainError(msg)
        boxes.append((cx, cy, w, h))
    return tuple(boxes)


def collect_yolo(src: Source) -> Collected:
    label = f"source {src.name!r}"
    if src.license in ("self", "permission"):
        msg = f"{label}: {src.license} の YOLO の素材は manifest の書き方が決まるまで受けない"
        raise TrainError(msg)
    try:
        manifest = json.loads((src.path / "manifest.json").read_text(encoding="utf-8"))
        entries = {e["image"]: e for e in manifest["files"]}
        licenses = {v: s["license"] for v, s in manifest["sources"].items()}
    except (OSError, ValueError, KeyError, TypeError) as exc:
        msg = f"{label}: manifest.json を読めない"
        raise TrainError(msg) from exc
    images = sorted(p for p in (src.path / "images").rglob("*") if p.is_file())
    labels = {p.relative_to(src.path).as_posix() for p in (src.path / "labels").rglob("*.txt")}
    out = Collected(labels_note=manifest.get("labels_note"))
    classes = []
    for img in images:
        rel = img.relative_to(src.path).as_posix()
        if img.suffix != ".jpg":
            msg = f"{label}: 画像は .jpg だけ（{rel}）"
            raise TrainError(msg)
        entry = entries.pop(rel, None)
        if entry is None:
            msg = f"{label}: manifest に無い画像（{rel}）"
            raise TrainError(msg)
        digest = sha256_file(img)
        if digest != entry.get("sha256"):
            msg = f"{label}: SHA-256 が manifest と違う（{rel}）"
            raise TrainError(msg)
        lbl = entry.get("label", "")
        if lbl not in labels:
            msg = f"{label}: ラベルファイルが無い（{rel}）。負例は空のラベルファイルを置く"
            raise TrainError(msg)
        labels.discard(lbl)
        video = str(entry.get("video", ""))
        if video not in licenses:
            msg = f"{label}: 動画 {video!r} のライセンスが manifest に無い"
            raise TrainError(msg)
        classes.append(license_class(licenses[video]))
        part = rel.split("/")[1]
        split = part if src.use == "train" and part in SPLITS else "eval"
        out.items.append(
            Item(
                src.name,
                split,
                f"yolo:{video}",
                img,
                f"{src.rel}/{rel}",
                img.name,
                digest,
                src.license,
                parse_label(src.path / lbl),
            )
        )
    if entries:
        msg = f"{label}: manifest にあって無い画像（{sorted(entries)[0]}）"
        raise TrainError(msg)
    if labels:
        msg = f"{label}: 画像の無いラベル（{sorted(labels)[0]}）"
        raise TrainError(msg)
    strictest = max(classes, key=STRICTNESS.__getitem__, default=src.license)
    if strictest != src.license:
        msg = (
            f"{label}: 一覧の license {src.license} が"
            f"素材の manifest（最も厳しいもの {strictest}）と違う"
        )
        raise TrainError(msg)
    return out


# ---------------------------------------------------------------- R3 Capture


def tl_to_center(xywh: Sequence[float]) -> tuple[float, float, float, float] | None:
    """左上基準 → 中心基準。角を 0〜1 に切ってから直す。幅か高さが 0 なら None。"""
    x, y, w, h = (float(v) for v in xywh)
    x1, y1 = min(max(x, 0.0), 1.0), min(max(y, 0.0), 1.0)
    x2, y2 = min(max(x + w, 0.0), 1.0), min(max(y + h, 0.0), 1.0)
    if x2 - x1 <= 0 or y2 - y1 <= 0:
        return None
    return ((x1 + x2) / 2, (y1 + y2) / 2, x2 - x1, y2 - y1)


def capture_group(source: str, created_at: str) -> str:
    """source と日本時間の日付。"""
    stamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=UTC)
    return f"{source}:{stamp.astimezone(JST).date().isoformat()}"


def val_groups(groups: Iterable[str], seed: int, ratio: float) -> set[str]:
    """ハッシュの順に並べ、2 つ以上なら max(1, round(ratio·n)) 個（train に 1 つ以上残す）。"""
    ordered = sorted(set(groups), key=lambda g: hashlib.sha256(f"{seed}:{g}".encode()).hexdigest())
    n = len(ordered)
    if n < 2:
        return set()
    k = min(max(1, round(ratio * n)), n - 1)
    return set(ordered[:k])


def _validator() -> Callable[[object], bool]:
    from jsonschema import Draft202012Validator  # edge/detector の dev 依存

    validator = Draft202012Validator(json.loads(CAPTURE_SCHEMA.read_text(encoding="utf-8")))
    return validator.is_valid


def _read_capture(src: Source, path: Path) -> tuple[dict | None, Path | None, str | None]:
    """(capture, 画像, 理由)。置き方を見分け、名前の決まりで画像を決める。"""
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None, None, "invalid"
    if isinstance(data, dict) and "capture" in data:  # api
        cap, file = data.get("capture"), data.get("file")
        key = path.stem
        if not isinstance(cap, dict) or not isinstance(file, str):
            return None, None, "invalid"
        match = API_FILE.match(file)
        cid = cap.get("id")
        if (
            not API_KEY.match(key)
            or not isinstance(cid, str)
            or cid.lower() != key
            or match is None
            or match.group(1) != key
        ):
            return cap, None, "bad_path"
        image = src.path / file
        if image.exists() and sha256_file(image)[:12] != match.group(2):
            return cap, None, "bad_path"
        return cap, image, None
    if not isinstance(data, dict):
        return None, None, "invalid"
    if not EDGE_ID.match(path.stem) or data.get("id") != path.stem:  # edge
        return data, None, "bad_path"
    return data, src.path / f"{path.stem}.jpg", None


def collect_captures(
    src: Source, seed: int, ratio: float, is_valid: Callable[[object], bool]
) -> Collected:
    out = Collected()
    found: list[tuple[Item, str]] = []
    for path in sorted(src.path.glob("cap_*.json")):
        cap, image, reason = _read_capture(src, path)
        if reason is None and not is_valid(cap):
            reason = "invalid"
        if reason is None:
            reason = _capture_reason(src, cap, image)
        if reason is not None:
            out.skipped[reason] += 1
            continue
        boxes = tuple(
            b
            for b in (tl_to_center(box["xywh"]) for box in cap["boxes"] if box["by"] == "user")
            if b is not None
        )
        if not boxes:
            out.skipped["no_user_box"] += 1
            continue
        group = capture_group(cap["source"], cap["createdAt"])
        item = Item(
            src.name,
            "eval",
            f"capture:{group}",
            image,
            f"{src.rel}/{image.name}",
            image.name,
            sha256_file(image),
            src.license,
            boxes,
            {"id": cap["id"], "source": cap["source"], "date": group.split(":", 1)[1]},
        )
        found.append((item, group))
    if src.use == "eval":
        out.items = [item for item, _ in found]
        return out
    val = val_groups([g for _, g in found], seed, ratio)
    if found and not val:
        out.notes.append(f"{src.name}: Capture のグループが 1 つなので Capture の val なし")
    out.items = [
        Item(**{**item.__dict__, "split": "val" if g in val else "train"}) for item, g in found
    ]
    return out


def _capture_reason(src: Source, cap: dict, image: Path | None) -> str | None:
    if image is None or not image.is_file():
        return "no_image"
    if image.resolve().parent != src.path:
        return "bad_path"
    if cap["consent"] is not True:
        return "no_consent"
    if cap["source"] == "vehicle":
        return "vehicle_pending"
    if cap["id"].lower() not in src.reviewed:
        return "not_reviewed"
    if not any(box["by"] == "user" for box in cap["boxes"]):
        return "no_user_box"
    return None


# ---------------------------------------------------------------- R4・R5 漏れの検査と出力


def check_leaks(items: Sequence[Item]) -> None:
    sides: dict[str, set[str]] = {"train": set(), "val": set(), "eval": set()}
    shas: dict[str, set[str]] = {"learn": set(), "eval": set()}
    for item in items:
        sides[item.split].add(item.group)
        shas["eval" if item.split == "eval" else "learn"].add(item.sha256)
    if both := sides["train"] & sides["val"]:
        msg = f"同じグループが train と val の両方にある（{sorted(both)[0]}）"
        raise TrainError(msg)
    if both := (sides["train"] | sides["val"]) & sides["eval"]:
        msg = f"同じグループが学習側と評価側の両方にある（{sorted(both)[0]}）"
        raise TrainError(msg)
    if shas["learn"] & shas["eval"]:
        msg = "同じ画像（SHA-256）が学習側と評価側の両方にある"
        raise TrainError(msg)
    if not any(item.boxes for item in items if item.split in SPLITS):
        msg = "学習側の鹿の箱が 0 個（学習にならない）"
        raise TrainError(msg)
    if not any(item.split == "val" for item in items):
        msg = "val の画像が 0 枚（学習の検証ができない）"
        raise TrainError(msg)
    names = Counter(item.file.lower() for item in items)
    if dup := [n for n, c in names.items() if c > 1]:
        msg = f"出力の名前が衝突する（{dup[0]}）"
        raise TrainError(msg)


def _label_text(boxes: Iterable[tuple[float, float, float, float]]) -> str:
    return "".join("0 " + " ".join(f"{v:.6g}" for v in box) + "\n" for box in boxes)


def build(
    sources_path: Path,
    root: Path = HERE,
    run: str = "",
    seed: int = 0,
    val_ratio: float = 0.2,
    is_valid: Callable[[object], bool] | None = None,
) -> Path:
    if not NAME.match(run):
        msg = f"run の名前は英小文字・数字・- だけ（{run!r}）"
        raise TrainError(msg)
    root = root.resolve()
    sources = load_sources(sources_path, root)
    validate = is_valid
    collected: dict[str, Collected] = {}
    for src in sources:
        if src.kind == "yolo":
            collected[src.name] = collect_yolo(src)
        else:
            validate = validate or _validator()
            collected[src.name] = collect_captures(src, seed, val_ratio, validate)
    items = _unique([item for c in collected.values() for item in c.items], collected)
    check_leaks(items)
    run_dir = root / "out/train" / run
    run_dir.parent.mkdir(parents=True, exist_ok=True)
    try:
        run_dir.mkdir()
    except FileExistsError as exc:
        msg = f"run {run!r} は既にある（上書きしない）"
        raise TrainError(msg) from exc
    try:
        _write_run(run_dir, sources, collected, items, seed, val_ratio)
    except BaseException:
        shutil.rmtree(run_dir, ignore_errors=True)
        raise
    return run_dir


def _unique(items: list[Item], collected: Mapping[str, Collected]) -> list[Item]:
    """Capture の重複（同じ id か同じ画像）は最初の 1 つだけを残し、duplicate に数える。"""
    seen: set[str] = set()
    out = []
    for item in items:
        keys = {f"sha:{item.sha256}"}
        if item.capture is not None:
            keys.add(f"id:{item.capture['id'].lower()}")
        if item.capture is not None and keys & seen:
            collected[item.source].skipped["duplicate"] += 1
            continue
        seen |= keys
        out.append(item)
    return out


def _write_run(
    run_dir: Path,
    sources: Sequence[Source],
    collected: Mapping[str, Collected],
    items: Sequence[Item],
    seed: int,
    val_ratio: float,
) -> None:
    for split in SPLITS:
        (run_dir / "images" / split).mkdir(parents=True)
        (run_dir / "labels" / split).mkdir(parents=True)
    files = []
    for item in items:
        if item.split in SPLITS:
            shutil.copyfile(item.image, run_dir / "images" / item.split / item.file)
            label = run_dir / "labels" / item.split / f"{Path(item.file).stem}.txt"
            label.write_text(_label_text(item.boxes))
        entry = {
            "file": item.file,
            "source": item.source,
            "split": item.split,
            "group": item.group,
            "name": item.name,
            "origin": item.origin,
            "sha256": item.sha256,
            "license": item.license,
            "boxes": [list(b) for b in item.boxes],
        }
        if item.capture is not None:
            entry["capture"] = dict(item.capture)
        files.append(entry)
    counts = Counter(item.split for item in items)
    manifest = {
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "seed": seed,
        "val_ratio": val_ratio,
        "counts": {s: counts.get(s, 0) for s in ("train", "val", "eval")},
        "sources": {
            src.name: {
                "kind": src.kind,
                "license": src.license,
                "use": src.use,
                "used": {
                    s: sum(1 for i in items if i.source == src.name and i.split == s)
                    for s in ("train", "val", "eval")
                },
                "skipped": dict(sorted(collected[src.name].skipped.items())),
            }
            for src in sources
        },
        "labels_note": {
            n: c.labels_note for n, c in collected.items() if c.labels_note is not None
        },
        "notes": [n for c in collected.values() for n in c.notes],
        "files": files,
    }
    (run_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )
    (run_dir / "dataset.yaml").write_text(
        f"path: {run_dir.resolve()}\ntrain: images/train\nval: images/val\nnames:\n  0: deer\n",
        encoding="utf-8",
    )


# ---------------------------------------------------------------- R6 学習


def verify_run(run_dir: Path) -> dict:
    """build の出力が manifest どおりか（余分・欠け・SHA-256・dataset.yaml の path）。"""
    try:
        manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
        yaml = (run_dir / "dataset.yaml").read_text(encoding="utf-8")
    except (OSError, ValueError) as exc:
        msg = f"build の出力を読めない（{run_dir.name}）"
        raise TrainError(msg) from exc
    if f"path: {run_dir.resolve()}\n" not in yaml:
        msg = (
            "dataset.yaml の path がこの run のフォルダでない（別の場所へ移したなら build し直す）"
        )
        raise TrainError(msg)
    want: dict[str, str | None] = {}
    for entry in manifest["files"]:
        if entry["split"] in SPLITS:
            want[f"images/{entry['split']}/{entry['file']}"] = entry["sha256"]
            want[f"labels/{entry['split']}/{Path(entry['file']).stem}.txt"] = None
    have = {
        p.relative_to(run_dir).as_posix()
        for d in ("images", "labels")
        for p in (run_dir / d).rglob("*")
        if p.is_file() and p.suffix != ".cache"  # Ultralytics がラベルの読み込みで書く
    }
    if have != set(want):
        diff = sorted(have ^ set(want))[0]
        msg = f"build の出力が manifest と違う（{diff}）。build し直す"
        raise TrainError(msg)
    for rel, digest in want.items():
        if digest is not None and sha256_file(run_dir / rel) != digest:
            msg = f"画像の SHA-256 が manifest と違う（{rel}）。build し直す"
            raise TrainError(msg)
    return manifest


def pick_device(device: str, mps_available: Callable[[], bool]) -> str:
    if device != "auto":
        return device
    return "mps" if mps_available() else "cpu"


def _check_name(models_dir: Path, name: str) -> None:
    if not NAME.match(name):
        msg = f"重みの名前は英小文字・数字・- だけ（{name!r}）"
        raise TrainError(msg)
    for ext in (".pt", ".json", ".mlpackage"):
        if (models_dir / f"{name}{ext}").exists():
            msg = f"{name}{ext} は既にある（上書きしない）"
            raise TrainError(msg)


def train(
    run_dir: Path,
    models_dir: Path = MODELS,
    name: str = "",
    seed: int = 0,
    base: Path = MODELS / "yolo26n.pt",
    epochs: int = 60,
    imgsz: int = 640,
    batch: int = 8,
    device: str = "auto",
    *,
    allow_by_sa_base: bool = False,
    trainer: Callable[[Path, dict], TrainResult] | None = None,
    known_bases: Mapping[str, Base] = KNOWN_BASES,
    mps_available: Callable[[], bool] | None = None,
) -> Path:
    if not NAME.match(name):
        msg = f"重みの名前は英小文字・数字・- だけ（{name!r}）"
        raise TrainError(msg)
    if not base.is_file():
        msg = f"元の重みが無い（{base.name}）"
        raise TrainError(msg)
    _check_name(models_dir, name)
    manifest = verify_run(run_dir)
    base_sha = sha256_file(base)
    known = known_bases.get(base_sha)
    if known is None:
        msg = f"元の重みの出所が分からない（{base.name}、SHA-256 {base_sha[:12]}…）"
        raise TrainError(msg)
    if known.by_sa and not allow_by_sa_base:
        msg = "元の重みは CC BY-SA を含む学習の派生。使うなら --allow-by-sa-base を付ける"
        raise TrainError(msg)
    picked = pick_device(device, mps_available or _mps_available)
    args = {
        "data": str(run_dir / "dataset.yaml"),
        "project": str(run_dir / "ultralytics"),
        "name": "train",
        "seed": seed,
        "deterministic": True,
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "device": picked,
        "plots": False,
        "exist_ok": False,
    }
    result = (trainer or _ultralytics_train)(base, args)
    target = models_dir / f"{name}.pt"
    with result.last.open("rb") as src, target.open("xb") as dst:
        try:
            shutil.copyfileobj(src, dst)
        except BaseException:
            target.unlink(missing_ok=True)  # 半端な重みを残さない（次の「既にある」の原因になる）
            raise
    root = run_dir.resolve().parents[2]
    card = {
        "name": name,
        "weights": "last.pt",
        "base": {
            "name": base.name,
            "sha256": base_sha,
            "origin": known.origin,
            "by_sa": known.by_sa,
        },
        "run": run_dir.resolve().relative_to(root).as_posix(),
        "manifest_sha256": sha256_file(run_dir / "manifest.json"),
        "sources": [
            {"name": n, "license": s["license"], "use": s["use"]}
            for n, s in manifest["sources"].items()
        ],
        "attribution": "CC BY の帰属表示は CREDITS.md の該当行（Commons の各動画）",
        "seed": seed,
        "epochs": epochs,
        "imgsz": imgsz,
        "batch": batch,
        "device": picked,
        "ultralytics": result.version,
        "created": datetime.now(UTC).isoformat(timespec="seconds"),
        "note": (
            "MPS では同じ seed でも学習は完全には一致しない。決定性の約束は build の manifest まで"
        ),
    }
    with (models_dir / f"{name}.json").open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(card, ensure_ascii=False, indent=1) + "\n")
    return target


def _mps_available() -> bool:  # pragma: no cover  day0 の環境（torch）
    import torch

    return bool(torch.backends.mps.is_available())


def _ultralytics_train(base: Path, args: dict) -> TrainResult:  # pragma: no cover  day0 の環境
    os.environ["YOLO_OFFLINE"] = "1"
    import ultralytics
    from ultralytics import YOLO
    from ultralytics.utils import SETTINGS

    SETTINGS.update({"sync": False})
    model = YOLO(str(base))
    model.train(**args)
    last = Path(model.trainer.last)  # exist_ok=False で train-2 などに書かれても正しい場所
    return TrainResult(last=last, version=ultralytics.__version__)


# ---------------------------------------------------------------- R7 書き出し


def export(
    weights: Path,
    conf: float = 0.25,
    iou: float = 0.7,
    imgsz: tuple[int, int] = (FRAME[1], FRAME[0]),
    *,
    min_conf: float = TrackerConfig().min_conf,
    exporter: Callable[[Path, dict], Path] | None = None,
    verify: Callable[[Path], None] | None = None,
) -> Path:
    if conf > min_conf:
        msg = f"NMS の conf {conf} が [tracker] min_conf {min_conf} より大きい（追う鹿が消える）"
        raise TrainError(msg)
    if not weights.is_file():
        msg = f"重みが無い（{weights.name}）"
        raise TrainError(msg)
    target = weights.with_suffix(".mlpackage")
    if target.exists():
        msg = f"{target.name} は既にある（上書きしない）"
        raise TrainError(msg)
    with tempfile.TemporaryDirectory(prefix="train-l0-export-") as tmp:
        local = Path(tmp) / weights.name
        shutil.copyfile(weights, local)
        # 入力は L0 のフレームと同じ 640×480（高さ, 幅）。正方形へ引き伸ばすと縦横比が崩れ、
        # 精度が大きく落ちた（docs/reports/2026-11-06-dataset-train-run.md）
        args = {"format": "coreml", "nms": True, "imgsz": list(imgsz), "conf": conf, "iou": iou}
        produced = (exporter or _ultralytics_export)(local, args)
        if target.exists():
            msg = f"{target.name} は既にある（上書きしない）"
            raise TrainError(msg)
        shutil.move(str(produced), str(target))
    try:
        (verify or _verify_coreml)(target)
    except Exception as exc:  # L0 の読み込みのどの失敗も「確かめられない」にする（再送出する）
        msg = f"{target.name} を L0 の読み込みで確かめられない: {exc}"
        raise VerifyError(msg) from exc
    return target


def _ultralytics_export(weights: Path, args: dict) -> Path:  # pragma: no cover  day0 の環境
    os.environ["YOLO_OFFLINE"] = "1"
    from ultralytics import YOLO
    from ultralytics.utils import SETTINGS

    SETTINGS.update({"sync": False})
    return Path(YOLO(str(weights)).export(**args))


def _verify_coreml(path: Path) -> None:  # pragma: no cover  day0 の環境（coremltools）
    from detector.config import Config, InferConfig
    from detector.l0.coreml import load_coreml_detector

    detector = load_coreml_detector(Config(infer=InferConfig(model_path=str(path))))
    detector.detect(np.zeros((FRAME[1], FRAME[0], 3), dtype=np.uint8))


# ---------------------------------------------------------------- R8 評価


def iou(a: Sequence[float], b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = a[0] - a[2] / 2, a[1] - a[3] / 2, a[0] + a[2] / 2, a[1] + a[3] / 2
    bx1, by1, bx2, by2 = b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2
    inter = max(0.0, min(ax2, bx2) - max(ax1, bx1)) * max(0.0, min(ay2, by2) - max(ay1, by1))
    union = a[2] * a[3] + b[2] * b[3] - inter
    return inter / union if union > 0 else 0.0


def match(
    preds: Sequence[tuple[float, Sequence[float]]],
    gts: Sequence[Sequence[float]],
    threshold: float,
) -> tuple[int, int, int]:
    """確信度順（同じなら出てきた順）に、未使用の正解のうち IoU 最大（同じなら先）へ当てる。"""
    kept = sorted(
        (p for p in enumerate(preds) if p[1][0] >= threshold), key=lambda p: (-p[1][0], p[0])
    )
    used: set[int] = set()
    tp = 0
    for _, (_, box) in kept:
        best, best_iou = None, 0.0
        for k, gt in enumerate(gts):
            if k in used:
                continue
            value = iou(box, gt)
            if value > best_iou:
                best, best_iou = k, value
        if best is not None and best_iou >= IOU:
            used.add(best)
            tp += 1
    return tp, len(gts) - tp, len(kept) - tp


def rates(tp: int, fn: int, fp: int) -> dict[str, float | None]:
    return {
        "recall": tp / (tp + fn) if tp + fn else None,
        "precision": tp / (tp + fp) if tp + fp else None,
    }


def resize(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    """最近傍で (幅, 高さ) へ。L0 の _stretch と同じ添字の取り方。"""
    width, height = size
    h, w = image.shape[:2]
    rows = np.arange(height) * h // height
    cols = np.arange(width) * w // width
    return np.ascontiguousarray(image[rows[:, None], cols[None, :]])


def _tally() -> dict[str, int]:
    return {"tp": 0, "fn": 0, "fp": 0, "images": 0, "negative_images_with_detection": 0}


def evaluate(
    model: Path,
    run_dir: Path,
    out_dir: Path | None = None,
    *,
    factory: Callable[[Path], Detector] | None = None,
    reader: Callable[[Path], np.ndarray] | None = None,
) -> Path:
    try:
        manifest = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        msg = f"build の出力を読めない（{run_dir.name}）"
        raise TrainError(msg) from exc
    if not model.exists():
        msg = f"モデルが無い（{model.name}）"
        raise TrainError(msg)
    out_dir = out_dir or run_dir.parents[1] / "eval"
    kind = model.suffix.lstrip(".")
    target = out_dir / f"{model.stem}.{kind}.{run_dir.name}.json"
    if target.exists():
        msg = f"{target.name} は既にある（上書きしない）"
        raise TrainError(msg)
    try:
        detector = (factory or _make_detector)(model)
    except (OSError, ValueError) as exc:  # ConfigError（deer の無いモデル等）も ValueError
        msg = f"モデルを読めない（{model.name}）: {exc}"
        raise TrainError(msg) from exc
    if "deer" not in detector.names:
        msg = "モデルのクラスに deer が無い"
        raise TrainError(msg)
    root = run_dir.resolve().parents[2]
    report: dict = {
        "model": model.name,
        "run": run_dir.name,
        "preprocess": PREPROCESS,
        "iou": IOU,
        "labels_note": manifest.get("labels_note", {}),
        "note": "静止画のフレーム単位。速度は数えない（開発機の値を Mac mini の値と混同しない）",
    }
    for side in ("val", "eval"):
        tallies = {t: {"total": _tally(), "by_source": {}, "by_group": {}} for t in THRESHOLDS}
        for entry in manifest["files"]:
            if entry["split"] != side:
                continue
            image = root / entry["origin"]
            if not image.is_file() or sha256_file(image) != entry["sha256"]:
                msg = f"評価の画像が manifest と違う（{entry['file']}）。build し直す"
                raise TrainError(msg)
            frame = resize((reader or _read_image)(image), FRAME)
            preds = detector.detect(frame, Path(entry["file"]))
            gts = [tuple(b) for b in entry["boxes"]]
            for t in THRESHOLDS:
                tp, fn, fp = match(preds, gts, t)
                buckets = (
                    tallies[t]["total"],
                    tallies[t]["by_source"].setdefault(entry["source"], _tally()),
                    tallies[t]["by_group"].setdefault(entry["group"], _tally()),
                )
                for bucket in buckets:
                    bucket["tp"] += tp
                    bucket["fn"] += fn
                    bucket["fp"] += fp
                    bucket["images"] += 1
                    bucket["negative_images_with_detection"] += int(not gts and fp > 0)
        report[side] = {
            str(t): {
                "total": {
                    **v["total"],
                    **rates(v["total"]["tp"], v["total"]["fn"], v["total"]["fp"]),
                },
                "by_source": v["by_source"],
                "by_group": v["by_group"],
            }
            for t, v in tallies.items()
        }
    out_dir.mkdir(parents=True, exist_ok=True)
    with target.open("x", encoding="utf-8") as handle:
        handle.write(json.dumps(report, ensure_ascii=False, indent=1) + "\n")
    return target


def _read_image(path: Path) -> np.ndarray:  # pragma: no cover  day0 の環境（opencv）
    import cv2

    image = cv2.imread(str(path))
    if image is None:
        msg = f"画像を読めない（{path.name}）"
        raise TrainError(msg)
    return image


def _make_detector(model: Path) -> Detector:  # pragma: no cover  day0 の環境
    if model.suffix == ".mlpackage":
        from detector.config import Config, InferConfig
        from detector.l0.coreml import load_coreml_detector

        l0 = load_coreml_detector(Config(infer=InferConfig(model_path=str(model))))

        def detect_ml(frame: np.ndarray, image: Path) -> list:
            return [(d.conf, d.xywh) for d in l0.detect(frame) if d.label == "deer"]

        return Detector(names=("deer",), detect=detect_ml)
    os.environ["YOLO_OFFLINE"] = "1"
    from ultralytics import YOLO

    yolo = YOLO(str(model))
    names = tuple(str(v).lower() for v in yolo.names.values())

    def detect_pt(frame: np.ndarray, image: Path) -> list:
        # export と同じ 640×480 の入力（引き伸ばしも余白も無し）
        result = yolo.predict(
            frame, imgsz=[FRAME[1], FRAME[0]], conf=min(THRESHOLDS), rect=False, verbose=False
        )[0]
        deer = names.index("deer") if "deer" in names else -1
        out = []
        for box, conf, cls in zip(
            result.boxes.xywhn.tolist(),
            result.boxes.conf.tolist(),
            result.boxes.cls.tolist(),
            strict=True,
        ):
            if int(cls) == deer:
                out.append((float(conf), tuple(box)))
        return out

    return Detector(names=names, detect=detect_pt)


# ---------------------------------------------------------------- CLI


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("build")
    b.add_argument("--sources", type=Path, default=HERE / "train_sources.toml")
    b.add_argument("--root", type=Path, default=HERE)
    b.add_argument("--run", required=True)
    b.add_argument("--seed", type=int, required=True)
    b.add_argument("--val-ratio", type=float, default=0.2)
    t = sub.add_parser("train")
    t.add_argument("--run", required=True)
    t.add_argument("--root", type=Path, default=HERE)
    t.add_argument("--name", required=True)
    t.add_argument("--seed", type=int, required=True)
    t.add_argument("--base", type=Path, default=MODELS / "yolo26n.pt")
    t.add_argument("--epochs", type=int, default=60)
    t.add_argument("--imgsz", type=int, default=640)
    t.add_argument("--batch", type=int, default=8)
    t.add_argument("--device", default="auto")
    t.add_argument("--allow-by-sa-base", action="store_true")
    e = sub.add_parser("export")
    e.add_argument("--weights", type=Path, required=True)
    e.add_argument("--conf", type=float, default=0.25)
    v = sub.add_parser("evaluate")
    v.add_argument("--model", type=Path, required=True)
    v.add_argument("--run", required=True)
    v.add_argument("--root", type=Path, default=HERE)
    args = parser.parse_args(argv)
    try:
        if args.cmd == "build":
            run_dir = build(args.sources, args.root, args.run, args.seed, args.val_ratio)
            m = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
            c = m["counts"]
            sys.stdout.write(f"{run_dir}: train {c['train']} / val {c['val']} / eval {c['eval']}\n")
            for note in m["notes"]:
                sys.stdout.write(f"  {note}\n")
        elif args.cmd == "train":
            run_dir = args.root.resolve() / "out/train" / args.run
            pt = train(
                run_dir,
                MODELS,
                args.name,
                args.seed,
                args.base,
                args.epochs,
                args.imgsz,
                args.batch,
                args.device,
                allow_by_sa_base=args.allow_by_sa_base,
            )
            sys.stdout.write(f"{pt}\n")
        elif args.cmd == "export":
            sys.stdout.write(f"{export(args.weights, args.conf)}\n")
        else:
            run_dir = args.root.resolve() / "out/train" / args.run
            out = evaluate(args.model, run_dir)
            r = json.loads(out.read_text(encoding="utf-8"))
            for side in ("val", "eval"):
                tot = r[side]["0.25"]["total"]
                sys.stdout.write(
                    f"{side} @0.25: TP {tot['tp']} FN {tot['fn']} FP {tot['fp']} "
                    f"neg_img_fp {tot['negative_images_with_detection']}\n"
                )
            sys.stdout.write(f"{out}\n")
    except TrainError as exc:
        sys.stderr.write(f"エラー: {exc}\n")
        return 2
    except VerifyError as exc:
        sys.stderr.write(f"確かめの失敗: {exc}\n")
        return 1
    return 0


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
