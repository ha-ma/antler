# レビュー結果: packages/zones（feat/zones）

対象: `packages/zones` の src と scripts。仕様は `docs/specs/zones/functional.md`。
実行環境が無いため、テストとベンチは走らせていない。以下はコードを読んだ上での指摘で、「テストが赤のはず」は手でトレースした結果。

## Critical（修正必須）

### C1. [judge.ts:90, 162] ヒステリシスと通過の除外が `status === 'inside'` に依存 → unknown を挟むと壊れる（UC-2i は赤のはず）

- `unknown()`（judge.ts:65-70）は `status: 'unknown'` で返す。次の呼び出しで `wasInside`（:90）は `previous?.status === 'inside'` なので false になる。
- `judge.test.ts:40` の UC-2i（inside 100 m → 測位欠け → 180 m で inside のまま）は、トレースすると 180 m が `limit = 150.01` で判定され `outside` になる。テストが期待する `inside` と食い違う。
- 同じ原因で二重計上が起きる。`crossedZones`（:162）の除外も `previous.status === 'inside'` なので、unknown 明けは除外されない。inside（enterZone 済み）→ トンネル（unknown）→ ゾーンの先で outside、とすると、前回の測位（ゾーン内）から今回までの線分がそのゾーンに 150 m 以内で触れる。そのためそのゾーンが `passages` にも入る。enterZone と通過で 1 ゾーンが 2 回数えられる（A7-2 の通過回数がずれる）。
- 修正案: 「最後に inside だったゾーン」を基準にする。outside は `lastInsideZoneId` を持ち越さないので、`lastInsideZoneId` は「inside、または inside の後の unknown」を意味する。

```ts
// judgeZone 内
const wasInside = previous?.lastInsideZoneId === nearest.zone.id
// crossedZones 内
if (previous?.lastInsideZoneId === zone.id) continue
```

- ただし `lastInsideZoneId` は outside 返却に含まれない（:118-125）。このため outside → unknown → 同ゾーンで inside は、`enterZone` が true になる（正しい動き）。この前提は壊さないこと。

### C2. [route.ts:93] 往復ルートで `measureAlongRoute` が帰り道を正しく測れない

- `distanceToPolyline(position, plan.route)` は距離が厳密に小さい最初の線分を採る（geo.ts:66 の `d < best`）。往復で帰り道が行き道と同じ道だと、距離は同じで常に行き道側に落ちる。
- 帰り道では `positionKm` が行きの値になる。`current` は行きの区間（残り km が逆向き）、`next` は帰りの区間まで膨らんだ距離になる。
- UC-3d（route.test.ts:48）は `plan.intervals` の件数しか見ていないので、このバグは捕まらない。
- 修正案: `measureAlongRoute(plan, position, hintKm?)` で、前回の `positionKm` の近傍（例: 前回 −0.2 km 〜 +数 km）の線分だけを探す。ヒントが無いときだけ全体を探す。ルート長に比例する全線走査が毎フレーム要らなくなるので、性能にも効く。往復を含むテスト（帰りの `positionKm` が行きより大きい）を足す。

### C3. [geo.ts:53-73 と route.ts:29-33, 93] `alongM` が局所座標の長さで足されるため、300 km のルートで `cumulativeM` と数百 m〜km ずれる

- `distanceToPolyline` は、全線分の長さを「問い合わせ点を原点にした `toLocal`」で測って `walked` に足す。東西成分は原点の緯度の cos で決まる。
- 一方 `planRoute` の `cumulativeM`（→ `entryKm` / `exitKm`）は線分ごとの `metersBetween`（線分の始点が原点）。同じルートでも 2 つの「道のり」の物差しが違う。
- 問い合わせ点が北緯 43.0° で、線分が 42.8° や 43.4° にあると、東西成分が cos の比（0.3〜0.6 %）だけ縮む・伸びる。新千歳〜阿寒（東西およそ 200 km）では、遠い側で 1 km 前後の差になる。南北に長いルートではさらに大きくなる。
- `next.distanceKm = entryKm − positionKm` に、この差がそのまま出る。geo.ts 冒頭の「数 km の範囲なので 0.1 % 未満」という前提が、ルート全体では成り立たない。
- 修正案: 投影した線分の番号 `i` と線分内の比 `t` を返し、`alongM = cumulativeM[i] + t * segLen(i)` とする。judge.ts のゾーン内（数 km〜数十 km）では実害は小さい。

