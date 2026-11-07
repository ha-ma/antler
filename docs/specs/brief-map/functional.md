---
feature: brief-map
target_paths:
  - packages/trip/src/day/
  - packages/trip/scripts/
  - packages/trip/data/routes.json
  - apps/api/src/application/usecases/trip-day/
  - apps/api/src/application/ports/gateways/road-catalog.gateway.ts
  - apps/api/src/infrastructure/gateways/file-road-catalog.gateway.ts
  - apps/api/src/infrastructure/http/routes/trip-day.routes.ts
  - apps/sim/src/features/brief-map/
spec_confirmed_at: 320f632
tier: 2
---

# 仕様: brief-map（A-2 出発前ブリーフィング・その日のルートとゾーン）

> 2026-11-08 rebrand-shikashi（`docs/specs/rebrand-shikashi/functional.md`）: サービス名を SHIKASHI に変えた（A は SHIKASHI SIMULATOR、B は SHIKASHI NAVIGATOR）。この仕様の対象では、ヘッダーの印（SVG）を SHIKASHI のロゴに替え、画面の title の名前を SHIKASHI SIMULATOR にした。文中の「EZO ROAD」は旧名。この仕様の規則は変えていない。

> 2026-11-08 sticky-cta（`docs/specs/sticky-cta/functional.md` R4）で、「エンジンをかける」（運転のある日）と「次の日（DAY n）へ」（運転の無い日）を画面の下に固定した帯（`shared/components/ActionBar`）に載せ、本文の下の余白に帯の高さを足した。行き先・文言・DOM の位置（右の列）は変えていない。運転の無い最後の日は帯を出さない。

## 概要

**drive-season（2026-11-06）での変更**: 当日の条件 v2（天候に `rain`、4〜11 月の表、版 2。冬の表は v1 のまま）と、`trip-day.routes.test.ts` の全日のテストの時間切れを 20 秒に（R4 の本文に v2 を書いた）（`docs/specs/drive-season/functional.md`）。

A-1 で決めた旅の「その日」を、出発の前に見せる画面（A-2）と、その中身を返す `GET /api/trips/:id/day/:n`。
地図（MapLibre GL JS ＋ OSM のベクタタイル）の上に、独自の SVG でルート・鹿ゾーンの帯・地点と時刻を重ねる（ch9 ① d ハイブリッド）。
ゾーンの通過予定の時刻と光（昼・薄暮・夜）、日没と薄暮の時間帯、鹿アラートの ON/OFF と 3 状態の凡例、当日の条件（シード付き乱数）、操作説明を出し、「エンジンをかける」で運転（`/drive`）へ渡す。

要件: ch3 A2-1〜A2-4、ch7 `GET /api/trips/{id}/day/{n}`（その日のルート・ゾーン・イベント案。シードで再現できる）、ch9 ①（d ハイブリッド、確定）、ch5（3 状態・4 言語）、ch6（初回読込 3 秒・帰属表示）、ch8（トークン・44 px・4.5:1）、付録 A #9（4 言語が欠けない・登録なし）。
画面: UI キャンバス v2 の A2_Brief（`/trip/:id/brief`）。読み取り結果は `docs/reports/2026-11-03-a2-brief-artboard.md`。

**Tier 2 の理由**: 認可（保存した旅を ID だけで読み出す初めての API。plan-trip の threat.md が「読み出しは brief-map で」と残した）、外部への依存（ブラウザが地図タイルを外部の提供元から読む。ルートは開発時に OSRM から取って同梱する）。永続化の表は増やさない（条件はシードから決まるので保存しない。R4）。

**plan-trip-photos（2026-11-06）での変更**: しおりの組み立て（`buildItinerary`）が重さでなく標準の所要で割り当てるようになり、移動だけなら当日に移動する規則になった。UC-2b のテストの旅を「釧路空港 16:00 受け取り」から「17:30 受け取り」に直した（18:00 までに拠点へ着けず、1 日目は空港で泊まる場面を保つ）。この仕様の挙動は変わらない。以前に保存した旅は、作り直しが一致しないので ItineraryChangedError になる（docs/changes/2026-11-06-a-local-feedback.md）。

**deploy-a（2026-11-05）での変更**: レート制限の `rateLimit` に名前（`trip-day.read`）を付けた（Vercel ではこの名前でインスタンスをまたいで数える）。挙動は変わらない。Vercel の関数では `@antler/zones/zones.geojson` を関数のファイルに含める（`vercel build` で確かめた）。

