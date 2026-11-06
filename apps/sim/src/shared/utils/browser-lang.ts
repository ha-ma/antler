import type { Lang } from '@antler/schema'
import { initialLang } from '@antler/trip'

// 旅の言語が分からない間（読み込み中・失敗・描画の失敗）の言語（docs/specs/i18n/functional.md R5・S-1）。
// A（sim）は A-1 と同じ initialLang（zh は繁体字の地域だけ、当てはまらなければ ja）。

export function browserLangs(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages
}

export function browserLang(): Lang {
  return initialLang(browserLangs())
}
