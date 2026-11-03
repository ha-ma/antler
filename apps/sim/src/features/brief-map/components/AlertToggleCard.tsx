import { AlertState, type AlertStateName } from '@antler/alert-ui'
import type { Lang } from '@antler/schema'
import { BRIEF_TEXT, type BriefTextKey } from '../text'

type Props = { lang: Lang; alertOn: boolean; onChange: (on: boolean) => void }

const LEGEND: readonly {
  state: AlertStateName
  distance: number
  shape: BriefTextKey
  meaning: BriefTextKey
}[] = [
  { state: 'safe', distance: 3.2, shape: 'shapeSafe', meaning: 'meaningSafe' },
  { state: 'zone', distance: 12.4, shape: 'shapeZone', meaning: 'meaningZone' },
  { state: 'danger', distance: 58, shape: 'shapeDanger', meaning: 'meaningDanger' },
]

/**
 * 鹿アラートの ON/OFF と 3 状態の凡例（R7、A2-2）。凡例は B の PWA と同じ AlertState（compact・muted）。
 * A-2 は音を出さない。凡例の AlertState は見本なので読み上げから外し、同じ内容を文字で並べる。
 */
export function AlertToggleCard({ lang, alertOn, onChange }: Props) {
  const t = BRIEF_TEXT
  return (
    <section className="brief-alert" data-theme="night" aria-labelledby="brief-alert-title">
      <div className="brief-alert__head">
        <div>
          <h2 id="brief-alert-title" className="brief-alert__title">
            {t.alertHeading[lang]}
          </h2>
          <p className="brief-alert__lead">{t.alertLead[lang]}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={alertOn}
          aria-label={t.alertSwitch[lang]}
          className="brief-switch"
          onClick={() => onChange(!alertOn)}
        >
          <span className="brief-switch__track" aria-hidden="true">
            <span className="brief-switch__thumb" />
          </span>
          <span className="brief-switch__text" aria-hidden="true">
            {alertOn ? t.on[lang] : t.off[lang]}
          </span>
        </button>
      </div>
      <h3 className="brief-alert__legend-title">{t.legendTitle[lang]}</h3>
      <ul className="brief-legend">
        {LEGEND.map((item) => (
          <li key={item.state} className="brief-legend__item">
            {/* 車内スマホの画面（compact の AlertState）をそのまま縮めて見せる */}
            <div className="brief-legend__phone" aria-hidden="true">
              <div className="brief-legend__screen">
                <AlertState
                  state={item.state}
                  distance={item.distance}
                  side="L"
                  lang={lang}
                  compact
                  muted
                />
              </div>
            </div>
            <p className="brief-legend__text">
              <strong>{t[item.shape][lang]}</strong> {t[item.meaning][lang]}
            </p>
          </li>
        ))}
      </ul>
      <p className="brief-alert__note">{alertOn ? t.offNote[lang] : t.offActive[lang]}</p>
    </section>
  )
}
