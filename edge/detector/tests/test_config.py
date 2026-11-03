"""UC-7: 設定。"""

import pytest

from detector.config import Config, ConfigError, load_config


def write(tmp_path, text: str):
    p = tmp_path / "detector.toml"
    p.write_text(text, encoding="utf-8")
    return p


# UC-7a
def test_uc7a_空は既定値(tmp_path):
    c = load_config(write(tmp_path, ""))
    assert c == Config()
    assert (c.camera.source, c.camera.device) == ("device", 0)
    assert (c.camera.width, c.camera.height, c.camera.fps) == (1280, 720, 60)
    assert (c.pipeline.target_fps, c.infer.budget_ms, c.infer.model_path) == (10, 100, "")


# UC-7b
def test_uc7b_全項目(tmp_path):
    c = load_config(
        write(
            tmp_path,
            '[camera]\nsource="file"\npath="drive.mp4"\nwidth=640\nheight=480\nfps=30\n'
            '[pipeline]\ntarget_fps=5\n[infer]\nmodel_path="deer.mlpackage"\nbudget_ms=80\n',
        )
    )
    assert (c.camera.source, c.camera.path, c.camera.fps) == ("file", "drive.mp4", 30)
    assert (c.pipeline.target_fps, c.infer.budget_ms) == (5, 80)


@pytest.mark.parametrize(
    ("text", "key"),
    [
        ("[camera]\nwidthh=1\n", "widthh"),
        ('[camera]\nwidth="big"\n', "width"),
        ("[camera]\nwidth=0\n", "width"),
        ("[camera]\nfps=0\n", "fps"),
        ("[nope]\na=1\n", "nope"),
        ("[pipeline]\ntarget_fps=11\n", "target_fps"),
        ("[camera]\nwidth=true\n", "width"),
    ],
)
# UC-7c
def test_uc7c_不正はConfigError_キー名つき(tmp_path, text, key):
    with pytest.raises(ConfigError, match=key):
        load_config(write(tmp_path, text))


# UC-7d
def test_uc7d_fileでpath無し_sourceが不正(tmp_path):
    with pytest.raises(ConfigError, match="path"):
        load_config(write(tmp_path, '[camera]\nsource="file"\n'))
    with pytest.raises(ConfigError, match="source"):
        load_config(write(tmp_path, '[camera]\nsource="usb"\n'))


# UC-7e
def test_uc7e_無い_TOMLでない(tmp_path):
    with pytest.raises(ConfigError):
        load_config(tmp_path / "none.toml")
    with pytest.raises(ConfigError):
        load_config(write(tmp_path, "this is = = not toml"))


@pytest.mark.parametrize("bad", [0, -1, 1001])
# UC-7f
def test_uc7f_budgetが範囲外(tmp_path, bad):
    with pytest.raises(ConfigError, match="budget_ms"):
        load_config(write(tmp_path, f"[infer]\nbudget_ms={bad}\n"))


# UC-7g
def test_uc7g_UTF8でないファイルもConfigError(tmp_path):
    p = tmp_path / "bad.toml"
    p.write_bytes(b"\xff\xfe\x00bad")
    with pytest.raises(ConfigError):
        load_config(p)
