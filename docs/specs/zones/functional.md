---
feature: zones
target_paths:
  - packages/zones/
spec_confirmed_at: 2d7c4a7
tier: 1
---

# 仕様: zones（鹿ゾーン DB と判定）

## 概要

鹿ゾーン DB（GeoJSON 1 ファイル）と、その生成スクリプト、ゾーン判定・距離・光の区分・危険度の純粋関数を `@antler/zones` に置く。
A（地図・3D・イベント）と B（スマホの GPS）が同じファイルと同じ関数を使う。alert-ui の `deriveAlertState` が受け取る `GpsZone` を作る側。
要件: ch2「鹿ゾーンDB」、ch5 の 3 状態表の遷移条件、ch4 B4-2・B4-3・B4-5、ch3 A2-1・A3-5・A3-6・A4-2・A5-2・A7-2、ch7（zones・Capture.roadSegment）、
ch6「ライセンス」「プライバシー」。出典の調査: docs/reports/2026-11-03-research-deer-zone-sources.md。

**範囲外**: `/api/zones.geojson` の配信（A-2 の feature）、PWA への同梱とハッシュの一致テスト（pwa の feature）、地図への描画（brief-map）、
3D でのゾーン進入と 1× 固定（drive-3d。この feature の `enterZone` の判定を使う）。

## Example Map

Story: A のプレイヤーと B のドライバーとして、同じ鹿多発区間のデータで「いまゾーンの中か・次のゾーンまで何 km か・どのくらい危ないか」を知りたい。

- R1: ゾーン DB は GeoJSON の FeatureCollection 1 ファイル。手で直さず、生成スクリプトが元データ（`packages/zones/data/zones.source.json`）から作る
  - 各ゾーン: id（例 `R240-akan-1`）、路線番号、路線名 4 言語、区間名、段階（開発局 / 釧路開建の地図の段階）、重み表、出典、確からしさ（high / medium / low）
  - geometry はポリゴン（中心線を片側 150 m 膨らませたもの）。中心線は properties に持つ（A の帯の描画と道のりの計算に使う）
  - 出典が空・長さ 1 km 未満・id の形が違う・重みが 0〜1 の外 → 生成スクリプトが失敗する
  - ファイルに版（`version`）と中身のハッシュ（`hash`）を入れる。同じ元データからは毎回同じバイト列
  - 道路の線形は国土地理院系の中心線（国土数値情報 道路データ N13 など。CC BY 互換）から取る。OSM は使わない（ODbL）
- R2: ゾーンの内外を GPS の位置から決める（B4-5。`judgeZone`）
  - 中心線からの距離 ≤ 150 m → inside（ちょうど 150 m も inside）。距離は緯度経度のままでなくメートルで測る
  - 入るのは 150 m 以内、出るのは 200 m を超えてから（ヒステリシス）。149 → 151 → 149 m と揺れても inside のまま
  - 誤差（accuracy）が 100 m を超える: 誤差の円がゾーンに重なれば inside、重ならなければ unknown
  - 10 秒より古い測位・北海道の外・位置が無い → unknown（deriveAlertState が前の状態を保つ）
  - 誤差が 1 km を超える・位置や時刻や誤差が数でない（NaN）測位は使わない → unknown（遠くでチャイムが鳴るのを防ぐ）
  - 出口側の猶予（200 m）は、unknown を挟んでも、隣のゾーンの方が近くても、最後に inside だったゾーンに効く
  - ゾーン内の残り km は進む向きで決める。5 m 未満の動き（信号待ちの GPS の揺れ）では前回の向きを保つ。向きが分からなければ長い方
- R3: 次のゾーンまでの距離
  - A（`measureAlongRoute`）: その日のルート（LineString）に沿って、ゾーン外なら次のゾーンの入口までの km、ゾーン内なら出口までの残り km
  - B（`judgeZone` の結果）: ルートが無いので、いちばん近いゾーンまでの直線距離（道のりより短く出るので安全側）。路線名はそのゾーンの道路名
  - B の到達予定: 距離 ÷ GPS の速度。時速 5 km 未満なら出さない（「--」）。時刻は JST
