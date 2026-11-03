"""TRK-1・TRK-2: IoU トラッカーと距離・横方向速度・TTC（決定的なコード）。"""

import itertools
import math

import pytest

from detector.config import DEFAULT_DISTANCE_TABLE, TrackerConfig
from detector.l0.tracker import MAX_DETECTIONS, MAX_POINTS, Tracker, iou, track_distance_m
from detector.ports import Detection
from detector.schema.judge_request import TrackPoint

from .conftest import named, result

TABLE = DEFAULT_DISTANCE_TABLE
TAN35 = math.tan(math.radians(35))


def box(x=0.4, h=0.1, conf=0.9, w=0.05, y=0.5):
    return Detection("deer", conf, (x, y, w, h))


def tracker(**kw):
    return Tracker(TrackerConfig(**kw), TABLE)


def feed(tr, frames):
    """frames: [(ms, [Detection, ...]), ...]"""
    for ms, dets in frames:
        tr.update(result(ms, *dets))
    return tr


def ids(tr):
    return [t.id for t in tr.tracks]


# TRK-1a
def test_trk1a_IoUで同じIDを引き継ぎ_離れた検出は新しいID():
    tr = feed(tracker(), [(0, [box(0.30)]), (100, [box(0.31)])])
    assert ids(tr) == [1] and len(tr.tracks[0].points) == 2
    feed(tr, [(200, [box(0.31), box(0.80)])])
    assert ids(tr) == [1, 2]
    assert iou((0.5, 0.5, 0.2, 0.2), (0.5, 0.5, 0.2, 0.2)) == pytest.approx(1.0)
    assert iou((0.1, 0.1, 0.1, 0.1), (0.9, 0.9, 0.1, 0.1)) == 0.0
    assert iou((0.5, 0.5, 0.0, 0.0), (0.5, 0.5, 0.0, 0.0)) == 0.0


# TRK-1b
def test_trk1b_IoUの大きい組から結び_同じ入力で同じ割り当て():
    def run():
        tr = feed(tracker(), [(0, [box(0.40, w=0.1), box(0.52, w=0.1)])])
        # 2 頭が寄る。新しい検出 A は ID1 と大きく重なり、B は ID2 と大きく重なる
        feed(tr, [(100, [box(0.50, w=0.1), box(0.42, w=0.1)])])
        return [(t.id, t.last.xywh[0]) for t in tr.tracks]

    first = run()
    assert first == [(1, 0.42), (2, 0.50)]
    assert all(run() == first for _ in range(5))
    # 取り合い: 検出 A（0.45）は ID1 とも閾値以上で重なるが、ID2 との IoU のほうが大きい。
    # 順に結ぶと ID1 が A を取り、B は ID2 と閾値未満で新しいトラックになる。貪欲なら ID1←B、ID2←A
    tr = feed(tracker(), [(0, [box(0.40, w=0.1), box(0.46, w=0.1)])])
    assert iou(tr.tracks[0].last.xywh, (0.45, 0.5, 0.1, 0.1)) >= 0.3
    feed(tr, [(100, [box(0.45, w=0.1), box(0.40, w=0.1)])])
    assert [(t.id, t.last.xywh[0]) for t in tr.tracks] == [(1, 0.40), (2, 0.45)]
    # 同点（同じ箱が 2 つ）は ID の小さいトラックに、検出の順で
    tr = feed(tracker(), [(0, [box(0.4), box(0.4)]), (100, [box(0.4, conf=0.5)])])
    assert tr.tracks[0].last.conf == 0.5 and len(tr.tracks[1].points) == 1


# TRK-1c
def test_trk1c_max_ageを超えたトラックは消え_ちょうどでは残る():
    tr = feed(tracker(max_age_s=0.5), [(0, [box()]), (500, [])])
    assert ids(tr) == [1]
    feed(tr, [(501, [])])
    assert ids(tr) == []


# TRK-1d
def test_trk1d_履歴はwindowと64点まで_狭義の昇順():
    tr = feed(tracker(window_s=0.3), [(ms, [box()]) for ms in range(0, 1000, 100)])
    pts = tr.tracks[0].points
    assert [round((p.t - pts[-1].t).total_seconds(), 1) for p in pts] == [-0.3, -0.2, -0.1, 0.0]
    tr = feed(tracker(window_s=5.0), [(ms * 10, [box()]) for ms in range(100)])
    pts = tr.tracks[0].points
    assert len(pts) == MAX_POINTS
    assert all(a.t < b.t for a, b in itertools.pairwise(pts))