**範囲外**: 運転の画面と、そこで条件・ルートを使うこと（drive-3d。この feature は URL と型だけを渡す）、ランダムなイベント（給油・渋滞など。stop-events が `stops` の横に足す）、旅全体の地図（A-7、record）、Capture の `conditions` の語彙（`_` 区切り）への変換（capture）、`/drive` のチャンクの先読み（drive-3d のマージ後）。

## Example Map

Story: 台湾から初めて北海道をレンタカーで旅する 4 人のグループの運転者として、出発の前に「今日はどこを、何時に、どんな光の中で通るか」と鹿の多い区間を地図で見て、鹿アラートを付けるかを決め、当日の条件と操作を知ってから運転を始める。

Questions は 2026-11-03 にすべて推奨で決定（CLAUDE.md の方針「推奨案のある判断は推奨案で決めて進める」）。決定は各 Rule に「推奨で決定」と書いた。

- R1 ルートのデータ（ch9 ① d）: ルートは開発時に OSRM（公開デモサーバー `router.project-osrm.org`、キー不要）で 1 回だけ計算し、`packages/trip/data/routes.json` に同梱する。api も画面も実行時に OSRM へ通信しない（回線が無くても動く・同じシードで同じ結果。推奨で決定）
  - 計算する組: 各エリアについて「玄関口 5 か所 ＋ そのエリアの拠点」の全ての 2 地点（向きは 1 つ。逆向きは同じ線を逆にたどる）。しおりの移動はこの組の中だけで起きる
  - 線は `overview=full` を Douglas–Peucker 15 m で間引き、encoded polyline（精度 5）で持つ。ゾーンの判定（`planRoute` は 25 m 刻みで中心線から 150 m 以内）を取りこぼさない細かさ（推奨で決定）
  - 所要時間は OSRM の値 × 1.2（固定の係数。冬道・観光の寄り道。推奨で決定）。係数・取得日・出典はファイルの `meta` に書く
  - 組がファイルに無い（地点のマスターを足して取り直していない）→ 直線でつなぎ、所要は plan-trip と同じ目安（直線 × 1.3 ÷ 50 km/h）、`source: "straight"` を付けて返す。直線ではゾーンを判定しない（`zones` に入れない。通らないゾーンを「通過」と出さない）。画面は「概算のルート」と書く。「組が全部ある」ことはテストで見る
  - 冬に閉まる道（OSRM は季節の規制を知らない）: 知床峠（国道 334 号、例年 11 月上旬〜4 月下旬は通行止め）の 2 km 以内を通る線は、斜里を経由して取り直す。季節で線を変えず、通年で峠を通らない線にする（ペルソナは 2 月。spec-adversary [2]、推奨で決定）。表は `packages/trip/src/day/road-pairs.ts` の `WINTER_CLOSURES`
  - 線の端点は地点の座標から 5 km 以内（OSRM は最寄りの道に吸着する）。地点を動かしたら取り直す
  - 取得スクリプトは `packages/trip/scripts/fetch-routes.ts`。1 秒に 1 回まで、User-Agent を付ける（OSRM デモの利用条件）
- R2 その日の行程（A2-1・ch7）: 保存した TripPlan から `buildItinerary` を作り直し、その日（`leg.day === n`）の移動を順に並べる。各移動の出発は `leg.startMs`、到着は出発 ＋ R1 の所要
  - しおりの出発は plan-trip の目安（直線 × 1.3 ÷ 50 km/h）で決まり、到着は OSRM × 1.2 で出すので、2 本目以降の出発は「しおりの出発」と「前の移動の到着」の遅い方にする。不変条件 `arriveAt(i) ≤ departAt(i+1)`（spec-adversary [1]、推奨で決定）
  - 返却の 1 時間前を越えて着く場合も、到着はそのまま出す（しおりの組み立ては plan-trip の目安のまま。A-2 は道の所要を正直に見せる）
  - 夜に出て翌日（JST）に着く移動は、時刻をそのまま返す。画面は日付が違う時刻に「翌」を付ける（例「翌 0:30」）
  - 作り直した `days` が保存した `days` と違う（マスターが変わった）→ 409 `ITINERARY_CHANGED`。古い旅を黙って別の行程で見せない（推奨で決定）。関係の無い地点を足しただけで days が同じなら 409 にならない
  - 移動の無い日（同じ拠点で過ごす）→ `legs` は空。画面は「この日は運転しません」と、その日の地点だけを出す
  - `stops` はその日の楽しみ（id と拠点）。stop-events がランダムなイベントをここに足す（ch7 の「イベント案」のうち、しおりで確定したもの）
  - その日の日付（JST、`YYYY-MM-DD`）と、Claude が書いた 1 行説明（TripDetails の `dayNotes`）を添える
