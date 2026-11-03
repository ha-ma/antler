// drive（A-3 運転中 3D・A-5 鹿ゾーン内・検知アラート）。仕様: docs/specs/drive-3d/functional.md
// App からは遅延読込で使う（three・R3F を初回読込に入れない。R12）。
export { DrivePage } from './components/DrivePage'
export { DriveEngine, type DriveSnapshot } from './domain/engine'
export { demoScenario, DEMO_TRIP } from './domain/scenario'
export type { DriveScenario, Encounter } from './types'
