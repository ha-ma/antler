"""capture.store（docs/specs/edge-capture UC-5）: ローカル保存。JSON が最後、完成品だけが見える。

Test List: STO-1a STO-1b STO-1c STO-1d STO-1e STO-1f STO-1g STO-1h STO-1i STO-1j STO-1k
認可: AUTH-9（送信済みの consent を変えない: STO_1d）
AUTH-10（id の形が違えばパスに使わない: STO_1b）
障害: FAIL-3 FAIL-4（起動時の掃除: STO_1c）FAIL-5 IDEM-3
"""

from __future__ import annotations

import json
import os
import stat
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from detector.capture.model import build_capture
from detector.capture.store import CaptureStore, StoreError, valid_id
from detector.config import JudgeConfig
from detector.ports import Detection

JST = timezone(timedelta(hours=9))
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00fake-image-bytes\xff\xd9"
PROBS = {
    "alert_level": {"none": 0.1, "zone": 0.2, "danger": 0.7},
    "on_roadway": 0.6,
    "static_shoulder": 0.1,
    "false_positive": 0.05,
}


def make_capture(n: int, seconds: float | None = None) -> dict:
    when = datetime(2027, 2, 15, 16, 30, 0, tzinfo=JST) + timedelta(
        seconds=n if seconds is None else seconds
    )
    return build_capture(
        capture_id=f"cap_{n:012x}",
        detections=[Detection("deer", 0.9, (0.3, 0.5, 0.1, 0.2))],
        t_frame=when,
        image_size=(320, 240),
        distance_table=JudgeConfig().distance_table,
        min_box_conf=0.4,
    )


@pytest.fixture
def store(tmp_path: Path) -> CaptureStore:
    return CaptureStore(tmp_path / "captures", max_items=50)


def test_STO_1a_保存すると画像とJSONができて一覧に出る_権限は0700と0600(
    store: CaptureStore, tmp_path: Path
) -> None:
    capture = make_capture(1)
    store.save(capture, JPEG)
    directory = tmp_path / "captures"
    assert (directory / "cap_000000000001.jpg").read_bytes() == JPEG
    assert json.loads((directory / "cap_000000000001.json").read_text(encoding="utf-8")) == capture
    assert stat.S_IMODE(directory.stat().st_mode) == 0o700
    assert stat.S_IMODE((directory / "cap_000000000001.json").stat().st_mode) == 0o600
    assert stat.S_IMODE((directory / "cap_000000000001.jpg").stat().st_mode) == 0o600
    items, total = store.list()
    assert total == 1
    assert items == [{"capture": capture, "uploaded": False}]
    assert store.read_image("cap_000000000001") == JPEG


def test_STO_1a_一覧は新しい順で件数の上限つき(store: CaptureStore) -> None:
    for n in (1, 2, 3):
        store.save(make_capture(n), JPEG)
    items, total = store.list(limit=2)
    assert total == 3
    assert [i["capture"]["id"] for i in items] == ["cap_000000000003", "cap_000000000002"]


@pytest.mark.parametrize(
    "bad",
    [
        "../x",
        "..",
        "/etc/passwd",
        "cap_ABCDEF012345",
        "cap_12345678901",
        "cap_1234567890123",
        "",
        "cap_0123456789a/",
    ],
)
def test_STO_1b_idの形が違えばパスに使わない(store: CaptureStore, bad: str) -> None:
    assert not valid_id(bad)
    assert store.read_image(bad) is None
    assert store.set_consent([bad], True) == 0
    assert store.mark_uploaded([bad]) == 0
    capture = make_capture(1)
    capture["id"] = bad
    with pytest.raises(StoreError):
        store.save(capture, JPEG)


def test_STO_1c_壊れたものは一覧に出ず起動時に掃除される(tmp_path: Path) -> None:
    directory = tmp_path / "captures"
    first = CaptureStore(directory, max_items=50)
    first.save(make_capture(1), JPEG)
    (directory / ".tmp-cap_00000000aaaa-1.jpg").write_bytes(b"x")
    (directory / "cap_00000000bbbb.jpg").write_bytes(JPEG)  # JSON の無い画像
    (directory / "cap_00000000cccc.json").write_text("{not json", encoding="utf-8")
    (directory / "cap_00000000dddd.json").write_text(
        json.dumps({"id": "cap_00000000eeee"}), encoding="utf-8"
    )  # 名前と id が違う
    (directory / "cap_00000000ffff.uploaded").write_bytes(b"")  # JSON の無いしるし
    (directory / "note.txt").write_text("keep", encoding="utf-8")  # 知らないファイルは触らない
    second = CaptureStore(directory, max_items=50)
    names = sorted(p.name for p in directory.iterdir())
    assert ".tmp-cap_00000000aaaa-1.jpg" not in names
    assert "cap_00000000bbbb.jpg" not in names
    assert "cap_00000000ffff.uploaded" not in names
    assert "note.txt" in names
    assert "cap_000000000001.json" in names
    items, total = second.list()
    assert total == 1
    assert items[0]["capture"]["id"] == "cap_000000000001"


