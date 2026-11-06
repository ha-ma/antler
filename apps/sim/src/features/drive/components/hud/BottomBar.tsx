import { HUD_TEXT } from './hud-text'
import { releaseFocusAfterPointer } from './pointer-focus'

type Props = {
  speedKmh: number
  soundOn: boolean
  onSound: (on: boolean) => void
  /** キーの説明を出す（主のポインタが指の端末では出さない。mobile-landscape R3） */
  keys?: boolean
}

/** 下部: 操作の説明、速度、音トグル（R11） */
export function BottomBar({ speedKmh, soundOn, onSound, keys = true }: Props) {
  return (
    <div className="drive-hud__bottom" data-keys={keys}>
      {keys && (
        <dl className="drive-hud__controls" data-testid="key-hints">
          {HUD_TEXT.controls.map(([key, label]) => (
            <div key={key}>
              <dt>
                <kbd>{key}</kbd>
              </dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="drive-hud__speed" data-testid="speed">
        <span className="drive-hud__num drive-hud__num--large">{Math.round(speedKmh)}</span>{' '}
        {HUD_TEXT.speedUnit}
      </p>
      <button
        type="button"
        className="drive-hud__button"
        aria-pressed={soundOn}
        onClick={(e) => {
          releaseFocusAfterPointer(e)
          onSound(!soundOn)
        }}
      >
        {soundOn ? HUD_TEXT.sound.on : HUD_TEXT.sound.off}
      </button>
    </div>
  )
}