# TRK-1e
def test_trk1e_min_conf未満_高さ0_失敗フレームは入らず_鹿なしは時刻を進める():
    tr = feed(tracker(min_conf=0.4), [(0, [box(conf=0.39), box(h=0.0), box(h=float("nan"))])])
    assert ids(tr) == []
    tr.update(result(100, box(conf=0.4)))
    tr.update(result(200, box(), failed=True))
    assert len(tr.tracks[0].points) == 1
    # 失敗フレームは時刻を進めない: 2 秒後の失敗でもトラックは消えない
    tr.update(result(2100, failed=True))
    assert ids(tr) == [1]
    # 鹿 0 件の正常なフレームは時刻を進める
    tr.update(result(2100))
    assert ids(tr) == []
    other = Detection("car", 0.9, (0.4, 0.5, 0.05, 0.1))
    tr.update(result(2200, other))
    assert ids(tr) == []


# TRK-1f
def test_trk1f_同時刻と少し戻ったフレームは結び付けも追加もしない():
    tr = feed(tracker(), [(0, [box()]), (100, [box()])])
    feed(tr, [(100, [box(0.8)]), (50, [box(0.8)]), (-800, [box(0.8)])])
    assert ids(tr) == [1] and len(tr.tracks[0].points) == 2


# TRK-1g
def test_trk1g_1秒より大きく戻ったら作り直し_IDは再利用しない(logbuf):
    tr = feed(tracker(), [(5000, [box()]), (5100, [box(0.8)])])
    assert ids(tr) == [1, 2]
    feed(tr, [(3000, [box()])])
    assert ids(tr) == [3] and len(tr.tracks[0].points) == 1
    assert named(logbuf, "l0.tracker_reset")[0]["back_s"] == 2.1


# TRK-1h
def test_trk1h_1フレームの検出は16件まで_確信度の高いものを残す():
    dets = [box(0.02 + 0.05 * i, w=0.02, conf=0.5 + 0.02 * i) for i in range(20)]
    tr = feed(tracker(), [(0, dets)])
    assert len(tr.tracks) == MAX_DETECTIONS == 16
    assert min(t.last.conf for t in tr.tracks) == pytest.approx(0.58)
    assert [t.last.xywh[0] for t in tr.tracks] == sorted(t.last.xywh[0] for t in tr.tracks)


# TRK-2a
def test_trk2a_距離は補間の小数_表より遠い側は端の値():
    assert track_distance_m(0.15, TABLE) == pytest.approx(12.0)
    assert track_distance_m(0.11, TABLE) == pytest.approx(15.2)
    assert track_distance_m(0.01, TABLE) == 55.0
    tr = feed(tracker(), [(0, [box(h=0.15)])])
    assert tr.metrics(tr.tracks[0]).distance_m == pytest.approx(12.0)


# TRK-2f
def test_trk2f_表の最大より近い鹿も距離が縮みTTCが数で出る():
    assert track_distance_m(0.8, TABLE) == pytest.approx(2.0)
    frames = [(i * 100, [box(h=0.40 + 0.04 * i, w=0.2)]) for i in range(6)]
    tr = feed(tracker(), frames)
    m = tr.metrics(tr.tracks[0])
    assert m.distance_m < 4.0 and m.ttc_s is not None and m.ttc_s > 0


# TRK-2b
@pytest.mark.parametrize(
    ("x0", "dx", "sign"),
    [(0.30, +0.01, 1), (0.30, -0.01, -1), (0.70, -0.01, 1), (0.70, +0.01, -1)],
)
def test_trk2b_進路へ近づく向きが正(x0, dx, sign):
    frames = [(i * 100, [box(x0 + dx * i)]) for i in range(5)]
    tr = feed(tracker(), frames)
    m = tr.metrics(tr.tracks[0])
    # 距離 16 m・画角 70° で、0.01/0.1 秒 = 横に 2×tan35×16×0.1 m/s
    expected = 2 * TAN35 * 16.0 * 0.1
    assert m.lateral_mps == pytest.approx(sign * expected)


