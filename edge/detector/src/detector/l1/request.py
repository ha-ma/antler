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
    from detector.vehicle import VehicleReport

__all__ = ["MIN_SPEED_KMH", "VehicleContext", "build_request", "context_from_report"]

# 校正の実値のモード（dataset/export_l1_labels.py の CAR_KMH）の下限。これより遅い速度は
# 学習に無く、降格（見逃しの向き）に寄るので、渡すときはここまで持ち上げる
MIN_SPEED_KMH = 30.0


@dataclass(frozen=True)
class VehicleContext:
    """車の状態の固定値。60 km/h（北海道の一般道の法定速度）・鹿ゾーン内・夜・ロービーム。"""

    speed_kmh: float = 60.0
    zone: str = "inside"
    light: str = "night"
    headlight: str = "low"


def context_from_report(report: VehicleReport | None) -> tuple[VehicleContext, str]:
    """PWA の報告（新しい項目だけ入っている）から車の状態を作る。(状態, state_source)。

    項目ごとに: 有れば実値、無ければ固定値。速度は MIN_SPEED_KMH で持ち上げる。ヘッドライトは
    PWA に分からないので、実値の光が昼なら off、それ以外は low（校正の実値のモードと同じ規則）。
    使ってよいかの判断（校正の context・設定）は呼び出し側（run_l1）が行う。
    """
    default = VehicleContext()
    if report is None or report.known == 0:
        return default, "fixed"
    speed = default.speed_kmh if report.speed_kmh is None else max(report.speed_kmh, MIN_SPEED_KMH)
    context = VehicleContext(
        speed_kmh=speed,
        zone=report.zone or default.zone,
        light=report.light or default.light,
        headlight="off" if report.light == "day" else default.headlight,
    )
    return context, "pwa" if report.known == 3 else "partial"


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
