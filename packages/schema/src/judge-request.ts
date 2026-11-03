import { z } from 'zod'
import { Light, Side } from './common'

// JudgeRequest — L0 が決定的に計算した状態を、L1（Mac mini 上の jev 互換サーバー local-jev、`POST /v1/systemone`）へ
// 文字で渡す入力。2〜3 Hz。画像は入れない（state は strict で、画像・位置・識別子を足せない）。
// 形と英文の質問は要件定義書 原本 第 7 章の例と同一。仕様: docs/specs/schema-judge/、変更指示 §3.3。
// 数値判断（距離・TTC）は L0 がコードで出す。L1 には意味の判断だけを問う（B2-6）。

/** 追跡中の 1 点。t は現在を 0 とする秒（過去は負）。 */
const TrackPoint = z
  .strictObject({
    t: z.number().max(0),
    conf: z.number().min(0).max(1),
    distanceM: z.number().min(0),
    /** 横方向の速度（符号つき。向きの定義は edge-l0 が決める） */
    lateralMps: z.number(),
    side: Side,
    /** 位置の語（例 shoulder）。原本に一覧が無いので列挙にしない。32 字まで */
    pos: z.string().regex(/^[a-z][a-z_]{0,31}$/),
  })
  .meta({ title: 'TrackPoint' })

const State = z
  .strictObject({
    speedKmh: z.number().min(0),
    zone: z.enum(['inside', 'outside']),
    light: Light,
    headlight: z.enum(['off', 'low', 'high']),
    /** 古い順（t の昇順）に並べて渡す。受け側は順序を前提にしない */
    track: z.array(TrackPoint).min(1).max(64),
    /** L0 が計算した衝突までの秒。衝突コースにないとき null（JSON に無限大は書けない） */
    ttcSec: z.number().min(0).nullable(),
    recentAlerts30s: z.number().int().min(0),
  })
  .meta({ title: 'JudgeState' })

/**
 * 4 問・この順・この文言に固定する（質問文を変えると L1 の校正が無効になる）。
 * 変えるときは仕様・見本・生成物・校正データをまとめて直す PR にする。
 */
const Questions = z.tuple([
  z
    .strictObject({
      id: z.literal('alert_level'),
      type: z.literal('choice'),
      text: z.literal('Which alert should the driver get now?'),
      options: z.tuple([z.literal('none'), z.literal('zone'), z.literal('danger')]),
    })
    .meta({ title: 'AlertLevelQuestion' }),
  z
    .strictObject({
      id: z.literal('on_roadway'),
      type: z.literal('noul'),
      text: z.literal('The animal is moving into the driving lane.'),
    })
    .meta({ title: 'OnRoadwayQuestion' }),
  z
    .strictObject({
      id: z.literal('static_shoulder'),
      type: z.literal('noul'),
      text: z.literal('The animal is standing still on the road shoulder.'),
    })
    .meta({ title: 'StaticShoulderQuestion' }),
  z
    .strictObject({
      id: z.literal('false_positive'),
      type: z.literal('noul'),
      text: z.literal('The detection is not a real deer (sign, snow, post).'),
    })
    .meta({ title: 'FalsePositiveQuestion' }),
])

export const JudgeRequestSchema = z
  .strictObject({
    /**
     * local-jev に割り当てたモデル名（config.yaml の l1.model。既定は jev-latest）。
     * 字数の数え方が JS と Python で違わないよう ASCII に限る。空白・改行は入れられない。
     */
    model: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/),
    state: State,
    questions: Questions,
  })
  .meta({ title: 'JudgeRequest' })
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>

/** 固定の 4 問。edge-l1 の questions.py はこれと同じ内容を import し、文言を書き直さない。 */
export const JUDGE_QUESTIONS: JudgeRequest['questions'] = [
  {
    id: 'alert_level',
    type: 'choice',
    text: 'Which alert should the driver get now?',
    options: ['none', 'zone', 'danger'],
  },
  {
    id: 'on_roadway',
    type: 'noul',
    text: 'The animal is moving into the driving lane.',
  },
  {
    id: 'static_shoulder',
    type: 'noul',
    text: 'The animal is standing still on the road shoulder.',
  },
  {
    id: 'false_positive',
    type: 'noul',
    text: 'The detection is not a real deer (sign, snow, post).',
  },
]
