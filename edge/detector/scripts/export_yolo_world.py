"""YOLO-World（オープン語彙）→ 鹿だけの CoreML（.mlpackage）。Day 0 の暫定モデル（Step 0）。

COCO の YOLOv8 には deer のクラスが無い。そこで YOLO-World に `set_classes(["deer"])` を指定して
書き出し、Day 5 に鹿の画像で学習し直す（推奨で決定。docs/specs/edge-day0）。

    python edge/detector/scripts/export_yolo_world.py --check-image deer.jpg

  どこから実行しても、重み（.pt）と書き出しは edge/detector/models/（.gitignore 済み）に置く。

- 重みは `yolov8s-worldv2.pt`。**v2 だけが CoreML に出せる**（ultralytics の exporter が
  v1 の書き出しを拒否する）。`set_classes` は CLIP の取得（git とネットワーク）を要する
- NMS 付きで書き出すと、出力が `confidence`（N×クラス数）と `coordinates`（N×4、正規化 xywh）、
  メタデータ `names`（`{0: 'deer'}` の文字列）になる。これは edge-l0 の読み方（l0/coreml.py）と
  同じなので、**l0 の側は変えない**。書き出した後に l0 自身の読み込み（load_coreml_detector）で
  推論し、出力の名前（モデルの宣言）と、--check-image の写真での
  出力の形を確かめる。合わなければ exit 1
- NMS に焼き込まれる確信度の下限（`--conf`）は `[tracker] min_conf`（0.4）以下にする。それより
  高いと、トラッカーが追うはずの 0.4 未満の鹿が NMS で消える（edge-l0 の Deferred）
- 依存: pip install -e "edge/detector[day0]"（ライセンスは CREDITS.md）
"""

from __future__ import annotations

import argparse
import contextlib
import json
import shutil
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Final

import numpy as np

from detector.config import Config, ConfigError, CoremlConfig, InferConfig, TrackerConfig
from detector.l0.coreml import (
    CoreMLOutputError,
    load_coreml_detector,
    load_with_coremltools,
    parse_names,
)

if TYPE_CHECKING:
    from collections.abc import Callable, Sequence

    from detector.l0.coreml import LoadedModel

DEFAULT_WEIGHTS: Final = "yolov8s-worldv2.pt"
DEFAULT_NAME: Final = "yolov8s-worldv2-deer"
DEFAULT_CLASSES: Final = ("deer",)
DEFAULT_CONF: Final = 0.25  # Ultralytics の既定。tracker.min_conf（0.4）以下
OUTPUTS: Final = ("confidence", "coordinates")
EXIT_OK, EXIT_FAIL, EXIT_INPUT = 0, 1, 2


class ExportError(Exception):
    """書き出しか、書き出したモデルの検証に失敗した（メッセージは手順書にそのまま出してよい）。"""


def _read_image(path: Path) -> np.ndarray:
    """検証用の画像（BGR）。鹿が写っているものがよい（出力の形を確かめられる）。"""
    try:
        import cv2
    except ImportError as exc:
        msg = "opencv が無い（ultralytics と一緒に入る。pip install -e 'edge/detector[day0]'）"
        raise ExportError(msg) from exc
    image = cv2.imread(str(path))
    if image is None:
        msg = f"画像を読めない: {path.name}"
        raise ExportError(msg)
    return image


def default_out_dir() -> Path:
    return Path(__file__).resolve().parent.parent / "models"


def _yolo_world() -> Callable[[str], object]:
    try:
        from ultralytics import YOLOWorld
    except ImportError as exc:
        msg = "ultralytics が無い（pip install -e 'edge/detector[day0]'）"
        raise ExportError(msg) from exc
    return YOLOWorld


