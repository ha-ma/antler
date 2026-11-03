"""設定ファイル（B1-2: 解像度と fps は設定ファイル）。TOML を読んで Config にする。"""

from __future__ import annotations

import math
import tomllib
from dataclasses import dataclass, field, fields
from itertools import pairwise
from pathlib import Path

from detector.ports import ConfigError

__all__ = [
    "CameraConfig",
    "Config",
    "ConfigError",
    "InferConfig",
    "JudgeConfig",
    "PipelineConfig",
    "ServerConfig",
    "load_config",
]

MIN_TARGET_FPS = 5
MAX_TARGET_FPS = 10

# ボックスの高さ（画面に対する比）→ 距離 m。計算上の暫定値。実車の画角で測り直す（調査走行）
DEFAULT_DISTANCE_TABLE: tuple[tuple[float, float], ...] = (
    (0.03, 55.0),
    (0.05, 33.0),
    (0.10, 16.0),
    (0.20, 8.0),
    (0.40, 4.0),
)


@dataclass(frozen=True)
class CameraConfig:
    source: str = "device"
    device: int = 0
    path: str = ""
    width: int = 1280
    height: int = 720
    fps: int = 60


@dataclass(frozen=True)
class PipelineConfig:
    target_fps: int = 10


@dataclass(frozen=True)
class InferConfig:
    model_path: str = ""
    budget_ms: int = 100


@dataclass(frozen=True)
class JudgeConfig:
    threshold: float = 0.4
    off_after_s: float = 1.5
    stall_after_s: float = 3.0
    distance_table: tuple[tuple[float, float], ...] = DEFAULT_DISTANCE_TABLE


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    max_clients: int = 16


@dataclass(frozen=True)
class Config:
    camera: CameraConfig = field(default_factory=CameraConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    infer: InferConfig = field(default_factory=InferConfig)
    judge: JudgeConfig = field(default_factory=JudgeConfig)
    server: ServerConfig = field(default_factory=ServerConfig)


_RANGES = {
    "device": (0, 64),
    "width": (1, 8192),
    "height": (1, 8192),
    "fps": (1, 240),
    "target_fps": (MIN_TARGET_FPS, MAX_TARGET_FPS),
    "budget_ms": (1, 1000),
    "threshold": (0.0, 1.0),
    "off_after_s": (0.5, 10.0),
    "stall_after_s": (1.0, 30.0),
    "port": (1, 65535),
    "max_clients": (1, 64),
}


def _number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool) and math.isfinite(value)


def _distance_table(value: object, where: str) -> tuple[tuple[float, float], ...]:
    """[[高さ, m], ...]。2 点以上、高さは増え、距離は減る（大きく写るほど近い）。"""
    if not isinstance(value, list) or len(value) < 2:
        msg = f"{where} は [[高さ, m], ...] の 2 点以上にする"
        raise ConfigError(msg)
    table = []
    for row in value:
        if not (isinstance(row, list) and len(row) == 2 and all(_number(v) for v in row)):
            msg = f"{where} の各行は [高さ, m] の数値にする"
            raise ConfigError(msg)
        height, metres = float(row[0]), float(row[1])
        if not (0.0 < height <= 1.0) or metres <= 0.0:
            msg = f"{where} の高さは 0 超 1 以下、距離は正にする: {row}"
            raise ConfigError(msg)
        table.append((height, metres))
    if any(b[0] <= a[0] or b[1] >= a[1] for a, b in pairwise(table)):
        msg = f"{where} は高さが増えるほど距離が減る列にする"
        raise ConfigError(msg)
    return tuple(table)


def _check(name: str, key: str, default: object, value: object) -> object:
    if key == "distance_table":
        return _distance_table(value, f"{name}.{key}")
    if isinstance(default, float):
        ok = _number(value)
    else:
        ok = not isinstance(value, bool) and isinstance(value, type(default))
    if not ok:
        msg = f"{name}.{key} の型が違う（{type(default).__name__} にする）"
        raise ConfigError(msg)
    if key in _RANGES and not _RANGES[key][0] <= value <= _RANGES[key][1]:  # type: ignore[operator]
        lo, hi = _RANGES[key]
        msg = f"{name}.{key} は {lo}〜{hi} にする: {value}"
        raise ConfigError(msg)
    return float(value) if isinstance(default, float) else value  # type: ignore[arg-type]


def _section(cls: type, raw: object, name: str) -> object:
    if not isinstance(raw, dict):
        msg = f"[{name}] はテーブルにする"
        raise ConfigError(msg)
    known = {f.name for f in fields(cls)}
    values = {}
    for key, value in raw.items():
        if key not in known:
            msg = f"知らないキー: {name}.{key}"
            raise ConfigError(msg)
        values[key] = _check(name, key, getattr(cls(), key), value)
    return cls(**values)


def load_config(path: str | Path) -> Config:
    try:
        raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        msg = f"設定ファイルを読めない: {Path(path).name} ({type(exc).__name__})"
        raise ConfigError(msg) from exc
    sections = {
        "camera": CameraConfig,
        "pipeline": PipelineConfig,
        "infer": InferConfig,
        "judge": JudgeConfig,
        "server": ServerConfig,
    }
    for key in raw:
        if key not in sections:
            msg = f"知らないセクション: {key}"
            raise ConfigError(msg)
    parsed = {name: _section(cls, raw[name], name) for name, cls in sections.items() if name in raw}
    config = Config(**parsed)
    if config.camera.source not in ("device", "file"):
        msg = f"camera.source は device か file: {config.camera.source!r}"
        raise ConfigError(msg)
    if config.camera.source == "file" and not config.camera.path:
        msg = "camera.source が file のときは camera.path が要る"
        raise ConfigError(msg)
    return config
