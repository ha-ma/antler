"""設定ファイル（B1-2: 解像度と fps は設定ファイル）。TOML を読んで Config にする。"""

from __future__ import annotations

import tomllib
from dataclasses import dataclass, field, fields
from pathlib import Path

from detector.ports import ConfigError

__all__ = ["CameraConfig", "Config", "ConfigError", "InferConfig", "PipelineConfig", "load_config"]

MIN_TARGET_FPS = 5
MAX_TARGET_FPS = 10


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
class Config:
    camera: CameraConfig = field(default_factory=CameraConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    infer: InferConfig = field(default_factory=InferConfig)


_RANGES = {
    "device": (0, 64),
    "width": (1, 8192),
    "height": (1, 8192),
    "fps": (1, 240),
    "target_fps": (MIN_TARGET_FPS, MAX_TARGET_FPS),
    "budget_ms": (1, 1000),
}


def _section(cls: type, raw: object, name: str) -> object:
    if not isinstance(raw, dict):
        msg = f"[{name}] はテーブルにする"
        raise ConfigError(msg)
    known = {f.name: f for f in fields(cls)}
    values = {}
    for key, value in raw.items():
        if key not in known:
            msg = f"知らないキー: {name}.{key}"
            raise ConfigError(msg)
        default = getattr(cls(), key)
        if isinstance(value, bool) or not isinstance(value, type(default)):
            msg = f"{name}.{key} の型が違う（{type(default).__name__} にする）"
            raise ConfigError(msg)
        if key in _RANGES and not _RANGES[key][0] <= value <= _RANGES[key][1]:
            lo, hi = _RANGES[key]
            msg = f"{name}.{key} は {lo}〜{hi} にする: {value}"
            raise ConfigError(msg)
        values[key] = value
    return cls(**values)


def load_config(path: str | Path) -> Config:
    try:
        raw = tomllib.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, tomllib.TOMLDecodeError) as exc:
        msg = f"設定ファイルを読めない: {Path(path).name} ({type(exc).__name__})"
        raise ConfigError(msg) from exc
    sections = {"camera": CameraConfig, "pipeline": PipelineConfig, "infer": InferConfig}
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