## Warning（推奨）

### W1. [judge.ts:56-63, 90] ヒステリシスが「いちばん近いゾーン」だけに効く

- inside だったゾーン X から 180 m の地点で、隣のゾーン Y が 160 m にあると、nearest は Y。`wasInside` は false なので 160 > 150 で outside になり、X の出口側の猶予が消える。
- 異なる路線が近い・重なる場所で起きる。データ上は R240-akan-2 と R241-akanko-1 などが候補。実際に近接しているかは座標を計算していない。
- 修正案: 前回 inside のゾーンを先に EXIT_M で判定し、残ったときだけ nearest を探す。
- 関連して、重なる別路線のゾーンでは nearest が数 m の差で入れ替わり、`zoneId` が変わるたびに `enterZone` が立つ。planRoute は路線を問わず 200 m 以内を 1 区間にまとめるのに、judge は 1 ゾーン単位で、チャイムの回数が食い違う。
- zones-builder.ts:126-143 は `route` が同じ組だけ検査する。R5 の「同じ路線」に合わせたのだとしても、別路線の重なり（R5 と R230 のような重複区間）も検査して、残すなら judge 側でまとめる方が整合する。

### W2. [judge.ts:134-147] remainingKm の向き判定

- 動きが 1 m 以下（信号待ち）のとき `Math.max(toEnd, toStart)` に戻る。出口に向かって走っていたのに、止まると残りが長い方へ跳ぶ。止まっている間の GPS の揺れ（数 m）でも、向きが毎回入れ替わりうる。
- 修正案: 向き（`direction: 1 | -1`）を `ZoneJudgement` に持ち、20 m 以上動いたときだけ更新する。動きが小さいときは前回の向きを使う。
- :143 の `prevAlong` は前回の測位を毎回投影し直している。向きを持てば、この投影も 1 回減る。
- 補足: `remainingKm` は中心線の端までだが、route.ts の `exitKm` は縁（約 150 m 手前）までで、A と B で約 0.15 km 食い違う。仕様で揃えるか、README に書く。
- 補足: 往復のようにゾーンの中心線がヘアピンで折り返すと、`alongM` が側をまたいで跳ぶ。向き判定の閾値で吸収されない。

### W3. [judge.ts:89-100] 誤差の上限が無い

- `accuracy > 100` のとき、`distance − accuracy > limit` でなければ inside。誤差が 5 km の測位は、5 km 以内のどこでも inside になり、`enterZone`（チャイム）が立つ。
- 修正案: `MAX_USABLE_ACCURACY_M`（例 1000）を超える測位は unknown にする。仕様 R2 の「誤差の円が重なれば inside」と矛盾しない範囲で、上限を spec に足す。
- `accuracyM` が負・NaN のときの扱いは未定義（NaN は `> 100` が false になり、高精度扱いで判定される）。`timestamp` が NaN のときも古い測位の判定をすり抜ける（`NaN > STALE_MS` が false）。入力は `Number.isFinite` で弾く。

### W4. [judge.ts:149-166, geo.ts:76-88] 長い空白の線分が「通過」を作る

- 前回と今回の測位を結ぶ直線で判定するので、バックグラウンドで 1 時間後に復帰して 50 km 離れた、のようなときに、直線が横切る全ゾーンが `passages` に入る。道は直線ではない。
- 修正案: 空白が長い（例: 時間 > 5 分、または距離 > 10 km）ときは通過を数えない。
- `segmentDistanceToPolyline` は原点を前回の測位に置く。全 17 ゾーンを回すので、遠いゾーンでは座標が数 % ゆがむが、150 m 以内かどうかには影響しない。直線が長いと 0.3 %（20 km で数十 m）の誤差が 150 m の閾値に効く、という程度。

### W5. [route.ts:54-68] 200 m のつなぎが折り返しも 1 区間にしうる

