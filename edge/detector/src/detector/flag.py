"""AlertFlag の組み立て（ch7、packages/schema の alert-flag）。画像・位置情報は持たない。"""

from __future__ import annotations

from typing import TYPE_CHECKING

from detector.frame import format_t_frame

if TYPE_CHECKING:
    from datetime import datetime

    from detector.judge import JudgeState


def build_flag(state: JudgeState, t_sent: datetime) -> dict[str, object]:
    """edge は GPS を持たないので zone は常に outside（ゾーンの判定は PWA。B4-5）。"""
    flag: dict[str, object] = {
        "type": "flag",
        "v": 1,
        "deer": state.deer,
        "zone": "outside",
        "t_frame": format_t_frame(state.t_frame),
        "t_sent": format_t_frame(t_sent),
    }
    if state.deer:
        flag.update(
            conf=state.conf,
            distanceM=state.distance_m,
            side=state.side,
            frameJpegB64=None,  # B3-3 の JPEG は Deferred（画像を持ち出さない）
        )
    return flag
