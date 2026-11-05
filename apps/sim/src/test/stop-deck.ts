// A-4 のテスト用: 束の POST の応答（api の形のまま。docs/specs/stop-events/functional.md「API エンドポイント」）。
// D2: 鶴居でタンチョウ（重さ 4）→ 阿寒湖。leave は昼、linger は薄暮、stay は通らない。

export const STOP_TRIP_ID = 'K7m2abcd'
export const STOP_OWNER_TOKEN = 'a1b2c3d4'.repeat(8)

const ROAD = { ja: '国道240号', en: 'Route 240', zh: '240號國道', ko: '국도 240호' }
const L = (ja: string, en: string, zh: string, ko: string) => ({ ja, en, zh, ko })

export function stopDeckBody() {
  return {
    deck: {
      tripId: STOP_TRIP_ID,
      day: 2,
      date: '2027-02-15',
      dayBudgetJPY: 96000,
      data: { routes: '2026-11-03', zones: 'abc' },
      scenes: [
        {
          id: 'p-red-crowned-crane',
          kind: 'pleasure',
          trigger: { kind: 'stop', beforeLeg: 1 },
          at: '2027-02-15T10:56+09:00',
          pleasure: { id: 'red-crowned-crane', weight: 4, base: 'tsurui' },
          stayMin: 42,
          spentJPY: 0,
          arrive: { place: 'akan', at: '2027-02-15T16:50+09:00' },
          choices: [
            {
              id: 'leave',
              kind: 'leave',
              delayMin: 0,
              endsDay: false,
              stayAt: null,
              arrive: { place: 'akan', at: '2027-02-15T16:50+09:00' },
              zone: {
                entryAt: '2027-02-15T16:20+09:00',
                light: 'dusk',
                km: 38,
                roadName: ROAD,
                count: 1,
              },
              lost: { jpy: 0, weight: 0, pleasures: [], lateReturn: false },
            },
            {
              id: 'linger',
              kind: 'linger',
              delayMin: 60,
              endsDay: false,
              stayAt: null,
              arrive: { place: 'akan', at: '2027-02-15T17:50+09:00' },
              zone: {
                entryAt: '2027-02-15T17:20+09:00',
                light: 'night',
                km: 38,
                roadName: ROAD,
                count: 2,
              },
              lost: { jpy: 0, weight: 0, pleasures: [], lateReturn: false },
            },
            {
              id: 'stay',
              kind: 'stay',
              delayMin: 0,
              endsDay: true,
              stayAt: 'tsurui',
              arrive: null,
              zone: null,
              lost: { jpy: 96000, weight: 1, pleasures: ['lake-akan-onsen'], lateReturn: false },
            },
          ],
        },
        {
          id: 'r1-fuel',
          kind: 'fuel',
          trigger: { kind: 'road', leg: 1, km: 12.5 },
          at: '2027-02-15T15:10+09:00',
          pleasure: null,
          stayMin: null,
          spentJPY: null,
          arrive: { place: 'akan', at: '2027-02-15T16:50+09:00' },
          choices: [
            {
              id: 'refuel',
              kind: 'refuel',
              delayMin: 15,
              endsDay: false,
              stayAt: null,
              arrive: { place: 'akan', at: '2027-02-16T00:05+09:00' },
              zone: {
                entryAt: '2027-02-15T16:35+09:00',
                light: 'dusk',
                km: 38,
                roadName: ROAD,
                count: 1,
              },
              lost: { jpy: 0, weight: 0, pleasures: [], lateReturn: false },
            },
            {
              id: 'skip',
              kind: 'skip',
              delayMin: 0,
              endsDay: false,
              stayAt: null,
              arrive: { place: 'akan', at: '2027-02-15T16:50+09:00' },
              zone: {
                entryAt: '2027-02-15T16:20+09:00',
                light: 'dusk',
                km: 38,
                roadName: ROAD,
                count: 1,
              },
              lost: { jpy: 0, weight: 0, pleasures: [], lateReturn: true },
            },
          ],
        },
      ],
    },
    writing: {
      scenes: [
        {
          id: 'p-red-crowned-crane',
          headline: L(
            '群れがまだ残っていた。',
            'The flock was still there.',
            '鶴群還在。',
            '무리가 아직 남아 있었다.',
          ),
          body: L(
            '給餌場には四十羽ほど。友人が「来てよかった」と言った。',
            'About forty cranes at the feeding ground.',
            '餵食場約有四十隻。',
            '먹이터에는 사십 마리 정도.',
          ),
          choices: [
            {
              id: 'leave',
              label: L('いま出発する', 'Leave now', '現在出發', '지금 출발한다'),
              note: L(
                '明るいうちに走りたい',
                'Drive while there is light',
                '想趁天亮開車',
                '밝을 때 달리고 싶다',
              ),
            },
            {
              id: 'linger',
              label: L(
                'もう少し、鶴の飛び立ちを見る',
                'Watch the cranes take off',
                '再看鶴起飛',
                '두루미가 날아오르는 것을 본다',
              ),
              note: L('温泉の夕食に遅れる', 'Late for dinner', '晚餐會遲到', '저녁에 늦는다'),
            },
            {
              id: 'stay',
              label: L('釧路に戻って泊まる', 'Go back and stay', '回去住宿', '돌아가서 묵는다'),
              note: L('温泉はなくなる', 'No hot spring', '沒有溫泉', '온천은 없다'),
            },
          ],
        },
      ],
    },
  }
}
