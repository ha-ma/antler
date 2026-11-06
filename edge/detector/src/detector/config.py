"""設定ファイル（B1-2: 解像度と fps は設定ファイル）。TOML を読んで Config にする。"""

from __future__ import annotations

import math
import re
import tomllib
from dataclasses import dataclass, field, fields, replace
from itertools import pairwise
from pathlib import Path

from detector.ports import ConfigError

__all__ = [
    "COMPUTE_UNITS",
    "CameraConfig",
    "CaptureConfig",
    "CaptureServerConfig",
    "Config",
    "ConfigError",
    "CoremlConfig",
    "InferConfig",
    "JudgeConfig",
    "L0FilterConfig",
    "L1Config",
    "L2Config",
    "PipelineConfig",
    "PwaServerConfig",
    "ServerConfig",
    "TlsConfig",
    "TrackerConfig",
    "load_config",
    "resolve_path",
]

# CoreML の compute units（B1-3）。L0（YOLO）は CPU と Neural Engine、GPU は L1（MLX）に空ける
COMPUTE_UNITS = ("cpu_only", "cpu_and_gpu", "cpu_and_ne", "all")

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
    threshold: float = 0.8  # 赤の下限。2026-11-03 ユーザー判断（変更指示 B2-3 どおり。edge-l0）
    off_after_s: float = 1.5
    stall_after_s: float = 3.0
    distance_table: tuple[tuple[float, float], ...] = DEFAULT_DISTANCE_TABLE


@dataclass(frozen=True)
class ServerConfig:
    host: str = "127.0.0.1"
    port: int = 8765
    max_clients: int = 16


@dataclass(frozen=True)
class CoremlConfig:
    compute_units: str = "cpu_and_ne"


@dataclass(frozen=True)
class TrackerConfig:
    """L0 のトラッカー（B2-2）。画角・車線の半幅は暫定値。実車で測り直す（調査走行）。"""

    min_conf: float = 0.4
    iou_threshold: float = 0.3
    max_age_s: float = 1.0
    window_s: float = 1.0
    hfov_deg: float = 70.0
    lane_half_width_m: float = 1.75


@dataclass(frozen=True)
class L0FilterConfig:
    """L0 の誤検出の後処理（docs/specs/l0-fp-filter）。即時ルールの手前で枠を除く・弱める。

    既定は「本物の鹿ならカメラから 2 m より近い」枠だけに当たる（水平画角 70° の暫定値で見積もり）。
    直前 3 秒に通した枠から続く枠は除かない（近づいた鹿・止まった車の前の鹿）。
    無視する領域は車載カメラの取り付けで決まるので、既定は空（測ってから車ごとの設定に書く）。
    """

    enabled: bool = True
    max_area: float = 0.7  # 面積（w×h）がこれ以上の枠を除く
    max_width: float = 0.85  # 幅がこれ以上で、
    min_height_at_max_width: float = 0.5  # 高さもこれ以上の枠を除く（遠くの横長の群れは残す）
    ignore_regions: tuple[tuple[float, float, float, float], ...] = ()  # [x1, y1, x2, y2] の列
    region_min_inside: float = 0.8  # 枠の面積のうち領域に入る割合がこれ以上なら
    region_conf_scale: float = 0.5  # 確信度にこれを掛ける（0 なら除く）


