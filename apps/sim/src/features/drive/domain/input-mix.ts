import { NO_INPUT, type DriveInput } from '../types'

// キーと指の入力を合わせる（docs/specs/mobile-landscape/functional.md R3）。
// それぞれの入力元は自分の押下だけを渡す。エンジンには、どれかが押していれば押している（OR）を渡す。
// 指を離しても、キーで押しているものは離さない（逆も同じ）。

export type InputTarget = { setInput: (input: DriveInput) => void }

export type InputSourceName = 'keys' | 'touch'

const INPUT_KEYS = Object.keys(NO_INPUT) as (keyof DriveInput)[]

export class InputMixer {
  private readonly sources = new Map<InputSourceName, DriveInput>()

  constructor(private readonly target: InputTarget) {}

  /** 1 つの入力元の窓口（useKeyboardDrive などはエンジンの代わりにこれを受け取る） */
  source(name: InputSourceName): InputTarget {
    return {
      setInput: (input) => {
        this.sources.set(name, { ...input })
        this.target.setInput(this.merged())
      },
    }
  }

  private merged(): DriveInput {
    const out: DriveInput = { ...NO_INPUT }
    for (const input of this.sources.values()) {
      for (const key of INPUT_KEYS) out[key] = out[key] || input[key]
    }
    return out
  }
}
