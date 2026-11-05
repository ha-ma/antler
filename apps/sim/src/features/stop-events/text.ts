import type { Lang } from '@antler/schema'
import type { ChoiceKind, SceneKind } from './types'
import type { LightWord } from './utils/format'

// A-4 の画面の文言（ja / en / zh 繁体字 / ko。欠けは text.test.ts が落とす）。
// Claude の文が無いときの決まった言い回し（UI-4d）もここに持つ。Claude の代わりの物語は作らない（見出しは楽しみの名前）。
// `{name}` の形の差し込みは fillText で埋める。統計の実数はこの画面に出さない。

type UiText = Record<Lang, string>

export const STOP_TEXT = {
  eyebrowPleasure: {
    ja: '旅のしおり ・ 楽しみ',
    en: 'Itinerary ・ Highlight',
    zh: '旅程 ・ 期待的行程',
    ko: '여행 일정 ・ 즐길 거리',
  },
  eyebrowRoad: { ja: '道中のできごと', en: 'On the road', zh: '途中的狀況', ko: '길 위의 일' },
  weight: { ja: '重さ {n}', en: 'Weight {n}', zh: '重要度 {n}', ko: '중요도 {n}' },
  photo: { ja: '写真：{name}', en: 'Photo: {name}', zh: '照片：{name}', ko: '사진: {name}' },
  photoCount: { ja: '写真 {n} 枚', en: '{n} photos', zh: '{n} 張照片', ko: '사진 {n}장' },
  stay: { ja: '滞在', en: 'Stay', zh: '停留', ko: '체류' },
  minutes: { ja: '{n} 分', en: '{n} min', zh: '{n} 分鐘', ko: '{n}분' },
  spent: {
    ja: '使った（予算からの目安）',
    en: 'Spent (estimate from budget)',
    zh: '花費（依預算估算）',
    ko: '쓴 돈 (예산 기준 추정)',
  },
  arrival: {
    ja: '{place} 到着予定',
    en: 'Arrive {place}',
    zh: '預計抵達{place}',
    ko: '{place} 도착 예정',
  },
  noArrival: {
    ja: '今日の移動はおしまい',
    en: 'No more driving today',
    zh: '今天不再移動',
    ko: '오늘 이동은 끝',
  },
  question: { ja: 'どうする？', en: 'What will you do?', zh: '要怎麼做？', ko: '어떻게 할까요?' },
  arriveAt: {
    ja: '→ {place} {time} 着',
    en: '→ {place} at {time}',
    zh: '→ {time} 抵達{place}',
    ko: '→ {place} {time} 도착',
  },
  nextDay: { ja: '翌 {time}', en: '{time} (+1 day)', zh: '隔天 {time}', ko: '다음 날 {time}' },
  stayHere: {
    ja: '→ {place} に泊まる',
    en: '→ Stay in {place}',
    zh: '→ 住在{place}',
    ko: '→ {place}에서 묵기',
  },
  zonePass: {
    ja: '鹿ゾーン（{km} km）を {time}〜 {light}に通過',
    en: 'Deer zone ({km} km) from {time}, {light}',
    zh: '{time}起於{light}通過鹿區（{km} 公里）',
    ko: '사슴 구간({km}km)을 {time}부터 {light}에 통과',
  },
  zoneMore: {
    ja: '（ほか {n} 区間）',
    en: ' (+{n} more)',
    zh: '（另有 {n} 段）',
    ko: ' (외 {n}구간)',
  },
  zoneNone: {
    ja: '鹿ゾーンを通らない',
    en: 'No deer zone ahead',
    zh: '不經過鹿區',
    ko: '사슴 구간을 지나지 않음',
  },
  lostYen: {
    ja: '予算からの目安 −{yen}',
    en: 'Estimated from budget −{yen}',
    zh: '依預算估算 −{yen}',
    ko: '예산 기준 추정 −{yen}',
  },
  lostWeight: {
    ja: '楽しみ −重さ {n}',
    en: 'Highlights −weight {n}',
    zh: '行程 −重要度 {n}',
    ko: '즐길 거리 −중요도 {n}',
  },
  lateReturn: {
    ja: '返却に遅れる',
    en: 'Late for the car return',
    zh: '趕不上還車',
    ko: '반납 시간에 늦음',
  },
  alertOn: {
    ja: '鹿アラート ON ・ ダッシュボードのスマホで通知します',
    en: 'Deer alert ON ・ The dashboard phone will warn you',
    zh: '鹿警報 開啟 ・ 儀表板上的手機會通知',
    ko: '사슴 알림 ON ・ 대시보드의 휴대폰이 알려 줍니다',
  },
  alertOff: { ja: '鹿アラート OFF', en: 'Deer alert OFF', zh: '鹿警報 關閉', ko: '사슴 알림 OFF' },
  dialogLabel: { ja: '観光スポット', en: 'Stop', zh: '景點', ko: '관광 스폿' },
  // 確認用の画面（/trip/:id/day/:n/stops。R12）
  previewHeading: {
    ja: 'DAY {n} の停車の出来事',
    en: 'Stops on day {n}',
    zh: '第 {n} 天的停車事件',
    ko: '{n}일차 정차 이벤트',
  },
  previewNoOwner: {
    ja: 'この旅を作った端末で開くと、出来事が出ます。',
    en: 'Open this on the device that created the trip to see the stops.',
    zh: '請在建立此旅程的裝置上開啟，才會顯示事件。',
    ko: '이 여행을 만든 기기에서 열면 이벤트가 표시됩니다.',
  },
  previewLoading: {
    ja: '出来事を用意しています（Claude が書いています）',
    en: 'Preparing the stops (Claude is writing)',
    zh: '正在準備事件（Claude 正在撰寫）',
    ko: '이벤트를 준비하고 있습니다 (Claude가 쓰는 중)',
  },
  previewFailed: {
    ja: '出来事を用意できませんでした。',
    en: 'Could not prepare the stops.',
    zh: '無法準備事件。',
    ko: '이벤트를 준비하지 못했습니다.',
  },
  previewRetry: { ja: 'もう一度', en: 'Try again', zh: '再試一次', ko: '다시 시도' },
  previewEmpty: {
    ja: 'この日は停車の出来事がありません。',
    en: 'No stops on this day.',
    zh: '這一天沒有停車事件。',
    ko: '이날은 정차 이벤트가 없습니다.',
  },
  previewChosen: {
    ja: '選んだもの：{label}',
    en: 'You chose: {label}',
    zh: '你選擇了：{label}',
    ko: '선택: {label}',
  },
} satisfies Record<string, UiText>

