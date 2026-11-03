import { HUD_TEXT } from './hud-text'
import { releaseFocusAfterPointer } from './pointer-focus'

type Props = {
  speedKmh: number
  soundOn: boolean
  onSound: (on: boolean) => void
}

/** 下部: 操作の説明、速度、音トグル（R11） */
export function BottomBar({ speedKmh, soundOn, onSound }: Props) {
  return (
    <div className="drive-hud__bottom">
      <dl className="drive-hud__controls">
        {HUD_TEXT.controls.map(([key, label]) => (
          <div key={key}>
            <dt>
              <kbd>{key}</kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
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
