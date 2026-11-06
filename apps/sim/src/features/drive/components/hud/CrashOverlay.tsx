import type { Lang } from '@antler/schema'
import { hudText } from './hud-text'

/**
 * 衝突の演出（drive-crash-spot R3・UC-3b）。白く光る → 周りから暗くなる → 全面が ground。
 * ぼかしは .drive[data-crash] が 3D の層に当てる（drive.css）。reduced-motion では光とぼかしを出さず、暗くなるだけ。
 * 色は ink（光）と ground（暗転）。alert-danger は鹿検知専用なので使わない。操作要素を持たず、ポインタを奪わない。
 * 当たったことは role="alert" で 1 回伝える（終わりの帯は演出のあとに出る）
 */
export function CrashOverlay({ lang }: { lang: Lang }) {
  return (
    <div className="drive-crash" data-testid="crash-overlay">
      <div className="drive-crash__flash" />
      <div className="drive-crash__vignette" />
      <p className="drive-crash__sr" role="alert">
        {hudText(lang).end.collided}
      </p>
    </div>
  )
}
