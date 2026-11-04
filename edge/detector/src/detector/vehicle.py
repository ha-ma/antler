"""PWA から届く車の状態（vehicle メッセージ、docs/specs/pwa-uplink R1・R4）。

形は packages/schema の VehicleMessage（JSON Schema から生成した detector.schema.client_message）。
ここは L1 を知らない（detector.l1 を import しない。edge-l0 の LAC-1）。L1 の問い合わせへの写しは
detector.l1.request が行う。位置（緯度経度）・精度・時刻の席は無く、足されたメッセージは拒否する。
"""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import ValidationError

from detector.schema.client_message import VehicleMessage

__all__ = ["SPEED_MAX_AGE_S", "VehicleReport", "parse_vehicle"]

# 速度はすぐ変わるので、ゾーンと光（vehicle_max_age_s）より短く。これを超えた速度は固定値に戻す
SPEED_MAX_AGE_S = 3.0


@dataclass(frozen=True)
class VehicleReport:
    """検証に通った 1 通。None は「分からない」。received_at は hub の単調時計（秒）。"""

    speed_kmh: float | None
    zone: str | None
    light: str | None
    received_at: float = 0.0

    @property
    def known(self) -> int:
        """実値の項目の数（0〜3）。"""
        return sum(v is not None for v in (self.speed_kmh, self.zone, self.light))


def parse_vehicle(message: object, received_at: float = 0.0) -> VehicleReport:
    """検証して VehicleReport にする。通らなければ ValueError（本文は例外に残さない）。

    JSON Schema は「無い」だけを許し、`null` を許さない（Zod の optional）。生成された pydantic は
    `| None = None` なので、明示された `null` はここで止める（TS と同じ結果にする）。
    """
    if not isinstance(message, dict):
        raise ValueError("vehicle: not an object")
    try:
        model = VehicleMessage.model_validate(message)
    except ValidationError as exc:
        raise ValueError("vehicle: invalid") from exc
    values = {name: getattr(model, name) for name in model.model_fields_set}
    if any(value is None for value in values.values()):
        raise ValueError("vehicle: null")
    speed = model.speedKmh
    return VehicleReport(
        speed_kmh=None if speed is None else float(speed),
        zone=model.zone,
        light=model.light,
        received_at=received_at,
    )
