import io
import json
import logging
import sys

from detector.log import configure_logging, install_excepthook


def _lines(buf: io.StringIO) -> list[dict]:
    return [json.loads(line) for line in buf.getvalue().splitlines()]


def test_1行のJSONにevent_level_extraを入れる():
    buf = io.StringIO()
    configure_logging("INFO", stream=buf)
    logging.getLogger("detector.flag").info(
        "flag.sent", extra={"t_frame": "2027-02-15T16:31:08.120+09:00", "conf": 0.94}
    )
    entry = _lines(buf)[0]
    assert entry["event"] == "flag.sent"
    assert entry["level"] == "info"
    assert entry["logger"] == "detector.flag"
    assert entry["t_frame"] == "2027-02-15T16:31:08.120+09:00"
    assert entry["conf"] == 0.94
    assert "ts" in entry


def test_しきい値より低いレベルは出さない():
    buf = io.StringIO()
    configure_logging("WARNING", stream=buf)
    log = logging.getLogger("detector")
    log.info("skip")
    log.warning("keep")
    assert [e["event"] for e in _lines(buf)] == ["keep"]


def test_例外はnameとmessageとstackを持つ():
    buf = io.StringIO()
    configure_logging("INFO", stream=buf)
    try:
        raise ValueError("camera not found")
    except ValueError:
        logging.getLogger("detector").exception("camera.open")
    error = _lines(buf)[0]["error"]
    assert error["name"] == "ValueError"
    assert error["message"] == "camera not found"
    assert "Traceback" in error["stack"]


def test_未捕捉の例外を記録する(monkeypatch):
    buf = io.StringIO()
    configure_logging("INFO", stream=buf)
    monkeypatch.setattr(sys, "excepthook", sys.__excepthook__)
    install_excepthook()
    try:
        raise RuntimeError("boom")
    except RuntimeError as exc:
        sys.excepthook(type(exc), exc, exc.__traceback__)
    entry = _lines(buf)[0]
    assert entry["event"] == "process.uncaught"
    assert entry["level"] == "critical"
    assert entry["error"]["message"] == "boom"
