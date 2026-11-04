"""edge-day0: YOLO-World → CoreML の書き出し。ultralytics・coremltools は偽物で確かめる。"""

import importlib.util
import json
from pathlib import Path
from typing import ClassVar

import numpy as np
import pytest

from detector.l0.coreml import LoadedModel

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_yolo_world.py"
spec = importlib.util.spec_from_file_location("export_yolo_world", SCRIPT)
ex = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ex)


class FakeWorld:
    """ultralytics.YOLOWorld の代わり。export は models/ の外に .mlpackage を作る。"""

    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self.classes: list[str] | None = None
        self.export_kwargs: dict | None = None

    def set_classes(self, classes: list[str]) -> None:
        self.classes = classes

    def export(self, **kwargs: object) -> str:
        self.export_kwargs = kwargs
        pkg = self.workdir / "yolov8s-worldv2.mlpackage"
        pkg.mkdir()
        (pkg / "Manifest.json").write_text("{}", encoding="utf-8")
        return str(pkg)


class FakeModel:
    def __init__(self, outputs: dict) -> None:
        self.outputs = outputs

    def predict(self, data: dict) -> dict:
        return self.outputs


def loader_for(names: str | None, outputs: dict):
    def load(path: str, units: str) -> LoadedModel:
        meta = {} if names is None else {"names": names}
        return LoadedModel(FakeModel(outputs), "image", (640, 640), meta)

    return load


GOOD = {"confidence": np.zeros((0, 1)), "coordinates": np.zeros((0, 4))}


def verify(names: str | None, outputs: dict) -> dict:
    return ex.verify(
        Path("m.mlpackage"),
        ["deer"],
        loader=loader_for(names, outputs),
        prepare=lambda image: image,
    )


def test_verify_accepts_l0_readable_model() -> None:
    report = verify("{0: 'deer'}", GOOD)
    assert report["names"] == ["deer"]
    assert report["input"] == {"name": "image", "size": [640, 640]}
    assert report["blank_image_detections"] == 0
    assert report["outputs_expected"] == ["confidence", "coordinates"]


def test_verify_rejects_model_without_deer() -> None:
    with pytest.raises(ex.ExportError, match="l0 の読み方で読めない"):
        verify("{0: 'person'}", GOOD)


def test_verify_rejects_missing_names() -> None:
    with pytest.raises(ex.ExportError, match="l0 の読み方で読めない"):
        verify(None, GOOD)


def test_verify_rejects_class_mismatch() -> None:
    with pytest.raises(ex.ExportError, match="クラスと合わない"):
        verify(
            "{0: 'deer', 1: 'car'}",
            {"confidence": np.zeros((0, 2)), "coordinates": GOOD["coordinates"]},
        )


def test_verify_rejects_renamed_outputs() -> None:
    with pytest.raises(ex.ExportError, match="出力が l0 の読み方と合わない"):
        verify("{0: 'deer'}", {"scores": np.zeros((0, 1)), "boxes": np.zeros((0, 4))})


def test_verify_rejects_wrong_shape() -> None:
    bad = {"confidence": np.zeros((2, 3)), "coordinates": np.zeros((2, 4))}
    with pytest.raises(ex.ExportError, match="出力が l0 の読み方と合わない"):
        verify("{0: 'deer'}", bad)


def run_export(tmp_path: Path, **kw: object) -> tuple[dict, FakeWorld]:
    world = FakeWorld(tmp_path)
    out = tmp_path / "models"
    report = ex.export(
        out_dir=out,
        model_factory=lambda weights: world,
        verifier=lambda path, classes: {"names": list(classes)},
        name_fixer=lambda path, classes: False,
        **kw,
    )
    return report, world


def test_export_sets_classes_exports_with_nms_and_moves(tmp_path: Path) -> None:
    report, world = run_export(tmp_path)
    assert world.classes == ["deer"]
    assert world.export_kwargs == {
        "format": "coreml",
        "nms": True,
        "imgsz": 640,
        "conf": 0.25,
        "iou": 0.7,
    }
    target = tmp_path / "models" / "yolov8s-worldv2-deer.mlpackage"
    assert (target / "Manifest.json").exists()
    assert not (tmp_path / "yolov8s-worldv2.mlpackage").exists()
    assert report["path"] == str(target)
    assert report["names_patched"] is False


def test_export_refuses_to_overwrite_without_force(tmp_path: Path) -> None:
    run_export(tmp_path)
    with pytest.raises(ex.ExportError, match="既にある"):
        run_export(tmp_path)
    run_export(tmp_path, force=True)


def test_export_fails_when_nothing_produced(tmp_path: Path) -> None:
    class Empty(FakeWorld):
        def export(self, **kwargs: object) -> str:
            return str(self.workdir / "missing.mlpackage")

    with pytest.raises(ex.ExportError, match="書き出した"):
        ex.export(
            out_dir=tmp_path / "models",
            model_factory=lambda w: Empty(tmp_path),
        )