- 往復で、ゾーンを出て 200 m 以内で折り返す（駐車場など）と、行きと帰りが 1 区間（UC-3d の「通過 2 回」が 1 回）になる。つなぐ条件に、ルートの向き（折り返していないこと）か、ゾーン ID の連続性を足す。
- 隙間は「最後の inside サンプルから次の inside サンプルまで」で測る。真の縁どうしの隙間より最大 50 m（各 25 m）大きく出る。実際に 180 m の隙間でも、200 m を超えて別区間になりうる。サンプル間隔の半分ずつ余裕を見るか、境界を二分探索で詰める。
- `entryKm` は最初の inside サンプルなので、実際の縁より最大 25 m 内側（遅い）、`exitKm` は最大 25 m 早い。150 m の縁に対して許容範囲だが、README の許容誤差に書く。
- 「同じ路線で 500 m 以内は生成で失敗する」ので、同じ路線のゾーンどうしの隙間は常に 200 m を超える（縁の隙間 = 中心線の隙間 − 300 m > 200 m）。つまり planRoute のつなぎが効くのは、別路線の接続・重なりと、ルートの寄り道だけ。仕様 R5 の文面（同じ路線でつなぐ）と実際の挙動がずれているので、spec か実装のどちらかを直す。

### W6. [zones-builder.ts:126-143, resolve-centerlines.ts:507-523] 「同じ路線で中心線間 ≤ 500 m」の判定

- 意味は合っている。縁の隙間 ≤ 200 m ⇔ 中心線間 ≤ 200 + 2×150 = 500 m（平行な道のとき）。
- ただし中心線間の距離を「頂点から相手の折れ線までの最短」で測っているため、頂点の近くで交差せずに線分の途中で交わる（X 字）2 本の距離が 0 にならない。`segmentSegmentDistance`（geo.ts:92、現状 private）を export して、線分どうしで測る。
- 逆に、同じ路線でも道のりでは遠い（ヘアピンで折り返して 400 m だけ離れている）区間を、直線距離で弾く。この場合は誤検出なので、メッセージに「道のりでは続いていない場合は元データの区間を見直す」と書く。
- 同じ計算が 2 か所にある（zones-builder.ts と `sameRouteGaps`）。DRY: 片方に寄せる。

### W7. [geo.ts:127-161] `bufferPolyline` の鋭角

- 角の法線を「前後の頂点を結ぶ弦の法線」から作り、`scale = min(2, 1/cos(半角))` で伸ばす。線分の長さが違う頂点（間引き後の中心線はそうなる）では、弦の向きが二等分線とずれ、短い線分のほうへ 150 m を保てない。1 km と 20 m の線分で 45° 曲がると、短い方の側は約 105 m になる。
- 曲がりが約 120° を超えると 2 倍で頭打ちになり、内側の輪郭が自己交差する（ヘアピンや線分が offset より短いとき）。R230-jozankei（中山峠の連続カーブ）で曲がりを確認する。
- 判定は中心線からの距離で行うので、判定そのものには影響しない（コメントどおり）。ただし A が描く帯は、実際の判定幅とずれて見える。
- 修正案: 線分ごとにオフセットして、外側は丸め（または miter 制限つき）、内側は切り詰める。または polygon-clipping 系ライブラリで union する。生成物の検証に `turf.booleanValid` 相当（自己交差なし）を足す。
- 輪郭の向きは時計回り（左側を進行方向に並べ、右側を戻す）。RFC 7946 は外周を反時計回りと定めている。描画ライブラリは通常許すが、検証ツールは警告する。

### W8. [zones-builder.ts:83, 64, resolve-centerlines.ts:528] `localeCompare` で並べている

- 「同じ元データからは毎回同じバイト列」(R1) が、実行環境のロケールに依存する。ICU の照合は記号や数字の扱いが環境で変わりうる（`R24-` と `R240-` の順など）。
- 同じファイルの :126 は `a.id > b.id`（コード単位の比較）で、並べ方と比べ方も食い違う。
- 修正案: `a.id < b.id ? -1 : a.id > b.id ? 1 : 0` に統一する。

### W9. [resolve-centerlines.ts] 最短経路と失敗条件