def _ensure_names(path: Path, classes: Sequence[str]) -> bool:
    """メタデータ names が読めないときだけ、l0 の読み方（{0: 'deer'} の文字列）で書き足す。"""
    try:
        import coremltools as ct
    except ImportError as exc:
        msg = "coremltools が無い（pip install -e 'edge/detector[day0]'）"
        raise ExportError(msg) from exc

    model = ct.models.MLModel(str(path), skip_model_load=True)
    try:
        parse_names(model.user_defined_metadata.get("names"))
    except ConfigError:
        model.user_defined_metadata["names"] = str(dict(enumerate(classes)))
        patched = path.with_name(f"{path.stem}.patched.mlpackage")
        model.save(str(patched))
        shutil.rmtree(path)
        shutil.move(str(patched), str(path))
        return True
    return False


def verify(
    path: Path,
    classes: Sequence[str],
    compute_units: str = "cpu_and_ne",
    loader: Callable[[str, str], LoadedModel] = load_with_coremltools,
    prepare: Callable[[np.ndarray], object] | None = None,
    image: np.ndarray | None = None,
) -> dict[str, object]:
    """l0 の読み方（load_coreml_detector）で読み込み、推論する。

    黒い画像は検出が 0 件になり、l0 は 0 件のとき出力の形を見ない。そのため出力の名前は
    モデルの宣言（get_spec）で確かめ、形は image（検出が出る鹿の写真）があるときに確かめる。
    """
    config = Config(
        infer=InferConfig(model_path=str(path)), coreml=CoremlConfig(compute_units=compute_units)
    )
    holder: list[LoadedModel] = []
    extra = {} if prepare is None else {"prepare": prepare}

    def spy(model_path: str, units: str) -> LoadedModel:
        loaded = loader(model_path, units)
        holder.append(loaded)
        return loaded

    try:
        detector = load_coreml_detector(config, loader=spy, **extra)
    except ConfigError as exc:
        msg = f"l0 の読み方で読めない: {exc}"
        raise ExportError(msg) from exc
    loaded = holder[0]
    names = parse_names(loaded.metadata.get("names"))
    if tuple(names) != tuple(c.lower() for c in classes):
        msg = f"names がクラスと合わない: {names} != {tuple(classes)}"
        raise ExportError(msg)
    get_spec = getattr(loaded.model, "get_spec", None)
    declared = sorted(o.name for o in get_spec().description.output) if get_spec else None
    if declared is not None and not set(OUTPUTS) <= set(declared):
        msg = f"出力の名前が l0 の読み方と合わない: {declared}。期待: {OUTPUTS}"
        raise ExportError(msg)
    try:
        found = detector.detect(np.zeros((480, 640, 3), dtype=np.uint8))
        seen = None if image is None else detector.detect(image)
    except (CoreMLOutputError, KeyError, ValueError) as exc:
        msg = f"出力が l0 の読み方と合わない（{type(exc).__name__}: {exc}）。期待: {OUTPUTS}"
        raise ExportError(msg) from exc
    return {
        "names": list(names),
        "input": {"name": loaded.input_name, "size": list(loaded.input_size)},
        "outputs_expected": list(OUTPUTS),
        "outputs_declared": declared,
        "blank_image_detections": len(found),
        "check_image_detections": None if seen is None else len(seen),
        "shape_verified": bool(seen),
        "compute_units": compute_units,
    }


