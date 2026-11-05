import { z } from 'zod'
import { IsoDateTime, Light } from './common'

// クライアント（B の PWA）→ サーバー（Mac Mini）のメッセージ。ack と label だけ（ch7「B WebSocket」）。
// クライアントは AlertFlag を送れない（threat.md の認可マトリクス）。

export const AckMessageSchema = z.strictObject({
  type: z.literal('ack'),
  /** スマホが赤などを表示した時刻（ch6「B 遅延」の t_shown） */
  t_shown: IsoDateTime,
})

export const LabelMessageSchema = z.strictObject({
  type: z.literal('label'),
  /** ドライバー（同乗者）の「いた」「いない」（B2-6、MAY） */
  value: z.enum(['present', 'absent']),
})

/**
 * 車の状態（pwa-uplink、2026-11-04 に追加。ack と label は変えない）。PWA が GPS から作った派生値だけを edge の L1 に返す。
 * - 3 項目はすべて任意。無い項目は「分からない」で、edge が固定値で埋める（`zone: 'unknown'` や null は作らない）
 * - 各メッセージは全部を置き換える（前のメッセージの項目を引き継がない）
 * - 位置（緯度経度）・精度・時刻・端末の識別子の席は無い（strict）。新しさは edge が受け取った時刻で測る
 * 仕様: docs/specs/pwa-uplink/、docs/changes/2026-11-04-pwa-uplink.md
 */
export const VehicleMessageSchema = z
  .strictObject({
    type: z.literal('vehicle'),
    /** 速さ（km/h）。PWA は測位が 5 秒以内で速さが取れたときだけ入れる */
    speedKmh: z.number().min(0).max(300).optional(),
    /** 鹿ゾーンの内外（judgeZone）。分からなければ入れない */
    zone: z.enum(['inside', 'outside']).optional(),
    /** 光の区分。位置から PWA が決める（edge は位置を持たない） */
    light: Light.optional(),
  })
  .meta({ title: 'VehicleMessage' })

export const ClientMessageSchema = z.discriminatedUnion('type', [
  AckMessageSchema,
  LabelMessageSchema,
  VehicleMessageSchema,
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type VehicleMessage = z.infer<typeof VehicleMessageSchema>