- 迂回比（`MAX_DETOUR_RATIO = 2.5`）は、**長すぎる**経路しか検出しない。最短経路が別の国道（より短い並行路線）に乗り換えても、短いので比は小さく、検出されない。N13 には路線番号が無いので、`route` が正しいことは何も確かめていない。
- 修正案: 経由点（中間の地名）を必ず 1 点以上置かせる。または、結果の線が元の「始点 → 経由点 → 終点」の折れ線から ±X m を超えて離れないこと（例: 最大 1 km）を検査する。許容 2.5 は「勾配のきつい山道でも 1.5〜2」と見て、1.8 くらいまで絞れる。
- 欠けているメッシュは、始点・経由点・終点のメッシュしか確認しない（:422-428）。道がそのあいだの第三のメッシュを通るのに cache に無いと、「たどれない」か、遠回りの別の国道を通る経路になる。経由点のバウンディングボックスが掛かる全メッシュを確認する。
- `N13_002 !== '1'`、`N13_003 !== '1'`、`N13_004 === '5'` の意味（通常部・国道・建設中）は、cache の GeoJSON が無かったので確認できなかった。N13 の仕様書（KS-META）で、橋・トンネルなどのコードが `N13_002` に別の値として入っていないか照合する。入っていると、橋とトンネルで線が切れ、経路が別の国道に回る。
- `cutAtKm` が線の長さより長いとき、`cutAt` は黙ってそのまま返す（:335-351）。note に「N km で切る」と書いたのに実際は切れていない状態になるので、失敗にする。
- `snapToNetwork` のコメント（`marginDeg = 0.02`、「東西 1.6 km・南北 2.2 km」）と、実コードの `marginDeg * 4`（0.08°、東西およそ 6.5 km・南北 8.9 km）が食い違う。
- `loadNetwork` の `N13Feature.parse` は、1 件でも `MultiLineString` やジオメトリ null があると、ファイル名なしの ZodError で全体が止まる。対象外にするか、ファイル名つきで失敗させる。
- `snapToNetwork` は全国道の線に落とす。合流点の近くの地名座標は、別の国道に落ちうる。`snapsM` の表示はあるが、「2 本以上の国道が MAX_SNAP_M 以内にある」場合は警告するとよい。

### W10. [sun.ts:12-23, 67-72] 不正な日時が黙って dusk になる

- `toInstant` は number をそのまま通す。NaN や Invalid Date は、`altitudeDeg` が NaN になり、`> 6` も `< -6` も false で、`hourAngleDeg < 0`（NaN）も false → `'dusk'` を返す。
- `Number.isFinite(ms)` を `toInstant` の出口で確認して `RangeError` にする。文字列には既にある（`Number.isNaN(ms)`）。

## Info（参考）

- [sun.ts] NOAA の式の写しを係数ごとに突き合わせた。L0、M、e、C、ω、見かけの黄経、ε0 の入れ子、Δε、y、均時差の各項（`4ey·sinM·cos2L0`、`1.25e²·sin2M` を含む）、真太陽時（UTC 分 + 均時差 + 4×経度）、時角の符号、cosZ とも、写し間違いは見当たらない。UC-5c の astropy 参照値との比較（0.5° 以内）を実行して確かめること。
- [sun.ts] 大気差の補正なしは、仕様どおり（astropy の参照値も大気差なし）。±6° の境界では大気差は 0.15° 前後で、区分の判定には影響しない。
- [judge.ts] `Where`（`{lat, lon}`）と `LonLat`（`[lon, lat]`）の 2 つの座標の持ち方が混在している。sun.ts だけ `{lat, lon}` なので、`zoneRisk` で `mid[0]`/`mid[1]` を取り違える余地がある。型で揃えるとよい。
- [judge.ts:96] 誤差が大きいとき、`limit` に出口側（200 m）が混ざる。inside 中は 200 m + 誤差まで inside。仕様の「円が重なれば inside」より甘いが、安全側。
- [geo.ts:11] 北海道の bounding box は青森北部（下北半島）も含む。R9 の「北海道の外は unknown」とは厳密には異なるが、ゾーンが無いので実害は無い。
- [zones-builder.ts:145] `hash` は `features` のみの sha256。`version` と `factorSource` は含まない。仕様 R1 の「中身のハッシュ」がファイル全体を指すなら不足。A/B 一致の確認が features だけなら問題ない。
- [route.ts] オフルート（ルートから遠い位置）でも `positionKm` は最寄りの点に落ちる。距離を返して、閾値（例: 500 m）を超えたら B 側の `judgeZone` に切り替えるなどの判断材料にできる。
- [test] UC-2i が赤になるはず（C1）。AC-1（acceptance.test.ts:58-59）は 1 km ごとに `judgeZone` と `measureAlongRoute` を回すが、unknown を挟まず、往復でもないので、C1・C2 は捕まらない。C1・C2・C3 を再現するテスト（unknown 明けの 180 m、帰り道の `positionKm`、遠い側の `positionKm` と `entryKm` の差）を足してから直す。

## 性能の見積もり（未計測）