- R4: 測位の途切れ（トンネルなど）。前回と今回の測位を結ぶ線分がゾーンを横切ったら「通過」として数える（A7-2）。チャイムは鳴らさない（過ぎたあと）
  - 前回と今回の測位が 2 分より離れていれば数えない（直線が実際の道筋と違うため）。最後に inside だったゾーンは、入ったときに数えているので通過にしない
  - A の `measureAlongRoute` は前回の位置（`hintKm`）を受け、往復で行き道と帰り道が重なるところでは前回に近い方へ落とす。道のりは `planRoute` と同じ物差し（頂点ごとの累積）で数える
- R5: 重なる・続くゾーン、往復、中から出発
  - 同じ路線で重なるか 200 m 以内で続くゾーンは、元データで 1 つにまとめる（生成スクリプトが失敗する）。A のルート上で 200 m 以内で続く別路線のゾーンは 1 つの走行区間（残り km は最後の出口まで、チャイム 1 回）
  - 往復ルートで同じゾーンを 2 回通る → 通過 2 回
  - ゾーンの中から出発 → 「進入」と同じ扱い（`enterZone` が立つ。A の 1× 固定とチャイムに使う）
- R6: 光の区分（`lightPeriod`）は時計の時刻でなく太陽の高さで決める
  - 太陽の高さ > +6° → day、-6°〜+6° で午前 → dawn、午後 → dusk、< -6° → night
  - 日付・緯度経度から計算し、時刻は JST で受ける。端末のタイムゾーンに左右されない
  - A-4（いつ通るか）・A-5（遭遇率）・Capture の `light` が同じ区分を使う
- R7: 危険度（`zoneRisk`）＝ そのゾーンの重み表[月][光の区分]（0〜1）
  - 初版の重み表 ＝ 段階の重み × 全道の月別分布 × 時間帯の分布（2025 年全道。統計の数値を事実として使い、表は転載しない）
  - どのゾーンでも 11 月の dusk ＞ 7 月の day
- R8: Capture の位置の丸め（`toRoadSegment`）
  - ゾーンから 1 km 以内 → そのゾーンの id
  - それ以外 → `unknown`。座標から ID を作らない
- R9: 範囲。北海道全体を範囲とし、ゾーン外は緑と「次のゾーンまで」を出す（道道・市町村道は未調査であることを README に書く）。北海道の外 → unknown

Questions は全問決着（2026-11-03、ユーザー回答「全部推奨で」）。保留は下の 3 件。

## ユースケース

### UC-1: ゾーン DB の生成（R1）

- **Given**: 元データ（区間の始点・終点、段階、出典）と道路中心線
- **When**: 生成スクリプトを回す
- **Then**: 検証を通ったゾーンだけの FeatureCollection が、毎回同じバイト列で書き出される。だめな元データは失敗する

### UC-2: ゾーンの内外（R2・R9）

- **Given**: 測位（緯度経度・誤差・時刻）、前回の判定、現在時刻
- **When**: `judgeZone` を呼ぶ
- **Then**: inside / outside / unknown、ゾーン id、残り・次までの km、路線名、到達予定

### UC-3: ルート沿いの距離（R3・R5）

- **Given**: ルートの LineString と現在地
- **When**: `measureAlongRoute` を呼ぶ
- **Then**: 次のゾーンの入口までの km、ゾーン内なら出口までの残り km、ルート上のゾーン通過の一覧

### UC-4: 測位の途切れ（R4）

- **Given**: 前回と今回の測位がゾーンの両側にある
- **When**: `judgeZone` を呼ぶ
- **Then**: 通過が 1 回数えられ、enterZone は立たない

### UC-5: 光の区分（R6）

- **Given**: JST の日時と緯度経度
- **When**: `lightPeriod` を呼ぶ
- **Then**: dawn / day / dusk / night

### UC-6: 危険度（R7）

- **Given**: ゾーンと日時
- **When**: `zoneRisk` を呼ぶ
- **Then**: 0〜1 の値

