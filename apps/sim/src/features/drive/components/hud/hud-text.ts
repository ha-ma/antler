import type { Lang } from '@antler/schema'
import type { Surface, Weather } from '../../types'

// HUD の文言（4 言語。zh は繁体字。docs/specs/i18n/functional.md R5）。言語は旅の TripPlan.lang（snapshot.lang）。
// 旅を読み込む前はブラウザの言語（initialLang）。キーの名前（W・S・A / D・Space）と単位は言語に依存しない。
// `{name}` の差し込みは fillHud で埋める。zh・ko はネイティブ確認が保留（docs/reports/2026-11-06-i18n-native-check.md）。

export type HudText = {
  start: { title: string; lead: string; alertOn: string; alertOff: string; go: string }
  /** 操作の説明（キーの名前と、その働き） */
  controls: readonly (readonly [string, string])[]
  zone: { nextZone: string; arrival: string; noNextZone: string; inZone: string; danger: string }
  time: { sunset: string; driving: string }
  playback: { label: string; pause: string; resume: string; locked: string }
  sound: { on: string; off: string; label: string }
  end: {
    collided: string
    collidedNote: string
    completed: string
    completedNote: string
    retry: string
  }
  route: { label: string; destination: string; arrival: string; stage: string; today: string }
  /** cleared は `{n}`（クリアしたステージ）と `{of}`（全部の数）を差し込む */
  stage: { cleared: string; noZone: string }
  trip: {
    loading: string
    notFound: string
    dayNotFound: string
    changed: string
    rateLimited: string
    failed: string
    noMove: string
    retry: string
    toPlan: string
    toBrief: string
    toFirstDay: string
    distance: string
  }
  /** 天候・路面・運転時間のチップの並びの名前（支援技術向け） */
  conditions: string
  speedUnit: string
  noWebgl: string
}

const KEYS = ['W', 'S', 'A / D', 'Space'] as const

function controls(
  labels: readonly [string, string, string, string, string],
  mouse: string,
): HudText['controls'] {
  return [...KEYS.map((key, i) => [key, labels[i] ?? ''] as const), [mouse, labels[4]] as const]
}

