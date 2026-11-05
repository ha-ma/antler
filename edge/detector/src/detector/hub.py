"""配信の規則（B3-2）: 変化は即時、そのほかは 1 秒ごと。ack を受けて遅延を走行ログに残す。

トランスポート（WebSocket）は知らない。送り先は sender（文字列 → 送った数）だけ。
イベントループの上だけで触る。時計は注入できる（clock は単調時計の秒、wall は壁時計）。

赤は L0 だけで決め、`on_result` の中で同期に送る（B2-3）。L1 の答え（edge-l1）は `on_l1` で
fusion に渡し、降格で出力が変わったときだけ再送する（`reason=l1`）。detector.l1 は import しない。
"""

from __future__ import annotations

import asyncio
import json
import logging
import math
from dataclasses import replace
from datetime import UTC, datetime
from time import monotonic
from typing import TYPE_CHECKING

from detector.flag import build_flag
from detector.frame import format_t_frame
from detector.fusion import HOLD_MAX_S, Fusion
from detector.judge import JudgeState, is_blind
from detector.l0.stage import L0Stage
from detector.vehicle import SPEED_MAX_AGE_S, VehicleReport, parse_vehicle

if TYPE_CHECKING:
    from collections.abc import Callable

    from detector.config import JudgeConfig, L1Config, TrackerConfig
    from detector.fusion import L1Target, L1Verdict
    from detector.pipeline import FrameResult

logger = logging.getLogger("detector.hub")

