# 生成物。手で直さない。再生成: python edge/detector/scripts/generate_models.py
# ruff: noqa
# fmt: off

from __future__ import annotations

from typing import Annotated, Literal

from detector.schema._base import StrictModel
from pydantic import ConfigDict, Field, RootModel, StrictFloat, StrictInt


class TrackPoint(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
        regex_engine="python-re",
    )
    t: Annotated[StrictFloat, Field(le=0.0)]
    conf: Annotated[StrictFloat, Field(ge=0.0, le=1.0)]
    distanceM: Annotated[StrictFloat, Field(ge=0.0)]
    lateralMps: StrictFloat
    side: Literal['L', 'R']
    pos: Annotated[str, Field(pattern='^[a-z][a-z_]{0,31}(?!\\n)$')]


class TtcSec(RootModel[StrictFloat]):
    model_config = ConfigDict(allow_inf_nan=False)
    root: Annotated[StrictFloat, Field(ge=0.0)]


class JudgeState(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    speedKmh: Annotated[StrictFloat, Field(ge=0.0)]
    zone: Literal['inside', 'outside']
    light: Literal['dawn', 'day', 'dusk', 'night']
    headlight: Literal['off', 'low', 'high']
    track: Annotated[list[TrackPoint], Field(max_length=64, min_length=1)]
    ttcSec: TtcSec | None
    recentAlerts30s: Annotated[StrictInt, Field(ge=0, le=9007199254740991)]


class AlertLevelQuestion(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Literal['alert_level']
    type: Literal['choice']
    text: Literal['Which alert should the driver get now?']
    options: tuple[Literal['none'], Literal['zone'], Literal['danger']]


class OnRoadwayQuestion(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Literal['on_roadway']
    type: Literal['noul']
    text: Literal['The animal is moving into the driving lane.']


class StaticShoulderQuestion(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Literal['static_shoulder']
    type: Literal['noul']
    text: Literal['The animal is standing still on the road shoulder.']


class FalsePositiveQuestion(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    id: Literal['false_positive']
    type: Literal['noul']
    text: Literal['The detection is not a real deer (sign, snow, post).']


class JudgeRequest(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
        regex_engine="python-re",
    )
    model: Annotated[str, Field(pattern='^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}(?!\\n)$')]
    state: Annotated[JudgeState, Field(title='JudgeState')]
    questions: tuple[AlertLevelQuestion, OnRoadwayQuestion, StaticShoulderQuestion, FalsePositiveQuestion]
