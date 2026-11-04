import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import { link, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  CaptureRepository,
  CaptureStats,
  CreateCaptureResult,
  ExistingCapture,
  NewStoredCapture,
} from '../../application/ports/repositories/capture.repository.js'
import { imageFileName } from '../../domain/captures/policies/capture-identity-policy.js'
import { CAPTURE_KEY_PATTERN } from '../../domain/captures/rules/capture-rules.js'

// CaptureRepository のファイル実装（docs/specs/edge-capture/functional.md A4・A6、resilience.md）。
// SQLite の表は足さない（口は同じなので、あとで DB に替えられる）。
// 置き場所: {dir}/{key}.json（{capture, file, bodyHash, receivedAt}。JSON が完成のしるし）
//          {dir}/{key}-{画像の sha256 先頭12桁}.{jpg|png}（実ファイル）
// 書き方: 一時ファイルに書いて fsync し、fs.link（ハードリンク。存在すれば EEXIST で失敗 = 上書きしない）で名前を付ける。
//   画像（EEXIST は同じ名前 = 同じ内容として無視）→ JSON（EEXIST なら負け）の順。負けた側は既存の JSON を読んで比べる。
// 件数とバイト数は起動時に 1 回数え、保存のたびに増やすメモリの数（数件の超過は許す）。ディレクトリ 0700・ファイル 0600。

const TMP_PREFIX = '.tmp-'
const JSON_NAME = /^cap_[a-z0-9]+\.json$/
const IMAGE_NAME = /^cap_[a-z0-9]+-[0-9a-f]{12}\.(?:jpg|png)$/

const ignore = (): undefined => undefined

function hasCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code
}

function assertKey(key: string): void {
  // ファイル名に使う前に必ず通す（.. や / を通さない）
  if (!CAPTURE_KEY_PATTERN.test(key)) throw new Error('invalid capture key')
}

/** 一時ファイルに書いて fsync する。名前は付けない */
async function writeTemp(dir: string, data: Uint8Array | string): Promise<string> {
  const path = join(dir, `${TMP_PREFIX}${randomUUID()}`)
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(data)
    await handle.sync()
  } catch (error) {
    await handle.close().catch(ignore)
    await unlink(path).catch(ignore)
    throw error
  }
  await handle.close()
  return path
}

/** ハードリンクで名前を付ける。既にあれば false（上書きしない） */
async function linkNew(tmp: string, dest: string): Promise<boolean> {
  try {
    await link(tmp, dest)
    return true
  } catch (error) {
    if (hasCode(error, 'EEXIST')) return false
    throw error
  }
}

type StoredFile = { file: string | null; bodyHash: string | null }

/** 記録を読む。無い = null、読めない・形が違う = 中身が null */
async function readStored(path: string): Promise<StoredFile | null> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return null
    return { file: null, bodyHash: null }
  }
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return { file: null, bodyHash: null }
    const record = parsed as Record<string, unknown>
    const file = typeof record['file'] === 'string' ? record['file'] : null
    const bodyHash = typeof record['bodyHash'] === 'string' ? record['bodyHash'] : null
    return file !== null && bodyHash !== null ? { file, bodyHash } : { file: null, bodyHash: null }
  } catch {
    return { file: null, bodyHash: null }
  }
}

export class FileCaptureRepository implements CaptureRepository {
  private count = 0
  private bytes = 0

  /** ディレクトリを 0700 で作り（起動時）、孤児の一時ファイルを消して、件数と画像の合計を数える */
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const name of readdirSync(dir)) {
      if (name.startsWith(TMP_PREFIX)) {
        rmSync(join(dir, name), { force: true })
      } else if (JSON_NAME.test(name)) {
        this.count += 1
      } else if (IMAGE_NAME.test(name)) {
        this.bytes += statSync(join(dir, name)).size
      }
    }
  }

  async create(item: NewStoredCapture): Promise<CreateCaptureResult> {
    assertKey(item.key)
    const fileName = imageFileName(item.key, item.image.sha256, item.image.format)
    const imagePath = join(this.dir, fileName)
    const jsonPath = join(this.dir, `${item.key}.json`)
    const temps: string[] = []
    let createdImage = false
    try {
      const imageTemp = await writeTemp(this.dir, item.image.bytes)
      temps.push(imageTemp)
      createdImage = await linkNew(imageTemp, imagePath)

      const record = JSON.stringify({
        capture: item.capture,
        file: fileName,
        bodyHash: item.bodyHash,
        receivedAt: item.receivedAt,
      })
      const jsonTemp = await writeTemp(this.dir, record)
      temps.push(jsonTemp)
      if (await linkNew(jsonTemp, jsonPath)) {
        // 数えるのは JSON を取った側（同じ画像を作ったのが別の要求でも、1 組につき 1 回）
        this.count += 1
        this.bytes += item.image.bytes.byteLength
        return { status: 'created' }
      }

      // 先に取られた。既存を読んで、自分の画像が使われていなければ消す
      const existing = await readStored(jsonPath)
      if (createdImage && existing?.file !== fileName) await unlink(imagePath).catch(ignore)
      return { status: 'exists', existingBodyHash: existing?.bodyHash ?? null }
    } finally {
      // 書けなかったときも、画像だけは消さない（resilience.md: 画像だけ残ったものは JSON が無いので完成品ではなく、
      // 同じ中身の再送が EEXIST を無視して JSON を作り直す。同じ画像を共有する並行要求の JSON から画像を奪わない）
      await Promise.all(temps.map((t) => unlink(t).catch(ignore)))
    }
  }

  async find(key: string): Promise<ExistingCapture | null> {
    assertKey(key)
    const stored = await readStored(join(this.dir, `${key}.json`))
    return stored ? { bodyHash: stored.bodyHash } : null
  }

  stats(): Promise<CaptureStats> {
    return Promise.resolve({ count: this.count, bytes: this.bytes })
  }
}
