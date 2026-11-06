"""L0 の YOLO（CoreML）アダプタ（B1-3・B2-2）。compute units は設定（既定 cpu_and_ne）で選ぶ。

モデルは Ultralytics の NMS 付きエクスポートを前提にする: 入力は画像 1 つ、出力は
`confidence`（N×クラス数。MLProgram では 80 の倍数まで埋まる）と `coordinates`（N×4、正規化 xywh）、
クラス名はメタデータ `names`。
出力の形は開発用の Mac で実モデルを書き出して確かめた（2026-11-06）。ANE の fps は Mac mini の実機で
確かめる（Step 0。Deferred）。
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

import numpy as np

from detector.l0.inference import DeerDetector
from detector.ports import ConfigError, Detection

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping

    from detector.config import Config

__all__ = [
    "COMPUTE_UNIT_NAMES",
    "CoreMLDetector",
    "CoreMLOutputError",
    "LoadedModel",
    "load_coreml_detector",
    "load_with_coremltools",
    "parse_names",
]

# 設定の値 → coremltools.ComputeUnit の名前（coremltools 9.0 で確認）
COMPUTE_UNIT_NAMES = {
    "cpu_only": "CPU_ONLY",
    "cpu_and_gpu": "CPU_AND_GPU",
    "cpu_and_ne": "CPU_AND_NE",
    "all": "ALL",
}
MAX_NAMES_CHARS = 10_000
# ultralytics は MLProgram の NMS の不具合（issue #22309）を避けるため、クラスの列を
# 80 の倍数まで 0 で埋める（names は元のクラス数のまま）。埋めた列は読まない
CLASS_PAD = 80


class CoreMLOutputError(ValueError):
    """モデルの出力が想定の形でない。パイプラインはこの推論を infer.failed に数える。"""


class CoreMLModel(Protocol):
    def predict(self, data: dict[str, object]) -> Mapping[str, object]: ...


@dataclass(frozen=True)
class LoadedModel:
    model: CoreMLModel
    input_name: str
    input_size: tuple[int, int]  # (幅, 高さ)
    metadata: Mapping[str, str]


def parse_names(raw: object) -> tuple[str, ...]:
    """メタデータ `names`（"{0: 'deer', 1: 'car'}"）→ 添字順のクラス名（小文字）。deer が必須。"""
    if not isinstance(raw, str) or not raw or len(raw) > MAX_NAMES_CHARS:
        msg = "モデルのメタデータ names を読めない"
        raise ConfigError(msg)
    try:
        value = ast.literal_eval(raw)
    except (ValueError, SyntaxError, MemoryError, RecursionError) as exc:
        msg = "モデルのメタデータ names を読めない"
        raise ConfigError(msg) from exc
    if (
        not isinstance(value, dict)
        or not all(isinstance(k, int) and not isinstance(k, bool) for k in value)
        or sorted(value) != list(range(len(value)))
        or not all(isinstance(v, str) for v in value.values())
    ):
        msg = "モデルのメタデータ names は {0: 'deer', ...} の形にする"
        raise ConfigError(msg)
    names = tuple(value[i].strip().lower() for i in range(len(value)))
    if "deer" not in names:
        msg = "モデルのクラスに deer が無い（このモデルでは鹿を検知できない）"
        raise ConfigError(msg)
    return names


def _to_pil(image: np.ndarray) -> object:  # pragma: no cover  実機（Pillow は ultralytics の依存）
    from PIL import Image

    return Image.fromarray(image)


def _stretch(image: np.ndarray, size: tuple[int, int]) -> np.ndarray:
    width, height = size
    h, w = image.shape[:2]
    rows = np.arange(height) * h // height
    cols = np.arange(width) * w // width
    return np.ascontiguousarray(image[rows[:, None], cols[None, :]])


class CoreMLDetector:
    """BGR を RGB にしてモデルの入力の大きさへ引き伸ばし、NMS 済みの出力を Detection にする。"""

    def __init__(
        self,
        loaded: LoadedModel,
        names: tuple[str, ...],
        prepare: Callable[[np.ndarray], object] = _to_pil,
    ) -> None:
        self._loaded = loaded
        self._names = names
        self._prepare = prepare

    def detect(self, image: np.ndarray) -> list[Detection]:
        rgb = _stretch(image[:, :, ::-1], self._loaded.input_size)
        out = self._loaded.model.predict({self._loaded.input_name: self._prepare(rgb)})
        try:
            conf = np.asarray(out["confidence"], dtype=float)
            coords = np.asarray(out["coordinates"], dtype=float)
        except (KeyError, TypeError, ValueError) as exc:
            msg = "CoreML の出力に confidence / coordinates が無い"
            raise CoreMLOutputError(msg) from exc
        if conf.size == 0 and coords.size == 0:
            return []
        n = len(self._names)
        if (
            conf.ndim != 2
            or coords.ndim != 2
            or conf.shape[1] not in {n, -(-n // CLASS_PAD) * CLASS_PAD}
            or coords.shape[1] != 4
            or conf.shape[0] != coords.shape[0]
        ):
            msg = f"CoreML の出力の形が違う: confidence {conf.shape}, coordinates {coords.shape}"
            raise CoreMLOutputError(msg)
        # 誤差で 0〜1 をわずかに外れた座標は切り詰める（NaN は残し、DeerDetector が捨てる）
        coords = np.clip(coords, 0.0, 1.0)
        detections = []
        for row, box in zip(conf[:, :n], coords, strict=True):
            k = int(np.argmax(row))
            xywh = (float(box[0]), float(box[1]), float(box[2]), float(box[3]))
            detections.append(Detection(self._names[k], float(row[k]), xywh))
        return detections


def load_with_coremltools(path: str, compute_units: str) -> LoadedModel:
    """coremltools で読み込む。compute units は MLModel の引数で固定する（B1-3）。"""
    try:
        import coremltools as ct  # 任意の依存（pyproject の coreml）
    except ImportError as exc:
        msg = "coremltools が無い（pip install -e 'edge/detector[coreml]'）"
        raise ConfigError(msg) from exc

    unit = getattr(ct.ComputeUnit, COMPUTE_UNIT_NAMES[compute_units])
    model = ct.models.MLModel(path, compute_units=unit)
    for item in model.get_spec().description.input:
        if item.type.WhichOneof("Type") == "imageType":
            size = (int(item.type.imageType.width), int(item.type.imageType.height))
            return LoadedModel(model, item.name, size, dict(model.user_defined_metadata))
    msg = "CoreML モデルに画像の入力が無い"
    raise ConfigError(msg)


def load_coreml_detector(
    config: Config,
    loader: Callable[[str, str], LoadedModel] = load_with_coremltools,
    prepare: Callable[[np.ndarray], object] = _to_pil,
) -> DeerDetector:
    """設定からパイプラインに渡す検出器を作る。deer だけを確信度順に返す DeerDetector で包む。"""
    path = config.infer.model_path
    if not path:
        msg = "infer.model_path が空（CoreML のモデルのパスを書く）"
        raise ConfigError(msg)
    loaded = loader(path, config.coreml.compute_units)
    names = parse_names(loaded.metadata.get("names"))
    return DeerDetector(CoreMLDetector(loaded, names, prepare))