- R3 ゾーンの通過と光（A2-1）: 各移動のルートを `planRoute`（@antler/zones）にかけ、ゾーンの走行区間ごとに入口・出口の道のり（km）と、入口・出口の予定時刻（その移動の中で道のりに比例して補間）を出す
  - 道のりの物差しは間引いた線の長さ（`planRoute` の `totalKm`）。時刻は `entryKm / totalKm` の比で補間する（spec-adversary [3]）
  - 時刻は分に切り捨てて返す。区間の光は、入口の地点と切り捨てた入口の時刻の `lightPeriod`（day / dawn / dusk / night）。表示と判定の境目をそろえる
  - 区間の名前は、区間の入口に最も近いゾーンの道路名（4 言語）。`zoneIds` は区間の全てのゾーン（`planRoute` は id を辞書順に並べるので、先頭を名前に使わない。spec-adversary [4]）
  - 日没（太陽の高さ −0.833° を下回る時刻）と薄暮（+6° 〜 −6°。`lightPeriod` の dusk と同じ線）は、その日の最後の移動の到着地点（移動が無ければ滞在地）で、その日の 12:00〜24:00（JST）を 1 分刻みで調べる。沈まない日は null。画面は日没のチップに地名を添える
  - 区間の帯の上の時刻・光の語は文字でも出す（色だけに頼らない）
- R4 当日の条件（A2-3）: `(旅のシード, n)` から作る乱数（mulberry32、`deriveSeed(seed, "conditions:" + n)`。drive-3d の `domain/rng.ts` と同じ式）で決める純粋関数。`Math.random` を使わない。表は増やさない: 同じシード・同じ版なら同じ条件が出ることが「記録に残す」こと（推奨で決定）。応答に `version` を入れ（v1、drive-season で 2）、表を変えたら版を上げる
  - 運転者: 運転できる人の何人目か（1〜drivers）。2 人以上なら「交代できる」
  - 車種: 人数で決める（1〜2 人 コンパクト、3〜5 人 コンパクト SUV、6〜8 人 ミニバン）。出発の月（JST）が 11〜4 月なら 4WD。車種と 4WD は旅全体で同じ（レンタカーは 1 台。spec-adversary [6]）
  - 天候 `weather`: `clear | cloudy | rain | snow | fog`、路面 `surface`: `dry | wet | packed-snow | ice`。drive-3d の `types.ts` と同じ文字列（drive が後で `import type` に差し替えられる）。天候はその日の月の表から引き（12〜3 月は雪が多い、7〜8 月は霧が多い）、路面は月と天候を条件にした表から引く（雪の日に dry は出ない）
  - **v2（drive-season R1、2026-11-06）**: 天候に `rain` を足し、4〜11 月の表を変えた（雨の日は濡れ、4・11 月は 1 割が凍結）。冬（12〜3 月）の表は v1 のまま。版は 2。表と出典は `docs/changes/2026-11-06-a-local-feedback-2-season.md` §3.2、テストは `packages/trip/src/day/conditions-season.test.ts`（drive-season UC-1a〜UC-1e）。天候の指定（`weather`、見本の場面の切り替え用）を入力に足した
  - 車内: 人数（= party.size）と窓の曇り `none | light | medium | heavy`（1〜2 人 none、3〜4 人 light、5〜6 人 medium、7〜8 人 heavy。雨・雪・霧の日は 1 段上げる）
- R5 API（ch7）: `GET /api/trips/:id/day/:n` → 200 `{ plan, details, day }`。`day` は `DayPlan`（`@antler/trip` の型と zod の形。R2〜R4 の結果）
  - `DayPlan.data` に、結果を決めるデータの版（routes の取得日・zones の hash・条件の版）を入れる。「同じ旅・同じ日・同じ data なら同じ DayPlan」（spec-adversary [3]）
  - 認証なし。旅の ID を知る人が読める（受けるのはスキーマの形の英数 4〜16 文字、api が作るのは推測困難な英数 8 文字）（A7-1 の `/t/{id}` と同じ扱い。ownerToken は削除にだけ使う。推奨で決定。threat.md）
  - IP あたり 1 分 60 件（推奨で決定）。`id` の形が違う・旅が無い → 404 `TRIP_NOT_FOUND`（区別しない）。`n` が 1 以上の整数でない → 400 `INVALID_INPUT`。`n` が日数を超える → 404 `DAY_NOT_FOUND`
  - 応答に所有者トークンのハッシュを含めない