@dataclass(frozen=True)
class L1Config:
    """L1（local-jev への 4 問、B2-4〜B2-8）。降格だけに使う。赤は L0 が鳴らす（edge-l1）。

    接続先の既定は 8766（local-jev の既定 8765 は WebSocket の既定とぶつかる。推奨で決定）。
    環境変数 TYPESAFE_BASE_URL があればそちらが優先（l1.client.resolve_base_url）。
    """

    enabled: bool = True
    base_url: str = "http://127.0.0.1:8766"
    model: str = "jev-latest"
    rate_hz: float = 2.5
    timeout_ms: int = 800
    override_conf: float = 0.9  # B2-5 の MUST。0.9 より下げられない
    l2_route_conf: tuple[float, float] = (0.5, 0.9)
    wait_for_l1_before_red: bool = False  # B2-8（MAY）。true でも保留は 150 ms まで
    calibration_path: str = "calibration.json"  # 相対パスは設定ファイルのディレクトリから
    # PWA の車の状態（pwa-uplink）。"pwa" = 届いた実値を使う（校正が real か校正なしのときだけ）。
    # "fixed" = 常に固定値（60 km/h・inside・night・low）。校正のずれを疑うときの安全弁
    vehicle_state: str = "pwa"
    vehicle_max_age_s: float = 10.0  # ゾーンと光の期限（受け取った時刻から）。速度は 3 秒


@dataclass(frozen=True)
class L2Config:
    """L2（任意の Claude Vision、Step 5）。未実装で、今は値を確かめるだけ。"""

    enabled: str = "auto"


@dataclass(frozen=True)
class CaptureConfig:
    """検知フレームの保存（B2-5、docs/specs/edge-capture）。保存は赤の経路の外で行う。"""

    enabled: bool = True
    dir: str = "captures"  # 相対パスは設定ファイルのディレクトリから
    image_width: int = 320  # B3-3。高さは 4:3
    jpeg_quality: int = 80
    trigger_conf: float = 0.8  # 既定は L0 の赤の閾値（judge.threshold）と同じ
    min_interval_s: float = 2.0
    max_per_run: int = 300
    max_items: int = 2000
    queue_size: int = 8
    l1_attach_window_s: float = 3.0  # l1Probs を付ける、答えの前後の秒数
    retention_hours: int = 24  # この時間でどれも消す（送信済みも。借り手が替わった車に残さない）


@dataclass(frozen=True)
class CaptureServerConfig:
    """PWA が走行後に Capture を取りに来る HTTP（docs/specs/edge-capture E5）。

    8765（WebSocket）・8766（local-jev）とぶつからない 8767。allowed_origins が空なら、
    ブラウザの別オリジンからの書き込みを許さない（CORS ヘッダを付けない）。
    """

    host: str = "127.0.0.1"
    port: int = 8767
    allowed_origins: tuple[str, ...] = ()


@dataclass(frozen=True)
class TlsConfig:
    """車ごとの CA で https / wss にする（docs/specs/pwa-https R2）。

    パスは設定ファイルのディレクトリから。cert と key がどちらも空なら TLS を使わない
    （ws / http。開発用）。片方だけは ConfigError。ca_cert は pwa_server が http の設定ページで
    配る CA の証明書（鍵ではない）。
    """

    cert: str = ""
    key: str = ""
    ca_cert: str = ""


@dataclass(frozen=True)
class PwaServerConfig:
    """PWA の静的配信（https）と CA の配布（http）。別プロセス `python -m detector.pwa_server`。

    macOS で 1024 未満は管理者が要るので 8443 / 8080。dist は設定ファイルのディレクトリから。
    """

    host: str = "127.0.0.1"
    https_port: int = 8443
    http_port: int = 8080
    dist: str = "../../apps/pwa/dist"


@dataclass(frozen=True)
class Config:
    camera: CameraConfig = field(default_factory=CameraConfig)
    pipeline: PipelineConfig = field(default_factory=PipelineConfig)
    infer: InferConfig = field(default_factory=InferConfig)
    judge: JudgeConfig = field(default_factory=JudgeConfig)
    server: ServerConfig = field(default_factory=ServerConfig)
    coreml: CoremlConfig = field(default_factory=CoremlConfig)
    tracker: TrackerConfig = field(default_factory=TrackerConfig)
    l0_filter: L0FilterConfig = field(default_factory=L0FilterConfig)
    l1: L1Config = field(default_factory=L1Config)
    l2: L2Config = field(default_factory=L2Config)
    capture: CaptureConfig = field(default_factory=CaptureConfig)
    capture_server: CaptureServerConfig = field(default_factory=CaptureServerConfig)
    tls: TlsConfig = field(default_factory=TlsConfig)
    pwa_server: PwaServerConfig = field(default_factory=PwaServerConfig)
    source_dir: str = field(default="", compare=False)  # 読んだ設定ファイルのディレクトリ


