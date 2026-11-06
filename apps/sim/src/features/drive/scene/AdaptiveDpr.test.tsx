import ReactThreeTestRenderer from '@react-three/test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AdaptiveDpr } from './AdaptiveDpr'

// performance R4: 遅い状態が続いたら DPR を 1 段ずつ下げる（値は Canvas の prop にする側へ渡す）

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
  vi.unstubAllGlobals()
})

describe('AdaptiveDpr（performance R4）', () => {
  it('UC-4f: 20 fps が 4 秒続くと 1.25、さらに 4 秒で 1 を渡す。60 fps では渡さない', async () => {
    vi.stubGlobal('devicePixelRatio', 2)
    const onDpr = vi.fn()
    const renderer = await ReactThreeTestRenderer.create(<AdaptiveDpr onDpr={onDpr} />)
    await run(renderer, 600, 1 / 60)
    expect(onDpr).not.toHaveBeenCalled()
    await run(renderer, 80, 1 / 20)
    expect(onDpr).toHaveBeenLastCalledWith(1.25)
    await run(renderer, 80, 1 / 20)
    expect(onDpr).toHaveBeenLastCalledWith(1)
    // いちばん下からは下げない
    await run(renderer, 200, 1 / 20)
    expect(onDpr).toHaveBeenCalledTimes(2)
    await renderer.unmount()
  })
})
