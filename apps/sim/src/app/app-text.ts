import type { Lang } from '@antler/schema'

// 描画が壊れたときの画面の文（docs/specs/i18n/functional.md R6）。旅の言語を信用できないので 4 言語を並べて出す。

export const APP_ERROR_TEXT: Record<Lang, string> = {
  ja: '表示中に問題が起きました。ページを読み込み直してください。',
  en: 'Something went wrong while showing this page. Please reload the page.',
  zh: '顯示時發生問題。請重新載入頁面。',
  ko: '화면을 표시하는 중에 문제가 생겼습니다. 페이지를 새로 고쳐 주세요.',
}

/** 並べる順（ブラウザの言語を先頭に、残りは ja・en・zh・ko の順） */
export function errorLangOrder(first: Lang): Lang[] {
  return [first, ...(['ja', 'en', 'zh', 'ko'] as const).filter((l) => l !== first)]
}
