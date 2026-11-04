// loss（A-6 喪失）の公開 API。drive（drive-link）は lossHref(report) で /loss/:tripId?… に移る。
// 契約: docs/specs/loss/functional.md R1（変えたら drive-link 向けのメモ loss-handover.md も直す）。
export { LossPage } from './components/LossPage'
export { lossHref } from './utils/collision-url'
export type { CollisionReport } from './types'