HEARTBEAT_S = 1.0
MAX_TYPE_NAME = 32
VEHICLE_LOG_INTERVAL_S = 1.0  # vehicle.updated / vehicle.invalid / vehicle.error は 1 秒に 1 回まで


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
        l1: L1Config | None = None,
    ) -> None:
        self._cfg = config
        self._clock = clock
        self._wall = wall
        # 赤は L0 だけで決める（B2-3）。L1 の結果は待たない（edge-l1 は降格だけを非同期に重ねる）
        self._l0 = l0 or L0Stage(config, tracker)
        self._judge = self._l0.judge  # 既存のテスト（test_server）が状態を覗く入口
        self.fusion = Fusion(l1, self._l0, config.threshold) if l1 and l1.enabled else None
        self._wait = bool(self.fusion and l1 and l1.wait_for_l1_before_red)
        self.l1_healthy = False  # L1 のタスクが直前の問い合わせに成功したか（保留の条件）
        self.l1_wake = asyncio.Event()  # 赤の保留のとき L1 のタスクをすぐ起こす
        self._hold_until: float | None = None
        self._fusion_fail_log: float | None = None
        self.sender: Callable[[str], int] = lambda _text: 0
        self._last_sent = 0.0
        self._last_ok: float | None = None
        self._stalled = False
        self._was_on = False
        self._out_deer: bool | None = None  # 最後に送った出力の deer
        self._ack_t_frame: datetime | None = None
        self._clients = 0
        # PWA から届いた車の状態の最新 1 件（pwa-uplink）。赤の経路には使わない（L1 の入力だけ）
        self._vehicle: VehicleReport | None = None
        self._vehicle_key: tuple[object, object] | None = None
        self._vehicle_stale_logged = False
        self._vehicle_logs: dict[str, float] = {}

    @property
    def deer_on(self) -> bool:
        s = self._l0.state
        return bool(s and s.deer)

    def on_result(self, result: FrameResult) -> None:
        now = self._clock()
        if not is_blind(result):
            self._last_ok = now
            self._stalled = False
        changed = self._l0.update(result, now)  # 同期。await を入れない
        started = self._after_l0(now)
        if started and self._wait and self.l1_healthy:
            self._hold_until = now + HOLD_MAX_S  # B2-8: 150 ms まで。期限は tick が見る
            self.l1_wake.set()
        self._sync(now, "change", l0_changed=changed)

    def tick(self) -> None:
        """短い間隔（0.1 秒など）で呼ぶ。

        入力停止の expire、保留・降格の期限、1 秒ごとのハートビート。
        """
        now = self._clock()
        expired = self._l0.expire(now)
        self._after_l0(now)
        held = self._hold_until is not None
        if self._sync(now, "change" if expired or held else "l1", l0_changed=expired):
            return
        if self._l0.state is None or now - self._last_sent < HEARTBEAT_S:
            return
        if self._is_stalled(now):
            if not self._stalled:
                self._stalled = True
                logger.warning("judge.stalled")
            return  # 見えていないのに「鹿なし」を送らない。PWA は無受信で「未接続」を出す
        self._emit("heartbeat", now)

    def _output(self, now: float) -> JudgeState | None:
        """送る状態。L0 の状態に、保留（B2-8）と降格（fusion）を重ねる。"""
        state = self._l0.state
        if state is None:
            return None
        if self._hold_until is not None:
            if not state.deer or now >= self._hold_until:
                self._hold_until = None
            else:
                return JudgeState(False, state.t_frame)  # 保留中は保留前の「赤でない」のまま
        if state.deer and self._demoted(now):
            # 降格。conf・距離は付けない（deer: false の形）
            return JudgeState(False, state.t_frame)
        return state

    def _after_l0(self, now: float) -> bool:
        """fusion にエピソードの開け閉めを知らせる。fusion が壊れても赤は止めない。"""
        if self.fusion is None:
            return False
        try:
            return self.fusion.after_l0(now)
        except Exception as exc:  # noqa: BLE001  赤の経路。壊れたら降格しない側に倒す
            self._fusion_failed(exc, now)
            return False

    def _demoted(self, now: float) -> bool:
        """降格しているか。fusion が壊れたら降格しない（L0 の赤をそのまま出す）。"""
        if self.fusion is None:
            return False
        try:
            return self.fusion.refresh(now)
        except Exception as exc:  # noqa: BLE001  赤の経路。壊れたら降格しない側に倒す
            self._fusion_failed(exc, now)
            return False

    def _fusion_failed(self, exc: Exception, now: float) -> None:
        if self._fusion_fail_log is None or now - self._fusion_fail_log >= HEARTBEAT_S:
            self._fusion_fail_log = now
            logger.error("fusion.failed", extra={"error_type": type(exc).__name__})

    def _sync(self, now: float, reason: str, l0_changed: bool) -> bool:
        """出力が変わった（または L0 が変わってそのまま出す）ときに送る。送ったら True。"""
        out = self._output(now)
        if out is None:
            return False
        if out.deer != self._out_deer or (l0_changed and out is self._l0.state):
            self._emit(reason, now, out)
            return True
        return False

    def _is_stalled(self, now: float) -> bool:
        return self._last_ok is None or now - self._last_ok >= self._cfg.stall_after_s

    def l1_target(self) -> tuple[L1Target, int] | None:
        """L1 のタスクが聞く対象と recentAlerts30s。聞く対象が無ければ None。"""
        if self.fusion is None:
            return None
        target = self.fusion.target()
        if target is None:
            return None
        return target, self.fusion.recent_alerts(self._clock())

    def on_l1(self, verdict: L1Verdict) -> None:
        """L1 の答え。降格で出力が変わったら再送する。止まっている（stalled）あいだは送らない。"""
        if self.fusion is None:
            return
        now = self._clock()
        route = self.fusion.apply(verdict)
        if self._hold_until is not None and verdict.episode == self.fusion.episode:
            self._hold_until = None  # 保留中に答えが来た: 答えで決めた出力を送る
        if not self._is_stalled(now):
            self._sync(now, "l1", l0_changed=False)
        logger.info(
            "l1.result",
            extra={
                "episode": verdict.episode,
                "track_id": verdict.track_id,
                "latency_ms": round(verdict.latency_ms, 1),
                "model": verdict.model,
                "alert_level": verdict.alert_level,
                "conf": round(verdict.conf, 4),
                "conf_raw": round(verdict.conf_raw, 4),
                "calibrated": verdict.calibrated,
                "reason": verdict.reason,
                "state_source": verdict.state_source,
                "route": route,
                "overrode": self.fusion.active,
            },
        )
        if route == "l2_candidate":
            logger.info(
                "l1.l2_candidate",
                extra={
                    "episode": verdict.episode,
                    "conf": round(verdict.conf, 4),
                    "l2": "not_implemented",
                },
            )

    def on_l1_failed(self) -> None:
        """L1 が使えなかった。降格と保留を解き、赤に戻す（ログは L1 のタスクが残す）。"""
        if self.fusion is None:
            return
        now = self._clock()
        self.fusion.failed()
        held = self._hold_until is not None
        self._hold_until = None
        if not self._is_stalled(now):
            self._sync(now, "change" if held else "l1", l0_changed=False)

    def snapshot(self) -> str | None:
        """新しくつないだクライアントへ送る直近の判定。まだ判定が無ければ None。"""
        now = self._clock()
        if self._l0.expire(now):
            self._after_l0(now)
            self._emit("change", now)  # 入力が止まったままの鹿を、新しい接続に配らない
        state = self._output(now)
        if state is None or self._is_stalled(now):
            return None  # 見えていないのに「鹿なし」も「鹿あり」も配らない
        wall = self._wall()
        text, l1 = self._serialize(state, wall, now)
        logger.info(
            "flag.sent",
            extra={
                "t_frame": format_t_frame(state.t_frame),
                "t_sent": format_t_frame(wall),
                "deer": state.deer,
                "reason": "snapshot",
                "clients": 1,
                **self._track_fields(state, now),
                **({"l1": l1} if l1 else {}),
            },
        )
        return text

    def _serialize(
        self, state: JudgeState, wall: datetime, now: float
    ) -> tuple[str, dict[str, object] | None]:
        """AlertFlag の JSON と、実際に付けた l1（付けなければ None）。"""
        flag = build_flag(state, wall)
        l1 = None
        if self.fusion is not None and self.deer_on:
            try:
                l1 = self.fusion.l1_field()
            except Exception as exc:  # noqa: BLE001  l1 はログ用。壊れても赤は送る
                self._fusion_failed(exc, now)
            if l1 is not None:
                flag["l1"] = l1
        try:
            return json.dumps(flag, allow_nan=False), l1
        except ValueError:
            return self.dumps_finite(flag), None

    @staticmethod
    def dumps_finite(flag: dict[str, object]) -> str:
        """NaN・無限大を JSON に書かない（schema-judge R3）。l1 を外し、壊れた数は 0 にする。

        PWA の JSON.parse は NaN で落ち、deer ごと失われる。0 にしても deer は届く（赤は止めない）。
        """
        logger.error("flag.non_finite")
        clean = {
            k: (0.0 if isinstance(v, float) and not math.isfinite(v) else v)
            for k, v in flag.items()
            if k != "l1"
        }
        return json.dumps(clean, allow_nan=False)

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
        """ack・label・vehicle だけ読む。余分な項目は捨て、本文はログに残さない。"""
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
        elif kind == "vehicle":
            self._on_vehicle(message)
        else:
            safe = kind if isinstance(kind, str) and len(kind) <= MAX_TYPE_NAME else None
            logger.warning("client.ignored", extra={"type": safe})

    def _on_vehicle(self, message: object) -> None:
        """PWA の速度・ゾーン・光（pwa-uplink R4）。検証に通ったものを丸ごと置き換える。

        同期で数マイクロ秒の処理だけ（検証と代入）。赤の経路（on_result・tick・fusion）を呼ばない。
        通らなければ捨てて前の値を残す（新しさも進めない）。本文・位置はログに出さない。
        """
        now = self._clock()
        try:
            report = parse_vehicle(message, now)
        except ValueError:
            self._vehicle_log("invalid", now, logger.warning, "vehicle.invalid", {})
            return
        except Exception as exc:  # noqa: BLE001  接続を落とさない。前の値を残す
            self._vehicle_log(
                "error", now, logger.error, "vehicle.error", {"error_type": type(exc).__name__}
            )
            return
        self._vehicle = report
        self._vehicle_stale_logged = False
        key = (
            report.zone,
            report.light,
        )  # 速度の有無では出さない（null と数値の行き来で毎秒出ない）
        if key != self._vehicle_key and self._vehicle_log_ready("updated", now):
            self._vehicle_key = key
            logger.info(
                "vehicle.updated",
                extra={
                    "zone": report.zone,
                    "light": report.light,
                    "has_speed": report.speed_kmh is not None,
                },
            )

    def _vehicle_log_ready(self, name: str, now: float) -> bool:
        last = self._vehicle_logs.get(name)
        if last is not None and now - last < VEHICLE_LOG_INTERVAL_S:
            return False
        self._vehicle_logs[name] = now
        return True

    def _vehicle_log(
        self,
        name: str,
        now: float,
        emit: Callable[..., None],
        event: str,
        extra: dict[str, object],
    ) -> None:
        if self._vehicle_log_ready(name, now):
            emit(event, extra=extra)

    def vehicle_report(self, max_age_s: float) -> VehicleReport | None:
        """L1 の問い合わせに使う車の状態。新しい項目だけを返す（pwa-uplink R5）。

        自分の単調時計で古さを測る（端末の時刻は見ない。時計が戻っても新しい扱い）。
        速度は 3 秒、ゾーンと光は max_age_s を超えたら外し、全部外れたら None。
        古くなったら vehicle.stale を 1 回残す（次の新しい値が来るまで繰り返さない）。
        """
        report = self._vehicle
        if report is None:
            return None
        age = max(0.0, self._clock() - report.received_at)
        if age > max_age_s:
            if not self._vehicle_stale_logged:
                self._vehicle_stale_logged = True
                logger.info("vehicle.stale", extra={"age_s": round(age, 1)})
            return None
        if report.speed_kmh is not None and age > min(SPEED_MAX_AGE_S, max_age_s):
            return replace(report, speed_kmh=None)
        return report

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

    def _emit(self, reason: str, now: float, out: JudgeState | None = None) -> None:
        state = out if out is not None else self._output(now)
        if state is None:
            return
        wall = self._wall()
        if state.deer and not self._was_on:
            self._ack_t_frame = state.t_frame  # 最後に送った deer:true（出力）の最初の t_frame
        self._was_on = state.deer
        self._out_deer = state.deer
        text, l1 = self._serialize(state, wall, now)
        sent = self.sender(text)
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
                **({"l1": l1} if l1 else {}),
            },
        )
