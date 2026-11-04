// edge-capture（POST /api/captures）のテスト用のビルダー（docs/specs/edge-capture/functional.md の Test List）。
// 画像はすべて合成した最小のバイト列（実写は入れない）。本番の DI では使わない。

import { crc32 } from 'node:zlib'
import type { Capture } from '@antler/schema'
import type {
  CaptureRepository,
  CaptureStats,
  CreateCaptureResult,
  ExistingCapture,
  NewStoredCapture,
} from '../../src/application/ports/repositories/capture.repository.js'

export const SIZE_320x240: [number, number] = [320, 240]

/** 検証を通る Capture（vehicle）。image はクライアントが送る値（サーバーは使わない） */
export function buildCapture(overrides: Partial<Capture> = {}): Capture {
  return {
    id: 'cap_0a1b2c3d4e5f',
    source: 'vehicle',
    image: 'captures/cap_0a1b2c3d4e5f.jpg',
    imageSize: SIZE_320x240,
    boxes: [{ label: 'deer', xywh: [0.4, 0.3, 0.2, 0.4], by: 'model' }],
    conditions: {
      season: 'winter',
      month: 2,
      weather: 'unknown',
      surface: 'unknown',
      light: 'dusk',
      fog: 'none',
      traffic: 'unknown',
      vehicle: 'unknown',
    },
    distanceM: 42,
    side: 'R',
    pose: 'unknown',
    reactionMs: null,
    outcome: 'avoided',
    roadSegment: 'unknown',
    consent: true,
    createdAt: '2026-02-14T16:30:00.000+09:00',
    ...overrides,
  }
}

function u16(n: number): number[] {
  return [(n >> 8) & 0xff, n & 0xff]
}

function u32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}

function ascii(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

export type JpegOptions = {
  width?: number
  height?: number
  /** APP0 の形。jfif = 正規（サムネイル 0×0）、none = 無し */
  app0?: 'jfif' | 'none' | 'jfxx' | 'jfif-thumbnail' | 'jfif-twice'
  /** APP1（Exif）を足す */
  exif?: boolean
  /** APP1（XMP）を足す */
  xmp?: boolean
  /** APP2（ICC）を足す */
  icc?: boolean
  /** COM（コメント）を足す */
  comment?: boolean
  /** EOI の後ろに付ける余り */
  trailing?: number[]
  /** EOI を付けない */
  omitEoi?: boolean
  /** SOF を付けない */
  omitSof?: boolean
  /** SOS 以降を付けない（途中で切れた画像） */
  omitScan?: boolean
  /** SOS のあとの画素に RST と FF00 を混ぜる */
  scanWithMarkers?: boolean
}

function segment(marker: number, payload: number[]): number[] {
  return [0xff, marker, ...u16(payload.length + 2), ...payload]
}

/** 最小の JPEG（SOI, APP0(JFIF), DQT, SOF0, DHT, SOS, 画素, EOI）。デコードはできないが構造は正しい */
export function buildJpeg(options: JpegOptions = {}): Uint8Array {
  const { width = 320, height = 240, app0 = 'jfif' } = options
  const out: number[] = [0xff, 0xd8]
  if (app0 === 'jfif' || app0 === 'jfif-twice') {
    out.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
  }
  if (app0 === 'jfif-twice') {
    out.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]))
  }
  if (app0 === 'jfxx') {
    out.push(...segment(0xe0, [...ascii('JFXX'), 0, 0x10, 0xff, 0xd8, 0xff, 0xd9]))
  }
  if (app0 === 'jfif-thumbnail') {
    // サムネイル 1×1（RGB 3 バイト）
    out.push(...segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 1, 1, 9, 9, 9]))
  }
  if (options.exif) {
    out.push(...segment(0xe1, [...ascii('Exif'), 0, 0, ...ascii('MM'), 0, 42, 0, 0, 0, 8]))
  }
  if (options.xmp) {
    out.push(...segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>')))
  }
  if (options.icc) {
    out.push(...segment(0xe2, [...ascii('ICC_PROFILE'), 0, 1, 1, 0]))
  }
  if (options.comment) {
    out.push(...segment(0xfe, ascii('taken at 43.1,144.3')))
  }
  out.push(...segment(0xdb, [0, ...Array<number>(64).fill(16)]))
  if (!options.omitSof) {
    out.push(...segment(0xc0, [8, ...u16(height), ...u16(width), 1, 1, 0x11, 0]))
  }
  out.push(...segment(0xc4, [0x00, 1, ...Array<number>(15).fill(0), 0]))
  if (options.omitScan) return Uint8Array.from(out)
  out.push(...segment(0xda, [1, 1, 0, 0, 63, 0]))
  // 画素（エントロピー符号化データ）。FF のあとに 00 を置くスタッフィングと RST も入れられる
  out.push(0x12, 0x34, 0x56)
  if (options.scanWithMarkers) out.push(0xff, 0x00, 0x78, 0xff, 0xd0, 0x9a, 0xff, 0xff, 0xd1, 0xbc)
  if (!options.omitEoi) out.push(0xff, 0xd9)
  if (options.trailing) out.push(...options.trailing)
  return Uint8Array.from(out)
}

