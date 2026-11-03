"""L1 に送る JudgeRequest の組み立て（B2-4・B2-6）。数値はすべて L0 の値で、モデルに出させない。

edge が知らない車の状態は、降格に寄らない値で固定する（docs/specs/edge-l1 R2。実値は Deferred）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from pydantic import ValidationError

from detector.l1.client import L1Unavailable
from detector.schema import JUDGE_QUESTIONS, JudgeRequest

if TYPE_CHECKING:
    from detector.fusion import L1Target

__all__ = ["VehicleContext", "build_request"]


@dataclass(frozen=True)
class VehicleContext:
    """車の状態の固定値。60 km/h（北海道の一般道の法定速度）・鹿ゾーン内・夜・ロービーム。"""

    speed_kmh: float = 60.0
    zone: str = "inside"
    light: str = "night"
    headlight: str = "low"


def build_request(
    target: L1Target,
    recent_alerts: int,
    model: str,
    context: VehicleContext | None = None,
) -> JudgeRequest:
    """pydantic の JudgeRequest に通したものだけを返す。

    通らない → L1Unavailable(invalid_request)。
    """
    ctx = context or VehicleContext()
    raw = {
        "model": model,
        "state": {
            "speedKmh": ctx.speed_kmh,
            "zone": ctx.zone,
            "light": ctx.light,
            "headlight": ctx.headlight,
            "track": target.points,
            "ttcSec": target.ttc_s,
            "recentAlerts30s": recent_alerts,
        },
        "questions": list(JUDGE_QUESTIONS),
    }
    try:
        return JudgeRequest.model_validate(raw)
    except ValidationError as exc:
        raise L1Unavailable("invalid_request", type(exc).__name__) from exc
