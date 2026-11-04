import type { Lang } from '@antler/schema'

// A-6 の画面の文言（R10: ja / en / zh 繁体字 / ko）。欠けは text.test.ts が落とす。
// `{name}` の形の差し込みは fillText で埋める。統計の実数・金額は STATS と計算から差し込む（ここに書かない）。

type UiText = Record<Lang, string>

export const LOSS_TEXT = {
  brand: { ja: 'EZO ROAD', en: 'EZO ROAD', zh: 'EZO ROAD', ko: 'EZO ROAD' },
  pageTitle: { ja: '旅の喪失', en: 'What the trip lost', zh: '旅程的損失', ko: '여행의 상실' },
  loadingTrip: {
    ja: 'しおりを読み込んでいます',
    en: 'Loading the itinerary',
    zh: '正在載入行程表',
    ko: '일정표를 불러오는 중',
  },
  notFound: {
    ja: '旅が見つかりません。',
    en: 'This trip could not be found.',
    zh: '找不到這趟旅程。',
    ko: '여행을 찾을 수 없습니다.',
  },
  outdated: {
    ja: 'この旅は古い形式です。もう一度つくってください。',
    en: 'This trip uses an old format. Please plan it again.',
    zh: '這趟旅程的格式較舊。請重新規劃。',
    ko: '이 여행은 이전 형식입니다. 다시 만들어 주세요.',
  },
  tripFailed: {
    ja: 'しおりを読み込めませんでした。',
    en: 'Could not load the itinerary.',
    zh: '無法載入行程表。',
    ko: '일정표를 불러오지 못했습니다.',
  },
  unreadable: {
    ja: '衝突の情報が読めません。',
    en: 'The collision details could not be read.',
    zh: '無法讀取碰撞的資訊。',
    ko: '충돌 정보를 읽을 수 없습니다.',
  },
  retry: { ja: 'もう一度', en: 'Try again', zh: '再試一次', ko: '다시 시도' },
  toPlan: { ja: '旅をつくる画面へ', en: 'Plan a trip', zh: '前往規劃旅程', ko: '여행 만들기로' },
  eyebrow: {
    ja: 'DAY {n} ・ {time} ・ {from} → {to}',
    en: 'DAY {n} · {time} · {from} → {to}',
    zh: 'DAY {n} ・ {time} ・ {from} → {to}',
    ko: 'DAY {n} ・ {time} ・ {from} → {to}',
  },
  heading: {
    ja: '旅は、ここで終わりました。',
    en: 'The trip ended here.',
    zh: '旅程，在這裡結束了。',
    ko: '여행은 여기서 끝났습니다.',
  },
  fact: {
    ja: '{light}、{side}から出てきた鹿と、時速 {speed} km で衝突しました。',
    en: '{light}, a deer came out from {side} and the car hit it at {speed} km/h.',
    zh: '{light}，與從{side}衝出的鹿以時速 {speed} 公里相撞。',
    ko: '{light}, {side}에서 나온 사슴과 시속 {speed}km로 충돌했습니다.',
  },
  lightDay: { ja: '昼', en: 'In daylight', zh: '白天', ko: '낮' },
  lightDawn: { ja: '明け方', en: 'At dawn', zh: '清晨', ko: '새벽' },
  lightDusk: { ja: '薄暮', en: 'At twilight', zh: '黃昏', ko: '박명' },
  lightNight: { ja: '夜', en: 'At night', zh: '夜間', ko: '밤' },
  sideL: { ja: '左', en: 'the left', zh: '左側', ko: '왼쪽' },
  sideR: { ja: '右', en: 'the right', zh: '右側', ko: '오른쪽' },
  factPlain: {
    ja: '鹿と衝突しました。',
    en: 'The car hit a deer.',
    zh: '與鹿相撞了。',
    ko: '사슴과 충돌했습니다.',
  },
  alertOff: {
    ja: '鹿アラートは OFF でした。',
    en: 'The deer alert was OFF.',
    zh: '鹿警示是關閉的。',
    ko: '사슴 알림은 꺼져 있었습니다.',
  },
  carDone: {
    ja: '車はもう走れません。',
    en: 'The car can no longer be driven.',
    zh: '車子已經無法行駛。',
    ko: '차는 더 이상 달릴 수 없습니다.',
  },
  storyHeading: {
    ja: 'Claude が書いた、失ったもの',
    en: 'What was lost, written by Claude',
    zh: 'Claude 寫下的、失去的事物',
    ko: 'Claude가 쓴, 잃어버린 것',
  },
  storyLoading: {
    ja: '文を用意しています',
    en: 'Writing the story',
    zh: '正在準備文字',
    ko: '글을 준비하는 중',
  },
  storyFailed: {
    ja: '文を用意できませんでした。',
    en: 'The story could not be prepared.',
    zh: '無法準備文字。',
    ko: '글을 준비하지 못했습니다.',
  },
  storyLimit: {
    ja: '本日の上限に達しました。',
    en: "Today's limit has been reached.",
    zh: '已達今日的上限。',
    ko: '오늘의 한도에 도달했습니다.',
  },
  metrics: { ja: '失ったもの', en: 'What was lost', zh: '失去的事物', ko: '잃어버린 것' },
  tileVehicle: {
    ja: '車両の損害（保険金支払 1 件の平均）',
    en: 'Vehicle damage (average insurance payout per claim)',
    zh: '車輛損失（保險理賠每件平均）',
    ko: '차량 손해（보험금 지급 1건 평균）',
  },
  tileVehicleNote: {
    ja: '最大 {max} ・ 免責・NOC はレンタカー会社の規定による（準備中）',
    en: 'Up to {max} · Deductible and NOC depend on the rental company (in preparation)',
    zh: '最高 {max} ・ 自負額與營業損失依租車公司規定（準備中）',
    ko: '최대 {max} ・ 면책금・NOC는 렌터카 회사 규정에 따름（준비 중）',
  },
  tileCancel: {
    ja: 'キャンセル・払い戻しなし',
    en: 'Cancellations, no refund',
    zh: '取消・無法退款',
    ko: '취소・환불 없음',
  },
  tileCancelNote: {
    ja: '宿 {nights} 泊・楽しみ {pleasures} 件・{people} 人分',
    en: '{nights} nights · {pleasures} experiences · for {people}',
    zh: '住宿 {nights} 晚・體驗 {pleasures} 項・{people} 人份',
    ko: '숙박 {nights}박・체험 {pleasures}건・{people}명분',
  },
  approx: {
    ja: '概算（単価の出典なし）',
    en: 'Estimate (no source for unit prices)',
    zh: '概算（單價無出處）',
    ko: '추정（단가 출처 없음）',
  },
  tileDays: { ja: '失った日数', en: 'Days lost', zh: '失去的天數', ko: '잃어버린 날' },
  unitDays: { ja: '日', en: 'days', zh: '天', ko: '일' },
  daysNote: { ja: 'D{from}〜D{to}', en: 'D{from}–D{to}', zh: 'D{from}–D{to}', ko: 'D{from}~D{to}' },
  tilePleasures: {
    ja: '楽しみ {total} つのうち',
    en: 'Of {total} highlights',
    zh: '{total} 項期待中',
    ko: '즐길 거리 {total}개 중',
  },
  pleasuresNote: {
    ja: '重さ {achieved} / {total}',
    en: 'Weight {achieved} / {total}',
    zh: '份量 {achieved} / {total}',
    ko: '비중 {achieved} / {total}',
  },
  actions: { ja: 'つぎに', en: 'Next', zh: '接下來', ko: '다음으로' },
  primaryOff: {
    ja: '鹿アラートを ON にして、同じ道をやり直す',
    en: 'Turn the deer alert ON and drive the same road again',
    zh: '開啟鹿警示，重新走同一條路',
    ko: '사슴 알림을 켜고 같은 길을 다시 달리기',
  },
  primaryOn: {
    ja: '同じ道を、もう一度走る',
    en: 'Drive the same road once more',
    zh: '再走一次同一條路',
    ko: '같은 길을 한 번 더 달리기',
  },
  replay: {
    ja: '衝突の 3 秒前を見る',
    en: 'Watch the 3 seconds before',
    zh: '查看碰撞前 3 秒',
    ko: '충돌 3초 전 보기',
  },
  newTrip: {
    ja: '別の旅をつくる',
    en: 'Plan another trip',
    zh: '規劃另一趟旅程',
    ko: '다른 여행 만들기',
  },
  cardHeading: { ja: '旅のしおり', en: 'Itinerary', zh: '旅程表', ko: '여행 일정표' },
  cardDays: { ja: '{n} 日間', en: '{n} days', zh: '{n} 天', ko: '{n}일간' },
  struck: { ja: '取り消し', en: 'cancelled', zh: '已取消', ko: '취소됨' },
  done: { ja: '済み', en: 'done', zh: '已完成', ko: '완료' },
  dayLabel: { ja: 'D{n}', en: 'D{n}', zh: 'D{n}', ko: 'D{n}' },
  routeRow: {
    ja: '{from} → {to}',
    en: '{from} → {to}',
    zh: '{from} → {to}',
    ko: '{from} → {to}',
  },
  stayRow: { ja: '{place}泊', en: 'Stay in {place}', zh: '住宿 {place}', ko: '{place} 숙박' },
  collisionRow: {
    ja: '{time} {from} → {to} で衝突',
    en: '{time} Collision, {from} → {to}',
    zh: '{time} 於 {from} → {to} 碰撞',
    ko: '{time} {from} → {to}에서 충돌',
  },
  statsHeading: {
    ja: 'これは、北海道で {year} 年に {total} 件起きたこと',
    en: 'This happened {total} times in Hokkaido in {year}',
    zh: '這是 {year} 年在北海道發生了 {total} 件的事',
    ko: '이것은 {year}년 홋카이도에서 {total}건 일어난 일',
  },
  statsAccidents: {
    ja: 'エゾシカが関係する交通事故は前年 {previous} 件。うち釧路方面 {kushiro} 件。',
    en: 'Deer-related traffic accidents: {previous} the year before. {kushiro} in the Kushiro area.',
    zh: '與蝦夷鹿有關的交通事故，前一年 {previous} 件。其中釧路方面 {kushiro} 件。',
    ko: '에조사슴 관련 교통사고는 전년 {previous}건. 그중 구시로 방면 {kushiro}건.',
  },
  statsInsurance: {
    ja: '車両保険金の支払いは {from}〜{to} に {claims} 件・{paid}、1 件平均 {average}。',
    en: 'Vehicle insurance paid {claims} claims from {from} to {to}, {paid} in total, {average} on average.',
    zh: '車輛保險理賠於 {from}–{to} 共 {claims} 件・{paid}，每件平均 {average}。',
    ko: '차량 보험금 지급은 {from}~{to}에 {claims}건・{paid}, 1건 평균 {average}.',
  },
  month: { ja: '{y}年{m}月', en: '{m}/{y}', zh: '{y}年{m}月', ko: '{y}년 {m}월' },
  source: { ja: '出典：{name}', en: 'Source: {name}', zh: '出處：{name}', ko: '출처: {name}' },
  recheck: {
    ja: '（出典の再照合中）',
    en: ' (source being re-checked)',
    zh: '（出處重新核對中）',
    ko: '（출처 재확인 중）',
  },
} satisfies Record<string, UiText>

export type LossTextKey = keyof typeof LOSS_TEXT

/** `{name}` を値で埋める */
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  )
}
