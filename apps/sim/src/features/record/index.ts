// record（A-7 旅の記録）の公開 API。仕様: docs/specs/record/functional.md
// drive・loss は運転の終わりに useSaveRun で走行を残し、status が saved / replayed なら recordHref(id) へ移る
// （not-owner なら移らず、その運転の結果をその場で見せる。R11）。
export { RecordPage } from './components/RecordPage'
export { saveRun, useSaveRun, type SaveRunVariables } from './hooks/useSaveRun'
export { recordHref } from './utils/links'
export type { SaveRunOutcome } from './types'
