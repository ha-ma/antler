import {
  checkLocalized,
  type TripWritingProblem,
} from '../../trips/policies/trip-writing-policy.js'
import type { LossStory } from '../models/loss.js'
import { STORY_MAX_LENGTH } from '../rules/loss-rules.js'

// 喪失文の検証（docs/specs/loss/functional.md R5、UC-5b）。plan-trip の validateTripWriting と同じ規則:
// 4 言語がそろい空でない・400 字以下・絵文字なし・3 桁以上の数／%／件／円を含まない（統計を書かせない）・言語ごとの文字種。
// 外れた理由をコードで返す（本文はログに出さない）。usecase はどれに外れても 1 回だけ作り直す。

export function validateLossStory(output: LossStory): TripWritingProblem[] {
  return checkLocalized(output.story, 'story', STORY_MAX_LENGTH)
}
