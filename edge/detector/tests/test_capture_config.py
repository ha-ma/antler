"""CFG-1: [capture]・[capture_server] の設定（docs/specs/edge-capture UC-7）。"""

from pathlib import Path

import pytest

from detector.config import (
    CaptureConfig,
    CaptureServerConfig,
    Config,
    ConfigError,
    load_config,
    resolve_path,
)

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"


def write(tmp_path: Path, text: str) -> Path:
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


def test_CFG_1a_空のTOMLで既定値(tmp_path: Path) -> None:
    config = load_config(write(tmp_path, ""))
    capture = config.capture
    assert capture.enabled is True
    assert capture.dir == "captures"
    assert (capture.image_width, capture.jpeg_quality) == (320, 80)
    assert (capture.trigger_conf, capture.min_interval_s) == (0.8, 2.0)
    assert (capture.max_per_run, capture.max_items, capture.queue_size) == (300, 2000, 8)
    assert capture.l1_attach_window_s == 3.0
    assert capture.retention_hours == 24
    server = config.capture_server
    assert (server.host, server.port, server.allowed_origins) == ("127.0.0.1", 8767, ())
    assert config.capture == CaptureConfig()
    assert config.capture_server == CaptureServerConfig()
    assert resolve_path(config, capture.dir) == tmp_path.resolve() / "captures"
    # WebSocket（8765）・local-jev（8766）とぶつけない
    assert server.port not in (Config().server.port, 8766)


def test_CFG_1a_指定した値が読める(tmp_path: Path) -> None:
    text = (
        '[capture]\nenabled = false\ndir = "/var/antler/captures"\nimage_width = 640\n'
        "jpeg_quality = 95\ntrigger_conf = 0.9\nmin_interval_s = 0.5\nmax_per_run = 10\n"
        "max_items = 100\nqueue_size = 2\nl1_attach_window_s = 5\n"
        '[capture_server]\nhost = "192.168.4.1"\nport = 9000\n'
        'allowed_origins = ["http://localhost:5197", "https://pwa.example.com"]\n'
    )
    config = load_config(write(tmp_path, text))
    assert config.capture.enabled is False
    assert config.capture.dir == "/var/antler/captures"
    assert config.capture.image_width == 640
    assert config.capture.l1_attach_window_s == 5.0
    assert config.capture_server.host == "192.168.4.1"
    assert config.capture_server.allowed_origins == (
        "http://localhost:5197",
        "https://pwa.example.com",
    )


@pytest.mark.parametrize(
    ("text", "key"),
    [
        ("[capture]\nimage_width = 159\n", "capture.image_width"),
        ("[capture]\nimage_width = 641\n", "capture.image_width"),
        ("[capture]\njpeg_quality = 49\n", "capture.jpeg_quality"),
        ("[capture]\njpeg_quality = 96\n", "capture.jpeg_quality"),
        ("[capture]\ntrigger_conf = 0.39\n", "capture.trigger_conf"),
        ("[capture]\ntrigger_conf = 1.1\n", "capture.trigger_conf"),
        ("[capture]\nmin_interval_s = 0.4\n", "capture.min_interval_s"),
        ("[capture]\nmin_interval_s = 61\n", "capture.min_interval_s"),
        ("[capture]\nmax_per_run = 0\n", "capture.max_per_run"),
        ("[capture]\nmax_per_run = 10001\n", "capture.max_per_run"),
        ("[capture]\nmax_items = 9\n", "capture.max_items"),
        ("[capture]\nmax_items = 20001\n", "capture.max_items"),
        ("[capture]\nqueue_size = 0\n", "capture.queue_size"),
        ("[capture]\nqueue_size = 65\n", "capture.queue_size"),
        ("[capture]\nl1_attach_window_s = 0.1\n", "capture.l1_attach_window_s"),
        ("[capture]\nretention_hours = 0\n", "capture.retention_hours"),
        ("[capture]\nretention_hours = 169\n", "capture.retention_hours"),
        ('[capture]\ndir = ""\n', "capture.dir"),
        ('[capture]\nenabled = "yes"\n', "capture.enabled"),
        ("[capture]\nunknown_key = 1\n", "capture.unknown_key"),
        ("[capture_server]\nport = 0\n", "capture_server.port"),
        ("[capture_server]\nport = 65536\n", "capture_server.port"),
        ('[capture_server]\nhost = " "\n', "capture_server.host"),
        ("[capture_server]\nallowed_origins = 5\n", "capture_server.allowed_origins"),
    ],
)
def test_CFG_1a_範囲外はConfigError_キー名つき(tmp_path: Path, text: str, key: str) -> None:
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(write(tmp_path, text))


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "",
        "http://",
        "ftp://x.example",
        "http://x.example/path",
        "http://x.example/",
        "http://x.example:99999x",
        "localhost:5173",
        "http://a b",
        "javascript:alert(1)",
        "null",
    ],
)
def test_CFG_1b_allowed_originsはオリジンの形だけ(tmp_path: Path, origin: str) -> None:
    text = f'[capture_server]\nallowed_origins = ["{origin}"]\n'
    with pytest.raises(ConfigError, match=r"capture_server\.allowed_origins"):
        load_config(write(tmp_path, text))


def test_CFG_1b_allowed_originsに文字列以外は入れられない(tmp_path: Path) -> None:
    with pytest.raises(ConfigError, match=r"capture_server\.allowed_origins"):
        load_config(write(tmp_path, "[capture_server]\nallowed_origins = [1]\n"))


def test_CFG_1c_trigger_confはtracker_min_conf以上(tmp_path: Path) -> None:
    text = "[tracker]\nmin_conf = 0.6\n[judge]\nthreshold = 0.7\n[capture]\ntrigger_conf = 0.5\n"
    with pytest.raises(ConfigError, match=r"capture\.trigger_conf"):
        load_config(write(tmp_path, text))
    ok = "[tracker]\nmin_conf = 0.6\n[judge]\nthreshold = 0.7\n[capture]\ntrigger_conf = 0.6\n"
    assert load_config(write(tmp_path, ok)).capture.trigger_conf == 0.6


def test_CFG_1c_設定の見本に両セクションがあり読める() -> None:
    text = EXAMPLE.read_text(encoding="utf-8")
    assert "[capture]" in text
    assert "[capture_server]" in text
    config = load_config(EXAMPLE)
    assert config.capture == CaptureConfig()
    assert config.capture_server == CaptureServerConfig()
