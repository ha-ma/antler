"""CFG-1: [coreml] と [tracker] の設定（edge-l0 R6）。"""

from pathlib import Path

import pytest

from detector.config import (
    COMPUTE_UNITS,
    Config,
    ConfigError,
    CoremlConfig,
    TrackerConfig,
    load_config,
)

EXAMPLE = Path(__file__).resolve().parents[1] / "config.example.toml"


def write(tmp_path, text: str):
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


# CFG-1a
def test_cfg1a_空なら_cpu_and_ne_とトラッカーの既定値(tmp_path):
    c = load_config(write(tmp_path, ""))
    assert c.coreml == CoremlConfig("cpu_and_ne")
    t = c.tracker
    assert (t.min_conf, t.iou_threshold, t.max_age_s, t.window_s) == (0.4, 0.3, 1.0, 1.0)
    assert (t.hfov_deg, t.lane_half_width_m) == (70.0, 1.75)


# CFG-1b
def test_cfg1b_指定した値が読める(tmp_path):
    c = load_config(
        write(
            tmp_path,
            '[coreml]\ncompute_units = "all"\n'
            "[tracker]\nmin_conf = 0.3\niou_threshold = 0.5\nmax_age_s = 0.8\n"
            "window_s = 2\nhfov_deg = 90\nlane_half_width_m = 2.0\n",
        )
    )
    assert c.coreml.compute_units == "all"
    assert c.tracker == TrackerConfig(0.3, 0.5, 0.8, 2.0, 90.0, 2.0)
    assert isinstance(c.tracker.window_s, float)


# CFG-1c
@pytest.mark.parametrize(
    ("text", "key"),
    [
        ('[coreml]\ncompute_units = "gpu"\n', "coreml.compute_units"),
        ('[coreml]\ncompute_units = "CPU_AND_NE"\n', "coreml.compute_units"),
        ("[coreml]\ncompute_units = 1\n", "coreml.compute_units"),
        ("[tracker]\nmin_conf = 1.5\n", "tracker.min_conf"),
        ("[tracker]\niou_threshold = 0.0\n", "tracker.iou_threshold"),
        ("[tracker]\nmax_age_s = 10\n", "tracker.max_age_s"),
        ("[tracker]\nwindow_s = 0.1\n", "tracker.window_s"),
        ("[tracker]\nhfov_deg = 180\n", "tracker.hfov_deg"),
        ('[tracker]\nlane_half_width_m = "wide"\n', "tracker.lane_half_width_m"),
        ("[tracker]\nspeed = 1\n", "tracker.speed"),
    ],
)
def test_cfg1c_不正はキー名つきのConfigError(tmp_path, text, key):
    with pytest.raises(ConfigError, match=key.replace(".", r"\.")):
        load_config(write(tmp_path, text))


# CFG-1d
@pytest.mark.parametrize("section", ["l1", "l2"])
def test_cfg1d_l1とl2はまだ知らないセクション(tmp_path, section):
    with pytest.raises(ConfigError, match=f"知らないセクション: {section}"):
        load_config(write(tmp_path, f"[{section}]\nenabled = true\n"))


# CFG-1e
def test_cfg1e_見本の設定ファイルが読め既定値と一致する():
    assert load_config(EXAMPLE) == Config()
    assert "cpu_and_ne" in COMPUTE_UNITS
