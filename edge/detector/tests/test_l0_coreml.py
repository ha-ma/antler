"""CU-1・CU-2・MV-1: CoreML の compute units と出力の読み取り。coremltools は偽物で差し替える。"""

import sys
from dataclasses import replace
from types import SimpleNamespace

import numpy as np
import pytest

import detector.inference as legacy
from detector.config import Config, CoremlConfig, InferConfig
from detector.l0 import coreml, inference
from detector.l0.coreml import (
    CoreMLDetector,
    CoreMLOutputError,
    LoadedModel,
    load_coreml_detector,
    parse_names,
)
from detector.pipeline import process_frames
from detector.ports import ConfigError

from .conftest import frames_at_fps, named
from .test_runner import ListSource

NAMES = "{0: 'deer', 1: 'car'}"


class FakeModel:
    def __init__(self, outputs):
        self.outputs = outputs
        self.inputs = []

    def predict(self, data):
        self.inputs.append(data)
        return self.outputs


def loaded(outputs, size=(640, 640), names=NAMES):
    return LoadedModel(FakeModel(outputs), "image", size, {"names": names})


def fake_coremltools(monkeypatch, names=NAMES, size=(640, 480)):
    """coremltools の代わり。MLModel に渡った compute_units を覚える。"""
    made = []
    units = SimpleNamespace(CPU_ONLY="cpu", CPU_AND_GPU="gpu", CPU_AND_NE="ne", ALL="all")
    image_input = SimpleNamespace(
        name="image",
        type=SimpleNamespace(
            WhichOneof=lambda _: "imageType",
            imageType=SimpleNamespace(width=size[0], height=size[1]),
        ),
    )
    other_input = SimpleNamespace(
        name="iouThreshold", type=SimpleNamespace(WhichOneof=lambda _: "doubleType")
    )

    class MLModel:
        def __init__(self, path, compute_units):
            made.append((path, compute_units))
            self.user_defined_metadata = {"names": names}

        def get_spec(self):
            return SimpleNamespace(description=SimpleNamespace(input=[other_input, image_input]))

        def predict(self, data):
            return {"confidence": [[0.9, 0.1]], "coordinates": [[0.3, 0.5, 0.1, 0.2]]}

    module = SimpleNamespace(ComputeUnit=units, models=SimpleNamespace(MLModel=MLModel))
    monkeypatch.setitem(sys.modules, "coremltools", module)
    return made


def config(units="cpu_and_ne", path="deer.mlpackage"):
    return Config(infer=InferConfig(model_path=path), coreml=CoremlConfig(units))


# CU-1a
def test_cu1a_既定ではCPU_AND_NEで読み込む(monkeypatch):
    made = fake_coremltools(monkeypatch)
    # Pillow は実機だけの依存（CI に無い）。画像の変換は差し替える
    det = load_coreml_detector(
        Config(infer=InferConfig(model_path="deer.mlpackage")), prepare=lambda a: a
    )
    assert made == [("deer.mlpackage", "ne")]
    found = det.detect(np.zeros((480, 640, 3), dtype=np.uint8))
    assert [d.label for d in found] == ["deer"]


# CU-1b
@pytest.mark.parametrize(
    ("units", "expected"), [("cpu_only", "cpu"), ("cpu_and_gpu", "gpu"), ("all", "all")]
)
def test_cu1b_設定どおりのcompute_unitsが渡る(monkeypatch, units, expected):
    made = fake_coremltools(monkeypatch)
    load_coreml_detector(config(units))
    assert made == [("deer.mlpackage", expected)]
    names = set(coreml.COMPUTE_UNIT_NAMES.values())
    assert names == {"CPU_ONLY", "CPU_AND_GPU", "CPU_AND_NE", "ALL"}


# CU-1c
def test_cu1c_モデルのパスが空ならConfigError(monkeypatch):
    with pytest.raises(ConfigError, match=r"infer\.model_path"):
        load_coreml_detector(config(path=""), loader=lambda *_: pytest.fail("読まない"))
    monkeypatch.setitem(sys.modules, "coremltools", None)  # 任意の依存が入っていない
    with pytest.raises(ConfigError, match="coremltools が無い"):
        load_coreml_detector(config())


