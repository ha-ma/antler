import type { LightPeriod } from '@antler/zones'
import type { Surface, Weather } from '../types'
import type { SceneSeason } from '../domain/season'

// 3D シーンの配色（ここだけに色を書く。CLAUDE.md・ch8 規約 1）。ch9 ②: ローポリ＋フラット基調、鹿とヘッドライトだけ PBR。
// tokens.json の値を使えるところは使う（night の空 = map-land night、ブランドの spruce など）。
// alert-danger の赤はシーンに使わない（検知専用。画面の赤はメインの HUD と AlertState が出す）。

/** tokens.json から借りる値（同じ値を書き写す。シーンの中でだけ使う） */
const TOKEN = {
  groundNight: '#0E1512',
  mapLandNight: '#1B2538',
  mapWaterNight: '#2A3448',
  spruceNight: '#3FA98C',
  inkNight: '#F2F5F1',
  inkFaintNight: '#7A8C84',
  inkMutedNight: '#B9C6BF',
  lineNight: '#2C3C34',
  clayNight: '#F0A26B',
} as const

/** 地形・道路（Lambert のフラット） */
export const TERRAIN = {
  /** 雪原 */
  snowField: '#E4EAF0',
  /** 除雪の雪の壁 */
  snowBank: '#D5DEE8',
  /** 路肩（踏まれた雪） */
  shoulder: '#B9C2CC',
  /** 圧雪の路面（轍で少し暗い） */
  road: '#8E98A3',
  roadDry: '#4E5359',
  roadWet: '#3A4148',
  roadIce: '#A7B4C1',
  /** 外側線（白） */
  edgeLine: '#F4F6F8',
  /** 中央線（黄。はみ出し禁止） */
  centerLine: '#E3B23C',
  /** 矢羽根（固定式視線誘導柱）の赤と白、支柱 */
  arrowRed: '#B8323A',
  arrowWhite: '#F4F4F2',
  pole: '#5B6066',
} as const

/**
 * 季節ごとの地面・路肩・法面（drive-season R3・UC-3b）。法面の形（layout の BANK_*）は季節で変えない。
 * bankSnow: 法面が雪の壁か（冬と雪どけ。雪どけは汚れた残雪）。ほかは草の法面
 */
export type SeasonLook = {
  ground: string
  shoulder: string
  bank: string
  bankSnow: boolean
  /** 針葉樹の先に雪が載るか（冬だけ） */
  coniferSnow: boolean
  /** 広葉樹の葉（緑・紅葉・なし） */
  leaves: 'none' | 'green' | 'autumn'
}

export const SEASON: Record<SceneSeason, SeasonLook> = {
  winter: {
    ground: TERRAIN.snowField,
    shoulder: TERRAIN.shoulder,
    bank: TERRAIN.snowBank,
    bankSnow: true,
    coniferSnow: true,
    leaves: 'none',
  },
  // 4 月: 枯れ草が出て、路肩の外に砂で汚れた残雪の壁が残る
  thaw: {
    ground: '#7C775B',
    shoulder: '#8C877C',
    bank: '#B4B0A4',
    bankSnow: true,
    coniferSnow: false,
    leaves: 'none',
  },
  green: {
    ground: '#5A7A3D',
    shoulder: '#8A877F',
    bank: '#4C6E35',
    bankSnow: false,
    coniferSnow: false,
    leaves: 'green',
  },
  // 10 月: 黄土色の草
  autumn: {
    ground: '#8A7F4E',
    shoulder: '#8B887E',
    bank: '#7C7344',
    bankSnow: false,
    coniferSnow: false,
    leaves: 'autumn',
  },
  // 11 月: 枯れ草、葉の無い木
  'late-autumn': {
    ground: '#75705A',
    shoulder: '#87837A',
    bank: '#6A654F',
    bankSnow: false,
    coniferSnow: false,
    leaves: 'none',
  },
}

/**
 * 路面ごとの車道（drive-season R3・UC-3c）。材質は 1 つ（MeshPhong）で、shininess・specular・skyReflect だけを
 * 路面で変える。rut: 圧雪の轍の帯の色（無い路面は null）。lineFade: 中央線・外側線を路面の色へ寄せる割合（0 はくっきり）。
 * skyReflect: 浅い角度で空（フォグの色）を映す強さ（0〜1。フレネルの近似。車道だけで、路肩・法面は映さない）
 */
export type SurfaceLook = {
  road: string
  rut: string | null
  lineFade: number
  shininess: number
  specular: string
  skyReflect: number
}

