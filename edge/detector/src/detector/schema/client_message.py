# 生成物。手で直さない。再生成: python edge/detector/scripts/generate_models.py
# ruff: noqa
# fmt: off

from __future__ import annotations

from typing import Annotated, Literal

from detector.schema._base import StrictModel
from pydantic import AwareDatetime, ConfigDict, Field, RootModel, StrictFloat


class TShown1(RootModel[str]):
    model_config = ConfigDict(allow_inf_nan=False)
    model_config = ConfigDict(
        regex_engine="python-re",
    )
    root: Annotated[
        str,
        Field(
            pattern='^(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9](?:Z|([+-](?:[01][0-9]|2[0-3]):[0-5][0-9])))(?!\\n)$'
        ),
    ]


class Model1(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['ack']
    t_shown: TShown1 | AwareDatetime


class Model2(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['label']
    value: Literal['present', 'absent']


class VehicleMessage(StrictModel):
    model_config = ConfigDict(
        extra='forbid',
    )
    type: Literal['vehicle']
    speedKmh: Annotated[StrictFloat | None, Field(ge=0.0, le=300.0)] = None
    zone: Literal['inside', 'outside'] | None = None
    light: Literal['dawn', 'day', 'dusk', 'night'] | None = None


class Model(RootModel[Model1 | Model2 | VehicleMessage]):
    model_config = ConfigDict(allow_inf_nan=False)
    root: Model1 | Model2 | VehicleMessage
