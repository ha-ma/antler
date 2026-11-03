import { formatDuration, formatJstDate, formatJstTime } from '../../domain/clock'
import type { DriveSnapshot } from '../../domain/engine'
import { PLAYBACK_RATES } from '../../domain/playback'
import type { PlaybackRate } from '../../types'
import { HUD_TEXT, SURFACE_TEXT, WEATHER_TEXT } from './hud-text'

type Props = {
  snapshot: DriveSnapshot
  onRate: (rate: PlaybackRate) => void
  onPause: (paused: boolean) => void
}

/** 上部: 日付・時刻・日没、再生速度、天候・路面・運転時間のチップ（R11、UC-7f） */
export function TopBar({ snapshot, onRate, onPause }: Props) {
  const { playback } = snapshot
  const p = HUD_TEXT.playback
  return (
    <div className="drive-hud__top">
      <div className="drive-hud__clock" data-testid="clock">
        <span>{formatJstDate(snapshot.clockMs)}</span>
        <span className="drive-hud__num">{formatJstTime(snapshot.clockMs)}</span>
        <span>
          {HUD_TEXT.time.sunset}{' '}
          <span className="drive-hud__num">
            {snapshot.sunsetMs === null ? '--:--' : formatJstTime(snapshot.sunsetMs)}
          </span>
        </span>
      </div>
      <div className="drive-hud__playback" role="group" aria-label={p.label}>
        {PLAYBACK_RATES.map((rate) => (
          <button
            key={rate}
            type="button"
            className="drive-hud__button"
            aria-pressed={playback.rate === rate}
            disabled={playback.locked && rate !== 1}
            aria-describedby={playback.locked ? 'drive-playback-locked' : undefined}
            onClick={() => onRate(rate)}
          >
            {rate}×
          </button>
        ))}
        <button
          type="button"
          className="drive-hud__button"
          aria-pressed={playback.paused}
          onClick={() => onPause(!playback.paused)}
        >
          {playback.paused ? p.resume : p.pause}
        </button>
        {playback.locked && (
          <span id="drive-playback-locked" className="drive-hud__note">
            {p.locked}
          </span>
        )}
      </div>
      <ul className="drive-hud__chips" aria-label="条件">
        <li>{WEATHER_TEXT[snapshot.weather]}</li>
        <li>{SURFACE_TEXT[snapshot.surface]}</li>
        <li>
          {HUD_TEXT.time.driving}{' '}
          <span className="drive-hud__num">{formatDuration(snapshot.t)}</span>
        </li>
      </ul>
    </div>
  )
}
