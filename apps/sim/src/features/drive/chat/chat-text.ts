import type { LocalizedLine, ReactionKind, RoadTopic, Speaker } from './chat-types'

// 会話の固定の文言（docs/specs/drive-audio-chat/functional.md R10・R13・R19）。人が書いた 4 言語の文。zh は繁体字。
// - 反応の 6 行（ゾーンに入った・出た・避けた）は、api の会話のときもここから出す（Claude に書かせない）
// - 見本の会話（旅の無い運転・トークンの無い端末・api の失敗）の話の行
// 数字・絵文字・鹿の語を書かない（鹿を見つけた・いると言うのは赤の警告の役割）。運転の指図や長い問いかけをしない。

export const SPEAKER_LABEL: Record<Speaker, LocalizedLine> = {
  p1: { ja: '助手席', en: 'Front passenger', zh: '副駕駛座', ko: '조수석' },
  p2: { ja: '後部座席・左', en: 'Back seat, left', zh: '後座左側', ko: '뒷좌석 왼쪽' },
  p3: { ja: '後部座席・右', en: 'Back seat, right', zh: '後座右側', ko: '뒷좌석 오른쪽' },
  radio: { ja: 'ラジオ', en: 'Radio', zh: '電台', ko: '라디오' },
}

export const FEED_LABEL: LocalizedLine = {
  ja: '車内の会話',
  en: 'In-car conversation',
  zh: '車內對話',
  ko: '차 안의 대화',
}

/** 反応の表（種類ごとに 2 行。n 回目は添字 (n − 1) mod 2） */
export const REACTION_TEXT: Record<ReactionKind, readonly [LocalizedLine, LocalizedLine]> = {
  'zone-enter': [
    {
      ja: 'ここから注意の区間だね。前をよく見ていこう',
      en: 'This is the caution stretch. Eyes on the road.',
      zh: '進入要注意的路段了，專心看前面吧',
      ko: '여기부터 주의 구간이네. 앞을 잘 보자',
    },
    {
      ja: 'また注意の区間に入ったよ。話すのは少し休もう',
      en: 'Another caution stretch. Let us keep it quiet for a bit.',
      zh: '又到注意路段了，我們先少聊一點',
      ko: '또 주의 구간이야. 잠깐 조용히 가자',
    },
  ],
  'zone-exit': [
    {
      ja: '注意の区間を抜けたね。おつかれさま',
      en: 'We are out of the caution stretch. Nice driving.',
      zh: '離開注意路段了，辛苦了',
      ko: '주의 구간을 빠져나왔네. 수고했어',
    },
    {
      ja: '抜けた抜けた。肩の力を抜いていこう',
      en: 'Through it. Time to relax your shoulders.',
      zh: '過了過了，放鬆一下肩膀吧',
      ko: '지나왔다. 어깨 힘 좀 빼자',
    },
  ],
  avoided: [
    {
      ja: 'いまの、止まれてよかった……',
      en: 'Phew, good thing we stopped in time.',
      zh: '剛剛好險，還好停住了',
      ko: '방금 멈춰서 다행이다……',
    },
    {
      ja: 'びっくりした。ゆっくりでいいからね',
      en: 'That was a scare. No need to hurry.',
      zh: '嚇一跳，慢慢開就好',
      ko: '깜짝 놀랐네. 천천히 가도 돼',
    },
  ],
}

/** 見本の会話の話の行（話題ごとに 2 行。pleasure は旅の楽しみの名前が要るので見本では使わない） */
export const FALLBACK_TEXT: Record<
  Exclude<RoadTopic, 'pleasure'>,
  readonly [LocalizedLine, LocalizedLine]
> = {
  depart: [
    {
      ja: 'さあ、出発だね。今日もよろしく',
      en: 'Here we go. Thanks for driving today.',
      zh: '出發囉，今天也麻煩你了',
      ko: '자, 출발이다. 오늘도 잘 부탁해',
    },
    {
      ja: '次の町へ行こう。忘れ物はないよね',
      en: 'On to the next town. Got everything?',
      zh: '往下一個城鎮出發，東西都帶了吧',
      ko: '다음 마을로 가자. 빠뜨린 건 없지',
    },
  ],
  weather: [
    {
      ja: '空気が冷たいね。窓の外が白く光ってる',
      en: 'The air is crisp. Everything outside is glowing white.',
      zh: '空氣好冷，窗外白白亮亮的',
      ko: '공기가 차갑네. 창밖이 하얗게 빛나',
    },
    {
      ja: '雲が流れてきたね。天気が変わるかも',
      en: 'Clouds are rolling in. The weather might change.',
      zh: '雲飄過來了，天氣可能會變',
      ko: '구름이 몰려오네. 날씨가 바뀔지도 몰라',
    },
  ],
  light: [
    {
      ja: '空の色がきれい。写真を撮りたくなるね',
      en: 'Look at the color of the sky. I want a photo.',
      zh: '天空的顏色好美，好想拍照',
      ko: '하늘 색이 예쁘다. 사진 찍고 싶어',
    },
    {
      ja: '日が傾いてきたね。早めにライトをつけよう',
      en: 'The sun is getting low. Lights on soon.',
      zh: '太陽開始西斜了，早點開燈吧',
      ko: '해가 기울기 시작했어. 일찍 라이트 켜자',
    },
  ],
  scenery: [
    {
      ja: '見て、遠くの山まで真っ白だよ',
      en: 'Look, the mountains are white all the way out.',
      zh: '你看，遠處的山都是白色的',
      ko: '봐, 저 멀리 산까지 새하얘',
    },
    {
      ja: 'この道、ずっと森の中だね。静かでいい',
      en: 'This road is all forest. So peaceful.',
      zh: '這條路一直在森林裡，好安靜',
      ko: '이 길은 계속 숲속이네. 조용해서 좋다',
    },
  ],
  snack: [
    {
      ja: 'おやつあるよ。止まったときに食べよう',
      en: 'I have snacks. Let us eat when we stop.',
      zh: '有零食喔，停車的時候再吃吧',
      ko: '간식 있어. 멈추면 먹자',
    },
    {
      ja: '次に止まったら温かい飲み物がほしいな',
      en: 'A warm drink at the next stop would be nice.',
      zh: '下次停車想喝點熱的',
      ko: '다음에 멈추면 따뜻한 음료 마시고 싶다',
    },
  ],
  music: [
    {
      ja: 'このラジオの曲、ちょっといいね',
      en: 'This song on the radio is kind of nice.',
      zh: '電台這首歌還不錯耶',
      ko: '라디오 이 노래 좀 좋다',
    },
    {
      ja: '旅の歌って感じがする。少し音を上げる？',
      en: 'Feels like a road trip song. Turn it up a bit?',
      zh: '很有旅行的感覺，要不要開大聲一點',
      ko: '여행 노래 같아. 소리 좀 키울까',
    },
  ],
}
