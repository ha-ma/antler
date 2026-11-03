import { z } from 'zod'
import { IsoDateTime, Side } from './common'

// Capture — A の「見つけた」と B の検知フレームが共有する教師データ（ch7）。
// 保存しないもの（ch5）: 氏名・メール・端末識別子・精密な位置。strict なので余分なキーは拒否する。
// 位置は道路区間 ID（roadSegment）に丸める。英数字とハイフンだけなので座標（小数点・カンマ）を書けない。

const Vocab = z.string().regex(/^[a-z][a-z_]*$/)

export const CaptureSchema = z.strictObject({
  id: z.string().regex(/^cap_[A-Za-z0-9]+$/),
  source: z.enum(['sim', 'vehicle']),
  /** 画像ファイルの相対パス（中身の検証は保存側の feature） */
  image: z.string().regex(/^[A-Za-z0-9_/-]+\.(?:jpg|jpeg|png)$/),
  imageSize: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  /** 囲み（A は利用者、B はモデル）。見逃し（missed）では 0 件もある */
  boxes: z.array(
    z.strictObject({
      label: z.literal('deer'),
      /** 画像に対する割合（0〜1）の x, y, 幅, 高さ */
      xywh: z.tuple([
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
        z.number().min(0).max(1),
      ]),
      by: z.enum(['user', 'model']),
    }),
  ),
  conditions: z.strictObject({
    season: z.enum(['spring', 'summer', 'autumn', 'winter']),
    month: z.number().int().min(1).max(12),
    weather: Vocab,
    surface: Vocab,
    light: z.enum(['dawn', 'day', 'dusk', 'night']),
    fog: z.enum(['none', 'light', 'medium', 'heavy']),
    traffic: Vocab,
    vehicle: Vocab,
  }),
  distanceM: z.number().min(0).nullable(),
  side: Side.nullable(),
  pose: Vocab,
  reactionMs: z.number().int().min(0).nullable(),
  outcome: z.enum(['avoided', 'collided', 'missed']),
  roadSegment: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/),
  /** 「提供する（匿名）」の同意。false でも保存はできる（ch5）。アップロードは isUploadable が判定する */
  consent: z.boolean(),
  createdAt: IsoDateTime,
})
export type Capture = z.infer<typeof CaptureSchema>

/** アップロードに回してよいか。形が正しく、同意があるものだけ（ch5・threat.md AUTH-6）。 */
export function isUploadable(capture: unknown): boolean {
  const parsed = CaptureSchema.safeParse(capture)
  return parsed.success && parsed.data.consent
}
