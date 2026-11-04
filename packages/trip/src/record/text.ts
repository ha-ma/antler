import type { Lang } from '@antler/schema'

// A-7 旅の記録の文言（docs/specs/record/functional.md R5〜R10、ja / en / zh 繁体字 / ko）。
// sim の A-7・api の SSR・OG 画像が同じ表を使う（同じ記録が同じ言葉で出る）。欠けは text.test.ts が落とす。
// `{name}` の形の差し込みは fillRecordText で埋める。統計の実数はこの画面に出さない。

type UiText = Record<Lang, string>

export const RECORD_TEXT = {
  brand: { ja: 'EZO ROAD', en: 'EZO ROAD', zh: 'EZO ROAD', ko: 'EZO ROAD' },
  pageTitle: {
    ja: '{title} — 旅の記録',
    en: '{title} — Trip record',
    zh: '{title} — 旅程紀錄',
    ko: '{title} — 여행 기록',
  },
  eyebrow: {
    ja: 'TRIP RECORD ・ {dates}',
    en: 'TRIP RECORD ・ {dates}',
    zh: 'TRIP RECORD ・ {dates}',
    ko: 'TRIP RECORD ・ {dates}',
  },
  headingCompleted: {
    ja: '守りきった。',
    en: 'Kept, all the way.',
    zh: '守住了。',
    ko: '끝까지 지켰다.',
  },
  headingPartial: {
    ja: 'D{n} まで走った。',
    en: 'Drove through Day {n}.',
    zh: '已行駛到第 {n} 天。',
    ko: '{n}일차까지 달렸다.',
  },
  headingNotStarted: {
    ja: 'まだ走っていません。',
    en: 'Not driven yet.',
    zh: '尚未出發。',
    ko: '아직 달리지 않았습니다.',
  },
  summary: {
    ja: '{party}人・{days}日間。鹿ゾーンを{zones}回通り、{met}頭に出会い、{avoided}頭を回避しました。',
    en: '{party} people, {days} days. Passed {zones} deer zones, met {met} deer and avoided {avoided}.',
    zh: '{party} 人・{days} 天。通過鹿區 {zones} 次，遇到 {met} 頭鹿，避開了 {avoided} 頭。',
    ko: '{party}명・{days}일. 사슴 구간을 {zones}번 지나 {met}마리를 만나고 {avoided}마리를 피했습니다.',
  },
  statsLabel: { ja: '記録の数字', en: 'Record in numbers', zh: '紀錄數字', ko: '기록 숫자' },
  statPleasures: { ja: '楽しみ 達成', en: 'Pleasures kept', zh: '守住的樂趣', ko: '지킨 즐거움' },
  statZones: { ja: '鹿ゾーン通過', en: 'Deer zones passed', zh: '通過鹿區', ko: '사슴 구간 통과' },
  statDeer: {
    ja: '鹿 遭遇 / 回避',
    en: 'Deer met / avoided',
    zh: '遇鹿 / 避開',
    ko: '사슴 만남 / 회피',
  },
  statBrake: {
    ja: 'アラート→ブレーキ 平均',
    en: 'Alert → brake, average',
    zh: '警報→煞車 平均',
    ko: '경보→브레이크 평균',
  },
  unitTimes: { ja: '回', en: '×', zh: '次', ko: '회' },
  unitSeconds: { ja: 's', en: 's', zh: 's', ko: 's' },
  noValue: { ja: '—', en: '—', zh: '—', ko: '—' },
  keptHeading: { ja: '守れたもの', en: 'What you kept', zh: '守住的', ko: '지킨 것' },
  keptEmpty: {
    ja: 'まだ守れた楽しみはありません。',
    en: 'No pleasures kept yet.',
    zh: '還沒有守住的樂趣。',
    ko: '아직 지킨 즐거움이 없습니다.',
  },
  photoPending: {
    ja: '写真は準備中',
    en: 'Photo coming soon',
    zh: '照片準備中',
    ko: '사진 준비 중',
  },
  dayLabel: { ja: 'D{n}', en: 'Day {n}', zh: '第 {n} 天', ko: '{n}일차' },
  logHeading: {
    ja: '鹿ゾーンでの{n}回',
    en: '{n} deer encounters',
    zh: '鹿區的 {n} 次',
    ko: '사슴 구간에서의 {n}번',
  },
  logEmpty: {
    ja: '鹿には出会いませんでした。',
    en: 'No deer encountered.',
    zh: '沒有遇到鹿。',
    ko: '사슴을 만나지 않았습니다.',
  },
  patternRoadside: {
    ja: '路肩に静止',
    en: 'Standing at the roadside',
    zh: '路肩靜止',
    ko: '갓길에 정지',
  },
  patternEyeshine: {
    ja: '林縁で目の反射',
    en: 'Eyeshine at the forest edge',
    zh: '林緣眼睛反光',
    ko: '숲 가장자리의 눈빛',
  },
  patternCrossing: { ja: '車線を横断', en: 'Crossing the lane', zh: '橫越車道', ko: '차선 횡단' },
  patternHerd: { ja: '群れ', en: 'A herd', zh: '鹿群', ko: '무리' },
  patternFrozen: {
    ja: '車の前で立ちすくみ',
    en: 'Frozen in front of the car',
    zh: '在車前呆立',
    ko: '차 앞에서 얼어붙음',
  },
  closest: { ja: '最接近 {m} m', en: 'closest {m} m', zh: '最近 {m} m', ko: '최근접 {m} m' },
  alertToBrake: {
    ja: 'アラート→ブレーキ {s} s',
    en: 'alert → brake {s} s',
    zh: '警報→煞車 {s} s',
    ko: '경보→브레이크 {s} s',
  },
  outcomeAvoided: { ja: '回避', en: 'Avoided', zh: '避開', ko: '회피' },
  outcomeCloseCall: { ja: '間一髪', en: 'Close call', zh: '千鈞一髮', ko: '아슬아슬' },
  outcomeCollided: { ja: '衝突', en: 'Collision', zh: '碰撞', ko: '충돌' },
  alertOff: { ja: 'アラート OFF', en: 'Alert OFF', zh: '警報 OFF', ko: '경보 OFF' },
  offChallenge: { ja: 'OFF {mark}', en: 'OFF {mark}', zh: 'OFF {mark}', ko: 'OFF {mark}' },
  shioriHeading: { ja: '旅のしおり', en: 'Trip plan', zh: '旅程表', ko: '여행 일정' },
  shioriCompleted: { ja: '完走', en: 'Completed', zh: '完成', ko: '완주' },
  shioriPartial: { ja: '途中', en: 'In progress', zh: '進行中', ko: '진행 중' },
  resultCompleted: { ja: '完走', en: 'Completed', zh: '完成', ko: '완주' },
  resultCollided: { ja: '衝突', en: 'Collision', zh: '碰撞', ko: '충돌' },
  resultNotDriven: { ja: '未走行', en: 'Not driven', zh: '未行駛', ko: '미주행' },
  moreDays: { ja: 'ほか {n} 日', en: '+{n} more days', zh: '另外 {n} 天', ko: '외 {n}일' },
  stayAt: { ja: '{place}泊', en: 'Stay in {place}', zh: '住{place}', ko: '{place} 숙박' },
  bHeading: {
    ja: '実際の旅にも、同じアラートを',
    en: 'The same alert on your real trip',
    zh: '真實的旅途，也用同樣的警報',
    ko: '실제 여행에도 같은 경보를',
  },
  bBody: {
    ja: 'このゲームで鳴っていた音と画面は、車載カメラとあなたのスマホで、実車でもそのまま動きます。',
    en: 'The sounds and screens from this game work the same in a real car, with a dashboard camera and your phone.',
    zh: '這個遊戲裡的聲音和畫面，透過車載鏡頭和你的手機，在真實的車上也一樣運作。',
    ko: '이 게임에서 울리던 소리와 화면은 차량용 카메라와 당신의 스마트폰으로 실제 차에서도 그대로 작동합니다.',
  },
  bPoint1: {
    ja: 'レンタカー受取時にダッシュボードに設置（対応店舗）',
    en: 'Mounted on the dashboard when you pick up the rental car (participating shops)',
    zh: '取車時安裝在儀表板上（合作店家）',
    ko: '렌터카 수령 시 대시보드에 설치(제휴 지점)',
  },
  bPoint2: {
    ja: 'スマホは Wi-Fi に接続するだけ。アプリは要りません（ブラウザで開く）',
    en: 'Your phone just joins the Wi-Fi. No app needed (it opens in the browser)',
    zh: '手機只要連上 Wi-Fi。不需要 App（用瀏覽器開啟）',
    ko: '스마트폰은 Wi-Fi에 연결만 하면 됩니다. 앱은 필요 없습니다(브라우저로 열기)',
  },
  bPoint3: {
    ja: 'ゲームで見つけた鹿の画像は、この検知の学習に使われます',
    en: 'The deer you spotted in the game help train this detector',
    zh: '你在遊戲中找到的鹿的影像，會用於這個偵測的學習',
    ko: '게임에서 찾은 사슴 이미지는 이 감지의 학습에 쓰입니다',
  },
  bLink: {
    ja: '車載アラートについて',
    en: 'About the in-car alert',
    zh: '關於車載警報',
    ko: '차량용 경보 안내',
  },
  openInApp: {
    ja: 'EZO ROAD で開く',
    en: 'Open in EZO ROAD',
    zh: '在 EZO ROAD 開啟',
    ko: 'EZO ROAD에서 열기',
  },
  planOwn: {
    ja: '自分の旅をつくる',
    en: 'Plan your own trip',
    zh: '規劃自己的旅程',
    ko: '나만의 여행 만들기',
  },
  planAnother: {
    ja: '別の旅をつくる',
    en: 'Plan another trip',
    zh: '規劃別的旅程',
    ko: '다른 여행 만들기',
  },
  challengeOff: {
    ja: 'アラート OFF で挑戦',
    en: 'Try with the alert OFF',
    zh: '關掉警報挑戰',
    ko: '경보 OFF로 도전',
  },
  challengeNotSaved: {
    ja: 'この端末での運転は、この記録には残りません。',
    en: 'Drives on this device are not added to this record.',
    zh: '在這台裝置上的駕駛，不會留在這份紀錄裡。',
    ko: '이 기기에서의 운전은 이 기록에 남지 않습니다.',
  },
  urlLabel: {
    ja: 'この旅の URL',
    en: 'URL of this trip',
    zh: '這趟旅程的網址',
    ko: '이 여행의 URL',
  },
  copyLink: { ja: 'リンクをコピー', en: 'Copy link', zh: '複製連結', ko: '링크 복사' },
  copied: { ja: 'コピーしました', en: 'Copied', zh: '已複製', ko: '복사했습니다' },
  copyFailed: {
    ja: 'コピーできませんでした。URL を選んでコピーしてください。',
    en: "Couldn't copy. Select the URL and copy it.",
    zh: '無法複製。請選取網址後複製。',
    ko: '복사하지 못했습니다. URL을 선택해 복사하세요.',
  },
  saveImage: {
    ja: 'しおりを画像で保存',
    en: 'Save the plan as an image',
    zh: '把旅程表存成圖片',
    ko: '일정을 이미지로 저장',
  },
  imageSaved: {
    ja: '画像を保存しました',
    en: 'Image saved',
    zh: '已儲存圖片',
    ko: '이미지를 저장했습니다',
  },
  saveImageFailed: {
    ja: '画像を作れませんでした。もう一度お試しください。',
    en: "Couldn't make the image. Please try again.",
    zh: '無法產生圖片。請再試一次。',
    ko: '이미지를 만들지 못했습니다. 다시 시도해 주세요.',
  },
  loading: {
    ja: '記録を読み込んでいます',
    en: 'Loading the record',
    zh: '正在讀取紀錄',
    ko: '기록을 불러오는 중',
  },
  notFound: {
    ja: 'この記録は見つかりません。削除されたか、URL が違います。',
    en: 'This record was not found. It was deleted, or the URL is wrong.',
    zh: '找不到這份紀錄。可能已被刪除，或網址有誤。',
    ko: '이 기록을 찾을 수 없습니다. 삭제되었거나 URL이 잘못되었습니다.',
  },
  loadFailed: {
    ja: '読み込めませんでした。',
    en: "Couldn't load the record.",
    zh: '無法讀取。',
    ko: '불러오지 못했습니다.',
  },
  retry: { ja: 'もう一度', en: 'Try again', zh: '再試一次', ko: '다시 시도' },
  deleteHeading: {
    ja: 'この記録を削除',
    en: 'Delete this record',
    zh: '刪除這份紀錄',
    ko: '이 기록 삭제',
  },
  deleteConfirm: {
    ja: '削除すると、この記録の URL は誰も開けなくなります。元に戻せません。共有先に表示されたカードは残ることがあります。',
    en: 'Once deleted, no one can open this record’s URL. This cannot be undone. Cards already shown where you shared it may remain.',
    zh: '刪除後，任何人都無法開啟這份紀錄的網址。無法復原。已分享處顯示的卡片可能會留下。',
    ko: '삭제하면 이 기록의 URL은 누구도 열 수 없습니다. 되돌릴 수 없습니다. 공유한 곳에 표시된 카드는 남을 수 있습니다.',
  },
  deleteAction: { ja: '削除する', en: 'Delete', zh: '刪除', ko: '삭제' },
  deleteCancel: { ja: 'やめる', en: 'Cancel', zh: '取消', ko: '취소' },
  deleted: { ja: '削除しました。', en: 'Deleted.', zh: '已刪除。', ko: '삭제했습니다.' },
  deleteForbidden: {
    ja: 'この端末の鍵では削除できません。',
    en: "This device's key can't delete this record.",
    zh: '這台裝置的金鑰無法刪除。',
    ko: '이 기기의 키로는 삭제할 수 없습니다.',
  },
  deleteOffline: {
    ja: 'つながりません。もう一度お試しください。',
    en: "Can't connect. Please try again.",
    zh: '無法連線。請再試一次。',
    ko: '연결할 수 없습니다. 다시 시도해 주세요.',
  },
  deleteFailed: {
    ja: '削除できませんでした。もう一度お試しください。',
    en: "Couldn't delete. Please try again.",
    zh: '無法刪除。請再試一次。',
    ko: '삭제하지 못했습니다. 다시 시도해 주세요.',
  },
  deleteOtherDevice: {
    ja: '削除は、この旅をつくった端末（同じブラウザ）からできます。',
    en: 'You can delete it from the device (same browser) that planned this trip.',
    zh: '可以從規劃這趟旅程的裝置（同一個瀏覽器）刪除。',
    ko: '이 여행을 만든 기기(같은 브라우저)에서 삭제할 수 있습니다.',
  },
} satisfies Record<string, UiText>

export type RecordTextKey = keyof typeof RECORD_TEXT

/** 文言を言語で引き、`{name}` を埋める */
export function recordText(
  key: RecordTextKey,
  lang: Lang,
  values: Record<string, string | number> = {},
): string {
  return RECORD_TEXT[key][lang].replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in values ? String(values[name]) : whole,
  )
}