def export(
    *,
    weights: str = DEFAULT_WEIGHTS,
    classes: Sequence[str] = DEFAULT_CLASSES,
    imgsz: int = 640,
    conf: float = DEFAULT_CONF,
    iou: float = 0.7,
    out_dir: Path | None = None,
    name: str = DEFAULT_NAME,
    force: bool = False,
    model_factory: Callable[[str], object] | None = None,
    verifier: Callable[[Path, Sequence[str]], dict[str, object]] | None = None,
    name_fixer: Callable[[Path, Sequence[str]], bool] | None = None,
    check_image: Path | None = None,
) -> dict[str, object]:
    out_dir = out_dir or default_out_dir()
    target = out_dir / f"{name}.mlpackage"
    if target.exists() and not force:
        msg = f"{target} が既にある（作り直すなら --force）"
        raise ExportError(msg)
    image = None if check_image is None else _read_image(check_image)
    out_dir.mkdir(parents=True, exist_ok=True)
    factory = model_factory or _yolo_world()
    # ultralytics は重みを cwd に落とす。リポジトリ直下に .pt（AGPL）を残さないよう models/ へ移る
    try:
        with contextlib.chdir(out_dir):
            model = factory(weights)
            model.set_classes(list(classes))  # type: ignore[attr-defined]  CLIP を取得する
            produced = Path(
                str(
                    model.export(  # type: ignore[attr-defined]
                        format="coreml", nms=True, imgsz=imgsz, conf=conf, iou=iou
                    )
                )
            )
    except (RuntimeError, OSError, ValueError, ImportError, AssertionError) as exc:
        msg = f"ultralytics の書き出しに失敗（{type(exc).__name__}: {exc}）"
        raise ExportError(msg) from exc
    if not produced.is_absolute():
        produced = out_dir / produced
    if not produced.exists():
        msg = f"書き出した {produced} が無い"
        raise ExportError(msg)
    backup = None
    if target.exists():  # --force: 検証に通るまで、使えていた旧モデルを残す
        backup = target.with_name(f"{target.name}.old")
        _remove(backup)
        target.rename(backup)
    shutil.move(str(produced), str(target))
    try:
        patched = (name_fixer or _ensure_names)(target, classes)
        report = (
            verify(target, classes, image=image) if verifier is None else verifier(target, classes)
        )
    except ExportError:
        failed = target.with_name(f"{target.stem}.failed.mlpackage")
        _remove(failed)
        target.rename(failed)  # 調べられるように残す
        if backup is not None:
            backup.rename(target)
        raise
    if backup is not None:
        _remove(backup)
    report.update(
        {
            "path": str(target),
            "weights": weights,
            "imgsz": imgsz,
            "conf": conf,
            "iou": iou,
            "names_patched": patched,
        }
    )
    return report


def _remove(path: Path) -> None:
    if path.is_dir():
        shutil.rmtree(path)
    elif path.exists():
        path.unlink()


def _multiple_of_32(text: str) -> int:
    value = int(text)
    if value < 32 or value % 32:
        msg = "32 の倍数（32 以上）"
        raise argparse.ArgumentTypeError(msg)
    return value


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python export_yolo_world.py", description=__doc__)
    p.add_argument("--weights", default=DEFAULT_WEIGHTS)
    p.add_argument("--classes", nargs="+", default=list(DEFAULT_CLASSES))
    p.add_argument("--imgsz", type=_multiple_of_32, default=640, help="32 の倍数（既定 640）")
    p.add_argument("--conf", type=float, default=DEFAULT_CONF, help="NMS に焼き込む下限")
    p.add_argument("--iou", type=float, default=0.7)
    p.add_argument("--out-dir", type=Path, help="既定: edge/detector/models/")
    p.add_argument("--name", default=DEFAULT_NAME)
    p.add_argument("--force", action="store_true", help="同名の .mlpackage を置き換える")
    p.add_argument(
        "--check-image", type=Path, help="検証に使う鹿の写真（無いと出力の形は確かめられない）"
    )
    return p


def main(argv: Sequence[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    min_conf = TrackerConfig().min_conf
    if not (0.0 < args.conf <= min_conf):
        sys.stderr.write(f"--conf は 0 より大きく {min_conf}（tracker.min_conf）以下\n")
        return EXIT_INPUT
    if "deer" not in {c.strip().lower() for c in args.classes}:
        sys.stderr.write("--classes に deer が要る（l0 は deer が無いモデルを拒否する）\n")
        return EXIT_INPUT
    try:
        report = export(
            weights=args.weights,
            classes=args.classes,
            imgsz=args.imgsz,
            conf=args.conf,
            iou=args.iou,
            out_dir=args.out_dir,
            name=args.name,
            force=args.force,
            check_image=args.check_image,
        )
    except ExportError as exc:
        sys.stderr.write(f"export_yolo_world: {exc}\n")
        return EXIT_FAIL
    sys.stdout.write(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    if args.check_image and not report.get("shape_verified"):
        sys.stderr.write(
            "export_yolo_world: --check-image の写真で検出が出ず、出力の形を確かめられない"
            "（鹿がはっきり写った別の写真で --force を付けて再実行）\n"
        )
        return EXIT_FAIL
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