export const SURFACE: Record<Surface, SurfaceLook> = {
  dry: {
    road: TERRAIN.roadDry,
    rut: null,
    lineFade: 0,
    shininess: 6,
    specular: '#141618',
    skyReflect: 0,
  },
  // 濡れ: 暗く、ヘッドライトと空を照り返す
  wet: {
    road: '#30363C',
    rut: null,
    lineFade: 0.12,
    shininess: 70,
    specular: '#7C858F',
    skyReflect: 0.6,
  },
  // 圧雪: 白っぽく、車輪の通る所が踏み固められて灰色の轍になる。線は雪の下でかすれる
  'packed-snow': {
    road: '#AAB2BB',
    rut: '#7D8690',
    lineFade: 0.72,
    shininess: 5,
    specular: '#1E2226',
    skyReflect: 0,
  },
  // 凍結: 青白く、強く照り返す
  ice: {
    road: '#B2C4D4',
    rut: null,
    lineFade: 0.4,
    shininess: 110,
    specular: '#C4D6E8',
    skyReflect: 0.5,
  },
}

/** 木（Lambert のフラット。頂点色） */
export const TREE = {
  /** トドマツ・エゾマツの葉（下の段から上へ明るく、先に雪） */
  conifer: '#1F3A30',
  coniferLight: '#2E5243',
  coniferSnow: '#DCE5EC',
  coniferTrunk: '#3B2E26',
  /** 葉の落ちた広葉樹（ミズナラ）とシラカバ */
  bareTrunk: '#5E554D',
  birchTrunk: '#D9D6CE',
  twig: '#4A433D',
  /** 広葉樹の葉（UC-3d）。緑はミズナラが濃く、シラカバが明るい。紅葉はミズナラが橙、シラカバが黄 */
  leafOak: '#47692F',
  leafOakLight: '#5C833B',
  leafBirch: '#6C9744',
  leafBirchLight: '#86AE52',
  autumnOak: '#BC5F28',
  autumnOakLight: '#CC7A2F',
  autumnBirch: '#CFA02A',
  autumnBirchLight: '#DDB43E',
} as const

/**
 * 降るもの（UC-3e）。粒は光を受けない（Basic）ので、光の区分ごとの明るさを掛けて夜に白く光りすぎないようにする
 */
export const PRECIP = {
  snow: '#F2F5F8',
  rain: '#A6B4C2',
  snowOpacity: 0.9,
  rainOpacity: 0.42,
} as const

export const PRECIP_BRIGHTNESS: Record<LightPeriod, number> = {
  day: 1,
  dawn: 0.75,
  dusk: 0.7,
  night: 0.5,
}

/** 鹿（MeshStandardMaterial の PBR。エゾシカの冬毛は灰褐色、臀に黒く縁取った白斑） */
export const DEER = {
  coat: '#5F5348',
  coatDark: '#463C34',
  belly: '#8A7D6F',
  rumpWhite: '#F1EEE8',
  rumpRim: '#1E1A17',
  hoof: '#1B1714',
  antler: '#BFAF96',
  nose: '#1A1715',
  /** 目の反射（タペータム。黄緑がかった白） */
  eyeshine: '#E9F7C8',
  /** 足元の影 */
  blob: '#000000',
} as const

/** 車内（Lambert のフラット。夜でも形が分かるように少し自発光） */
export const CABIN = {
  dash: '#4A5458',
  dashTop: '#353D41',
  trim: '#565F64',
  pillar: '#30373B',
  hood: '#3C4C58',
  /** ハンドルはダッシュボードより暗く（輪郭で見分ける） */
  wheel: '#121516',
  meterFace: '#0C0F10',
  /** 針は白（琥珀・赤は 3 状態の色なので計器に使わない） */
  meterNeedle: TOKEN.inkNight,
  /** 針の軸の蓋 */
  meterHub: '#1E2426',
  navFrame: '#101314',
  navScreen: TOKEN.mapLandNight,
  navRoute: TOKEN.spruceNight,
  navWater: TOKEN.mapWaterNight,
  navCar: TOKEN.inkNight,
  /** 車内の自発光（暗い時間に真っ黒にならないための下駄） */
  ambientGlow: '#2A3330',
} as const

/**
 * メーター（drive-tune R5）の canvas に描く色。夜の計器のように暗い板に明るい文字。
 * ABS の灯は clay（注意。night の明るい方）。琥珀（alert-zone）と赤（alert-danger）は 3 状態の色なので計器に使わない
 */
