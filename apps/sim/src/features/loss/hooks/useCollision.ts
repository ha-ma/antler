import { useParams, useSearchParams } from 'react-router'
import type { CollisionReport } from '../types'
import { parseCollision } from '../utils/collision-url'

// URL の状態（functional.md R1）: `/loss/:id?…` の衝突の情報。読めなければ null。

export function useCollision(): CollisionReport | null {
  const { id = '' } = useParams()
  const [search] = useSearchParams()
  return parseCollision(id, search)
}
