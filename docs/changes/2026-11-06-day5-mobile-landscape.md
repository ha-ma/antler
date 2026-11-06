# 2026-11-06 Day 5: A をスマホの横画面で使う（mobile-landscape）

仕様: `docs/specs/mobile-landscape/functional.md`（Tier 1、R1〜R4）。ロードマップ Day 5。
要件: ch6「A 対応環境」、ch3 A3-2・A3-3、ch8 規約 6、ch10 の受け入れ基準（A-3 のスマホ横 30 fps は performance のセッション）。

## 1. 事前の確認（`docs/reports/img/mobile-landscape-before/`）

| 画面                  | 844×390                                                                                              | 1280×800                                           | 390×844（縦） |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------- |
| `/plan`（A-1）        | 横にはみ出さない・縦にスクロール                                                                     | 同                                                 | 同            |
| A-2 `/trip/:id/brief` | 同                                                                                                   | 同                                                 | 同            |
| A-6 `/loss/:id`       | 同                                                                                                   | 同                                                 | 同            |
| A-7 `/t/:id`          | 同                                                                                                   | 同                                                 | 同            |
| `/drive`（A-3・A-5）  | **左の列と上の帯が重なる、右の列が 4 割、キーの説明が 2 段で速さと重なる、出発の案内の上下が切れる** | 車内のスマホ（drei の Html）が出発の案内の上に出る | —             |

コンテンツの画面（A-1・A-2・A-6・A-7）は変えていない。`/drive` だけを直した。

## 2. 変えたこと（`apps/sim/src/features/drive/`）

- 配置（R1）: `drive.css` に `--drive-left-w`・`--drive-edge`・`--drive-banner-top`・`--drive-banner-left`。小さい画面（幅 1100px 以下か高さ 560px 以下）で右の列 `min(260px, 30vw)`・左の列 240px・端の余白 space-3。上の帯と赤のバナー・ステージの帯は左右の列の間の中央（translateX をやめ、left / right から決める）。出発の案内・終了の帯は `max-height` と中のスクロール、低い画面では「出発」を下に留める。`.drive__scene` に `z-index: 0`（車内のスマホを HUD の下へ）。低い画面では区間の案内の楽しみの一覧・おすすめの一言を出さない。音量の操作は右の列の幅に縮む（`audio-controls.css`）
- 縦画面の案内（R2）: `RotateGuide.tsx`（4 言語、主文＋副文、インライン SVG）。`/drive` だけ。走っている途中で縦になったら一時停止（自動では再開しない）
- 指の操作（R3）: `TouchControls.tsx`（左の円 120px・右の円 88px）、`hooks/use-touch-drive.ts`、`domain/touch-stick.ts`（遊び 0.3）、`domain/input-mix.ts`（キーと指の入力を OR で合わせる。`useKeyboardDrive` はエンジンではなく合わせる口に渡す）
- ジャイロ（R4）: `domain/gyro-look.ts`（alpha・beta・gamma → 背面の方角と仰角、基準の時定数 5 秒）、`domain/look-input.ts`（ジャイロ → 指のドラッグ → マウスのカーソル）、`hooks/gyro-permission.ts`（iOS の `requestPermission` を「出発」「もう一度」の中で同期に呼ぶ）。`scene/DriverCamera.tsx` は視線の目標の取り方の 1 行だけ変えた（描画の重さには触れていない）
- 文言: `components/mobile-text.ts`（新しく足す分だけ。最初から 4 言語）。既存の `hud-text.ts` は変えていない

## 3. 手動テストマトリクス（Playwright。`docs/reports/img/mobile-landscape/`）

タッチは `hasTouch: true, isMobile: true`（`(pointer: coarse)` が真になる）。HUD の箱（左の列・時刻・再生速度・チップ・会話・おすすめ・音量・キーの説明・速さ・音トグル・左右の円・ステージの帯・赤のバナー）の `getBoundingClientRect` の重なり、画面の外に出たボタン、44px 未満の操作を数えた。

| 大きさ                     | 重なり | 画面の外 | 44px 未満 | 画像                                                       |
| -------------------------- | ------ | -------- | --------- | ---------------------------------------------------------- |
| 844×390 指                 | 0      | 0        | 0         | `drive-844x390-touch.png`・`drive-start-844x390-touch.png` |
| 1280×800 マウス            | 0      | 0        | 0         | `drive-1280x800-mouse.png`                                 |
| 1100×700 マウス            | 0      | 0        | 0         | `drive-1100x700-mouse.png`                                 |
| 740×360 指（対応環境の外） | 0      | 0        | 0         | `drive-740x360-touch.png`                                  |
| 390×844 指（縦）           | —      | —        | —         | `drive-start-390x844-touch.png`（案内）                    |

- 旅の場面（`/drive?trip=…&day=2`、左の列に楽しみの一覧）で、英語の赤のバナー（DEER AHEAD Left 42 m BRAKE）を差し込んで測った: 1280×800 でバナー 356〜702px・左の列の右端 306px・上の帯の下端 158px（バナーの上端 176px）。844×390 でバナー 12〜358px・左の列の下端 167px。重ならない（`trip-drive-banner-*.png`）
- 844×390 の指の操作: 左の円を上にドラッグして 2.5 秒で 0 → 28 km/h、右の円を押して 2.5 秒で 0 km/h、走行中に 390×844 にすると案内が出て、844×390 に戻すと「再開」のボタン（一時停止のまま）。キーの説明は出ない
- 開発中は音を出さない（`VITE_ALERT_SOUND=off`・`VITE_GAME_AUDIO=off` で起動。api 8831・sim 5221）

## 4. 推奨で決定（PR にも書く）

小さい画面の区分（幅 1100px 以下か高さ 560px 以下）、指で操る端末の判定（円・ジャイロは `any-pointer: coarse`、キーの説明を隠す・縦の案内は `pointer: coarse`）、案内を `/drive` だけにすること、運転中に縦にしたら一時停止、円の大きさと遊び 0.3、指の視線は離したら正面に戻す、基準の時定数 5 秒と 70° の打ち切り、`viewport-fit=cover` を使わない。

## 5. 残したこと

- Deferred（仕様の Questions）: 「タップで鹿」（PC のクリックも未実装）、実機（iPhone Safari・Android Chrome）でのジャイロの許可・符号・30 fps・ツールバーで低くなった高さ、844×390 でダッシュボードの計器の下が切れる（`scene/layout.ts` の画角。performance のセッション）
- レビューの Warning: `docs/reports/2026-11-06-*-mobile-landscape.md`
