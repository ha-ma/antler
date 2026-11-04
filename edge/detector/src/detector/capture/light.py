"""光の区分（Capture.conditions.light）を太陽の高さで決める（docs/specs/edge-capture E1）。

packages/zones の `lightPeriod`（NOAA の Solar Calculator の式、大気差なし）と同じ式・同じしきい値。
edge に GPS は無いので、場所は固定の道東の近似（SITE_NORTH_DEG / SITE_EAST_DEG）。
時計の時刻ではなく太陽の高さなので、季節で夕方の時刻がずれても合う。
"""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from datetime import datetime

__all__ = ["SITE_EAST_DEG", "SITE_NORTH_DEG", "light_period", "sun_altitude_deg"]

SITE_NORTH_DEG = 43.0
SITE_EAST_DEG = 144.4
DAY_ABOVE_DEG = 6.0
NIGHT_BELOW_DEG = -6.0

_RAD = math.pi / 180.0
_MS_PER_DAY = 86_400_000.0


def _solar(at: datetime) -> tuple[float, float]:
    """(太陽の高さ [度], 時角 [度])。at はタイムゾーン付き。"""
    if at.tzinfo is None:
        msg = "タイムゾーン付きの日時にする"
        raise ValueError(msg)
    ms = at.timestamp() * 1000.0
    jd = ms / _MS_PER_DAY + 2_440_587.5
    t = (jd - 2_451_545.0) / 36_525.0
    l0 = (280.46646 + t * (36_000.76983 + t * 0.0003032)) % 360.0
    m = 357.52911 + t * (35_999.05029 - 0.0001537 * t)
    e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)
    c = (
        math.sin(m * _RAD) * (1.914602 - t * (0.004817 + 0.000014 * t))
        + math.sin(2 * m * _RAD) * (0.019993 - 0.000101 * t)
        + math.sin(3 * m * _RAD) * 0.000289
    )
    omega = 125.04 - 1934.136 * t
    lam = l0 + c - 0.00569 - 0.00478 * math.sin(omega * _RAD)
    eps0 = 23.0 + (26.0 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60.0) / 60.0
    eps = eps0 + 0.00256 * math.cos(omega * _RAD)
    decl = math.asin(math.sin(eps * _RAD) * math.sin(lam * _RAD))
    y = math.tan(eps * _RAD / 2.0) ** 2
    eq_time_min = (
        4.0
        / _RAD
        * (
            y * math.sin(2 * l0 * _RAD)
            - 2 * e * math.sin(m * _RAD)
            + 4 * e * y * math.sin(m * _RAD) * math.cos(2 * l0 * _RAD)
            - 0.5 * y * y * math.sin(4 * l0 * _RAD)
            - 1.25 * e * e * math.sin(2 * m * _RAD)
        )
    )
    utc_minutes = (ms % _MS_PER_DAY) / 60_000.0
    true_solar_min = (utc_minutes + eq_time_min + 4.0 * SITE_EAST_DEG) % 1440.0
    solar_hour = true_solar_min / 4.0
    hour_angle = solar_hour + 180.0 if solar_hour < 0 else solar_hour - 180.0
    cos_zenith = math.sin(SITE_NORTH_DEG * _RAD) * math.sin(decl) + math.cos(
        SITE_NORTH_DEG * _RAD
    ) * math.cos(decl) * math.cos(hour_angle * _RAD)
    zenith = math.acos(max(-1.0, min(1.0, cos_zenith))) / _RAD
    return 90.0 - zenith, hour_angle


def sun_altitude_deg(at: datetime) -> float:
    """太陽の高さ（度、大気差なし）。"""
    return _solar(at)[0]


def light_period(at: datetime) -> str:
    """+6° 超 day、−6° 未満 night、その間は午前 dawn・午後 dusk（zones の lightPeriod と同じ）。"""
    altitude, hour_angle = _solar(at)
    if altitude > DAY_ABOVE_DEG:
        return "day"
    if altitude < NIGHT_BELOW_DEG:
        return "night"
    return "dawn" if hour_angle < 0 else "dusk"
