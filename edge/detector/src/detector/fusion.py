"""fusion（B2-5）: L0 の赤に、L1 の答えで「降格」だけを重ねる。L1 は上げない・数値を変えない。

降格（出力を deer: false にする）は、次をすべて満たすあいだだけ（docs/specs/edge-l1 R5）:
- 校正あり・結論が false_positive か alert_level（none/zone）で 0.9 以上
- L0 が今赤で、答えの問い合わせが今の赤のエピソードの中で作られた
- 赤の候補のトラックがちょうど 1 つで、それが問い合わせたトラック
- alert_level が理由なら、そのトラックが車線（lane）にいない
- 答えが新しい（問い合わせの開始から 3 / rate_hz + timeout 秒以内）
解除（赤へ戻す）は遅らせない。再び降格するのは赤に戻してから 1 秒後から
（入れ替わりを 1 Hz 以下に）。

detector.l1 を import しない（L1 が無くても L0 は動く）。イベントループの上だけで触る。
"""

from __future__ import annotations

import logging
import math
from collections import deque
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from detector.config import L1Config
    from detector.l0.stage import L0Stage
    from detector.l0.tracker import Track

__all__ = [
    "FLIP_GUARD_S",
    "HOLD_MAX_S",
    "Fusion",
    "L1Target",
    "L1Verdict",
    "conclude",
]

logger = logging.getLogger("detector.fusion")

FLIP_GUARD_S = 1.0  # 赤に戻してから再び降格するまでの最短（AlertState の 1 Hz と同じ）
HOLD_MAX_S = 0.15  # wait_for_l1_before_red の保留の上限（B2-8 の前提「L1 ≤150 ms」）
RECENT_WINDOW_S = 30.0  # recentAlerts30s
LEVEL_ORDER = ("danger", "zone", "none")  # 同点は危ない側を結論にする


@dataclass(frozen=True)
class L1Target:
    """L1 に聞く対象（L0 から取った値だけ）。episode は問い合わせを作ったときの赤のエピソード。"""

    episode: int | None
    track_id: int
    points: list[dict[str, object]]
    ttc_s: float | None


@dataclass(frozen=True)
class L1Verdict:
    """L1 の答えの要約。conf は校正後（校正なしなら素の値で、降格には使わない）。"""

    episode: int | None
    track_id: int
    started: float  # 問い合わせの開始（単調時計）
    latency_ms: float
    model: str
    calibrated: bool
    alert_level: str
    conf: float
    conf_raw: float
    reason: str | None  # false_positive / alert_level / None（降格の理由にならない）
    # 問い合わせの車の状態が PWA の実値か（pwa / partial / fixed。ログだけ。降格の条件に入れない）
    state_source: str = "fixed"


def conclude(
    levels: dict[str, float], false_positive: float, override_conf: float
) -> tuple[str, float, str | None]:
    """L1 の結論 (alert_level, conf, 理由)。理由があるときだけ降格の候補になる。"""
    if false_positive >= override_conf:
        return "zone", false_positive, "false_positive"
    best = max(LEVEL_ORDER, key=lambda k: (levels.get(k, 0.0), -LEVEL_ORDER.index(k)))
    conf = levels.get(best, 0.0)
    if best in ("none", "zone") and conf >= override_conf:
        return best, conf, "alert_level"
    return best, conf, None


def _unit(x: float) -> float:
    return min(1.0, max(0.0, x)) if math.isfinite(x) else 0.0