export const HUD_TEXT: Record<Lang, HudText> = {
  ja: {
    start: {
      title: '国道 240 号 釧路 → 阿寒',
      lead: '実在の鹿ゾーン（北海道開発局の資料から作成）を、2 月の夕方に走ります。',
      alertOn: '鹿アラート ON: 鹿ゾーンで琥珀とチャイム、カメラが鹿を見つけたら赤とビープ',
      alertOff: '鹿アラート OFF: スマホのアラートと音は出ません。鹿ゾーンの表示だけ残ります',
      go: '出発（音を出します）',
    },
    controls: controls(['加速', '減速・後退', 'ハンドル', 'ブレーキ', '視線'], 'マウス'),
    zone: {
      nextZone: '次の鹿ゾーンまで',
      arrival: '到達',
      noNextZone: 'この先に鹿ゾーンはありません',
      inZone: '鹿ゾーン走行中 残り',
      danger: '前方に鹿',
    },
    time: { sunset: '日没', driving: '運転' },
    playback: {
      label: '再生速度',
      pause: '一時停止',
      resume: '再開',
      locked: '鹿ゾーンの中は 1× だけ',
    },
    sound: { on: '音 ON', off: '音 OFF', label: '音' },
    end: {
      collided: '鹿と衝突しました',
      collidedNote: '旅の場面なら、このあと喪失の画面（A-6）に移ります。',
      completed: '完走しました',
      completedNote: '旅の場面なら、このあと旅の記録（A-7）に移ります。',
      retry: '同じシードでもう一度',
    },
    route: {
      label: 'いまの区間',
      destination: '目的地まで',
      arrival: '到着予定',
      stage: 'ステージ',
      today: '今日の楽しみ',
    },
    stage: {
      cleared: 'ステージ {n} / {of} クリア',
      noZone: 'この日は鹿ゾーンを通りません。「出発」でこの日の運転を終えます。',
    },
    trip: {
      loading: '旅を読み込んでいます',
      notFound: '旅が見つかりません',
      dayNotFound: 'その日はありません',
      changed: 'この旅は古い形式です。旅をつくり直してください',
      rateLimited: '少し待ってからもう一度',
      failed: '読み込めませんでした',
      noMove: 'この日は移動がありません',
      retry: 'もう一度',
      toPlan: '旅をつくる（A-1）へ',
      toBrief: 'ブリーフィングに戻る',
      toFirstDay: '1 日目のブリーフィングへ',
      distance: '距離',
    },
    conditions: '条件',
    speedUnit: 'km/h',
    noWebgl:
      'このブラウザでは 3D を表示できません（WebGL2 が必要です）。最新の Chrome・Safari・Edge・Firefox で開いてください。',
  },
  en: {
    start: {
      title: 'Route 240, Kushiro → Akan',
      lead: 'Drive real deer zones (from Hokkaido Regional Development Bureau data) on a February evening.',
      alertOn:
        'Deer alert ON: amber and a chime in deer zones; red and beeps when the camera spots a deer',
      alertOff:
        'Deer alert OFF: no phone alerts or sounds. Only the deer zone display stays on screen',
      go: 'Start (sound on)',
    },
    controls: controls(['Accelerate', 'Slow down / reverse', 'Steer', 'Brake', 'Look'], 'Mouse'),
    zone: {
      nextZone: 'Next deer zone in',
      arrival: 'arrive',
      noNextZone: 'No more deer zones ahead',
      inZone: 'In deer zone, remaining',
      danger: 'Deer ahead',
    },
    time: { sunset: 'Sunset', driving: 'Driving' },
    playback: {
      label: 'Playback speed',
      pause: 'Pause',
      resume: 'Resume',
      locked: '1× only inside deer zones',
    },
    sound: { on: 'Sound ON', off: 'Sound OFF', label: 'Sound' },
    end: {
      collided: 'You hit a deer',
      collidedNote: 'On a trip, the loss screen (A-6) comes next.',
      completed: 'You made it',
      completedNote: 'On a trip, the trip record (A-7) comes next.',
      retry: 'Try again with the same seed',
    },
    route: {
      label: 'Current leg',
      destination: 'To destination',
      arrival: 'ETA',
      stage: 'Stage',
      today: "Today's highlights",
    },
    stage: {
      cleared: 'Stage {n} / {of} cleared',
      noZone: 'No deer zones on this day. Press "Start" to finish the day’s drive.',
    },
    trip: {
      loading: 'Loading your trip',
      notFound: 'Trip not found',
      dayNotFound: 'That day does not exist',
      changed: 'This trip uses an old format. Please plan it again',
      rateLimited: 'Please wait a moment and try again',
      failed: 'Could not load',
      noMove: 'No driving on this day',
      retry: 'Try again',
      toPlan: 'Plan a trip (A-1)',
      toBrief: 'Back to the briefing',
      toFirstDay: 'Go to the Day 1 briefing',
      distance: 'Distance',
    },
    conditions: 'Conditions',
    speedUnit: 'km/h',
    noWebgl:
      'This browser cannot show 3D (WebGL2 is required). Please open it in the latest Chrome, Safari, Edge or Firefox.',
  },
  zh: {
    start: {
      title: '國道 240 號 釧路 → 阿寒',
      lead: '在 2 月的傍晚，行駛真實的鹿出沒區（依北海道開發局資料製作）。',
      alertOn: '鹿警示 開啟：進入鹿出沒區時顯示琥珀色並響起提示音，鏡頭發現鹿時顯示紅色並發出嗶聲',
      alertOff: '鹿警示 關閉：手機不會顯示警示也不會發出聲音，只保留鹿出沒區的顯示',
      go: '出發（會播放聲音）',
    },
    controls: controls(['加速', '減速・倒車', '方向盤', '煞車', '視線'], '滑鼠'),
    zone: {
      nextZone: '距下一個鹿出沒區',
      arrival: '抵達',
      noNextZone: '前方沒有鹿出沒區',
      inZone: '行駛於鹿出沒區 剩餘',
      danger: '前方有鹿',
    },
    time: { sunset: '日落', driving: '駕駛' },
    playback: {
      label: '播放速度',
      pause: '暫停',
      resume: '繼續',
      locked: '鹿出沒區內只能 1×',
    },
    sound: { on: '聲音 開', off: '聲音 關', label: '聲音' },
    end: {
      collided: '撞到鹿了',
      collidedNote: '若是旅程中的駕駛，接下來會進入損失畫面（A-6）。',
      completed: '平安抵達',
      completedNote: '若是旅程中的駕駛，接下來會進入旅程紀錄（A-7）。',
      retry: '用同一個種子再試一次',
    },
    route: {
      label: '目前路段',
      destination: '距目的地',
      arrival: '預計抵達',
      stage: '關卡',
      today: '今天的期待',
    },
    stage: {
      cleared: '關卡 {n} / {of} 通過',
      noZone: '這一天不會經過鹿出沒區。按「出發」即結束這一天的駕駛。',
    },
    trip: {
      loading: '正在讀取旅程',
      notFound: '找不到旅程',
      dayNotFound: '沒有這一天',
      changed: '這個旅程是舊格式，請重新規劃旅程',
      rateLimited: '請稍候再試一次',
      failed: '無法讀取',
      noMove: '這一天沒有移動',
      retry: '再試一次',
      toPlan: '前往規劃旅程（A-1）',
      toBrief: '回到行前簡報',
      toFirstDay: '前往第 1 天的行前簡報',
      distance: '距離',
    },
    conditions: '路況條件',
    speedUnit: 'km/h',
    noWebgl:
      '這個瀏覽器無法顯示 3D（需要 WebGL2）。請使用最新版的 Chrome、Safari、Edge 或 Firefox 開啟。',
  },
  ko: {
    start: {
      title: '국도 240호 구시로 → 아칸',
      lead: '실제 사슴 구역(홋카이도 개발국 자료로 작성)을 2월 저녁에 달립니다.',
      alertOn:
        '사슴 알림 ON: 사슴 구역에서는 호박색과 차임, 카메라가 사슴을 찾으면 빨간색과 경고음',
      alertOff: '사슴 알림 OFF: 스마트폰 알림과 소리가 나지 않습니다. 사슴 구역 표시만 남습니다',
      go: '출발 (소리가 납니다)',
    },
    controls: controls(['가속', '감속·후진', '핸들', '브레이크', '시선'], '마우스'),
    zone: {
      nextZone: '다음 사슴 구역까지',
      arrival: '도착',
      noNextZone: '앞으로 사슴 구역이 없습니다',
      inZone: '사슴 구역 주행 중 남은 거리',
      danger: '전방에 사슴',
    },
    time: { sunset: '일몰', driving: '운전' },
    playback: {
      label: '재생 속도',
      pause: '일시 정지',
      resume: '재개',
      locked: '사슴 구역 안에서는 1×만',
    },
    sound: { on: '소리 ON', off: '소리 OFF', label: '소리' },
    end: {
      collided: '사슴과 충돌했습니다',
      collidedNote: '여행 중이라면 이어서 상실 화면(A-6)으로 넘어갑니다.',
      completed: '완주했습니다',
      completedNote: '여행 중이라면 이어서 여행 기록(A-7)으로 넘어갑니다.',
      retry: '같은 시드로 다시 하기',
    },
    route: {
      label: '현재 구간',
      destination: '목적지까지',
      arrival: '도착 예정',
      stage: '스테이지',
      today: '오늘의 즐길 거리',
    },
    stage: {
      cleared: '스테이지 {n} / {of} 클리어',
      noZone: '이날은 사슴 구역을 지나지 않습니다. "출발"을 누르면 이날의 운전을 마칩니다.',
    },
    trip: {
      loading: '여행을 불러오는 중입니다',
      notFound: '여행을 찾을 수 없습니다',
      dayNotFound: '그날은 없습니다',
      changed: '이 여행은 예전 형식입니다. 여행을 다시 만들어 주세요',
      rateLimited: '잠시 후 다시 시도해 주세요',
      failed: '불러오지 못했습니다',
      noMove: '이날은 이동이 없습니다',
      retry: '다시 시도',
      toPlan: '여행 만들기(A-1)로',
      toBrief: '브리핑으로 돌아가기',
      toFirstDay: '1일차 브리핑으로',
      distance: '거리',
    },
    conditions: '조건',
    speedUnit: 'km/h',
    noWebgl:
      '이 브라우저에서는 3D를 표시할 수 없습니다(WebGL2 필요). 최신 Chrome, Safari, Edge, Firefox에서 열어 주세요.',
  },
}