def test_STO_1d_set_consentは送信済みを変えず存在しないidは数えない(store: CaptureStore) -> None:
    store.save(make_capture(1), JPEG)
    store.save(make_capture(2), JPEG)
    ids = ["cap_000000000001", "cap_000000000002", "cap_0000000000ff"]
    assert store.set_consent(ids, True) == 2
    assert store.mark_uploaded(["cap_000000000001"]) == 1
    # 送信済みは変えない（消さない）。未送信の 2 は「提供しない」で消える
    assert store.set_consent(["cap_000000000001", "cap_000000000002"], False) == 1
    by_id = {i["capture"]["id"]: i for i in store.list()[0]}
    assert set(by_id) == {"cap_000000000001"}
    assert by_id["cap_000000000001"]["capture"]["consent"] is True
    assert by_id["cap_000000000001"]["uploaded"] is True


def test_STO_1i_提供しないは未送信の画像とJSONを消す(store: CaptureStore, tmp_path: Path) -> None:
    store.save(make_capture(1), JPEG)
    store.save(make_capture(2), JPEG)
    store.set_consent(["cap_000000000002"], True)
    # 同意が未定（false）のものも、同意済みのものも、未送信なら消える
    assert store.set_consent(["cap_000000000001", "cap_000000000002"], False) == 2
    assert store.list() == ([], 0)
    assert store.read_image("cap_000000000001") is None
    assert [p.name for p in (tmp_path / "captures").iterdir()] == []
    # もう一度呼んでも 0（冪等）
    assert store.set_consent(["cap_000000000001"], False) == 0


def test_STO_1j_保持期間を過ぎた未送信は消え送信済みと期間内は残る(tmp_path: Path) -> None:
    created = datetime(2027, 2, 15, 16, 30, 0, tzinfo=JST)
    clock = {"now": created + timedelta(hours=1)}
    store = CaptureStore(
        tmp_path / "captures", max_items=50, retention_hours=24, now=lambda: clock["now"]
    )
    store.save(make_capture(1, seconds=0), JPEG)  # 古い（未送信）
    store.save(make_capture(2, seconds=0), JPEG)  # 古い（送信済み）
    store.set_consent(["cap_000000000002"], True)
    store.mark_uploaded(["cap_000000000002"])
    clock["now"] = created + timedelta(hours=23)
    store.save(make_capture(3, seconds=22 * 3600), JPEG)  # 期間内
    assert store.list()[1] == 3
    clock["now"] = created + timedelta(hours=25)
    items, total = store.list()
    assert sorted(i["capture"]["id"] for i in items) == ["cap_000000000002", "cap_000000000003"]
    assert total == 2
    assert not (tmp_path / "captures" / "cap_000000000001.jpg").exists()
    # 起動時にも掃除される
    clock["now"] = created + timedelta(hours=60)
    again = CaptureStore(
        tmp_path / "captures", max_items=50, retention_hours=24, now=lambda: clock["now"]
    )
    assert [i["capture"]["id"] for i in again.list()[0]] == ["cap_000000000002"]


def test_STO_1k_長さ0や途中で切れたJSONは一覧に出ずpendingは未送信だけ(tmp_path: Path) -> None:
    directory = tmp_path / "captures"
    first = CaptureStore(directory, max_items=50)
    first.save(make_capture(1), JPEG)
    first.save(make_capture(2), JPEG)
    first.set_consent(["cap_000000000002"], True)
    first.mark_uploaded(["cap_000000000002"])
    (directory / "cap_00000000aaaa.jpg").write_bytes(JPEG)
    (directory / "cap_00000000aaaa.json").write_bytes(b"")  # 長さ 0
    (directory / "cap_00000000bbbb.jpg").write_bytes(JPEG)
    (directory / "cap_00000000bbbb.json").write_bytes(b'{"id": "cap_00000000bbbb", "sour')
    second = CaptureStore(directory, max_items=50)
    assert second.list()[1] == 2
    pending, total = second.list(pending=True)
    assert [i["capture"]["id"] for i in pending] == ["cap_000000000001"]
    assert total == 1
    assert second.list(pending=True, limit=0) == ([], 1)


def test_IDEM_3_同じ更新を2回呼んでも結果は同じで2回目は0(store: CaptureStore) -> None:
    store.save(make_capture(1), JPEG)
    ids = ["cap_000000000001"]
    assert store.set_consent(ids, True) == 1
    assert store.set_consent(ids, True) == 0
    assert store.mark_uploaded(ids) == 1
    assert store.mark_uploaded(ids) == 0


def test_STO_1d_同意のないものは送信済みにできない(store: CaptureStore) -> None:
    store.save(make_capture(1), JPEG)
    assert store.mark_uploaded(["cap_000000000001"]) == 0
    assert store.list()[0][0]["uploaded"] is False


