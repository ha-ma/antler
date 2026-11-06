import type { Lang } from '@antler/schema'
import type { InputTarget } from '../../domain/input-mix'
import { useTouchDrive } from '../../hooks/use-touch-drive'
import { MOBILE_TEXT } from '../mobile-text'

type Props = {
  /** 指の入力の口（InputMixer の 'touch'） */
  input: InputTarget
  lang: Lang
}

/**
 * 左右の円（docs/specs/mobile-landscape/functional.md R3、A3-3）。指で操る端末で走っている間だけ置く（置く側が決める）。
 * 左の円: ドラッグでハンドルと加減速。右の円: 押している間ブレーキ
 */
export function TouchControls({ input, lang }: Props) {
  const { stick, brake, stickHandlers, brakeHandlers } = useTouchDrive(input)
  const t = MOBILE_TEXT[lang]
  return (
    <>
      <div
        className="drive-touch drive-touch__stick"
        role="group"
        aria-label={t.stick.aria}
        data-testid="touch-stick"
        {...stickHandlers}
      >
        <span
          className="drive-touch__knob"
          aria-hidden="true"
          data-active={stick.x !== 0 || stick.y !== 0}
          style={{
            transform: `translate(calc(-50% + ${String(stick.x * 36)}px), calc(-50% + ${String(stick.y * 36)}px))`,
          }}
        >
          <svg
            viewBox="0 0 24 24"
            width="24"
            height="24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {/* 上下左右の矢印 */}
            <path d="M12 3l-3 3h6zM12 21l-3-3h6zM3 12l3-3v6zM21 12l-3-3v6z" />
          </svg>
        </span>
        <span className="drive-touch__label" aria-hidden="true">
          {t.stick.label}
        </span>
      </div>
      <button
        type="button"
        className="drive-touch drive-touch__brake"
        aria-label={t.brake.aria}
        aria-pressed={brake}
        data-testid="touch-brake"
        {...brakeHandlers}
      >
        <svg
          viewBox="0 0 24 24"
          width="28"
          height="28"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          {/* ペダル */}
          <rect x="6" y="4" width="12" height="16" rx="3" />
          <path d="M9 9h6M9 12h6M9 15h6" />
        </svg>
        <span className="drive-touch__label">{t.brake.label}</span>
      </button>
    </>
  )
}
