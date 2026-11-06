import type { Lang } from '@antler/schema'
import { useSyncExternalStore } from 'react'
import type { ChatFeedStore } from './chat-feed-store'
import { FEED_LABEL, SPEAKER_LABEL } from './chat-text'
import './chat-feed.css'

// 車内の会話（docs/specs/drive-audio-chat/functional.md R13）。HUD の右側に、新しいものを下にして積む。
// 操作要素を置かない・フォーカスを取らない・ポインタを通す。点滅させない。赤の間は減光（60%）。
// 読み上げは見えない aria-live に最後の行だけ（まとめて出たときも 1 回。AlertState の読み上げと重ねない）。

type Props = {
  feed: ChatFeedStore
  lang: Lang
  /** 赤（danger）の間 */
  dimmed: boolean
}

export function ChatFeed({ feed, lang, dimmed }: Props) {
  const { lines, latest } = useSyncExternalStore(feed.subscribe, feed.getSnapshot)
  return (
    <div className="drive-chat" data-dimmed={dimmed}>
      <ol className="drive-chat__list" role="log" aria-live="off" aria-label={FEED_LABEL[lang]}>
        {lines.map((line) => (
          <li key={line.key} className="drive-chat__line">
            <span className="drive-chat__speaker">{SPEAKER_LABEL[line.speaker][lang]}</span>
            <span className="drive-chat__text" lang={lang === 'zh' ? 'zh-TW' : lang}>
              {line.text[lang]}
            </span>
          </li>
        ))}
      </ol>
      <p className="drive-chat__live" aria-live="polite" aria-atomic="true">
        {latest ? `${SPEAKER_LABEL[latest.speaker][lang]}: ${latest.text[lang]}` : ''}
      </p>
    </div>
  )
}