# TRK-2c
def test_trk2c_TTCは距離を接近速度で割る_近づかなければNone():
    # 高さ 0.10→0.20 を 0.4 秒で: 16 m → 8 m、接近 20 m/s、TTC = 8 / 20 = 0.4 秒
    frames = [(i * 100, [box(h=0.10 + 0.025 * i, w=0.1)]) for i in range(5)]
    tr = feed(tracker(), frames)
    m = tr.metrics(tr.tracks[0])
    assert m.distance_m == pytest.approx(8.0)
    assert m.ttc_s == pytest.approx(8.0 / 20.0)
    still = feed(tracker(), [(i * 100, [box()]) for i in range(5)])
    assert still.metrics(still.tracks[0]).ttc_s is None
    away = feed(tracker(), [(i * 100, [box(h=0.2 - 0.02 * i, w=0.1)]) for i in range(5)])
    assert away.metrics(away.tracks[0]).ttc_s is None
    one = feed(tracker(), [(0, [box()])])
    assert one.metrics(one.tracks[0]).ttc_s is None


# TRK-2d
def test_trk2d_横位置で_laneとshoulder():
    # 距離 16 m で横 1.75 m ↔ 中心からの x = 1.75 / (2 × tan35 × 16)
    edge = 1.75 / (2 * TAN35 * 16.0)
    tr = feed(tracker(), [(0, [box(0.5 - edge + 0.001, w=0.02), box(0.5 + edge + 0.01, w=0.02)])])
    assert [tr.metrics(t).pos for t in tr.tracks] == ["lane", "shoulder"]
    assert [tr.metrics(t).side for t in tr.tracks] == ["L", "R"]


# TRK-2e
def test_trk2e_点の列はTrackPointに通る():
    frames = [(i * 100, [box(0.3 + 0.01 * i, h=0.1 + 0.01 * i)]) for i in range(8)]
    tr = feed(tracker(), frames)
    pts = tr.track_points(tr.tracks[0])
    assert pts[-1]["t"] == 0.0 and pts[0]["t"] == pytest.approx(-0.7)
    assert [p["t"] for p in pts] == sorted(p["t"] for p in pts)
    for p in pts:
        TrackPoint.model_validate(p)
    assert pts[0]["lateralMps"] == 0.0 and pts[-1]["lateralMps"] > 0
    many = feed(tracker(window_s=5.0), [(ms * 10, [box()]) for ms in range(100)])
    assert len(many.track_points(many.tracks[0])) == MAX_POINTS


# TRK-2g
def test_trk2g_中央をまたいだ後は離れる向きで負_posはlaneのまま():
    frames = [(i * 100, [box(0.40 + 0.03 * i, h=0.2, w=0.1)]) for i in range(7)]  # 0.40 → 0.58
    tr = feed(tracker(), frames)
    assert ids(tr) == [1]
    m = tr.metrics(tr.tracks[0])
    assert m.side == "R" and m.lateral_mps < 0 and m.pos == "lane"
    pts = tr.track_points(tr.tracks[0])
    assert pts[3]["side"] == "L" and pts[3]["lateralMps"] > 0


# TRK-2h
def test_trk2h_最初の点から0_2秒未満では速度を出さない():
    tr = feed(tracker(), [(0, [box(0.3, h=0.1)]), (100, [box(0.32, h=0.15)])])
    m = tr.metrics(tr.tracks[0])
    assert (m.lateral_mps, m.ttc_s) == (0.0, None)
    feed(tr, [(200, [box(0.34, h=0.2)])])
    m = tr.metrics(tr.tracks[0])
    assert m.lateral_mps > 0 and m.ttc_s is not None


# TRK-2i
def test_trk2i_主トラックは最新のいちばん高いボックス():
    assert tracker().primary() is None
    tr = feed(tracker(), [(0, [box(0.2, h=0.1), box(0.8, h=0.2)])])
    assert tr.primary().id == 2
    tr = feed(tracker(), [(0, [box(0.2, h=0.1, conf=0.5), box(0.8, h=0.1, conf=0.9)])])
    assert tr.primary().id == 2  # 同じ高さは確信度
    tr = feed(tracker(), [(0, [box(0.2), box(0.8)])])
    assert tr.primary().id == 1  # さらに同じなら ID の小さい順
    # 最新の時刻に見えていなければ、最後に見たのが新しいもの
    tr = feed(tracker(), [(0, [box(0.2, h=0.3)]), (100, [box(0.8, h=0.1)]), (200, [])])
    assert tr.primary().id == 2
