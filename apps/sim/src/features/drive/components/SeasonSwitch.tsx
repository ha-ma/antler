import { currentDemoSeason, DEMO_SEASONS, demoSeasonHref } from '../domain/demo-season'
import { SEASON_TEXT } from './season-text'

/**
 * 見本の場面の季節の切り替え（drive-season R2）。運転の場面（engine）は読み込みのときに URL から作るので、
 * SPA の遷移ではなくページを読み直すふつうのリンクにする
 */
export function SeasonSwitch() {
  // 見本の場面の engine も window.location.search から作る（DrivePage）。Router の外でも描ける
  const search = window.location.search
  const current = currentDemoSeason(search)
  return (
    <nav className="drive-start__seasons" aria-label={SEASON_TEXT.label}>
      <ul>
        {DEMO_SEASONS.map(({ id }) => (
          <li key={id}>
            <a href={demoSeasonHref(search, id)} aria-current={id === current ? 'true' : undefined}>
              {SEASON_TEXT.items[id]}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