def test_STO_1d_再起動しても同意と送信済みが残る(tmp_path: Path) -> None:
    directory = tmp_path / "captures"
    first = CaptureStore(directory, max_items=50)
    first.save(make_capture(1), JPEG)
    first.set_consent(["cap_000000000001"], True)
    first.mark_uploaded(["cap_000000000001"])
    item = CaptureStore(directory, max_items=50).list()[0][0]
    assert item["uploaded"] is True
    assert item["capture"]["consent"] is True


def test_STO_1e_上限を超えると送信済みの古いものから消える(tmp_path: Path) -> None:
    store = CaptureStore(tmp_path / "captures", max_items=3)
    for n in (1, 2, 3):
        store.save(make_capture(n), JPEG)
    store.set_consent(["cap_000000000002"], True)
    store.mark_uploaded(["cap_000000000002"])
    store.save(make_capture(4), JPEG)  # 4 件目: 送信済みの 2 が消える
    ids = {i["capture"]["id"] for i in store.list()[0]}
    assert ids == {"cap_000000000001", "cap_000000000003", "cap_000000000004"}
    assert not (tmp_path / "captures" / "cap_000000000002.jpg").exists()
    assert not (tmp_path / "captures" / "cap_000000000002.uploaded").exists()
    store.save(make_capture(5), JPEG)  # 送信済みが無い: 全体で古い 1 が消える
    ids = {i["capture"]["id"] for i in store.list()[0]}
    assert ids == {"cap_000000000003", "cap_000000000004", "cap_000000000005"}


def test_STO_1f_書き込みが失敗してもJSONができず一時ファイルを残さない(
    store: CaptureStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    real_replace = os.replace

    def failing(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        if str(dst).endswith(".json"):
            msg = "disk full"
            raise OSError(msg)
        real_replace(src, dst)

    monkeypatch.setattr("detector.capture.store.os.replace", failing)
    with pytest.raises(StoreError):
        store.save(make_capture(1), JPEG)
    directory = tmp_path / "captures"
    assert not (directory / "cap_000000000001.json").exists()
    assert [p.name for p in directory.iterdir() if p.name.startswith(".tmp")] == []
    assert store.list() == ([], 0)
    # 先に置いた画像も片づける（完成品に見えず、孤児も残さない）
    assert not (directory / "cap_000000000001.jpg").exists()
    # 同じ id で、書けるようになってから保存し直せる
    monkeypatch.undo()
    store.save(make_capture(1), JPEG)
    assert store.list()[1] == 1


def test_FAIL_3_画像の書き込みが失敗したらJSONも作らない(
    store: CaptureStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    def failing(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        msg = "read-only"
        raise OSError(msg)

    monkeypatch.setattr("detector.capture.store.os.replace", failing)
    with pytest.raises(StoreError):
        store.save(make_capture(1), JPEG)
    directory = tmp_path / "captures"
    assert sorted(p.name for p in directory.iterdir()) == []


def test_STO_1g_l1Probsの書き足しはos_replaceで原子的(
    store: CaptureStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store.save(make_capture(1), JPEG)
    calls: list[str] = []
    real_replace = os.replace

    def spy(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        calls.append(str(dst))
        real_replace(src, dst)

    monkeypatch.setattr("detector.capture.store.os.replace", spy)
    assert store.attach_l1_probs("cap_000000000001", PROBS) is True
    assert calls == [str(tmp_path / "captures" / "cap_000000000001.json")]
    on_disk = json.loads((tmp_path / "captures" / "cap_000000000001.json").read_text("utf-8"))
    assert on_disk["l1Probs"] == PROBS
    # すでにあれば書き換えない
    assert store.attach_l1_probs("cap_000000000001", {**PROBS, "on_roadway": 0.0}) is False
    assert store.list()[0][0]["capture"]["l1Probs"] == PROBS


def test_FAIL_5_l1Probsの書き足しが失敗しても元のJSONが残る(
    store: CaptureStore, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    capture = make_capture(1)
    store.save(capture, JPEG)

    def failing(src: str | os.PathLike[str], dst: str | os.PathLike[str]) -> None:
        msg = "disk full"
        raise OSError(msg)

    monkeypatch.setattr("detector.capture.store.os.replace", failing)
    assert store.attach_l1_probs("cap_000000000001", PROBS) is False
    monkeypatch.undo()
    on_disk = json.loads((tmp_path / "captures" / "cap_000000000001.json").read_text("utf-8"))
    assert on_disk == capture
    assert "l1Probs" not in store.list()[0][0]["capture"]
    assert [p.name for p in (tmp_path / "captures").iterdir() if p.name.startswith(".tmp")] == []


def test_STO_1h_同じidは二度保存できない(store: CaptureStore) -> None:
    store.save(make_capture(1), JPEG)
    with pytest.raises(StoreError):
        store.save(make_capture(1), JPEG)
    assert store.has("cap_000000000001")
    assert not store.has("cap_000000000002")
