import type { Lang } from '@antler/schema'
import { memo, useSyncExternalStore } from 'react'
import { photoOf, photoSrc } from '@/features/plan-trip'
import type { ChatFeedStore } from './chat-feed-store'
import { FEED_LABEL, SPEAKER_LABEL } from './chat-text'
import type { FeedLine } from './chat-types'
import { PhotoCaption } from './PhotoCaption'
import './chat-feed.css'

// 車内の会話（docs/specs/drive-audio-chat/functional.md R13、drive-tourism T8）。HUD の右上に、上から積む（新しいものは下）。
// 楽しみの話の行は、楽しみの写真（飾り。alt=""）と出典の平文を添える。
// 操作要素を置かない・フォーカスを取らない・ポインタを通す。点滅させない。赤の間は減光（60%）。
// 読み上げは見えない aria-live に最後の行の話し手と一言だけ（出典は読まない。AlertState の読み上げと重ねない）。
// 読み上げの声が旅の言語になるよう、ルートに lang を付ける（zh は繁体字 zh-TW）。

type Props = {
  feed: ChatFeedStore
  lang: Lang
  /** 赤（danger）の間 */
  dimmed: boolean
}

export const htmlLang = (lang: Lang): string => (lang === 'zh' ? 'zh-TW' : lang)

export const ChatFeed = memo(function ChatFeed({ feed, lang, dimmed }: Props) {
  const { lines, latest } = useSyncExternalStore(feed.subscribe, feed.getSnapshot)
  return (
    <div className="drive-chat" data-dimmed={dimmed} lang={htmlLang(lang)}>
      <div role="log" aria-live="off" aria-label={FEED_LABEL[lang]}>
        <ol className="drive-chat__list">
          {lines.map((line) => (
            <ChatLineItem key={line.key} line={line} lang={lang} />
          ))}
        </ol>
      </div>
      <p className="drive-chat__live" aria-live="polite" aria-atomic="true">
        {latest ? `${SPEAKER_LABEL[latest.speaker][lang]}: ${latest.text[lang]}` : ''}
      </p>
    </div>
  )
})

function ChatLineItem({ line, lang }: { line: FeedLine; lang: Lang }) {
  const photo = line.pleasure ? photoOf(line.pleasure) : null
  return (
    <li className="drive-chat__line" data-photo={photo !== null}>
      {photo && (
        <img
          className="drive-chat__photo"
          src={photoSrc(photo)}
          alt=""
          width={64}
          height={48}
          decoding="async"
        />
      )}
      <span className="drive-chat__body">
        <span className="drive-chat__speaker">{SPEAKER_LABEL[line.speaker][lang]}</span>
        <span className="drive-chat__text">{line.text[lang]}</span>
        {photo && <PhotoCaption photo={photo} lang={lang} className="drive-chat__credit" />}
      </span>
    </li>
  )
}
