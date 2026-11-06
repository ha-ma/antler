import { useThree } from '@react-three/fiber'
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveDpr } from './AdaptiveDpr'

// performance R4: 遅い状態が続いたら Canvas の DPR を 1 段ずつ下げる

const seen: number[] = []
function DprProbe() {
  const dpr = useThree((s) => s.viewport.dpr)
  seen.push(dpr)
  return null
}

async function run(
  renderer: Awaited<ReturnType<typeof ReactThreeTestRenderer.create>>,
  frames: number,
  delta: number,
) {
  await ReactThreeTestRenderer.act(async () => {
    await renderer.advanceFrames(frames, delta)
  })
}

afterEach(() => {
  seen.length = 0
  vi.unstubAllGlobals()
})

describe('AdaptiveDpr（performance R4）', () => {
  it('UC-4f: 20 fps が 4 秒続くと 1.25、さらに 4 秒で 1。60 fps では変えない', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const renderer = await ReactThreeTestRenderer.create(
      <>
        <AdaptiveDpr />
        <DprProbe />
      </>,
    )
    const last = () => seen[seen.length - 1]
    const initial = last()
    await run(renderer, 600, 1 / 60)
    expect(last()).toBe(initial)
    await run(renderer, 80, 1 / 20)
    expect(last()).toBe(1.25)
    await run(renderer, 80, 1 / 20)
    expect(last()).toBe(1)
    await renderer.unmount()
  })
})