### UC-7: 位置の丸め（R8）

- **Given**: 位置
- **When**: `toRoadSegment` を呼ぶ
- **Then**: ゾーン id か `unknown`

## Questions（Deferred のみ残存可）

- [Deferred: 担当=Claude（調査）/ 期日=2026-11-04（Day 2）/ 暫定挙動=北海道開発局と釧路開建の地図の段階だけでゾーンを作る] 国交省 xROAD ロードキル DB の中身（点か区間か・道東の収録・提供者規約）を確かめ、使えれば区間件数で重みを置き換える
- [Deferred: 担当=ユーザー（調査走行）/ 期日=2026-11-06（Day 4）/ 暫定挙動=元データの確からしさ（high / medium / low）をそのまま出し、low のゾーンも表示する] ゾーンの位置と長さが現地の感覚と合っているか
- [Deferred: 担当=Claude / 期日=2026-11-04（Day 2）/ 暫定挙動=ゾーンから 1 km より遠い位置は `unknown`] ゾーン外の roadSegment を「路線＋1 km 単位のキロポスト」（例 `R44-km120`）にする。国土地理院系の中心線には路線番号もキロポストも無いため、路線の線形とキロポストを得る方法（xROAD など）が決まるまで作れない

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: ペルソナの経路（新千歳 → 釧路 → 阿寒）の模擬ルートで、`measureAlongRoute` と `judgeZone` を 1 km ごとに回すと、ゾーンの入口で enterZone が 1 回ずつ立ち、通過回数がルート上のゾーン数と一致し、結果を alert-ui の `deriveAlertState` に渡すと safe / zone が交互に出て danger は出ない
- [x] AC-2: 書き出した zones.geojson が生成スクリプトの出力と一致し、全ゾーンが出典・長さ・id・重みの検証を通る

UC-1 生成:

- [x] UC-1a: 正しい元データ → FeatureCollection。各ゾーンの geometry は中心線を片側 150 m 膨らませたポリゴン、properties に中心線
- [x] UC-1b: 出典が空・長さ 1 km 未満・id の形が違う・重みが 0〜1 の外 → 生成が失敗し、どのゾーンのどの項目かを示す
- [x] UC-1c: 同じ元データから 2 回作ると同じバイト列。`hash` が中身の sha256
- [x] UC-1d: 書き出したファイルがリポジトリのものと一致する（手で直していない）
- [x] UC-1e: [ADDED alert-contract-guard] `verifyZoneHash` は features から計算し直した sha256 と照合し、手で直したファイルを見つける
- [x] UC-1f: [ADDED code-reviewer] 長さの違う線分の角でも、輪郭は中心線から 150 m を保つ（角の向きを二等分線にする）

UC-2 内外:

- [x] UC-2a: 中心線から 149・150 m → inside、151 m（前回 outside）→ outside
- [x] UC-2b: 前回 inside で 151〜200 m → inside のまま、201 m → outside。149 → 151 → 149 m で enterZone は 1 回
- [x] UC-2c: 東へ 150 m と北へ 150 m がどちらも inside（メートルで測る。北緯 43° の経度のゆがみ）
- [x] UC-2d: 誤差 300 m で中心線から 400 m → inside（円が重なる）、誤差 300 m で 600 m → unknown
- [x] UC-2e: 10 秒より古い測位・位置なし・北海道の外 → unknown
- [x] UC-2f: outside のとき、いちばん近いゾーンまでの直線距離と、その路線名（4 言語）
- [x] UC-2g: 到達予定は距離 ÷ 速度（JST の時刻）。時速 5 km 未満・速度なし → 到達予定なし
- [x] UC-2h: ゾーンの中から始まる（前回なし・inside）→ enterZone が立つ
- [x] UC-2i: [ADDED alert-contract-guard] inside → unknown（測位の欠け）→ 180 m でも inside のまま（出口側の猶予を保つ）
- [x] UC-2j: [ADDED code-reviewer] 止まっていて GPS が揺れても、残り km の向きは反転しない（5 m 未満の動きでは向きを保つ）
- [x] UC-2k: [ADDED code-reviewer] 誤差が 1 km を超える・時刻や誤差が NaN → unknown
- [x] UC-2l: [ADDED code-reviewer] 隣の別路線のゾーンの方が近くても、入っていたゾーンの出口側の猶予（200 m）を保ち、enterZone を立て直さない

