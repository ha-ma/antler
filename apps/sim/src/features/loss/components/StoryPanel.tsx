import type { Lang } from '@antler/schema'
import { LossStoryError, useLossStory } from '../hooks/useLossStory'
import { LOSS_TEXT } from '../text'
import type { ResolvedCollision } from '../types'
import { dropClass, type DropStyle } from '../utils/drop'

/**
 * Claude の喪失文の欄（functional.md R5）。失敗するのはこの欄だけで、4 指標・しおり・統計カードは出したまま。
 * 失敗は「文を用意できませんでした」と「もう一度」（自動の再試行なし）。DAILY_LIMIT・LOSS_LIMIT は「本日の上限に達しました」だけ。
 * 代わりの文は作らない。
 */
export function StoryPanel({
  collision,
  lang,
  drop,
}: {
  collision: ResolvedCollision
  lang: Lang
  drop?: DropStyle
}) {
  const t = LOSS_TEXT
  const story = useLossStory(collision, true)
  // 1 日の上限・旅ごとの上限だけはボタンを出さない（押してもまた失敗する）。1 分の上限（RATE_LIMITED）は待てば通るので「もう一度」
  const limited =
    story.error instanceof LossStoryError &&
    (story.error.code === 'DAILY_LIMIT' || story.error.code === 'LOSS_LIMIT')
  return (
    <section
      className={dropClass('loss-story', drop)}
      style={drop}
      aria-labelledby="loss-story-heading"
    >
      <h2 id="loss-story-heading" className="loss-story__heading">
        {t.storyHeading[lang]}
      </h2>
      <div aria-live="polite">
        {story.isSuccess ? (
          <p className="loss-story__text">{story.data.story[lang]}</p>
        ) : story.isError && !story.isFetching ? (
          limited ? (
            <p>{t.storyLimit[lang]}</p>
          ) : (
            <div className="loss-story__failed">
              <p>{t.storyFailed[lang]}</p>
              <button
                type="button"
                className="loss-button loss-button--secondary"
                onClick={() => void story.refetch()}
              >
                {t.retry[lang]}
              </button>
            </div>
          )
        ) : (
          <p>{t.storyLoading[lang]}</p>
        )}
      </div>
    </section>
  )
}