# JudgeRequest の model と同じ字種（schema-judge R1）
MODEL_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
L2_MODES = ("auto", "off")
VEHICLE_STATES = ("pwa", "fixed")

_RANGES = {
    "device": (0, 64),
    "width": (1, 8192),
    "height": (1, 8192),
    "fps": (1, 240),
    "target_fps": (MIN_TARGET_FPS, MAX_TARGET_FPS),
    "budget_ms": (1, 1000),
    "threshold": (0.0, 1.0),
    "off_after_s": (0.5, 10.0),
    "stall_after_s": (1.0, 10.0),
    "port": (1, 65535),
    "https_port": (1, 65535),
    "http_port": (1, 65535),
    "max_clients": (1, 64),
    "min_conf": (0.0, 1.0),
    "iou_threshold": (0.05, 0.95),
    "max_age_s": (0.1, 5.0),
    "window_s": (0.2, 5.0),
    "hfov_deg": (10.0, 170.0),
    "lane_half_width_m": (0.5, 5.0),
    "rate_hz": (2.0, 3.0),
    "timeout_ms": (50, 800),
    "override_conf": (0.9, 1.0),
    "vehicle_max_age_s": (1.0, 60.0),
    "image_width": (160, 640),
    "jpeg_quality": (50, 95),
    "trigger_conf": (0.4, 1.0),
    "min_interval_s": (0.5, 60.0),
    "max_per_run": (1, 10_000),
    "max_items": (10, 20_000),
    "queue_size": (1, 64),
    "l1_attach_window_s": (0.5, 10.0),
    "retention_hours": (1, 168),
    # l0_filter（下限は 2 m 以遠の鹿の枠（面積 0.64・幅 0.68 まで）を除かないため。l0-fp-filter R6）
    "max_area": (0.65, 1.0),
    "max_width": (0.7, 1.0),
    "min_height_at_max_width": (0.4, 1.0),
    "region_min_inside": (0.8, 1.0),
    "region_conf_scale": (0.0, 0.95),
}

# 無視する領域の制約（l0-fp-filter R2）。車線の見張りの帯は 3 m 以遠の車線上の鹿が写る範囲
MAX_IGNORE_REGIONS = 8
MAX_REGION_AREA = 0.25
MAX_REGIONS_TOTAL_AREA = 0.4
LANE_WATCH_BAND = (0.25, 0.3, 0.75, 0.8)  # x1, y1, x2, y2
HORIZON_Y = 0.5  # 水平の取り付けでの地平線

# オリジン（スキームとホスト、任意のポート）。パス・ワイルドカード・空は許さない
_ORIGIN_RE = re.compile(r"https?://[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?(?::\d{1,5})?")


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


def _route_conf(value: object, where: str) -> tuple[float, float]:
    """[下, 上]。0 ≤ 下 < 上 ≤ 1（上が override_conf を超えないかは load_config で見る）。"""
    if not (isinstance(value, list) and len(value) == 2 and all(_number(v) for v in value)):
        msg = f"{where} は [下, 上] の 2 つの数にする"
        raise ConfigError(msg)
    lo, hi = float(value[0]), float(value[1])
    if not 0.0 <= lo < hi <= 1.0:
        msg = f"{where} は 0 ≤ 下 < 上 ≤ 1 にする: {value}"
        raise ConfigError(msg)
    return (lo, hi)


