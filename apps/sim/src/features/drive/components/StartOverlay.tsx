import { HUD_TEXT } from './hud/hud-text'

/** 出発の前の案内（UC-7e）。「出発」の操作の中で音を解除する（ブラウザの自動再生の制限） */
export function StartOverlay({
  alertEnabled,
  onStart,
}: {
  alertEnabled: boolean
  onStart: () => void
}) {
  const t = HUD_TEXT.start
  return (
    <section className="drive-start" aria-labelledby="drive-start-title">
      <h1 id="drive-start-title">{t.title}</h1>
      <p>{t.lead}</p>
      <p>{alertEnabled ? t.alertOn : t.alertOff}</p>
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
      <button type="button" className="drive-hud__primary" onClick={onStart}>
        {t.go}
      </button>
    </section>
  )
}