def test_画像の入力が無いモデルはConfigError(monkeypatch):
    fake_coremltools(monkeypatch)
    spec = SimpleNamespace(description=SimpleNamespace(input=[]))
    monkeypatch.setattr(
        sys.modules["coremltools"].models.MLModel, "get_spec", lambda self: spec, raising=True
    )
    with pytest.raises(ConfigError, match="画像の入力"):
        load_coreml_detector(config())


# CU-2a
def test_cu2a_confidenceとcoordinatesからクラス名つきの検出():
    out = {
        "confidence": np.array([[0.2, 0.7], [0.85, 0.1]]),
        "coordinates": np.array([[0.5, 0.5, 0.2, 0.2], [0.3, 0.4, 0.1, 0.15]]),
    }
    det = CoreMLDetector(loaded(out), ("deer", "car"), prepare=lambda a: a)
    found = det.detect(np.zeros((480, 640, 3), dtype=np.uint8))
    assert [(d.label, d.conf) for d in found] == [("car", 0.7), ("deer", 0.85)]
    assert found[1].xywh == (0.3, 0.4, 0.1, 0.15)
    empty = CoreMLDetector(loaded({"confidence": [], "coordinates": []}), ("deer",), lambda a: a)
    assert empty.detect(np.zeros((4, 4, 3), dtype=np.uint8)) == []


# CU-2b
@pytest.mark.parametrize(
    "out",
    [
        {"confidence": [[0.9, 0.1]], "coordinates": [[0.5, 0.5, 0.1, 0.1]] * 2},  # 行数違い
        {"confidence": [[0.9, 0.1]], "coordinates": [[0.5, 0.5, 0.1]]},  # 列が 3
        {"confidence": [[0.9]], "coordinates": [[0.5, 0.5, 0.1, 0.1]]},  # クラス数違い
        {"confidence": [0.9, 0.1], "coordinates": [0.5, 0.5, 0.1, 0.1]},  # 1 次元
        {"var_1": [[0.9, 0.1]]},  # 出力が無い
        {"confidence": "壊れた", "coordinates": [[0.5, 0.5, 0.1, 0.1]]},
    ],
)
def test_cu2b_形の違う出力は例外でパイプラインはinfer_failedに数える(out, logbuf):
    det = CoreMLDetector(loaded(out), ("deer", "car"), prepare=lambda a: a)
    with pytest.raises(CoreMLOutputError):
        det.detect(np.zeros((480, 640, 3), dtype=np.uint8))
    results = list(process_frames(ListSource(frames_at_fps(10, 2)), Config(), det))
    assert all(r.failed for r in results)
    assert len(named(logbuf, "infer.failed")) == 2


# CU-2c
def test_cu2c_メタデータのnamesを読む():
    assert parse_names("{0: 'deer', 1: 'car'}") == ("deer", "car")
    bad_names = [None, "", "deer", "[0, 1]", "{1: 'deer'}", "{0: 1}", "{0: 'deer'", "x" * 10_001]
    for bad in [*bad_names, "{0: 'deer', '1': 'car'}", "{True: 'deer'}"]:
        with pytest.raises(ConfigError, match="names"):
            parse_names(bad)


# CU-2d
def test_cu2d_BGRをRGBにしてモデルの入力の大きさに引き伸ばす():
    model = loaded({"confidence": [], "coordinates": []}, size=(8, 6))
    det = CoreMLDetector(model, ("deer",), prepare=lambda a: a)
    bgr = np.zeros((480, 640, 3), dtype=np.uint8)
    bgr[:, :, 0] = 10  # B
    bgr[:, :, 2] = 200  # R
    det.detect(bgr)
    sent = model.model.inputs[0]["image"]
    assert sent.shape == (6, 8, 3)
    assert (sent[0, 0, 0], sent[0, 0, 2]) == (200, 10)  # RGB の順