def _region(row: object, where: str) -> tuple[float, float, float, float]:
    """1 つの領域。画面の辺に接し、車線の見張りの帯と交わらず（接するだけは可）、面積 0.25 以下。"""
    if not (isinstance(row, list) and len(row) == 4 and all(_number(v) for v in row)):
        msg = f"{where} の各行は [x1, y1, x2, y2] の数値にする"
        raise ConfigError(msg)
    x1, y1, x2, y2 = (float(v) for v in row)
    if not (0.0 <= x1 < x2 <= 1.0 and 0.0 <= y1 < y2 <= 1.0):
        msg = f"{where} は 0 ≤ x1 < x2 ≤ 1、0 ≤ y1 < y2 ≤ 1 にする: {row}"
        raise ConfigError(msg)
    if not (x1 == 0.0 or y1 == 0.0 or x2 == 1.0 or y2 == 1.0):
        msg = f"{where} の領域は画面の辺のどれかに接するようにする（車の部品は端に写る）: {row}"
        raise ConfigError(msg)
    bx1, by1, bx2, by2 = LANE_WATCH_BAND
    if x1 < bx2 and bx1 < x2 and y1 < by2 and by1 < y2:
        msg = f"{where} は車線の見張りの帯 {list(LANE_WATCH_BAND)} と交われない: {row}"
        raise ConfigError(msg)
    if y1 < HORIZON_Y < y2:
        # 路肩の鹿は地平線の上下にまたがって写る。画面の端の縦の帯で路肩を覆えないようにする
        msg = f"{where} は地平線（y {HORIZON_Y}）をまたげない（路肩の鹿を弱めない）: {row}"
        raise ConfigError(msg)
    if (x2 - x1) * (y2 - y1) > MAX_REGION_AREA + 1e-9:  # 0.25 ちょうどを誤差で拒まない
        msg = f"{where} の 1 つの領域は面積 {MAX_REGION_AREA} 以下にする: {row}"
        raise ConfigError(msg)
    return (x1, y1, x2, y2)


def _regions(value: object, where: str) -> tuple[tuple[float, float, float, float], ...]:
    """無視する領域 [[x1, y1, x2, y2], ...]。8 個まで、面積の和 0.4 以下（l0-fp-filter R2）。"""
    if not isinstance(value, list) or len(value) > MAX_IGNORE_REGIONS:
        msg = f"{where} は [[x1, y1, x2, y2], ...] の {MAX_IGNORE_REGIONS} 個までにする"
        raise ConfigError(msg)
    regions = tuple(_region(row, where) for row in value)
    total = sum((x2 - x1) * (y2 - y1) for x1, y1, x2, y2 in regions)
    if total > MAX_REGIONS_TOTAL_AREA + 1e-9:
        msg = f"{where} の面積の和は {MAX_REGIONS_TOTAL_AREA} 以下にする"
        raise ConfigError(msg)
    return regions


def _origins(value: object, where: str) -> tuple[str, ...]:
    """CORS の許可リスト。`http(s)://host[:port]` の文字列だけ（* もパスも許さない）。"""
    if not isinstance(value, list):
        msg = f"{where} は文字列の配列にする"
        raise ConfigError(msg)
    for origin in value:
        if not isinstance(origin, str) or _ORIGIN_RE.fullmatch(origin) is None:
            msg = f"{where} は http(s)://host[:port] の形だけ（* もパスも不可）: {origin!r}"
            raise ConfigError(msg)
        port = origin.rsplit(":", 1)[-1]
        if port.isdigit() and not 1 <= int(port) <= 65535:
            msg = f"{where} のポートは 1〜65535: {origin!r}"
            raise ConfigError(msg)
    return tuple(value)


def _text(name: str, key: str, value: str) -> None:
    where = f"{name}.{key}"
    if name == "capture" and key == "dir" and not value.strip():
        msg = f"{where} は空にできない"
        raise ConfigError(msg)
    if key == "base_url" and not value.strip().startswith(("http://", "https://")):
        msg = f"{where} は http:// か https:// で始まる URL にする（空にできない）"
        raise ConfigError(msg)
    if key == "model" and not MODEL_RE.fullmatch(value):
        msg = f"{where} は英数字で始まる 64 字までの英数字と . _ : - にする"
        raise ConfigError(msg)
    if name == "l2" and key == "enabled" and value not in L2_MODES:
        msg = f"{where} は {' / '.join(L2_MODES)} のどれか: {value!r}"
        raise ConfigError(msg)
    if name == "l1" and key == "vehicle_state" and value not in VEHICLE_STATES:
        msg = f"{where} は {' / '.join(VEHICLE_STATES)} のどれか: {value!r}"
        raise ConfigError(msg)
    if key == "calibration_path" and not value.strip():
        msg = f"{where} は空にできない"
        raise ConfigError(msg)


