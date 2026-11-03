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


# UC-8a
def test_uc8a_judgeとserverの既定値(tmp_path):
    c = load_config(write(tmp_path, ""))
    assert (c.judge.threshold, c.judge.off_after_s, c.judge.stall_after_s) == (0.4, 1.5, 3.0)
    assert (c.server.host, c.server.port, c.server.max_clients) == ("127.0.0.1", 8765, 16)
    assert len(c.judge.distance_table) == 5


# UC-8b
def test_uc8b_指定した値と距離表(tmp_path):
    c = load_config(
        write(
            tmp_path,
            "[judge]\nthreshold=0.5\noff_after_s=2\ndistance_table=[[0.1, 20], [0.3, 5.5]]\n"
            '[server]\nhost="0.0.0.0"\nport=9000\nmax_clients=4\n',
        )
    )
    assert (c.judge.threshold, c.judge.off_after_s) == (0.5, 2.0)
    assert c.judge.distance_table == ((0.1, 20.0), (0.3, 5.5))
    assert (c.server.host, c.server.port, c.server.max_clients) == ("0.0.0.0", 9000, 4)  # noqa: S104


# UC-8c
@pytest.mark.parametrize(
    ("text", "key"),
    [
        ("[judge]\nthreshold=1.5\n", "threshold"),
        ('[judge]\nthreshold="a"\n', "threshold"),
        ("[judge]\noff_after_s=0.1\n", "off_after_s"),
        ("[judge]\ndistance_table=[[0.1, 20]]\n", "distance_table"),
        ("[judge]\ndistance_table=[[0.1, 5], [0.3, 20]]\n", "distance_table"),
        ('[judge]\ndistance_table=[[0.1, "x"], [0.3, 2]]\n', "distance_table"),
        ("[judge]\nnope=1\n", "nope"),
        ("[server]\nport=0\n", "port"),
        ("[server]\nport=70000\n", "port"),
        ("[server]\nmax_clients=100\n", "max_clients"),
        ("[server]\nhost=1\n", "host"),
        ('[server]\nhost=""\n', "host"),
        ("[judge]\nstall_after_s=11\n", "stall_after_s"),
    ],
)
def test_uc8c_不正はキー名つき(tmp_path, text, key):
    with pytest.raises(ConfigError, match=key):
        load_config(write(tmp_path, text))
