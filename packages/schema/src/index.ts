// @antler/schema — TripPlan / AlertFlag / Capture と WebSocket のメッセージの型（A と B の唯一の定義）。
// 要件: docs/requirements/ch7-data.md。仕様: docs/specs/alert-ui/。公開 API はこのファイルの export（凍結対象）。
export { IsoDateTime, Lang, Side, Slug, toJst } from './common'
export {
  AlertFlagSchema,
  readAlertFlag,
  type AlertFlag,
  type FlagProblem,
  type ReadFlagResult,
  type ReceivedFlag,
} from './alert-flag'
export {
  AckMessageSchema,
  ClientMessageSchema,
  LabelMessageSchema,
  type ClientMessage,
} from './client-message'
export { CaptureSchema, isUploadable, type Capture } from './capture'
export { DeparturePlace, TripPlanSchema, type TripPlan } from './trip-plan'
export {
  buildJsonSchema,
  JSON_SCHEMA_SOURCES,
  renderJsonSchema,
  type JsonSchemaName,
} from './json-schema'
