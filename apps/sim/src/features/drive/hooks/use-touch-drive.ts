import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { InputTarget } from '../domain/input-mix'
import { stickInput, stickOffset } from '../domain/touch-stick'
import { NO_INPUT } from '../types'

// 左右の円の指の入力（docs/specs/mobile-landscape/functional.md R3、A3-3）。
// 1 つの円は最初に触れた指だけを使い、ポインタを捕まえる。離す契機（up・cancel・捕まえが外れる・
// window の blur・タブが隠れる・円が消える）では、その円の入力を全部離す。
// 入力は合わせる口（InputMixer の 'touch'）に渡す。キーの押下には触れない。
// State 設計: つまみの位置とブレーキの押下（描画用、useState 2 つ）。押している指の id は ref（描画に使わない）。

type Offset = { x: number; y: number }

const CENTER: Offset = { x: 0, y: 0 }

type PadHandlers = {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  onLostPointerCapture: (e: ReactPointerEvent<HTMLElement>) => void
}

export type TouchDrive = {
  stick: Offset
  brake: boolean
  stickHandlers: PadHandlers
  brakeHandlers: PadHandlers
}

function capture(e: ReactPointerEvent<HTMLElement>): void {
  // jsdom には setPointerCapture が無いことがある
  try {
    e.currentTarget.setPointerCapture?.(e.pointerId)
  } catch {
    // 捕まえられなくても、離す契機は blur・cancel で拾う
  }
}

export function useTouchDrive(target: InputTarget): TouchDrive {
  const [stick, setStick] = useState<Offset>(CENTER)
  const [brake, setBrake] = useState(false)
  const current = useRef({ stick: CENTER, brake: false })
  const fingers = useRef<{ stick: number | null; brake: number | null }>({
    stick: null,
    brake: null,
  })
  const center = useRef({ x: 0, y: 0, radius: 0 })

  const send = (next: { stick: Offset; brake: boolean }) => {
    current.current = next
    setStick(next.stick)
    setBrake(next.brake)
    target.setInput({ ...NO_INPUT, ...stickInput(next.stick.x, next.stick.y), brake: next.brake })
  }

  const releaseStick = (e: ReactPointerEvent<HTMLElement>) => {
    if (fingers.current.stick !== e.pointerId) return
    fingers.current.stick = null
    send({ ...current.current, stick: CENTER })
  }
  const releaseBrake = (e: ReactPointerEvent<HTMLElement>) => {
    if (fingers.current.brake !== e.pointerId) return
    fingers.current.brake = null
    send({ ...current.current, brake: false })
  }

  const moveStick = (e: ReactPointerEvent<HTMLElement>) => {
    if (fingers.current.stick !== e.pointerId) return
    const c = center.current
    send({ ...current.current, stick: stickOffset(e.clientX, e.clientY, c.x, c.y, c.radius) })
  }

  const stickHandlers: PadHandlers = {
    onPointerDown: (e) => {
      if (fingers.current.stick !== null) return
      e.preventDefault()
      fingers.current.stick = e.pointerId
      capture(e)
      const box = e.currentTarget.getBoundingClientRect()
      center.current = {
        x: box.left + box.width / 2,
        y: box.top + box.height / 2,
        radius: box.width / 2,
      }
      moveStick(e)
    },
    onPointerMove: moveStick,
    onPointerUp: releaseStick,
    onPointerCancel: releaseStick,
    onLostPointerCapture: releaseStick,
  }

  const brakeHandlers: PadHandlers = {
    onPointerDown: (e) => {
      if (fingers.current.brake !== null) return
      e.preventDefault()
      fingers.current.brake = e.pointerId
      capture(e)
      send({ ...current.current, brake: true })
    },
    onPointerMove: () => undefined,
    onPointerUp: releaseBrake,
    onPointerCancel: releaseBrake,
    onLostPointerCapture: releaseBrake,
  }

  // window の blur・タブが隠れる・円が消える（アンマウント）で指の入力を全部離す（外部イベントの購読）
  // eslint-disable-next-line no-restricted-syntax -- window の blur と document の visibilitychange の購読
  useEffect(() => {
    const releaseAll = () => {
      fingers.current = { stick: null, brake: null }
      current.current = { stick: CENTER, brake: false }
      setStick(CENTER)
      setBrake(false)
      target.setInput({ ...NO_INPUT })
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') releaseAll()
    }
    window.addEventListener('blur', releaseAll)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('blur', releaseAll)
      document.removeEventListener('visibilitychange', onVisibility)
      fingers.current = { stick: null, brake: null }
      target.setInput({ ...NO_INPUT })
    }
  }, [target])

  return { stick, brake, stickHandlers, brakeHandlers }
}