- R6 画面の骨組み（A2_Brief）: `/trip/:id/brief?day=n`（`day` が無い・読めない → 1）。ヘッダに 4 段の進み具合（旅をつくる ✓ / 出発前チェック / ドライブ / 旅の記録）、見出し「今日のルートと、鹿の多い区間」、1 行の要約（DAY n ・ 出発 → 経由 → 到着 ・ 距離 ・ 日没）
  - 左に地図とゾーン通過の一覧、右に鹿アラートのカード・今日の条件・開始ボタン。幅 1000 px 未満では縦に積む（地図 → 通過の一覧 → アラート → 条件 → 開始）
  - 日数が 2 日以上なら D1〜Dn の切り替え（リンク。`?day=` を変える）
  - 文言は 4 言語（ja / en / zh / ko）。言語は旅の `plan.lang`
  - 読み込み中・失敗（もう一度）・旅が無い（A-1 へのリンク）を出す。失敗で白い画面にしない
  - 最小の文字は 12 px（アートボードの 11 px の注記は 12 px に上げる。凡例のミニスマホの中だけは AlertState の compact の 9 px。推奨で決定）
  - ground の上の小さい文字（ステッパーの未到達の段・条件の見出し）は `ink-muted`。`ink-faint` は ground 上で 4.5:1 に届かないので、白い面の帰属表示にだけ使う（spec-adversary [7]）
  - D1〜Dn の切り替えとトグルは 44 × 44 px 以上。ステッパーの完了の印は SVG のチェック（絵文字・記号の文字を使わない）。ゾーンの名札は文の長さで幅を変え、4 言語の最長の文でも切れない
- R7 鹿アラートの ON/OFF と凡例（A2-2）: `role="switch"` のトグル、初期値 ON。状態は URL の `?alert=off` に持つ（再読み込み・A-6 から戻ったときに同じ。A6-4 は ON で戻る）
  - ON の説明に 3 状態の凡例: `@antler/alert-ui` の `AlertState` を `compact`・`muted` で 3 つ（safe・zone・danger）並べ、それぞれに形の名前と一言（緑＝円・ゾーン外 / 琥珀＝三角・鹿ゾーン内でチャイム 1 回 / 赤＝八角・鹿を検知してビープと「前方に鹿」）。B の PWA と同じ部品なので同じ見た目になる
  - OFF の説明「OFF にすると、自分の目だけで走ります」。OFF でも凡例は残す（何が消えるかが分かる）
  - A-2 は音を出さない（凡例は `muted`）。音の確認は drive の `VITE_ALERT_SOUND=on` で行う
  - トグルは 44 × 44 px 以上の当たり判定
- R8 開始（A2-4 と運転への受け渡し）: 「エンジンをかける →」は `/drive?trip={id}&day={n}` へ移る。OFF なら `&alert=off` を足す（drive-3d の `resolveAlertEnabled` と同じ合図）。移動の無い日は開始ボタンの代わりに次の日へのリンク
  - 操作説明: PC「W A S D で運転」「Space でブレーキ」「クリックで鹿を指す・ドラッグで囲む」、スマホ「左の円をドラッグでハンドルと加減速」「右の円でブレーキ」「タップで鹿を指す」。両方を常に出す（端末の判定に頼らない。推奨で決定）
