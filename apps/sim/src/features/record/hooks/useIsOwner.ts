import { useState } from 'react'
import { ownerTokenOf } from '@/features/plan-trip'

// この端末にその旅の所有者トークンがあるか（docs/specs/record/functional.md R9・R10）。
// 画面を開いたときに 1 回だけ localStorage を読む（描画のたびに読まない）。

export function useIsOwner(tripId: string): boolean {
  const [isOwner] = useState(() => ownerTokenOf(tripId) !== null)
  return isOwner
}