export function hudText(lang: Lang): HudText {
  return HUD_TEXT[lang]
}

/** `{name}` を埋める（無い名前はそのまま残す） */
export function fillHud(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, name: string) =>
    name in values ? String(values[name]) : m,
  )
}

export const WEATHER_TEXT: Record<Lang, Record<Weather, string>> = {
  ja: { clear: '晴れ', cloudy: '曇り', rain: '雨', snow: '雪', fog: '霧' },
  en: { clear: 'Clear', cloudy: 'Cloudy', rain: 'Rain', snow: 'Snow', fog: 'Fog' },
  zh: { clear: '晴', cloudy: '陰', rain: '雨', snow: '雪', fog: '霧' },
  ko: { clear: '맑음', cloudy: '흐림', rain: '비', snow: '눈', fog: '안개' },
}

export const SURFACE_TEXT: Record<Lang, Record<Surface, string>> = {
  ja: { dry: '乾燥', wet: '湿潤', 'packed-snow': '圧雪', ice: '凍結' },
  en: { dry: 'Dry', wet: 'Wet', 'packed-snow': 'Packed snow', ice: 'Icy' },
  zh: { dry: '乾燥', wet: '濕滑', 'packed-snow': '壓實積雪', ice: '結冰' },
  ko: { dry: '건조', wet: '젖음', 'packed-snow': '압설', ice: '결빙' },
}

/** 赤のバナーの左右（4 言語） */
export const SIDE_TEXT: Record<Lang, { L: string; R: string }> = {
  ja: { L: '左', R: '右' },
  en: { L: 'LEFT', R: 'RIGHT' },
  zh: { L: '左側', R: '右側' },
  ko: { L: '왼쪽', R: '오른쪽' },
}