export type PngOptions = {
  width?: number
  height?: number
  /** IHDR と IDAT の間に挟むチャンクの型（中身は短いダミー） */
  chunks?: string[]
  /** IEND の後ろに付ける余り */
  trailing?: number[]
  omitIend?: boolean
  omitIhdr?: boolean
  omitIdat?: boolean
  /** 最後のチャンクの長さを本文より大きくする */
  overlongChunk?: boolean
}

function pngChunk(type: string, data: number[], length = data.length): number[] {
  const typeBytes = ascii(type)
  const crc = crc32(Uint8Array.from([...typeBytes, ...data]))
  return [...u32(length), ...typeBytes, ...data, ...u32(crc)]
}

/** 最小の PNG（署名, IHDR, IDAT, IEND）。CRC は付けるが、検証側は見ない */
export function buildPng(options: PngOptions = {}): Uint8Array {
  const { width = 320, height = 240 } = options
  const out: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  if (!options.omitIhdr) {
    out.push(...pngChunk('IHDR', [...u32(width), ...u32(height), 8, 2, 0, 0, 0]))
  }
  for (const type of options.chunks ?? []) {
    out.push(...pngChunk(type, [1, 2, 3, 4]))
  }
  if (!options.omitIdat) out.push(...pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x02]))
  if (options.overlongChunk) out.push(...pngChunk('IDAT', [1, 2, 3], 4096))
  if (!options.omitIend) out.push(...pngChunk('IEND', []))
  if (options.trailing) out.push(...options.trailing)
  return Uint8Array.from(out)
}

export type FormOptions = {
  /** Capture のオブジェクト（JSON にする）か、そのままの文字列 */
  capture?: Capture | Record<string, unknown> | string | File | null
  image?: Uint8Array | string | null
  imageName?: string
  imageType?: string
  /** 同じ名前の欄を 2 つ目として足す */
  duplicate?: 'capture' | 'image'
  extra?: Record<string, string>
}

/** multipart/form-data（欄名は capture・image）。null は欄を付けない */
export function buildForm(options: FormOptions = {}): FormData {
  const form = new FormData()
  const capture = options.capture === undefined ? buildCapture() : options.capture
  const image = options.image === undefined ? buildJpeg() : options.image
  const appendCapture = () => {
    if (capture === null) return
    if (capture instanceof File) form.append('capture', capture)
    else form.append('capture', typeof capture === 'string' ? capture : JSON.stringify(capture))
  }
  const appendImage = () => {
    if (image === null) return
    if (typeof image === 'string') form.append('image', image)
    else
      form.append(
        'image',
        new Blob([Uint8Array.from(image)], { type: options.imageType ?? 'image/jpeg' }),
        options.imageName ?? 'frame.jpg',
      )
  }
  appendCapture()
  appendImage()
  if (options.duplicate === 'capture') appendCapture()
  if (options.duplicate === 'image') appendImage()
  for (const [k, v] of Object.entries(options.extra ?? {})) form.append(k, v)
  return form
}

/** メモリだけの CaptureRepository（UseCase のテスト用）。first-wins の作成と、数え方は本物と同じ */
export class MemoryCaptureRepository implements CaptureRepository {
  readonly items = new Map<string, NewStoredCapture>()
  /** 書き込みの失敗を起こしたいときに差し込む */
  failNextCreate: Error | null = null
  private bytes = 0

  create(capture: NewStoredCapture): Promise<CreateCaptureResult> {
    if (this.failNextCreate) {
      const error = this.failNextCreate
      this.failNextCreate = null
      return Promise.reject(error)
    }
    const existing = this.items.get(capture.key)
    if (existing) return Promise.resolve({ status: 'exists', existingBodyHash: existing.bodyHash })
    this.items.set(capture.key, capture)
    this.bytes += capture.image.bytes.byteLength
    return Promise.resolve({ status: 'created' })
  }

  find(key: string): Promise<ExistingCapture | null> {
    const existing = this.items.get(key)
    return Promise.resolve(existing ? { bodyHash: existing.bodyHash } : null)
  }

  stats(): Promise<CaptureStats> {
    return Promise.resolve({ count: this.items.size, bytes: this.bytes })
  }
}