def _check(name: str, key: str, default: object, value: object) -> object:
    if key == "distance_table":
        return _distance_table(value, f"{name}.{key}")
    if key == "l2_route_conf":
        return _route_conf(value, f"{name}.{key}")
    if key == "allowed_origins":
        return _origins(value, f"{name}.{key}")
    if key == "ignore_regions":
        return _regions(value, f"{name}.{key}")
    if isinstance(default, bool):
        ok = isinstance(value, bool)
    elif isinstance(default, float):
        ok = _number(value)
    else:
        ok = not isinstance(value, bool) and isinstance(value, type(default))
    if not ok:
        msg = f"{name}.{key} の型が違う（{type(default).__name__} にする）"
        raise ConfigError(msg)
    if key == "compute_units" and value not in COMPUTE_UNITS:
        msg = f"{name}.{key} は {' / '.join(COMPUTE_UNITS)} のどれか: {value!r}"
        raise ConfigError(msg)
    if isinstance(value, str):
        _text(name, key, value)
    if key == "host" and not str(value).strip():
        msg = f"{name}.{key} は空にできない（全インターフェースを開けない）"
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
        "coreml": CoremlConfig,
        "tracker": TrackerConfig,
        "l0_filter": L0FilterConfig,
        "l1": L1Config,
        "l2": L2Config,
        "capture": CaptureConfig,
        "capture_server": CaptureServerConfig,
        "tls": TlsConfig,
        "pwa_server": PwaServerConfig,
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
    if config.tracker.min_conf > config.judge.threshold:
        # 赤なのに主トラックが無く、L1 が聞けない（edge-l0 の Deferred を edge-l1 で回収）
        msg = "tracker.min_conf は judge.threshold 以下にする"
        raise ConfigError(msg)
    if config.capture.trigger_conf < config.tracker.min_conf:
        msg = "capture.trigger_conf は tracker.min_conf 以上にする"
        raise ConfigError(msg)
    if config.l1.l2_route_conf[1] > config.l1.override_conf:
        msg = "l1.l2_route_conf の上は l1.override_conf 以下にする"
        raise ConfigError(msg)
    if bool(config.tls.cert.strip()) != bool(config.tls.key.strip()):
        # 片方だけで平文に戻ると、https の PWA が wss に届かず理由が分からなくなる（pwa-https R2）
        msg = "tls.cert と tls.key は両方書くか、両方空にする"
        raise ConfigError(msg)
    if config.tls.ca_cert.strip() and not config.tls.cert.strip():
        msg = "tls.ca_cert だけでは TLS にならない（tls.cert と tls.key も書く）"
        raise ConfigError(msg)
    if config.pwa_server.https_port == config.pwa_server.http_port:
        msg = "pwa_server.https_port と pwa_server.http_port は別にする"
        raise ConfigError(msg)
    if not config.pwa_server.dist.strip():
        msg = "pwa_server.dist は空にできない"
        raise ConfigError(msg)
    # 相対パス（l1.calibration_path）の基準。値の比較には入れない（Config() と等しいまま）
    return replace(config, source_dir=str(Path(path).resolve().parent))


def resolve_path(config: Config, value: str) -> Path:
    """設定に書いた相対パスを、設定ファイルのディレクトリ（無ければ今のディレクトリ）から解決する。"""
    p = Path(value)
    if p.is_absolute() or not config.source_dir:
        return p
    return Path(config.source_dir) / p