# CU-2e
def test_cu2e_deerの無いモデルは拒否_大文字は小文字に_端の座標は切り詰める(monkeypatch):
    with pytest.raises(ConfigError, match="deer が無い"):
        parse_names("{0: 'person', 1: 'car'}")
    fake_coremltools(monkeypatch, names="{0: 'person'}")
    with pytest.raises(ConfigError, match="deer が無い"):
        load_coreml_detector(config())
    assert parse_names("{0: ' Deer '}") == ("deer",)
    out = {"confidence": [[0.9]], "coordinates": [[0.98, 0.5, 0.05, 1.0000001]]}
    det = inference.DeerDetector(CoreMLDetector(loaded(out), ("deer",), prepare=lambda a: a))
    found = det.detect(np.zeros((480, 640, 3), dtype=np.uint8))
    assert len(found) == 1 and found[0].xywh[3] == 1.0
    nan = {"confidence": [[0.9]], "coordinates": [[float("nan"), 0.5, 0.05, 0.1]]}
    det = inference.DeerDetector(CoreMLDetector(loaded(nan), ("deer",), prepare=lambda a: a))
    assert det.detect(np.zeros((4, 4, 3), dtype=np.uint8)) == [] and det.last_invalid == 1


def padded(rows, width):
    """ultralytics が MLProgram の NMS で作る形: クラスの列を width まで埋める。"""
    conf = np.zeros((len(rows), width))
    for i, row in enumerate(rows):
        conf[i, : len(row)] = row
    return conf


# CU-2f
def test_cu2f_80の倍数まで埋めたクラスの列は無視して読む():
    image = np.zeros((480, 640, 3), dtype=np.uint8)
    conf = padded([[0.6], [0.3]], 80)
    conf[1, 5] = 0.99  # 埋めた列に値があっても選ばない
    out = {"confidence": conf, "coordinates": [[0.5, 0.5, 0.2, 0.2], [0.3, 0.4, 0.1, 0.1]]}
    found = CoreMLDetector(loaded(out), ("deer",), prepare=lambda a: a).detect(image)
    assert [(d.label, d.conf) for d in found] == [("deer", 0.6), ("deer", 0.3)]
    two = {"confidence": padded([[0.2, 0.7]], 80), "coordinates": [[0.5, 0.5, 0.2, 0.2]]}
    found = CoreMLDetector(loaded(two), ("deer", "car"), prepare=lambda a: a).detect(image)
    assert [(d.label, d.conf) for d in found] == [("car", 0.7)]
    for width in (79, 81, 160):
        bad = {"confidence": padded([[0.6]], width), "coordinates": [[0.5, 0.5, 0.2, 0.2]]}
        with pytest.raises(CoreMLOutputError, match="形が違う"):
            CoreMLDetector(loaded(bad), ("deer",), prepare=lambda a: a).detect(image)
    # 切り上げの端: 80 クラスは 80 列だけ、81 クラスは 81 列か 160 列
    for n, ok, ng in ((80, (80,), (160,)), (81, (81, 160), (80, 162))):
        names = ("deer", *(f"c{i}" for i in range(1, n)))
        for width in (*ok, *ng):
            out = {"confidence": padded([[0.6]], width), "coordinates": [[0.5, 0.5, 0.2, 0.2]]}
            det = CoreMLDetector(loaded(out), names, prepare=lambda a: a)
            if width in ok:
                assert [(d.label, d.conf) for d in det.detect(image)] == [("deer", 0.6)]
            else:
                with pytest.raises(CoreMLOutputError, match="形が違う"):
                    det.detect(image)


# MV-1
def test_mv1_detector_inferenceから従来どおりimportできl0と同じもの():
    assert legacy.DeerDetector is inference.DeerDetector
    assert legacy.ScriptedDetector is inference.ScriptedDetector
    assert legacy.Detection is inference.Detection
    assert set(legacy.__all__) == {"DeerDetector", "Detection", "Detector", "ScriptedDetector"}
    assert replace(Config(), coreml=CoremlConfig("all")).coreml.compute_units == "all"