- R9 地図（ch9 ① d）: 背景は MapLibre GL JS で OpenFreeMap の「positron」スタイル（OSM のベクタタイル、キー・登録・費用なし。推奨で決定）。地図の陸と水の色は tokens の `map-land`・`map-water` で塗り直す
  - SVG の重ね: ルート（spruce 5 px。ゾーン内は破線）、ゾーンの帯（alert-zone、不透明度 45 %、幅 22 px。ルートを R3 の区間で切って描くので zones.geojson を画面に載せない）、出発・経由・到着の地点と時刻、ゾーンの名札（「鹿ゾーン n km ・ 薄暮に通過」）
  - MapLibre は動的 import で別のチャンクにする（A-2 の初回読込に入れない）
  - 地図は動かさない（`interactive: false`）。その日のルートの範囲に合わせて表示し、枠の大きさが変わったときだけ合わせ直して SVG を投影し直す（スマホでページのスクロールを奪わない。spec-adversary [7]、推奨で決定）
  - 背景を出せない（WebGL が無い・スタイルかタイルの読み込みに失敗・8 秒で読み終わらない・`VITE_MAP_STYLE_URL=off`）→ 背景なし（`map-land` の面）に同じ SVG を出し、「地図の背景を読み込めません。ルートと鹿ゾーンだけを表示しています」と書く。ルートとゾーンはそのまま見える（回線の無いデモでも動く）。一度背景なしにしたら、その表示のあいだは戻さない（遅れて届いたスタイルは捨てる）
  - sim の HTML に `<meta name="referrer" content="strict-origin">`。タイルの要求で旅の ID（ページの path）を外へ出さない（spec-adversary [5]）
  - 帰属表示は常に文字で出す: 背景があるとき「© OpenStreetMap contributors ・ OpenFreeMap ・ OpenMapTiles」、いつも「ルート: OSRM（© OpenStreetMap contributors, ODbL）」。OSM の著作権ページへのリンク（ODbL の帰属）
  - 地図の SVG は `role="img"` と、ルートとゾーンを言葉にした `aria-label`。同じ内容はゾーン通過の一覧（文字）にもある

## API エンドポイント

### GET /api/trips/:id/day/:n

- **認証**: 不要（ID を知る人が読める）。詳細は threat.md
- **パス**: `id`（英数 4〜16 文字。形が違えば 404）、`n`（1 以上の整数）
- **レスポンス 200**: `{ plan: TripPlan, details: TripDetails, day: DayPlan }`
  - `DayPlan`: `day`、`date`（JST の `YYYY-MM-DD`）、`legs[{ from, to, departAt, arriveAt, distanceKm, durationMin, source: "osrm" | "straight", route: [lon, lat][] }]`、`stops[{ id, base }]`、`zones[{ leg, zoneIds, roadName{ja,en,zh,ko}, entryKm, exitKm, entryAt, exitAt, light }]`、`sun{ place, sunsetAt, duskStartAt, duskEndAt }`（沈まなければ null）、`conditions{ version, driver, drivers, vehicle, fourWd, weather, surface, occupants, windowFog }`、`stayAt`（移動が無い日の地点）、`data{ routes, zones, conditions }`（データの版）
  - 時刻はすべて `+09:00` の ISO 8601
- **エラー**: 下の表

## ユースケース

### UC-1: ルートのデータ（R1）

- **Given**: 地点のマスター（25 か所）と `routes.json`
- **When**: 2 地点の道を引く
- **Then**: エリアの組なら OSRM の線と所要 × 1.2、無い組なら直線と `source: "straight"`
- **Examples**: 新千歳 → 釧路 は約 280 km・約 4.5 時間（OSRM 3.75 時間 × 1.2）/ 釧路 → 新千歳 は同じ線を逆に / 道東の拠点 × 道央の拠点の組は持たない（しおりで起きない）/ 全てのエリアの組がファイルにある

### UC-2: その日の行程（R2）

- **Given**: ペルソナの旅（4 人・2/14 10:00 新千歳 → 2/18 17:00 新千歳・道東・流氷 5・タンチョウ 4）
- **When**: n 日目を作る
- **Then**: その日の移動が出発の早い順に並び、各移動の到着 = 出発 ＋ 所要。日付は JST
- **Examples**: 1 日目は新千歳から出る / 移動の無い日は `legs` が空で `stayAt` が滞在地 / 保存した days と作り直した days が違う → `ITINERARY_CHANGED`

### UC-3: ゾーンの通過と光（R3）

- **Examples**: ゾーンを通る移動 → 区間の入口 < 出口、入口の時刻 ≤ 出口の時刻、どちらも移動の出発〜到着の間 / 2 月の釧路の日没は 16 時台、薄暮の始まり < 日没 < 薄暮の終わり / 16:40 に入るゾーン → `dusk` / 同じ旅 → 同じ結果

### UC-4: 当日の条件（R4）

- **Examples**: 同じシード・同じ日 → 同じ条件 / 日が違えば別の列 / 4 人・2 月 → コンパクト SUV・4WD、雪の日の窓の曇りは medium / 10/31 出発の旅は 11 月の日も 4WD でない / 1 人 → 運転者は 1 人目で交代なし / 2 月を 200 シード回すと snow と packed-snow が最も多く、8 月は snow と ice が出ない

### UC-5: API（R5）