export const CLUSTER = {
  face: CABIN.meterFace,
  /** 文字盤の輪と区切り線 */
  ring: TOKEN.lineNight,
  tick: TOKEN.inkFaintNight,
  label: TOKEN.inkMutedNight,
  text: TOKEN.inkNight,
  /** 回転計の上の方（シフトアップの手前）の目盛り */
  tickHigh: TOKEN.clayNight,
  absOn: TOKEN.clayNight,
  /** 消えている灯の縁 */
  absOff: TOKEN.lineNight,
  onAbs: TOKEN.groundNight,
  /** ナビの案内の帯 */
  navBand: TOKEN.mapLandNight,
  navText: TOKEN.inkNight,
} as const

/** ヘッドライト（PBR の光） */
export const HEADLIGHT = {
  color: '#F3F1E6',
} as const

/** 光の区分（world.light）ごとの空・フォグ・環境光 */
export type SkyLook = {
  zenith: string
  horizon: string
  fog: string
  /** フォグの始まりと終わり（m）。描画の窓より短くして、道路と林の端を隠す */
  fogNear: number
  fogFar: number
  hemiSky: string
  hemiGround: string
  hemiIntensity: number
  sun: string
  sunIntensity: number
  /** 太陽（月）の向き（高さ、rad） */
  sunElevation: number
  /** ヘッドライトの強さ（0〜1。昼は点けない） */
  headlight: number
  /** 車内の自発光の強さ */
  cabinGlow: number
}

export const SKY: Record<LightPeriod, SkyLook> = {
  day: {
    zenith: '#8FB0CF',
    horizon: '#DDE5EC',
    fog: '#D6DEE6',
    fogNear: 80,
    fogFar: 650,
    hemiSky: '#E6EEF5',
    hemiGround: '#AEB7C0',
    hemiIntensity: 1.6,
    sun: '#FFF4E0',
    sunIntensity: 1.4,
    sunElevation: 0.45,
    headlight: 0,
    cabinGlow: 0.1,
  },
  dawn: {
    zenith: '#34405E',
    horizon: '#A9A2AE',
    fog: '#8A8E9E',
    fogNear: 40,
    fogFar: 480,
    hemiSky: '#9AA6C2',
    hemiGround: '#5A6070',
    hemiIntensity: 0.9,
    sun: '#F2C9A0',
    sunIntensity: 0.25,
    sunElevation: 0.05,
    headlight: 0.8,
    cabinGlow: 0.55,
  },
  dusk: {
    zenith: '#28324E',
    horizon: '#8F8794',
    fog: '#6E7286',
    fogNear: 30,
    fogFar: 420,
    hemiSky: '#8590B0',
    hemiGround: '#4A4F5E',
    hemiIntensity: 0.75,
    sun: '#E8A880',
    sunIntensity: 0.15,
    sunElevation: 0.03,
    headlight: 1,
    cabinGlow: 0.65,
  },
  night: {
    zenith: '#0A0F1C',
    horizon: TOKEN.mapLandNight,
    fog: TOKEN.mapLandNight,
    fogNear: 15,
    fogFar: 300,
    hemiSky: '#3A4766',
    hemiGround: TOKEN.groundNight,
    hemiIntensity: 0.35,
    sun: '#AFC0E0',
    sunIntensity: 0.08,
    sunElevation: 0.6,
    headlight: 1,
    cabinGlow: 0.6,
  },
}

/** 天候でフォグを詰める係数（far・near に掛ける） */
export const WEATHER_FOG: Record<Weather, number> = {
  clear: 1,
  cloudy: 0.9,
  rain: 0.7,
  snow: 0.55,
  fog: 0.3,
}

/** 雲に覆われた空の灰色（光の区分ごと）。曇り・雨・雪・霧の空はこれへ寄せる（UC-3f） */
export const OVERCAST: Record<LightPeriod, { zenith: string; horizon: string }> = {
  day: { zenith: '#9DA5AD', horizon: '#C4C9CE' },
  dawn: { zenith: '#474B55', horizon: '#83858C' },
  dusk: { zenith: '#3A3E48', horizon: '#73767E' },
  night: { zenith: '#101318', horizon: '#1E222A' },
}

/**
 * 天候で空を灰色へ寄せる割合（gray）と、太陽（月）の光を弱める係数（sun）。晴れは今までどおり
 */
export const WEATHER_SKY: Record<Weather, { gray: number; sun: number }> = {
  clear: { gray: 0, sun: 1 },
  cloudy: { gray: 0.6, sun: 0.45 },
  rain: { gray: 0.75, sun: 0.3 },
  snow: { gray: 0.65, sun: 0.4 },
  fog: { gray: 0.8, sun: 0.35 },
}