def test_main_ok_prints_json(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys) -> None:
    world = FakeWorld(tmp_path)
    monkeypatch.setattr(ex, "_yolo_world", lambda: lambda weights: world)
    monkeypatch.setattr(ex, "verify", lambda path, classes, **kw: {"names": list(classes)})
    monkeypatch.setattr(ex, "_ensure_names", lambda path, classes: True)
    code = ex.main(["--out-dir", str(tmp_path / "m"), "--imgsz", "320"])
    assert code == 0
    report = json.loads(capsys.readouterr().out)
    assert report["imgsz"] == 320
    assert report["names_patched"] is True


def test_main_reports_export_failure(
    tmp_path: Path, capsys, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys

    # Mac mini は dev と day0 を同じ venv に入れる。本物の書き出しが走らないよう無い状態にする
    monkeypatch.setitem(sys.modules, "ultralytics", None)
    code = ex.main(["--out-dir", str(tmp_path)])
    assert code == 1
    assert "ultralytics が無い" in capsys.readouterr().err


@pytest.mark.parametrize(
    "argv",
    [["--conf", "0.5"], ["--conf", "0"], ["--classes", "fox"]],
)
def test_main_rejects_inputs(argv: list[str]) -> None:
    assert ex.main(argv) == 2


def test_imgsz_must_be_multiple_of_32() -> None:
    with pytest.raises(SystemExit):
        ex.main(["--imgsz", "100"])


class FakeMLModel:
    saved: ClassVar[list[str]] = []
    metadata: ClassVar[dict[str, str]] = {}

    def __init__(self, path: str, skip_model_load: bool = False) -> None:
        self.user_defined_metadata: dict[str, str] = dict(FakeMLModel.metadata)

    def save(self, path: str) -> None:
        Path(path).mkdir()
        FakeMLModel.saved.append(self.user_defined_metadata["names"])


def install_fake_coremltools(monkeypatch: pytest.MonkeyPatch, metadata: dict[str, str]) -> None:
    import sys
    import types

    FakeMLModel.metadata = metadata
    FakeMLModel.saved = []
    module = types.ModuleType("coremltools")
    module.models = types.SimpleNamespace(MLModel=FakeMLModel)
    monkeypatch.setitem(sys.modules, "coremltools", module)


def test_ensure_names_patches_only_when_unreadable(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pkg = tmp_path / "m.mlpackage"
    pkg.mkdir()
    install_fake_coremltools(monkeypatch, {})
    assert ex._ensure_names(pkg, ["deer"]) is True
    assert FakeMLModel.saved == ["{0: 'deer'}"]
    assert pkg.is_dir()
    assert not (tmp_path / "m.patched.mlpackage").exists()
    install_fake_coremltools(monkeypatch, {"names": "{0: 'deer'}"})
    assert ex._ensure_names(pkg, ["deer"]) is False
    assert FakeMLModel.saved == []


def test_ensure_names_without_coremltools(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import sys

    monkeypatch.setitem(sys.modules, "coremltools", None)
    with pytest.raises(ex.ExportError, match="coremltools が無い"):
        ex._ensure_names(tmp_path, ["deer"])


# ---- spec-adversary の指摘 ----


class SpecModel(FakeModel):
    """get_spec() で出力の宣言を答えるモデル。"""

    def __init__(self, outputs: dict, declared: list[str]) -> None:
        super().__init__(outputs)
        self.declared = declared

    def get_spec(self):
        import types

        out = [types.SimpleNamespace(name=n) for n in self.declared]
        return types.SimpleNamespace(description=types.SimpleNamespace(output=out))


def verify_spec(declared: list[str], outputs: dict, image: object = None) -> dict:
    def load(path: str, units: str) -> LoadedModel:
        return LoadedModel(
            SpecModel(outputs, declared), "image", (640, 640), {"names": "{0: 'deer'}"}
        )

    return ex.verify(Path("m.mlpackage"), ["deer"], loader=load, prepare=lambda i: i, image=image)


def test_verify_checks_declared_outputs_even_when_nothing_is_detected() -> None:
    # 黒い画像では 0 件で、l0 は形を見ない。宣言の名前で落とす
    with pytest.raises(ex.ExportError, match="出力の名前が l0 の読み方と合わない"):
        verify_spec(["scores", "boxes"], GOOD)
    report = verify_spec(["confidence", "coordinates"], GOOD)
    assert report["outputs_declared"] == ["confidence", "coordinates"]
    assert report["shape_verified"] is False  # 検出が無いので形は未確認


def test_verify_checks_shape_with_a_detecting_image() -> None:
    good = {"confidence": np.array([[0.9]]), "coordinates": np.array([[0.5, 0.5, 0.2, 0.3]])}
    report = verify_spec(["confidence", "coordinates"], good, image=np.zeros((480, 640, 3)))
    assert report["check_image_detections"] == 1
    assert report["shape_verified"] is True
    bad = {"confidence": np.array([[0.9, 0.1]]), "coordinates": np.array([[0.5, 0.5, 0.2, 0.3]])}
    with pytest.raises(ex.ExportError, match="出力が l0 の読み方と合わない"):
        verify_spec(["confidence", "coordinates"], bad, image=np.zeros((480, 640, 3)))


def test_export_runs_inside_out_dir_so_weights_land_there(tmp_path: Path) -> None:
    seen: list[str] = []

    class Spy(FakeWorld):
        def set_classes(self, classes: list[str]) -> None:
            seen.append(str(Path.cwd()))
            super().set_classes(classes)

    out = tmp_path / "models"
    ex.export(
        out_dir=out,
        model_factory=lambda w: Spy(tmp_path),
        verifier=lambda path, classes: {},
        name_fixer=lambda path, classes: False,
    )
    assert Path(seen[0]).resolve() == out.resolve()
    assert Path.cwd().resolve() != out.resolve()  # 元の cwd に戻る


def test_export_check_image_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import sys
    import types

    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda p: None))
    with pytest.raises(ex.ExportError, match="画像を読めない"):
        ex.export(out_dir=tmp_path / "m", check_image=tmp_path / "none.jpg")
    monkeypatch.setitem(sys.modules, "cv2", None)
    with pytest.raises(ex.ExportError, match="opencv が無い"):
        ex.export(out_dir=tmp_path / "m", check_image=tmp_path / "none.jpg")


def test_export_passes_check_image_to_verify(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import sys
    import types

    photo = np.ones((4, 4, 3))
    monkeypatch.setitem(sys.modules, "cv2", types.SimpleNamespace(imread=lambda p: photo))
    got: dict = {}

    def fake_verify(path, classes, **kw):
        got.update(kw)
        return {}

    monkeypatch.setattr(ex, "verify", fake_verify)
    world = FakeWorld(tmp_path)
    ex.export(
        out_dir=tmp_path / "models",
        model_factory=lambda w: world,
        name_fixer=lambda p, c: False,
        check_image=tmp_path / "deer.jpg",
    )
    assert got["image"] is photo


def test_ultralytics_errors_become_export_errors(tmp_path: Path) -> None:
    class Boom(FakeWorld):
        def set_classes(self, classes: list[str]) -> None:
            msg = "CLIP を取れない"
            raise RuntimeError(msg)

    with pytest.raises(ex.ExportError, match=r"ultralytics の書き出しに失敗.*RuntimeError"):
        ex.export(out_dir=tmp_path / "m", model_factory=lambda w: Boom(tmp_path))


def test_force_keeps_the_old_model_when_verification_fails(tmp_path: Path) -> None:
    run_export(tmp_path)
    target = tmp_path / "models" / "yolov8s-worldv2-deer.mlpackage"
    (target / "old-marker").write_text("old", encoding="utf-8")

    def reject(path: Path, classes: object) -> dict:
        msg = "合わない"
        raise ex.ExportError(msg)

    with pytest.raises(ex.ExportError):
        ex.export(
            out_dir=tmp_path / "models",
            force=True,
            model_factory=lambda w: FakeWorld(tmp_path),
            verifier=reject,
            name_fixer=lambda p, c: False,
        )
    assert (target / "old-marker").exists()  # 旧モデルは戻る
    assert (tmp_path / "models" / "yolov8s-worldv2-deer.failed.mlpackage").exists()
    assert not (tmp_path / "models" / "yolov8s-worldv2-deer.mlpackage.old").exists()


def test_force_replaces_old_model_on_success(tmp_path: Path) -> None:
    run_export(tmp_path)
    target = tmp_path / "models" / "yolov8s-worldv2-deer.mlpackage"
    (target / "old-marker").write_text("old", encoding="utf-8")
    run_export(tmp_path, force=True)
    assert not (target / "old-marker").exists()
    assert not (tmp_path / "models" / "yolov8s-worldv2-deer.mlpackage.old").exists()


def test_main_fails_when_check_image_finds_nothing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys
) -> None:
    world = FakeWorld(tmp_path)
    monkeypatch.setattr(ex, "_yolo_world", lambda: lambda weights: world)
    monkeypatch.setattr(ex, "_read_image", lambda path: np.zeros((4, 4, 3)))
    monkeypatch.setattr(ex, "verify", lambda path, classes, **kw: {"shape_verified": False})
    monkeypatch.setattr(ex, "_ensure_names", lambda path, classes: False)
    code = ex.main(["--out-dir", str(tmp_path / "m"), "--check-image", "deer.jpg"])
    assert code == 1
    assert "検出が出ず" in capsys.readouterr().err
