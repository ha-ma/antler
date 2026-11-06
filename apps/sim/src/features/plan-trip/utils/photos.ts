import { z } from 'zod'
import photosJson from '../data/photos.json'
import { isAllowedLicense } from '@/shared/utils/photo-rules'

// 楽しみの写真の記録（docs/specs/plan-trip-photos/functional.md R6）。scripts/fetch-photos.ts が書き、
// 画面は読み込み時に検証する（形が違う・使えないライセンスなら例外）。画像は public/photos/ に同梱する。

const https = (host: string) =>
  z.url({ protocol: /^https$/, hostname: new RegExp(`^${host.replace(/\./g, '\\.')}$`) })

const PhotoSchema = z
  .strictObject({
    /** 楽しみの id */
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    /** public/ からの相対パス（名前は楽しみの id から作る） */
    file: z.string().regex(/^photos\/[a-z0-9-]+\.(?:jpg|png)$/),
    /** Commons のファイル名（作品名） */
    title: z.string().min(1).max(300),
    /** 撮影者（平文） */
    author: z.string().min(1).max(200),
    /** ライセンスの表示名（例 CC BY 4.0） */
    license: z.string().min(1).max(60),
    /** Commons の extmetadata の License（例 cc-by-4.0） */
    licenseCode: z.string().min(1).max(40),
    /** ライセンス本文の URL（パブリックドメインは無い） */
    licenseUrl: z.url({ protocol: /^https$/ }).nullable(),
    /** 出典（Commons のファイルのページ） */
    sourceUrl: https('commons.wikimedia.org'),
    retrievedAt: z.iso.date(),
    /** 原本の SHA-1（Commons の値。出所の識別子） */
    originalSha1: z.string().regex(/^[0-9a-f]{40}$/),
    /** 保存したファイルの SHA-256（改ざんの確認はこちら） */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    width: z.number().int().positive().max(800),
    height: z.number().int().positive().max(1600),
    /** 改変の内容（CC BY の表示に使う） */
    modification: z.string().min(1),
    /** 写っているもの（顔・商標・鹿）の確認。機械では確かめられないので、確認したことを記録する */
    review: z.string().min(1),
  })
  .refine((p) => isAllowedLicense({ code: p.licenseCode, name: p.license }), {
    message: '使えないライセンス（CC0・パブリックドメイン・CC BY だけ）',
  })
  .refine((p) => p.file.startsWith(`photos/${p.id}.`), { message: '名前は楽しみの id から作る' })

export type PleasurePhoto = z.infer<typeof PhotoSchema>

export const PHOTOS: readonly PleasurePhoto[] = z
  .array(PhotoSchema)
  .refine((list) => new Set(list.map((p) => p.id)).size === list.length, {
    message: '同じ楽しみの写真が 2 つある',
  })
  .parse(photosJson)

const BY_ID = new Map(PHOTOS.map((p) => [p.id, p]))

/** 楽しみの写真の記録。無ければ null（photo-placeholder のまま）。 */
export function photoOf(pleasureId: string): PleasurePhoto | null {
  return BY_ID.get(pleasureId) ?? null
}

/** 画像の URL（Vite の base を前に付ける）。 */
export function photoSrc(photo: PleasurePhoto): string {
  return `${import.meta.env.BASE_URL}${photo.file}`
}