UC-3 ルート沿い:

- [x] UC-3a: ルート上の現在地から次のゾーンの入口までの道のり km
- [x] UC-3b: ゾーン内なら出口までの残り km
- [x] UC-3c: ルート上で 200 m 以内の隙間で続く 2 ゾーン → 1 つの走行区間（残り km は最後の出口まで、入口は 1 回）。同じ路線で重なる・200 m 以内で続くゾーンは生成で失敗する（元データで 1 つにまとめる）
- [x] UC-3d: 往復ルートで同じゾーンを 2 回通る → 通過の一覧に 2 件
- [x] UC-3e: ルートがどのゾーンも通らない → 次のゾーンなし（距離なし）
- [x] UC-3f: [ADDED code-reviewer] 往復の帰り道では、前回の位置を手がかりに帰り道の上に落とす（行き道と取り違えない）
- [x] UC-3g: [ADDED code-reviewer] positionKm はルートの道のり（cumulativeM）と同じ物差し
- [x] UC-3h: [ADDED code-reviewer] 同じ路線の 2 本が線分の途中で交わる（頂点どうしは遠い）ときも生成が失敗する

UC-4 途切れ:

- [x] UC-4a: 前回の測位がゾーンの手前 1 km、今回がゾーンの先 1 km → 通過 1 回、enterZone は立たない
- [x] UC-4b: [ADDED code-reviewer] トンネルを抜けた直後（inside → unknown → 出口の先で outside）に、同じゾーンを通過にも数えない
- [x] UC-4c: [ADDED code-reviewer] 2 分より長い空白のあいだの直線は通過に数えない

UC-5 光の区分:

- [x] UC-5a: 釧路 2027-02-15 12:00 → day、21:00 → night
- [x] UC-5b: 釧路 2026-11-16 15:45（日没前、+1.4°）→ dusk、06:00（日の出前、-3.4°）→ dawn、2026-10-20 17:30（-11.2°）→ night
- [x] UC-5c: 太陽の高さが参照値（astropy で計算、大気差なし）と 0.5° 以内で一致する（釧路 2027-02-15 12:00 = 33.97°、16:30 = 3.11°、2026-07-15 12:00 = 67.56°、札幌 2026-11-16 15:45 = 3.28°）
- [x] UC-5d: 同じ瞬間を `+09:00` と `Z` で渡しても同じ結果（端末のタイムゾーンに左右されない）
- [x] UC-5e: [ADDED code-reviewer] 読めない日時（タイムゾーンなしの文字列・NaN・Invalid Date）は例外

UC-6 危険度:

- [x] UC-6a: 全ゾーン・全月・全区分で 0〜1
- [x] UC-6b: 全ゾーンで 11 月 dusk ＞ 7 月 day
- [x] UC-6c: zoneRisk はゾーンの中心付近の光の区分で表を引く

UC-7 丸め:

- [x] UC-7a: ゾーン内・ゾーンから 1 km 以内 → ゾーン id、1 km より遠い → `unknown`
- [x] UC-7b: 返す値は Capture の roadSegment の検証を通る（`@antler/schema`）

## 非機能要件

- [x] ライセンス: 各ゾーンの出典に資料名・URL・利用条件・「加工して作成」を持ち、CREDITS.md と packages/zones/README.md に書く
- [x] 範囲: 道道・市町村道は未調査であることを README に書く（緑は「ゾーン外」であって「安全」ではない）
- [x] 計算は端末で完結し、ネットワークを使わない（B はインターネットなし）
- [x] ファイルの大きさ: PWA に同梱するので 500 KB 以下

## 受け入れ基準

- [x] 受け入れテスト AC-1・AC-2 が Green
- [x] 全 UC のテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型）
