// 旅の記録（record）のドメイン例外。HTTP の status と code は infrastructure/http/error-mapper.ts が決める。
// 旅が無いときは trips の TripNotFoundError を使う（brief-map と同じ 404）。

export abstract class RecordError extends Error {}

/** 所有者トークンが無い・形が違う（threat.md AUTH-1・AUTH-3） */
export class OwnerTokenRequiredError extends RecordError {
  override name = 'OwnerTokenRequiredError'
  constructor() {
    super('この操作には旅の所有者トークンが要ります')
  }
}

/** 所有者トークンがその旅のものではない（threat.md AUTH-2・AUTH-3・IDOR-1） */
export class NotOwnerError extends RecordError {
  override name = 'NotOwnerError'
  constructor() {
    super('この旅の所有者ではありません')
  }
}

/** run の日が旅の日数を超える（functional.md UC-3c） */
export class RunDayOutOfRangeError extends RecordError {
  override name = 'RunDayOutOfRangeError'
  constructor() {
    super('その日は旅にありません')
  }
}

/** 1 つの旅に残せる run の数を超える（functional.md UC-3d） */
export class RunLimitError extends RecordError {
  override name = 'RunLimitError'
  constructor() {
    super('この旅に残せる走行の記録の数を超えました')
  }
}
