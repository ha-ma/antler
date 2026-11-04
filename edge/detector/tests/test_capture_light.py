"""capture.light（docs/specs/edge-capture UC-2）: 太陽の高さで光の区分を決める。

期待値は packages/zones の lightPeriod（北緯 43.0・東経 144.4）を tsx で実行した結果。
"""

from datetime import datetime, timedelta, timezone

import pytest

from detector.capture.light import light_period, sun_altitude_deg

JST = timezone(timedelta(hours=9))


def _at(text: str) -> datetime:
    return datetime.fromisoformat(text).astimezone(JST)


def test_LIGHT_1a_2月の道東の一日() -> None:
    assert light_period(_at("2027-02-15T06:30:00+09:00")) == "dawn"
    assert light_period(_at("2027-02-15T07:30:00+09:00")) == "day"
    assert light_period(_at("2027-02-15T12:00:00+09:00")) == "day"
    assert light_period(_at("2027-02-15T16:30:00+09:00")) == "dusk"
    assert light_period(_at("2027-02-15T20:00:00+09:00")) == "night"


@pytest.mark.parametrize(
    ("iso", "expected", "altitude"),
    [
        ("2027-02-15T07:30:00+09:00", "day", 10.78),
        ("2027-02-15T16:30:00+09:00", "dusk", 3.10),
        ("2027-02-15T20:00:00+09:00", "night", -34.59),
        ("2027-06-21T04:00:00+09:00", "dawn", 1.76),
        ("2027-06-21T19:00:00+09:00", "dusk", -0.07),
        ("2027-11-03T06:00:00+09:00", "dawn", -0.56),
        ("2027-12-21T15:30:00+09:00", "dusk", 2.249),
        ("2027-12-21T17:30:00+09:00", "night", -17.438),
    ],
)
def test_LIGHT_1b_zonesのlightPeriodと同じ値(iso: str, expected: str, altitude: float) -> None:
    when = _at(iso)
    assert light_period(when) == expected
    assert sun_altitude_deg(when) == pytest.approx(altitude, abs=0.02)


def test_LIGHT_1c_タイムゾーンが違っても同じ瞬間なら同じ() -> None:
    jst = datetime.fromisoformat("2027-02-15T16:30:00+09:00")
    utc = datetime.fromisoformat("2027-02-15T07:30:00+00:00")
    assert light_period(jst) == light_period(utc)


def test_LIGHT_1d_タイムゾーン無しは拒否する() -> None:
    with pytest.raises(ValueError, match="タイムゾーン"):
        light_period(datetime(2027, 2, 15, 12, 0))