- **Examples**: 保存したペルソナの旅の 2 日目 → 200、`day.day === 2`、`plan.id` が一致、応答に `ownerTokenHash` が無い / 同じ GET を 2 回 → 同じ本文 / `n=0`・`n=1.5`・`n=abc` → 400 / `n=6`（5 日の旅）→ 404 `DAY_NOT_FOUND` / 無い id・形の違う id → 404 `TRIP_NOT_FOUND` / 1 分に 61 回 → 429

### UC-6: 画面の骨組み（R6）

- **Examples**: `/trip/K7m2abcd/brief` → D1 の要約と地図 / `?day=2` → D2 / `?day=x` → D1 / 5 日の旅 → D1〜D5 の切り替え / api が 404 → 「旅が見つかりません」と A-1 へのリンク / 500 → 「もう一度」で読み直す / `plan.lang = "zh"` → 繁体字

### UC-7: アラートの ON/OFF と凡例（R7）

- **Examples**: 初期は ON（`aria-checked="true"`）で凡例が 3 つ / 押すと OFF・URL に `alert=off`・説明が OFF の文に / `?alert=off` で開く → OFF / 凡例は AlertState の safe・zone・danger / 音を出さない

### UC-8: 開始と操作説明（R8）

- **Examples**: ON で「エンジンをかける」→ `/drive?trip=K7m2abcd&day=2` / OFF → `…&alert=off` / 移動の無い日 → 次の日へのリンク（最終日なら出さない）/ PC とスマホの操作説明が両方ある

### UC-9: 地図（R9）

- **Examples**: 背景を出せない（jsdom・WebGL なし）→ 背景なしの注記とルート・帯の SVG / ゾーンの区間が 2 つ → 帯の path が 2 本 / 帰属表示（OSRM・OSM の著作権リンク）が常にある / `aria-label` にゾーンの名前と時刻

## エラーパターン

| 状況                                 | api                     | 画面                                             |
| ------------------------------------ | ----------------------- | ------------------------------------------------ |
| id の形が違う / 旅が無い             | 404 `TRIP_NOT_FOUND`    | 「旅が見つかりません」＋ A-1 へ                  |
| n が 1 以上の整数でない              | 400 `INVALID_INPUT`     | （画面は `?day=` を 1 に読み替えるので起きない） |
| n が日数を超える                     | 404 `DAY_NOT_FOUND`     | 「その日はありません」＋ D1 へ                   |
| マスターが変わり days が作り直せない | 409 `ITINERARY_CHANGED` | 「この旅は古い形式です」＋ A-1 へ                |
| レート制限                           | 429 `RATE_LIMITED`      | 「少し待ってもう一度」                           |
| 予期しない例外                       | 500 `INTERNAL`          | 「もう一度」                                     |
| api に届かない                       | —                       | 「もう一度」（入力は無いので失うものは無い）     |
| 地図の背景が出せない                 | —                       | 背景なしで SVG と注記（R9）                      |

### 例外 → ステータスコードマッピング

| 例外                     | コード              | HTTP |
| ------------------------ | ------------------- | ---- |
| `TripNotFoundError`      | `TRIP_NOT_FOUND`    | 404  |
| `TripDayNotFoundError`   | `DAY_NOT_FOUND`     | 404  |
| `ItineraryChangedError`  | `ITINERARY_CHANGED` | 409  |
| zod の検証エラー（パス） | `INVALID_INPUT`     | 400  |

## ビジネスルール

- 同じ旅・同じ日・同じデータの版（`DayPlan.data`）なら、同じ `DayPlan`（ルート・時刻・ゾーン・条件）を返す（シードで再現できる。ch7）
- 実行時に外部のルーティングへ通信しない。地図の背景だけがブラウザから外部へ行く（R1・R9）
- 鹿ゾーンの帯の色は alert-zone（45 %）。赤（alert-danger）は凡例の AlertState の中だけ（CLAUDE.md）
- 統計の実数を画面に書かない（この画面は統計を出さない）

## Questions（Deferred のみ残存可）