export const LIGHT_TEXT: Record<LightWord, UiText> = {
  day: { ja: '昼', en: 'in daylight', zh: '白天', ko: '낮' },
  dusk: { ja: '薄暮', en: 'at dusk', zh: '黃昏', ko: '해 질 녘' },
  dawn: { ja: '薄明', en: 'at dawn', zh: '黎明', ko: '새벽 박명' },
  afterSunset: { ja: '日没後', en: 'after sunset', zh: '日落後', ko: '해 진 뒤' },
  beforeDawn: { ja: '夜明け前', en: 'before dawn', zh: '天亮前', ko: '동트기 전' },
}

/** ランダムの場面の見出し（Claude の文が無いとき） */
export const SCENE_TEXT: Record<Exclude<SceneKind, 'pleasure'>, UiText> = {
  fuel: {
    ja: '燃料が気になってきた',
    en: 'The fuel gauge is getting low',
    zh: '油量開始讓人擔心',
    ko: '연료가 신경 쓰이기 시작했다',
  },
  traffic: { ja: '渋滞につかまった', en: 'Stuck in traffic', zh: '遇到塞車', ko: '정체에 걸렸다' },
  weather: {
    ja: '天気が変わってきた',
    en: 'The weather is turning',
    zh: '天氣變了',
    ko: '날씨가 바뀌고 있다',
  },
  request: {
    ja: '同乗者から寄り道のお願い',
    en: 'A passenger asks for a detour',
    zh: '同伴想順路逛逛',
    ko: '동행이 잠깐 들르자고 한다',
  },
}

/** 選択肢の決まった言い回し（Claude の文が無いとき） */
export const CHOICE_TEXT: Record<ChoiceKind, UiText> = {
  leave: { ja: 'いま出発する', en: 'Leave now', zh: '現在出發', ko: '지금 출발한다' },
  linger: {
    ja: 'もう少しいる',
    en: 'Stay a little longer',
    zh: '再待一會兒',
    ko: '조금 더 머문다',
  },
  stay: {
    ja: '予定を変えてここに泊まる',
    en: 'Change plans and stay here',
    zh: '改變計畫住在這裡',
    ko: '일정을 바꿔 여기서 묵는다',
  },
  refuel: { ja: '給油する', en: 'Refuel', zh: '加油', ko: '주유한다' },
  skip: { ja: '寄らずに進む', en: 'Keep going', zh: '不停繼續走', ko: '들르지 않고 간다' },
  wait: { ja: '渋滞を待つ', en: 'Wait it out', zh: '等塞車結束', ko: '정체를 기다린다' },
  bypass: { ja: '迂回する', en: 'Take a detour', zh: '繞路', ko: '우회한다' },
  'turn-back': {
    ja: '引き返して泊まる',
    en: 'Turn back and stay',
    zh: '折返住宿',
    ko: '되돌아가 묵는다',
  },
  slow: { ja: 'ゆっくり進む', en: 'Drive slowly', zh: '慢慢開', ko: '천천히 간다' },
  'wait-out': {
    ja: '道の駅で待つ',
    en: 'Wait at a roadside station',
    zh: '在休息站等待',
    ko: '휴게소에서 기다린다',
  },
  accept: { ja: '寄り道する', en: 'Make the detour', zh: '順路去看看', ko: '들렀다 간다' },
  decline: { ja: '断って進む', en: 'Say no and keep going', zh: '婉拒繼續走', ko: '거절하고 간다' },
}

/** `{name}` の形を埋める（足りない差し込みはそのまま残す） */
export function fillText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, key: string) =>
    key in values ? String(values[key]) : all,
  )
}
