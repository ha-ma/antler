import type { Lang } from '@antler/schema'

// 音量の操作の文言（docs/specs/drive-audio-chat/functional.md R14）。4 言語。
// 鹿の警告の音（alert-ui）とは別のつまみであることが分かる言い方にする。

type AudioText = {
  group: string
  mute: string
  volume: string
  music: string
}

export const AUDIO_TEXT: Record<Lang, AudioText> = {
  ja: {
    group: '運転の音（鹿の警告の音は別）',
    mute: '運転の音を消す',
    volume: '運転の音の大きさ',
    music: 'ラジオ',
  },
  en: {
    group: 'Driving sounds (deer alerts are separate)',
    mute: 'Mute driving sounds',
    volume: 'Driving sound volume',
    music: 'Radio',
  },
  zh: {
    group: '駕駛音效（鹿警示音另計）',
    mute: '關閉駕駛音效',
    volume: '駕駛音效音量',
    music: '電台',
  },
  ko: {
    group: '주행 소리(사슴 경고음은 별도)',
    mute: '주행 소리 끄기',
    volume: '주행 소리 크기',
    music: '라디오',
  },
}
