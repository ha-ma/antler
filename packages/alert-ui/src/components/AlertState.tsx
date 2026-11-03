import type { Side } from '@antler/schema'
import { useContext, useEffect, useState } from 'react'
import { formatKm, formatM } from '../format/format'
import { ALERT_TEXT, otherLangs, type AlertStateName, type Lang } from '../i18n/i18n'
import { AlertSoundContext } from '../sound/sound-context'
import { AlertShape } from './AlertShape'
import { DeerPictogram } from './DeerPictogram'
import { DirectionArrow } from './DirectionArrow'
import { useBlink } from './use-blink'
import './alert-state.css'

// 3 状態を全画面で伝える（docs/design/AlertState.md、functional.md R3・R4・R6・R7・R8・R10）。
// A の車内スマホ（compact）と B の PWA で同じものを使う。操作要素を置かない。タップで消えない。

export type AlertStateProps = {
  state: AlertStateName
  /** safe / zone は km、danger は m。無ければ「--」 */
  distance: number | undefined
  /** danger のときの方向。無ければ前方の矢印 */
  side?: Side | undefined
  /** 主文の言語。副文は残り 3 言語を常に併記（compact では出さない） */
  lang: Lang
  /** A の車内スマホ用。形と数値と矢印だけ */
  compact?: boolean | undefined
  /** 音を鳴らさない */
  muted?: boolean | undefined
}

function announcementOf(
  state: AlertStateName,
  distance: string,
  side: Side | undefined,
  lang: Lang,
) {
  const t = ALERT_TEXT[lang]
  // 距離が分からない（「--」）ときは距離の句を読ませない
  const d = distance === '--' ? undefined : distance
  return state === 'danger' ? t.announceDanger(side, d) : t.announceZone(state, d)
}

export function AlertState({
  state,
  distance,
  side,
  lang,
  compact = false,
  muted = false,
}: AlertStateProps) {
  const sound = useContext(AlertSoundContext)
  const value = state === 'danger' ? formatM(distance) : formatKm(distance)
  const text = ALERT_TEXT[lang][state]

  // 支援技術に読ませる文は、状態が変わったときだけ作り直す（距離の更新で毎秒読み直させない。UC-10）
  // （言語が変わったときも作り直す）
  const [announced, setAnnounced] = useState(() => ({
    state,
    lang,
    text: announcementOf(state, value, side, lang),
  }))
  if (announced.state !== state || announced.lang !== lang) {
    setAnnounced({ state, lang, text: announcementOf(state, value, side, lang) })
  }

  const blinkOn = useBlink(state === 'danger')

  // 音は外部の仕組み（Web Audio）との同期なので effect で渡す
  useEffect(() => {
    sound?.update({ state, distance, lang, muted })
  }, [sound, state, distance, lang, muted])

  // 画面から外れたら、鳴っているビープと発話を止める
  useEffect(() => {
    if (!sound) return undefined
    return () => {
      sound.release()
    }
  }, [sound])

  const shapeSize = compact ? 72 : 200
  const icon = state === 'safe' ? null : <DeerPictogram size={compact ? 36 : 104} />

  return (
    <div
      className="antler-alert"
      data-alert-state={state}
      data-compact={compact ? 'true' : 'false'}
      data-frame={state === 'danger' ? (blinkOn ? 'on' : 'off') : 'none'}
      style={{ background: `var(--alert-${state})`, color: `var(--on-alert-${state})` }}
    >
      {/* ライブリージョンは role を切り替えず、alert と status を常に置いて中身だけ入れ替える（role の切替は読まれない SR が多い） */}
      <p className="antler-alert__sr" role="alert" lang={lang}>
        {announced.state === 'danger' ? announced.text : ''}
      </p>
      <p className="antler-alert__sr" role="status" lang={lang}>
        {announced.state === 'danger' ? '' : announced.text}
      </p>
      {/* 読み上げではなく、支援技術で読みに来たときのための今の値（ライブではない） */}
      <p className="antler-alert__sr" lang={lang} data-testid="alert-current">
        {announcementOf(state, value, side, lang)}
      </p>
      <div className="antler-alert__visual" data-visual aria-hidden="true">
        <AlertShape state={state} size={shapeSize}>
          {icon}
        </AlertShape>
        {state === 'danger' && <DirectionArrow side={side} size={compact ? 32 : 72} />}
        <span className="antler-alert__value">
          <span className="antler-alert__num" data-testid="alert-value">
            {value}
          </span>
          <span className="antler-alert__unit" data-testid="alert-unit">
            {state === 'danger' ? 'm' : 'km'}
          </span>
        </span>
        {!compact && (
          <>
            <p className="antler-alert__headline" data-testid="alert-headline">
              {text.headline}
            </p>
            {text.action && (
              <p className="antler-alert__action" data-testid="alert-action">
                {text.action}
              </p>
            )}
            <p className="antler-alert__sub" data-testid="alert-sub">
              {otherLangs(lang)
                .map((l) => ALERT_TEXT[l][state].headline)
                .join(' ・ ')}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