class Fusion:
    def __init__(self, config: L1Config, l0: L0Stage, threshold: float) -> None:
        self._cfg = config
        self._l0 = l0
        self._threshold = threshold
        self._ttl = 3.0 / config.rate_hz + config.timeout_ms / 1000.0
        self._count = 0
        self.episode: int | None = None
        self._verdict: L1Verdict | None = None
        self._active = False
        self._released_at: float | None = None
        self._alerts: deque[float] = deque()

    @property
    def ttl_s(self) -> float:
        return self._ttl

    @property
    def active(self) -> bool:
        return self._active

    def after_l0(self, now: float) -> bool:
        """L0 の更新（update / expire）の後に呼ぶ。赤のエピソードを開け閉めする。

        赤になった（エピソードが始まった）ら True。
        """
        state = self._l0.state
        on = bool(state and state.deer)
        if on and self.episode is None:
            self._count += 1
            self.episode = self._count
            self._alerts.append(now)
            self._verdict = None
            self._active = False
            return True
        if not on and self.episode is not None:
            if self._active:
                self._released_at = now  # 降格のまま閉じても、次の降格まで 1 秒あける
            self.episode = None
            self._verdict = None
            self._active = False
        return False

    def recent_alerts(self, now: float) -> int:
        while self._alerts and now - self._alerts[0] > RECENT_WINDOW_S:
            self._alerts.popleft()
        return len(self._alerts)

    def target(self) -> L1Target | None:
        """聞く対象。赤のあいだは赤の候補でいちばん高いもの、赤でなければ主トラック。"""
        try:
            if self.episode is not None:
                reds = self._l0.red_tracks(self._threshold)
                track = max(reds, key=lambda tr: (tr.last.xywh[3], -tr.id)) if reds else None
            else:
                track = self._l0.tracker.primary()
            if track is None:
                return None
            points = self._l0.tracker.track_points(track)
            metrics = self._l0.tracker.metrics(track)
        except Exception:  # noqa: BLE001  トラッカーが壊れていたら聞かない（L0 は stage が守る）
            return None
        if not points:
            return None
        return L1Target(self.episode, track.id, points, metrics.ttc_s)

    def apply(self, verdict: L1Verdict) -> str:
        """答えを取り込み、ログの route を返す。今のエピソードの答えだけを残す。"""
        if verdict.episode is None or verdict.episode != self.episode:
            route = "no_episode"
        elif not verdict.calibrated:
            route = "uncalibrated"
        elif verdict.reason is not None:
            route = "override"
        elif self._cfg.l2_route_conf[0] <= verdict.conf < self._cfg.l2_route_conf[1]:
            route = "l2_candidate"
        else:
            route = "log"
        if route != "no_episode":
            self._verdict = verdict  # 降格にならない答え・校正なしの答えも、前の降格を上書きする
        return route

    def failed(self) -> None:
        """L1 が失敗した。降格を解く（次の refresh で赤に戻る）。"""
        self._verdict = None

    def refresh(self, now: float) -> bool:
        """降格の条件を確かめ直し、今降格しているかを返す。解除は即時、再降格は 1 秒あける。"""
        ok = self._qualifies(now)
        if ok and not self._active:
            if self._released_at is not None and now - self._released_at < FLIP_GUARD_S:
                return False
            self._active = True
        elif not ok and self._active:
            self._active = False
            self._released_at = now
        return self._active

    def _qualifies(self, now: float) -> bool:
        v = self._verdict
        state = self._l0.state
        if v is None or not v.calibrated or v.reason is None:
            return False
        if self.episode is None or v.episode != self.episode or not (state and state.deer):
            return False
        if now - v.started > self._ttl:
            return False
        reds = self._l0.red_tracks(self._threshold)
        if [tr.id for tr in reds] != [v.track_id]:
            return False
        return v.reason == "false_positive" or self._pos(reds[0]) != "lane"

    def _pos(self, track: Track) -> str:
        try:
            return self._l0.tracker.metrics(track).pos
        except Exception:  # noqa: BLE001  分からなければ車線にいるとみなす（降格しない）
            return "lane"

    def l1_field(self) -> dict[str, object] | None:
        """AlertFlag.l1。今のエピソードの校正済みの答えがあるときだけ。"""
        v = self._verdict
        if v is None or not v.calibrated or self.episode is None or v.episode != self.episode:
            return None
        return {
            "alert_level": v.alert_level,
            "conf": round(_unit(v.conf), 4),
            "overrode": self._active,
            "latencyMs": round(max(0.0, v.latency_ms), 1) if math.isfinite(v.latency_ms) else 0.0,
        }

    def has_verdict_for_episode(self) -> bool:
        v = self._verdict
        return v is not None and self.episode is not None and v.episode == self.episode
