import type { Lang } from '@antler/schema'

// スマホの横画面の文言（docs/specs/mobile-landscape/functional.md R2〜R4）。新しく足す文言なので最初から 4 言語。
// ローテーションの案内は主文＋残り 3 言語の副文（AlertState と同じ形）。

export const LANGS: readonly Lang[] = ['ja', 'en', 'zh', 'ko']

type Hint = readonly [key: string, label: string]

type MobileText = {
  rotate: { title: string; note: string }
  stick: { label: string; aria: string }
  brake: { label: string; aria: string }
  /** ジャイロの視線を使うかの切り替え（WCAG 2.5.4。出発の案内） */
  gyro: string
  /** 出発の案内の操作の説明（主のポインタが指の端末）。視線はジャイロ / ドラッグで変わる */
  hints: readonly Hint[]
  lookGyro: Hint
  lookDrag: Hint
}

export const MOBILE_TEXT: Record<Lang, MobileText> = {
  ja: {
    rotate: { title: '横にしてください', note: '運転はスマホを横にして使います' },
    stick: { label: 'ハンドル', aria: 'ハンドルとアクセル（ドラッグ）' },
    brake: { label: 'ブレーキ', aria: 'ブレーキ' },
    gyro: 'スマホの向きで視線を動かす',
    hints: [
      ['左の円', 'ドラッグでハンドルと加減速'],
      ['右の円', 'ブレーキ'],
    ],
    lookGyro: ['スマホの向き', '視線'],
    lookDrag: ['画面をドラッグ', '視線'],
  },
  en: {
    rotate: { title: 'Rotate your phone', note: 'Driving works in landscape' },
    stick: { label: 'Steer', aria: 'Steering and throttle (drag)' },
    brake: { label: 'Brake', aria: 'Brake' },
    gyro: 'Look around by tilting the phone',
    hints: [
      ['Left circle', 'Drag to steer, speed up, slow down'],
      ['Right circle', 'Brake'],
    ],
    lookGyro: ['Phone angle', 'Look around'],
    lookDrag: ['Drag the screen', 'Look around'],
  },
  zh: {
    rotate: { title: '請將手機橫放', note: '駕駛模擬需橫向使用' },
    stick: { label: '方向盤', aria: '方向盤與油門（拖曳）' },
    brake: { label: '煞車', aria: '煞車' },
    gyro: '以手機方向移動視線',
    hints: [
      ['左側圓圈', '拖曳以轉向與加減速'],
      ['右側圓圈', '煞車'],
    ],
    lookGyro: ['手機方向', '視線'],
    lookDrag: ['拖曳畫面', '視線'],
  },
  ko: {
    rotate: { title: '휴대폰을 가로로 돌려 주세요', note: '운전은 가로 화면에서 합니다' },
    stick: { label: '핸들', aria: '핸들과 가속(드래그)' },
    brake: { label: '브레이크', aria: '브레이크' },
    gyro: '휴대폰 방향으로 시선 움직이기',
    hints: [
      ['왼쪽 원', '드래그로 핸들과 가감속'],
      ['오른쪽 원', '브레이크'],
    ],
    lookGyro: ['휴대폰 방향', '시선'],
    lookDrag: ['화면 드래그', '시선'],
  },
}