- `judgeZone` は 1 回の測位で、`nearestZone`（17 ゾーン × 頂点数）と `crossedZones`（同じ数）を回す。zones.source.json の行数から、1 ゾーンは数十頂点で、全体で数百〜千頂点。2 回の走査で数千回の `toLocal`（cos を含む）。1 Hz の測位には十分軽い。
- `planRoute`: 300 km ÷ 25 m = 約 12,000 サンプル × 17 ゾーン × 数十頂点 ×（線分あたり `toLocal` 2 回 + タプル確保）で、千万回台の投影。V8 で 1 秒前後と見込む（モバイルではもっとかかる）。ゾーンごとの bounding box（±150 m）でサンプルを先に除けば、ほとんどのサンプルで 17 ゾーンのうち 16 を飛ばせる。1 回きりの計算なので優先度は低いが、A の起動時に走るなら入れる。
- `measureAlongRoute`: 毎フレーム、ルート全体の線分（数万）を走査する。ヒントつきの窓探索（C2）にすれば、定数時間になる。
- `toLocal` は呼ぶたびに `Math.cos` と新しい配列を作る。ホットパスでは原点ごとに cos を 1 回に寄せられる。

## 良い点

- `judgeZone` / `planRoute` / `measureAlongRoute` が純粋関数で、`now` と `previous` を引数で受けるので、テストしやすい。
- 150 m ちょうどを inside にするための 1 cm の余裕（:92）が、理由つきで書かれている。
- 生成スクリプトが、失敗を全部集めてから止まり、`zones.source.json` を書かない。どのゾーンのどの項目かを示すエラー文も良い。
- `toInstant` が、タイムゾーンの無い文字列を拒否する。端末の TZ に左右されない設計になっている。
- sun.ts は NOAA の式を忠実に写していて、`ms` の負の剰余（`((x % n) + n) % n`）も押さえている。

## 対応（メインセッション、2026-11-03）

直したもの（先に赤いテストを書いてから直した）:

| 指摘       | 対応                                                                                                    | テスト       |
| ---------- | ------------------------------------------------------------------------------------------------------- | ------------ |
| C1         | 出口側の猶予と通過の除外を `lastInsideZoneId` で判定                                                    | UC-2i・UC-4b |
| C2         | `measureAlongRoute(plan, position, hintKm?)`。最短から 30 m 以内の候補のうち前回に近い方を選ぶ          | UC-3f        |
| C3         | 道のりを `cumulativeM[i] + t × 線分長` で数える（`projectOnRoute`）                                     | UC-3g        |
| W1         | 最後に inside だったゾーンが 200 m 以内なら、隣のゾーンが近くてもそちらを続ける                         | UC-2l        |
| W2         | 向き（`direction`）を持ち越し、5 m 未満の動きでは変えない                                               | UC-2j        |
| W3         | 誤差 1 km 超・NaN の測位は unknown                                                                      | UC-2k        |
| W4         | 2 分より長い空白の直線は通過に数えない                                                                  | UC-4c        |
| W6         | 中心線どうしの距離を線分どうしで測る `polylineGapM` に寄せ、builder と resolve-centerlines の重複を解消 | UC-3h        |
| W7（一部） | 角の向きを、長さ 1 にした前後の線分の向きの和（二等分線）にする                                         | UC-1f        |
| W8         | 並べ順をコード単位の比較に統一（builder・resolve-centerlines）                                          | UC-1c        |
| W10        | `toInstant` が NaN・Invalid Date を拒否                                                                 | UC-5e        |

次に回すもの:

- W5: planRoute のつなぎが折り返しも 1 区間にしうる・サンプル間隔ぶん（最大 25 m）の縁のずれ。仕様 R5 の文面は実際の挙動（同じ路線は生成で失敗、つなぎは別路線だけ）に合わせて直した。折り返しの扱いは plan-trip / drive-3d で実ルートを使うときに決める
- W7（残り）: ヘアピンなど内側のオフセットが線分より長い角での輪郭の自己交差、外周の向き（RFC 7946 は反時計回り）。判定は中心線からの距離なので影響なし。brief-map で描画するときに直す
- W9: resolve-centerlines の経由点・メッシュ・N13 コード・`cutAtKm` の検査。Day 2 の xROAD 調査と一緒に見直す
- W2 補足: A の `exitKm`（縁）と B の `remainingKm`（中心線の端）の約 0.15 km の差。pwa の feature で表示を決めるときに揃える
- Info の各項目
