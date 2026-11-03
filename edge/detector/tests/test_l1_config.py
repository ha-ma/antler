"""CFG-1: [l1]・[l2] の設定と設定の組み合わせ（edge-l1 R8）。"""

from pathlib import Path

import pytest

from detector.config import Config, ConfigError, L1Config, L2Config, load_config, resolve_path

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"


def write(tmp_path, text: str) -> Path:
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


# CFG-1a
def test_cfg1a_空のTOMLでl1とl2の既定値(tmp_path):
    config = load_config(write(tmp_path, ""))
    l1 = config.l1
    assert l1.enabled is True
    assert l1.base_url == "http://127.0.0.1:8766"  # WebSocket の 8765 とぶつけない
    assert l1.model == "jev-latest"
    assert (l1.rate_hz, l1.timeout_ms, l1.override_conf) == (2.5, 800, 0.9)
    assert l1.l2_route_conf == (0.5, 0.9)
    assert l1.wait_for_l1_before_red is False
    assert l1.calibration_path == "calibration.json"
    assert resolve_path(config, l1.calibration_path) == tmp_path.resolve() / "calibration.json"
    assert config.l2 == L2Config(enabled="auto")
    assert Config().server.port != int(L1Config().base_url.rsplit(":", 1)[1])


# CFG-1b
def test_cfg1b_指定した値が読め相対パスは設定ファイルのディレクトリから(tmp_path):
    text = (
        '[l1]\nenabled = false\nbase_url = "http://localhost:9001"\nmodel = "llm-qwen2.5-1.5b"\n'
        "rate_hz = 3\ntimeout_ms = 300\noverride_conf = 0.95\nl2_route_conf = [0.4, 0.95]\n"
        'wait_for_l1_before_red = true\ncalibration_path = "cal/l1.json"\n'
        '[l2]\nenabled = "off"\n'
    )
    config = load_config(write(tmp_path, text))
    assert config.l1 == L1Config(
        enabled=False,
        base_url="http://localhost:9001",
        model="llm-qwen2.5-1.5b",
        rate_hz=3.0,
        timeout_ms=300,
        override_conf=0.95,
        l2_route_conf=(0.4, 0.95),
        wait_for_l1_before_red=True,
        calibration_path="cal/l1.json",
    )
    assert (
        resolve_path(config, config.l1.calibration_path) == tmp_path.resolve() / "cal" / "l1.json"
    )
    assert resolve_path(Config(), "c.json") == Path(
        "c.json"
    )  # ファイルから読まなければ今のディレクトリ
    assert config.l2.enabled == "off"


def test_cfg1b_絶対パスはそのまま(tmp_path):
    target = tmp_path / "x" / "c.json"
    config = load_config(write(tmp_path, f'[l1]\ncalibration_path = "{target}"\n'))
    assert resolve_path(config, config.l1.calibration_path) == target


# CFG-1c
@pytest.mark.parametrize(
    ("text", "key"),
    [
        ("[l1]\noverride_conf = 0.89\n", "l1.override_conf"),
        ("[l1]\noverride_conf = 1.01\n", "l1.override_conf"),
        ("[l1]\ntimeout_ms = 801\n", "l1.timeout_ms"),
        ("[l1]\ntimeout_ms = 0.5\n", "l1.timeout_ms"),
        ("[l1]\nrate_hz = 1.9\n", "l1.rate_hz"),
        ("[l1]\nrate_hz = 3.1\n", "l1.rate_hz"),
        ('[l1]\nenabled = "yes"\n', "l1.enabled"),
        ("[l1]\nenabled = 1\n", "l1.enabled"),
        ('[l1]\nbase_url = ""\n', "l1.base_url"),
        ('[l1]\nbase_url = "127.0.0.1:8766"\n', "l1.base_url"),
        ('[l1]\nmodel = "jev latest"\n', "l1.model"),
        ('[l1]\nmodel = ""\n', "l1.model"),
        ("[l1]\nl2_route_conf = [0.9, 0.5]\n", "l1.l2_route_conf"),
        ("[l1]\nl2_route_conf = [0.5]\n", "l1.l2_route_conf"),
        ('[l1]\nl2_route_conf = ["a", 0.9]\n', "l1.l2_route_conf"),
        ("[l1]\nl2_route_conf = [0.5, 0.95]\n", "l1.l2_route_conf"),  # 上 > override_conf
        ("[l1]\nwait_for_l1_before_red = 0\n", "l1.wait_for_l1_before_red"),
        ('[l1]\ncalibration_path = " "\n', "l1.calibration_path"),
        ("[l1]\nport = 8766\n", "l1.port"),
        ('[l2]\nenabled = "on"\n', "l2.enabled"),
        ("[l2]\nenabled = true\n", "l2.enabled"),
    ],
)
def test_cfg1c_不正はキー名つきのConfigError(tmp_path, text, key):
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(write(tmp_path, text))


# CFG-1d
def test_cfg1d_tracker_min_confがjudge_thresholdより大きいとConfigError(tmp_path):
    with pytest.raises(ConfigError, match=r"tracker\.min_conf"):
        load_config(write(tmp_path, "[judge]\nthreshold = 0.5\n[tracker]\nmin_conf = 0.6\n"))
    ok = load_config(write(tmp_path, "[judge]\nthreshold = 0.5\n[tracker]\nmin_conf = 0.5\n"))
    assert ok.tracker.min_conf == ok.judge.threshold


# CFG-1e
def test_cfg1e_見本にl1とl2があり既定値と一致する():
    text = EXAMPLE.read_text(encoding="utf-8")
    assert "[l1]" in text and "[l2]" in text
    config = load_config(EXAMPLE)
    assert config.l1.base_url == L1Config().base_url
    assert resolve_path(config, config.l1.calibration_path) == EXAMPLE.parent / "calibration.json"
    assert config == Config()
    assert config.l2 == L2Config()