- Deferred: `/drive` のチャンクの先読み（ch6「アセットは A-2 中にプリロード」）。担当: drive-3d のマージ後の cycle。期日: Day 3。暫定: 先読みしない（「エンジンをかける」の後に読む）
- Deferred: drive が `?trip=&day=` を読んで DayPlan で走ること。担当: drive-3d（人 A）。期日: Day 3。暫定: drive は見本の場面のまま。brief は URL だけ渡す
- Deferred: OpenFreeMap の提供が止まったときの代わり（自前の PMTiles など）。担当: 人 A。期日: Day 6。暫定: R9 の背景なし表示

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-1: 保存したペルソナの旅で `GET /api/trips/:id/day/n` を全日ぶん呼ぶ → 200。どの日も DayPlanSchema を通り、ゾーンを通る日が 1 日以上あり、各区間の時刻は移動の出発〜到着の間、移動は重ならない（`arriveAt(i) ≤ departAt(i+1)`）、条件は 2 回呼んでも同じ
- [x] AC-2: A-2 の画面をペルソナの旅（api はフェイク）で開くと、要約・ゾーン通過の一覧・条件・凡例 3 つ・操作説明が出て、トグルを OFF にすると「エンジンをかける」の行き先に `alert=off` が付く

UC-1 ルートのデータ:

- [x] UC-1a: encoded polyline を読み戻すと元の点（精度 5）に戻る
- [x] UC-1b: 全てのエリアの組（玄関口 ＋ エリアの拠点）が routes.json にある。距離・所要が正
- [x] UC-1c: 逆向きの組は同じ線を逆にたどり、距離・所要は同じ
- [x] UC-1d: 無い組は直線・`source: "straight"`・所要は直線 × 1.3 ÷ 50 km/h
- [x] UC-1e: 所要は OSRM の秒 × 1.2
- [x] UC-1f: Douglas–Peucker は端点を残し、許容 15 m を超える点を落とさない（取得スクリプトの部品）
- [x] UC-1g: [ADDED spec-adversary] どの線も知床峠（`WINTER_CLOSURES`）の 2 km 以内を通らない。線の端点は地点の 5 km 以内
- [x] UC-1h: [ADDED spec-adversary] 全ての組で OSRM × 1.2 の所要と plan-trip の目安の比が 0.4〜2.5 の間。直線 10 km 未満の近い組（札幌駅 → 札幌市内など）は差が 20 分以内（しおりの出発と A-2 の到着が大きく食い違わない）

UC-2 その日の行程:

- [x] UC-2a: ペルソナの旅の各日の移動が `buildItinerary` の legs と同じ順・同じ出発で、到着 = 出発 ＋ 所要
- [x] UC-2b: 移動の無い日は legs が空で stayAt がその日の滞在地
- [x] UC-2c: 保存した days が作り直しと違う → `ItineraryChangedError`
- [x] UC-2d: 日付は JST（23:30+08:00 の出発でも JST の暦日）、stops はその日の楽しみと拠点
- [x] UC-2e: [ADDED spec-adversary] その日の 2 本目以降の出発は、しおりの出発と前の到着の遅い方（移動が重ならない）
- [x] UC-2f: [ADDED spec-adversary] 直線でつないだ移動（組が無い）はゾーンを出さない
- [x] UC-2g: [ADDED spec-adversary] `data` に routes の取得日・zones の hash・条件の版がある

UC-3 ゾーンと光:

- [x] UC-3a: ゾーンの区間の入口 < 出口、時刻は移動の中で道のりに比例、区間の名前は道路名の 4 言語
- [x] UC-3b: 光は入口の地点と、分に切り捨てた入口の時刻の `lightPeriod`
- [x] UC-3d: [ADDED spec-adversary] 区間の名前は入口に最も近いゾーンの道路名（辞書順の先頭ではない）
- [x] UC-3c: 2 月の釧路の日没は 16 時台、薄暮の始まり < 日没 < 薄暮の終わり

UC-4 当日の条件:

- [x] UC-4a: 同じ (seed, n) → 同じ条件、n が違えば違う列（200 シードで少なくとも 1 つの欄が違う）
- [x] UC-4b: 車種は人数で、出発の月が 11〜4 月なら 4WD。10/31〜11/2 の旅は全日同じ車
- [x] UC-4f: [ADDED spec-adversary] 雪の日に路面 dry が出ない（200 シード）
- [x] UC-4c: 窓の曇りは人数の段で、雪か霧の日は 1 段上（上限 heavy）
- [x] UC-4d: 2 月の 200 シードで snow が最多の天候、packed-snow が最多の路面。8 月は snow・ice が出ない
- [x] UC-4e: 運転者は 1〜drivers。`packages/trip/src/day/` に `Math.random` が無い

UC-5 API:

- [x] UC-5a: 保存した旅の n 日目 → 200 `{ plan, details, day }`。応答に `ownerTokenHash` が無い
- [x] UC-5b: `n=0`・`1.5`・`abc` → 400 `INVALID_INPUT`
- [x] UC-5c: 日数を超える n → 404 `DAY_NOT_FOUND`、無い id・形の違う id → 404 `TRIP_NOT_FOUND`
- [x] UC-5d: 作り直しが違う旅 → 409 `ITINERARY_CHANGED`
- [x] UC-5e: IP ごとに 1 分 60 件を超える → 429

