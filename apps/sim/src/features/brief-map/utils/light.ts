import type { Lang } from '@antler/schema'
import type { LightPeriod } from '@antler/zones'
import { BRIEF_TEXT } from '../text'

const KEY = { day: 'lightDay', dawn: 'lightDawn', dusk: 'lightDusk', night: 'lightNight' } as const

/** 光の区分の語（色だけに頼らず、時刻と一緒に文字で出す。R3） */
export function lightText(light: LightPeriod, lang: Lang): string {
  return BRIEF_TEXT[KEY[light]][lang]
}
