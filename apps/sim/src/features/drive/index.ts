// drive（A-3 運転中 3D・A-5 鹿ゾーン内・検知アラート、A-2 からの受け渡し）。
// 仕様: docs/specs/drive-3d/functional.md、docs/specs/drive-link/functional.md
// App からは遅延読込で使う（three・R3F を初回読込に入れない。R12）。
export { DriveScreen } from './components/DriveScreen'
export { DrivePage } from './components/DrivePage'
export { DriveEngine, type DriveSnapshot } from './domain/engine'
export { demoScenario, DEMO_TRIP, driveSeed } from './domain/scenario'
export { scenarioFromDay } from './domain/trip-scenario'
export type { DriveResult, DriveScenario, Encounter } from './types'
// A-2 の間に 3D のチャンクを先読みする口（performance R5。app 層の preloadDrive が呼ぶ）
export { preloadDriveScene } from './scene/load-drive-canvas'
