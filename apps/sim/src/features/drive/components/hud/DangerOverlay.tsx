import { ALERT_TEXT, formatM, type DerivedAlert } from '@antler/alert-ui'
import type { Lang } from '@antler/schema'
import { SIDE_TEXT } from './hud-text'

/**
 * 赤のときの画面の縁のビネットと中央上のバナー（R7、A5-3、UC-7a）。アラート OFF では描かない。
 * 読み上げは車内スマホの AlertState が持つので、バナーは支援技術に読ませない（二重に読まれない）。
 */
export function DangerOverlay({ alert, lang }: { alert: DerivedAlert; lang: Lang }) {
  if (alert.state !== 'danger') return null
  const side = alert.side ? ` ${SIDE_TEXT[lang][alert.side]}` : ''
  return (
    <>
      <div className="drive-hud__vignette" data-testid="danger-vignette" aria-hidden="true" />
      <p className="drive-hud__banner" data-testid="danger-banner" aria-hidden="true">
        {ALERT_TEXT[lang].danger.headline}
        {side} <span className="drive-hud__num">{formatM(alert.distance)}</span> m
      </p>
    </>
  )
}
