import { z } from 'zod'
import { IsoDateTime } from './common'

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

export const ClientMessageSchema = z.discriminatedUnion('type', [
  AckMessageSchema,
  LabelMessageSchema,
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>
