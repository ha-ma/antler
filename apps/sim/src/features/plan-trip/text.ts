import type { Lang } from '@antler/schema'
import type { UiText } from './types'

// A-1 の画面の文言（R6: ja / en / zh 繁体字 / ko）。欠けは text.test.ts が落とす。
// `{name}` の形の差し込みは fillText で埋める。統計の数字はここに書かない（stats.json から読む）。

export const PLAN_TEXT = {
  brand: { ja: 'EZO ROAD', en: 'EZO ROAD', zh: 'EZO ROAD', ko: 'EZO ROAD' },
  steps: { ja: '進み具合', en: 'Progress', zh: '進度', ko: '진행 단계' },
  stepPlan: { ja: '旅をつくる', en: 'Plan the trip', zh: '規劃旅程', ko: '여행 만들기' },
  stepBrief: { ja: '出発前チェック', en: 'Pre-drive check', zh: '出發前確認', ko: '출발 전 점검' },
  stepDrive: { ja: 'ドライブ', en: 'Drive', zh: '駕駛', ko: '드라이브' },
  stepRecord: { ja: '旅の記録', en: 'Trip record', zh: '旅程紀錄', ko: '여행 기록' },
  lang: { ja: '言語', en: 'Language', zh: '語言', ko: '언어' },
  heading: {
    ja: 'どんな北海道の旅を、楽しみにしていますか？',
    en: 'What kind of Hokkaido trip are you looking forward to?',
    zh: '你期待一趟什麼樣的北海道之旅？',
    ko: '어떤 홋카이도 여행을 기대하고 있나요?',
  },
  lead: {
    ja: 'ここで描いた旅が、そのまま3Dのドライブになります。あなたの仕事は、この旅を最後まで守りきること。',
    en: 'The trip you sketch here becomes your 3D drive. Your job is to protect it all the way to the end.',
    zh: '你在這裡規劃的旅程，會直接變成 3D 駕駛。你的任務，是把這趟旅程守護到最後。',
    ko: '여기서 그린 여행이 그대로 3D 드라이브가 됩니다. 당신의 일은 이 여행을 끝까지 지켜내는 것입니다.',
  },
  inputs: { ja: '旅の条件', en: 'Trip details', zh: '旅程條件', ko: '여행 조건' },
  size: { ja: '人数', en: 'Travelers', zh: '人數', ko: '인원' },
  drivers: { ja: '運転できる人', en: 'Drivers', zh: '可駕駛人數', ko: '운전 가능 인원' },
  experience: {
    ja: '北海道での運転',
    en: 'Driving in Hokkaido',
    zh: '在北海道開車',
    ko: '홋카이도 운전 경험',
  },
  expFirst: { ja: 'はじめて', en: 'First time', zh: '第一次', ko: '처음' },
  expFew: { ja: '1〜2 回', en: '1-2 times', zh: '1～2 次', ko: '1~2회' },
  expExperienced: { ja: '慣れている', en: 'Experienced', zh: '很熟悉', ko: '익숙함' },
  departAt: {
    ja: '出発（日本時間）',
    en: 'Pick-up (Japan time)',
    zh: '出發（日本時間）',
    ko: '출발 (일본 시간)',
  },
  returnAt: {
    ja: '返却・帰国（日本時間）',
    en: 'Return (Japan time)',
    zh: '還車・回國（日本時間）',
    ko: '반납·귀국 (일본 시간)',
  },
  departPlace: { ja: '出発地', en: 'Pick-up place', zh: '出發地', ko: '출발지' },
  returnPlace: { ja: '返却地', en: 'Return place', zh: '還車地', ko: '반납지' },
  budget: {
    ja: '予算（1人・円）',
    en: 'Budget per person (JPY)',
    zh: '預算（每人・日圓）',
    ko: '예산 (1인·엔)',
  },
  pleasuresHeading: {
    ja: '楽しみなことを選んで、重さをつける',
    en: 'Pick what you look forward to, and weigh it',
    zh: '選擇期待的事，並給它重量',
    ko: '기대되는 것을 고르고 무게를 정하세요',
  },
  pleasuresLead: {
    ja: '重さが大きいほど日程で優先され、失ったときの痛みも大きくなります。',
    en: 'Heavier picks get priority in the schedule, and hurt more if you lose them.',
    zh: '重量越大，在行程中越優先，失去時也越痛。',
    ko: '무게가 클수록 일정에서 우선되고, 잃었을 때의 아픔도 커집니다.',
  },
  areas: { ja: 'エリア', en: 'Area', zh: '地區', ko: '지역' },
  areaDoto: {
    ja: '道東（釧路方面）',
    en: 'East Hokkaido (Kushiro)',
    zh: '道東（釧路方向）',
    ko: '도동 (구시로 방면)',
  },
  areaDoo: {
    ja: '道央（札幌方面）',
    en: 'Central Hokkaido (Sapporo)',
    zh: '道央（札幌方向）',
    ko: '도오 (삿포로 방면)',
  },
  areaCount: {
    ja: '{n} 件選択',
    en: '{n} selected',
    zh: '已選 {n} 項',
    ko: '{n}개 선택',
  },
  counter: { ja: '選択', en: 'Selected', zh: '已選', ko: '선택' },
  limitReached: {
    ja: '{max} 件まで選べます。ほかを選ぶには 1 つ外してください。',
    en: 'You can pick up to {max}. Remove one to pick another.',
    zh: '最多可選 {max} 項。若要選其他，請先取消一項。',
    ko: '최대 {max}개까지 고를 수 있습니다. 다른 것을 고르려면 하나를 빼세요.',
  },
  photo: { ja: '写真：{name}', en: 'Photo: {name}', zh: '照片：{name}', ko: '사진: {name}' },
  weight: { ja: '重さ', en: 'Weight', zh: '重量', ko: '무게' },
  weightOf: {
    ja: '{name} の重さ',
    en: 'Weight of {name}',
    zh: '{name} 的重量',
    ko: '{name}의 무게',
  },
  weightValue: { ja: '重さ {n}', en: 'Weight {n}', zh: '重量 {n}', ko: '무게 {n}' },
  weightDown: { ja: '重さを下げる', en: 'Lower the weight', zh: '降低重量', ko: '무게 낮추기' },
  weightUp: { ja: '重さを上げる', en: 'Raise the weight', zh: '提高重量', ko: '무게 높이기' },
  skippedMark: {
    ja: '（入りきらない）',
    en: " (doesn't fit)",
    zh: '（排不進）',
    ko: ' (들어가지 않음)',
  },
  itinerary: { ja: '旅のしおり', en: 'Trip plan', zh: '旅遊手冊', ko: '여행 일정표' },
  nightsDays: {
    ja: '{nights}泊{days}日',
    en: '{nights} nights, {days} days',
    zh: '{nights}晚{days}天',
    ko: '{nights}박 {days}일',
  },
  dayTrip: { ja: '日帰り', en: 'Day trip', zh: '當日來回', ko: '당일치기' },
  dayLabel: { ja: '{n} 日目', en: 'Day {n}', zh: '第 {n} 天', ko: '{n}일째' },
  moveOnly: { ja: '移動のみ', en: 'Driving only', zh: '僅移動', ko: '이동만' },
  stayAt: { ja: '{place}泊', en: 'Stay: {place}', zh: '住 {place}', ko: '{place} 숙박' },
  skipped: {
    ja: '日程に入りきらない楽しみ',
    en: "Picks that don't fit the schedule",
    zh: '排不進行程的項目',
    ko: '일정에 들어가지 않는 것',
  },
  allocation: {
    ja: '重さの配分（合計 {n}）',
    en: 'Weight split (total {n})',
    zh: '重量分配（合計 {n}）',
    ko: '무게 배분 (합계 {n})',
  },
  noPleasures: {
    ja: '楽しみを選ぶと、ここに配分が出ます。',
    en: 'Pick something to see the split here.',
    zh: '選擇項目後，這裡會顯示分配。',
    ko: '무언가를 고르면 여기에 배분이 표시됩니다.',
  },
  risk: {
    ja: 'この旅が失われるリスク',
    en: 'Risk of losing this trip',
    zh: '失去這趟旅程的風險',
    ko: '이 여행을 잃을 위험',
  },
  riskHigh: { ja: '高い', en: 'High', zh: '高', ko: '높음' },
  riskCaution: { ja: '注意', en: 'Caution', zh: '注意', ko: '주의' },
  riskLow: { ja: '低め', en: 'Lower', zh: '偏低', ko: '낮은 편' },
  riskNote: {
    ja: '重みは目安です。',
    en: 'The weights are rough estimates.',
    zh: '權重僅供參考。',
    ko: '가중치는 대략적인 기준입니다.',
  },
  source: { ja: '出典：{name}', en: 'Source: {name}', zh: '資料來源：{name}', ko: '출처: {name}' },
  budgetSummary: {
    ja: '予算（1人）',
    en: 'Budget per person',
    zh: '預算（每人）',
    ko: '예산 (1인)',
  },
  submit: {
    ja: 'この旅を守りに行く →',
    en: 'Go protect this trip →',
    zh: '去守護這趟旅程 →',
    ko: '이 여행을 지키러 가기 →',
  },
  submitting: {
    ja: 'しおりを仕上げています…',
    en: 'Finishing your trip plan…',
    zh: '正在完成旅遊手冊…',
    ko: '여행 일정표를 마무리하는 중…',
  },
  footnote: {
    ja: '登録不要 ・ 3Dはブラウザで動きます ・ 所要 約12分',
    en: 'No sign-up ・ 3D runs in your browser ・ About 12 min',
    zh: '免註冊 ・ 3D 在瀏覽器中執行 ・ 約需 12 分鐘',
    ko: '가입 불필요 ・ 3D는 브라우저에서 실행 ・ 약 12분',
  },
  errorFailed: {
    ja: 'しおりを仕上げられませんでした。',
    en: "We couldn't finish your trip plan.",
    zh: '無法完成旅遊手冊。',
    ko: '여행 일정표를 완성하지 못했습니다.',
  },
  retry: { ja: 'もう一度', en: 'Try again', zh: '再試一次', ko: '다시 시도' },
  errorLimit: {
    ja: '本日の生成上限に達しました。',
    en: "Today's creation limit has been reached.",
    zh: '已達今日的產生上限。',
    ko: '오늘의 생성 한도에 도달했습니다.',
  },
  invalidInput: {
    ja: '入力を確かめてください。しおりは前の入力のままです。',
    en: 'Please check your entries. The plan still shows the previous input.',
    zh: '請確認輸入內容。手冊仍維持先前的輸入。',
    ko: '입력을 확인해 주세요. 일정표는 이전 입력 그대로입니다.',
  },
  errSize: {
    ja: '人数は 1〜8 人にしてください。',
    en: 'Travelers must be 1-8.',
    zh: '人數請填 1～8 人。',
    ko: '인원은 1~8명으로 해 주세요.',
  },
  errDrivers: {
    ja: '運転できる人は 1 人以上、人数以下にしてください。',
    en: 'Drivers must be at least 1 and no more than travelers.',
    zh: '可駕駛人數需至少 1 人，且不超過總人數。',
    ko: '운전 가능 인원은 1명 이상, 인원 이하로 해 주세요.',
  },
  errDateTime: {
    ja: '日時を入れてください。',
    en: 'Please enter a date and time.',
    zh: '請輸入日期與時間。',
    ko: '날짜와 시간을 입력해 주세요.',
  },
  errReturn: {
    ja: '返却は出発より後にし、旅は {max} 日までにしてください。',
    en: 'Return must be after pick-up, and the trip at most {max} days.',
    zh: '還車需晚於出發，且旅程最多 {max} 天。',
    ko: '반납은 출발 이후로, 여행은 최대 {max}일로 해 주세요.',
  },
  errBudget: {
    ja: '予算は 0〜{max} 円にしてください。',
    en: 'Budget must be 0-{max} JPY.',
    zh: '預算請填 0～{max} 日圓。',
    ko: '예산은 0~{max}엔으로 해 주세요.',
  },
  briefPending: {
    ja: 'ブリーフィングは準備中です',
    en: 'The briefing is being prepared',
    zh: '行前說明準備中',
    ko: '브리핑은 준비 중입니다',
  },
  briefTitle: { ja: '旅のタイトル', en: 'Trip title', zh: '旅程標題', ko: '여행 제목' },
  briefBack: {
    ja: '旅をつくり直す',
    en: 'Plan another trip',
    zh: '重新規劃旅程',
    ko: '여행 다시 만들기',
  },
} satisfies Record<string, UiText>

export type PlanTextKey = keyof typeof PLAN_TEXT

/** 文言を言語で引き、`{name}` の差し込みを埋める。 */
export function fillText(
  key: PlanTextKey,
  lang: Lang,
  values: Record<string, string | number> = {},
): string {
  return PLAN_TEXT[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}
