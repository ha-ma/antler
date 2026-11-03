"""配信の規則（B3-2）: 変化は即時、そのほかは 1 秒ごと。ack を受けて遅延を走行ログに残す。

トランスポート（WebSocket）は知らない。送り先は sender（文字列 → 送った数）だけ。
イベントループの上だけで触る。時計は注入できる（clock は単調時計の秒、wall は壁時計）。
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from time import monotonic
from typing import TYPE_CHECKING

from detector.flag import build_flag
from detector.frame import format_t_frame
from detector.judge import is_blind
from detector.l0.stage import L0Stage

if TYPE_CHECKING:
    from collections.abc import Callable

    from detector.config import JudgeConfig, TrackerConfig
    from detector.judge import JudgeState
    from detector.pipeline import FrameResult

logger = logging.getLogger("detector.hub")

HEARTBEAT_S = 1.0
MAX_TYPE_NAME = 32


def _wall() -> datetime:
    return datetime.now(UTC)


class AlertHub:
    def __init__(
        self,
        config: JudgeConfig,
        clock: Callable[[], float] = monotonic,
        wall: Callable[[], datetime] = _wall,
        tracker: TrackerConfig | None = None,
        l0: L0Stage | None = None,
    ) -> None:
        self._cfg = config
        self._clock = clock
        self._wall = wall
        # 赤は L0 だけで決める（B2-3）。L1 の結果は待たない（edge-l1 で非同期に足す）
        self._l0 = l0 or L0Stage(config, tracker)
        self._judge = self._l0.judge  # 既存のテスト（test_server）が状態を覗く入口
        self.sender: Callable[[str], int] = lambda _text: 0
        self._last_sent = 0.0
        self._last_ok: float | None = None
        self._stalled = False
        self._was_on = False
        self._ack_t_frame: datetime | None = None
        self._clients = 0

    @property
    def deer_on(self) -> bool:
        s = self._l0.state
        return bool(s and s.deer)

    def on_result(self, result: FrameResult) -> None:
        now = self._clock()
        if not is_blind(result):
            self._last_ok = now
            self._stalled = False
        if self._l0.update(result, now):  # 同期。await を入れない
            self._emit("change")

    def tick(self) -> None:
        """短い間隔（0.1 秒など）で呼ぶ。入力停止の expire と、1 秒ごとのハートビート。"""
        now = self._clock()
        if self._l0.expire(now):
            self._emit("change")
            return
        if self._l0.state is None or now - self._last_sent < HEARTBEAT_S:
            return
        if self._is_stalled(now):
            if not self._stalled:
                self._stalled = True
                logger.warning("judge.stalled")
            return  # 見えていないのに「鹿なし」を送らない。PWA は無受信で「未接続」を出す
        self._emit("heartbeat")

    def _is_stalled(self, now: float) -> bool:
        return self._last_ok is None or now - self._last_ok >= self._cfg.stall_after_s

    def snapshot(self) -> str | None:
        """新しくつないだクライアントへ送る直近の判定。まだ判定が無ければ None。"""
        now = self._clock()
        if self._l0.expire(now):
            self._emit("change")  # 入力が止まったままの鹿を、新しい接続に配らない
        state = self._l0.state
        if state is None or self._is_stalled(now):
            return None  # 見えていないのに「鹿なし」も「鹿あり」も配らない
        text = json.dumps(build_flag(state, self._wall()))
        logger.info(
            "flag.sent",
            extra={
                "t_frame": format_t_frame(state.t_frame),
                "t_sent": format_t_frame(self._wall()),
                "deer": state.deer,
                "reason": "snapshot",
                "clients": 1,
                **self._track_fields(state, now),
            },
        )
        return text

    def _track_fields(self, state: JudgeState, now: float) -> dict[str, object]:
        """deer: true の flag.sent に足す L0 のトラッカーの値（ログだけ。AlertFlag は変えない）。"""
        if not state.deer:
            return {}
        m = self._l0.primary_metrics(now)
        if m is None:
            return {"track_id": None, "ttc_s": None, "lateral_mps": None}
        return {
            "track_id": m.track_id,
            "ttc_s": None if m.ttc_s is None else round(m.ttc_s, 2),
            "lateral_mps": round(m.lateral_mps, 2),
        }

    def on_client_message(self, raw: object) -> None:
        """ack と label だけ読む。余分な項目は捨て、本文はログに残さない。"""
        message = None
        if isinstance(raw, str):
            try:
                message = json.loads(raw)
            except (ValueError, RecursionError):
                message = None
        kind = message.get("type") if isinstance(message, dict) else None
        if kind == "ack":
            self._on_ack(message.get("t_shown"))
        elif kind == "label":
            return  # B2-6（MAY）。受け取って無視する
        else:
            safe = kind if isinstance(kind, str) and len(kind) <= MAX_TYPE_NAME else None
            logger.warning("client.ignored", extra={"type": safe})

    def _on_ack(self, t_shown: object) -> None:
        try:
            if not isinstance(t_shown, str):
                raise ValueError
            parsed = datetime.fromisoformat(t_shown)
            if parsed.tzinfo is None:
                raise ValueError
            fields = {
                "t_shown": format_t_frame(parsed),
                "t_frame": format_t_frame(self._ack_t_frame) if self._ack_t_frame else None,
                "since_frame_ms": None
                if self._ack_t_frame is None
                else round((parsed - self._ack_t_frame).total_seconds() * 1000.0, 1),
            }
        except (ValueError, OverflowError):  # 年 9999 の時刻など。本文は残さない
            logger.warning("ack.invalid")
            return
        logger.info("ack", extra=fields)

    def _emit(self, reason: str) -> None:
        state = self._l0.state
        if state is None:
            return
        wall = self._wall()
        if state.deer and not self._was_on:
            self._ack_t_frame = state.t_frame  # 最後に送った deer:true の最初の t_frame
        self._was_on = state.deer
        sent = self.sender(json.dumps(build_flag(state, wall)))
        self._last_sent = self._clock()
        logger.info(
            "flag.sent",
            extra={
                "t_frame": format_t_frame(state.t_frame),
                "t_sent": format_t_frame(wall),
                "deer": state.deer,
                "reason": reason,
                "clients": sent,
                **self._track_fields(state, self._last_sent),  # 送った後に計算する
            },
        )
