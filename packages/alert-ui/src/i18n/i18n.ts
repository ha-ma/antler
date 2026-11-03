// AlertState の文言（functional.md R6、AlertState.md の表）。zh は繁体字（zh-TW）。
// zh・ko の safe / zone の文言はネイティブ確認が保留（functional.md の Questions、期日 2026-11-07）。

export const LANGS = ['ja', 'en', 'zh', 'ko'] as const
export type Lang = (typeof LANGS)[number]
export type AlertStateName = 'safe' | 'zone' | 'danger'

type StateText = {
  /** 主文（大きく出す一語） */
  headline: string
  /** 補助文（zone の減速、danger のブレーキ）。safe には無い */
  action?: string
}

type LangText = Record<AlertStateName, StateText> & {
  /** 支援技術に読ませる文（danger）。方向と距離を差し込む。距離が分からなければ距離の句を省く */
  announceDanger: (side: 'L' | 'R' | undefined, distance: string | undefined) => string
  /** 支援技術に読ませる文（safe / zone）。距離が分からなければ距離の句を省く */
  announceZone: (state: 'safe' | 'zone', distance: string | undefined) => string
  /** 読み上げ音声（danger に入ってビープ 2 回のあと） */
  speech: string
  /** 支援技術に読ませる単位 */
  unitKm: string
  unitM: string
}

export const ALERT_TEXT: Record<Lang, LangText> = {
  ja: {
    safe: { headline: '鹿ゾーンまで' },
    zone: { headline: '鹿ゾーン走行中', action: '減速 50 km/h 以下に' },
    danger: { headline: '前方に鹿', action: 'ブレーキ' },
    announceDanger: (side, d) =>
      `前方に鹿${side === 'L' ? ' 左' : side === 'R' ? ' 右' : ''}${d ? ` ${d} メートル` : ''}`,
    announceZone: (state, d) =>
      state === 'zone'
        ? `鹿ゾーン走行中${d ? ` 残り ${d} キロ` : ''}`
        : `鹿ゾーンまで${d ? ` ${d} キロ` : ''}`,
    speech: '前方に鹿がいます',
    unitKm: 'キロ',
    unitM: 'メートル',
  },
  en: {
    safe: { headline: 'DEER ZONE AHEAD' },
    zone: { headline: 'DEER ZONE', action: 'Slow down to 50 km/h' },
    danger: { headline: 'DEER AHEAD', action: 'BRAKE' },
    announceDanger: (side, d) =>
      `Deer ahead${side === 'L' ? ' on the left' : side === 'R' ? ' on the right' : ''}${d ? `, ${d} meters` : ''}`,
    announceZone: (state, d) =>
      state === 'zone'
        ? `In deer zone${d ? `, ${d} km remaining` : ''}`
        : `Deer zone ahead${d ? ` in ${d} km` : ''}`,
    speech: 'Deer ahead',
    unitKm: 'km',
    unitM: 'meters',
  },
  zh: {
    safe: { headline: '距鹿區' },
    zone: { headline: '鹿區行駛中', action: '減速至 50 km/h 以下' },
    danger: { headline: '前方有鹿', action: '煞車' },
    announceDanger: (side, d) =>
      `前方有鹿${side === 'L' ? ' 左側' : side === 'R' ? ' 右側' : ''}${d ? ` ${d} 公尺` : ''}`,
    announceZone: (state, d) =>
      state === 'zone'
        ? `鹿區行駛中${d ? ` 剩餘 ${d} 公里` : ''}`
        : `距鹿區${d ? ` ${d} 公里` : ''}`,
    speech: '前方有鹿',
    unitKm: '公里',
    unitM: '公尺',
  },
  ko: {
    safe: { headline: '사슴 구역까지' },
    zone: { headline: '사슴 구역 주행 중', action: '50 km/h 이하로 감속' },
    danger: { headline: '전방 사슴', action: '브레이크' },
    announceDanger: (side, d) =>
      `전방 사슴${side === 'L' ? ' 왼쪽' : side === 'R' ? ' 오른쪽' : ''}${d ? ` ${d} 미터` : ''}`,
    announceZone: (state, d) =>
      state === 'zone'
        ? `사슴 구역 주행 중${d ? ` 남은 거리 ${d} 킬로미터` : ''}`
        : `사슴 구역까지${d ? ` ${d} 킬로미터` : ''}`,
    speech: '전방에 사슴이 있습니다',
    unitKm: '킬로미터',
    unitM: '미터',
  },
}

/** 副文に出す残り 3 言語（並びは LANGS の順）。 */
export function otherLangs(lang: Lang): Lang[] {
  return LANGS.filter((l) => l !== lang)
}

/**
 * 端末の言語の一覧（navigator.languages）から主文の言語を選ぶ（B4-7）。
 * zh は繁体字（zh-TW・zh-HK・zh-Hant）だけ。簡体字（zh-CN・zh-Hans）とほかの言語は en。
 */
export function resolveLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const lower = tag.toLowerCase()
    if (lower === 'ja' || lower.startsWith('ja-')) return 'ja'
    if (lower === 'ko' || lower.startsWith('ko-')) return 'ko'
    if (lower.startsWith('zh-')) {
      if (/^zh-(hant|tw|hk|mo)(-|$)/.test(lower)) return 'zh'
      continue
    }
    if (lower === 'en' || lower.startsWith('en-')) return 'en'
  }
  return 'en'
}