UC-6 画面の骨組み:

- [x] UC-6a: `?day=2` で D2 の要約、`?day=x` は D1、D1〜Dn の切り替えがリンク
- [x] UC-6b: 読み込み中・404（A-1 へのリンク）・500（もう一度で読み直す）
- [x] UC-6c: 言語は `plan.lang`。文言の表は 4 言語とも空欄が無い
- [x] UC-6d: 移動の無い日は「この日は運転しません」と滞在地
- [x] UC-6e: [ADDED spec-adversary] 翌日に着く時刻は「翌」を付けて出す

UC-7 アラート:

- [x] UC-7a: 初期 ON、押すと OFF で URL に `alert=off`、`?alert=off` で開くと OFF
- [x] UC-7b: 凡例は AlertState（compact・muted）の safe・zone・danger と、形の名前と一言

UC-8 開始と操作:

- [x] UC-8a: 「エンジンをかける」の行き先が `/drive?trip={id}&day={n}`（OFF なら `&alert=off`）
- [x] UC-8b: 移動の無い日は次の日へのリンク（最終日は出さない）
- [x] UC-8c: PC とスマホの操作説明が両方ある

UC-9 地図:

- [x] UC-9a: 背景を出せない環境で、注記と SVG（ルート・ゾーンの帯が区間の数だけ）
- [x] UC-9b: 帰属表示（OSRM・OSM の著作権リンク）が常にある
- [x] UC-9c: 地図の `aria-label` にゾーンの名前と通過の時刻
- [x] UC-9d: 投影（背景なしのとき）はルートの範囲を枠に収め、北が上
- [x] UC-9e: [ADDED spec-adversary] 一度背景なしにしたら、後から `load` が来ても背景なしのまま。MapLibre は `interactive: false` で作る
- [x] UC-9f: [ADDED spec-adversary] sim の HTML に `referrer` の meta（strict-origin）

## Rule → ドメイン語彙対応

| Rule   | 語彙（コード上の名前）                                                           | 置き場所                                                             |
| ------ | -------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| R1     | `RoadCatalog`、`roadBetween`                                                     | `packages/trip/src/day/roads.ts`                                     |
| R1     | `roadPairs`、`roadKey`、`WINTER_CLOSURES`                                        | `packages/trip/src/day/road-pairs.ts`                                |
| R1     | `decodePolyline`、`encodePolyline`、`simplify`                                   | `packages/trip/src/day/polyline.ts`                                  |
| R1     | 取得スクリプト（OSRM・冬の迂回・間引き・係数 1.2）                               | `packages/trip/scripts/fetch-routes.ts`                              |
| R2・R3 | `buildDayPlan`、`ItineraryChangedError`、`pointAtKm`（ゾーンの通過と光も）       | `packages/trip/src/day/day-plan.ts`                                  |
| R3     | `sunTimes`                                                                       | `packages/trip/src/day/sun-times.ts`                                 |
| R4     | `dayConditions`、`DayConditions`、`CONDITIONS_VERSION`                           | `packages/trip/src/day/conditions.ts`                                |
| R5     | `DayPlanSchema`                                                                  | `packages/trip/src/day/schema.ts`                                    |
| R5     | `GetTripDayUseCase`                                                              | `apps/api/src/application/usecases/trip-day/get-trip-day.usecase.ts` |
| R5     | `tripDayRoutes`                                                                  | `apps/api/src/infrastructure/http/routes/trip-day.routes.ts`         |
| R6〜R8 | `BriefPage`、`AlertToggleCard`、`ConditionsCard`、`useBriefParams`、`useTripDay` | `apps/sim/src/features/brief-map/`                                   |
| R9     | `ZoneMap`、`useBaseMap`、`buildOverlay`、`fitProjection`                         | `apps/sim/src/features/brief-map/map/`                               |

## 受け入れ基準

- AC-1・AC-2 が Green、Test List がすべて済み
- `python .claude/hooks/sfad-done.py brief-map` が exit 0
- component-guard・accessibility-checker・layer-guard・security-auditor の Critical が 0
- CREDITS.md に MapLibre GL JS・OpenFreeMap・OpenMapTiles・OpenStreetMap（ODbL）・OSRM（デモサーバー、取得日）を書く
