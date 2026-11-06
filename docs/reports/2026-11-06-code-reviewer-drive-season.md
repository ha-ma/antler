# code-reviewer: drive-season（claude/drive-season-fa89ff）

対象: `cff9f43..HEAD` のうち、依頼で指定された部品（conditions.ts / demo-season.ts / scene/ の 8 ファイル）と、その単体テスト。
制約: このセッションには Bash が無く、`git diff` / `git show cff9f43:...` / テスト実行ができなかった。v1 との比較は「現行コードを読んだ範囲」で、実行結果の証拠ではない。

## Critical（修正必須）

なし。

## Warning（推奨）

1. [scene/Road.tsx:81-84] ルート・路面・季節が変わって `cache` が作り直されるとき、旧 `cache.chunks` の `BufferGeometry` が dispose されない（dispose は同じ `cache` の中で窓から出た区間にしか掛からない）。「同じシードでもう一度」や場面の切り替えのたびに GPU バッファが漏れる。
   → cache を `useMemo` で作る代わりに、useFrame の先頭で `if (cache.ref !== key) { for (const c of cache.chunks.values()) c.geometry.dispose(); cache.chunks.clear(); cache.range = '' }` とする。または `useEffect(() => () => { for (const c of cache.chunks.values()) c.geometry.dispose() }, [cache])` で片づける。
2. [scene/Road.tsx:63-79, Forest.tsx:29-52, Precipitation.tsx:45-83] `<primitive object={...}>` は R3F が自動で dispose しない。アンマウント時に次のものが残る。Road の `material`（MeshPhong）と、プールのメッシュが持つ最後の geometry。Forest の `material` と、種類ごとの最後の geometry（Forest は季節差し替え時だけ dispose）。Precipitation の `BufferGeometry`・`PointsMaterial`/`LineBasicMaterial`・`blobTexture`（DataTexture）。
   → それぞれ `useEffect(() => () => { ...dispose() }, [...])` を足す。
3. [scene/Precipitation.tsx:45-78] `kind` か `seed` が変わると `object` を作り直すが、旧 geometry・material・テクスチャを捨てない（同じコンポーネントのまま snow から rain に変わる経路がある。key が無い）。
   → 上と同じ cleanup で捨てる。または `<Falling key={kind} ...>` で kind ごとにアンマウントさせ、cleanup に任せる。
4. [scene/Road.tsx:28-53] `shader.vertexShader.replace(...)` は、対象の `#include` が three の版で無くなると何も起きずに黙って通る（`opaque_fragment` は r154 以降の名前）。jsdom では描かれないので、テストでも気づけない。
   → `onBeforeCompile` 内で、置換後に `uSkyColor` / `vGloss` が含まれるかを確かめ、無ければ `console.error` か throw。シェーダー文字列の組み立てを純粋関数に分けて、置換が効いたことをテストする手もある。
5. [domain/demo-season.ts:62-70] `?weather=rain` だけ（month 無し）は 2 月の表を引くので、雨は無視されて別の天候になる（テストの UC-2b が仕様として固定している）。StartOverlay の切り替えは `currentDemoSeason` が null になり、どれも aria-current にならない。月の表に無い天候を、黙って無視する挙動は URL を手で書く人には分かりにくい。
   → 仕様どおりなら Info 扱いでよい。直すなら `weather` だけのときは、その天候が出る最初の月を選ぶか、画面に「この月には無い天候」と出す。
6. [domain/demo-season.ts:17-22, 72] 出発の年・日・時刻（`2027-..-15T16:40+09:00`）が、`DEMO_DEFAULT.startAt` と `demoSeason` のテンプレートの 2 か所に書いてある。片方だけ変えるとずれる。
   → `const startAtOf = (m: number) => \`2027-${String(m).padStart(2, '0')}-15T16:40+09:00\`` を 1 つ作り、`DEMO_DEFAULT` もそれで作る。
7. [scene/Atmosphere.tsx:73-110] 毎フレーム `Color.set(string)` を 6 回（target 3 つ、hemi 2 つ、sun 1 つ）呼ぶ。文字列の解析が走る。`weather-look.ts` のコメント「毎フレーム色の文字列を作らない」と実装が合っていない。さらに blend 中は毎フレーム `getHexString()` を 2 回（文字列を 2 つ作る）呼び、`paintDome` で全頂点（約 170）を塗り直す。
   → `skyTableOf` が `Color` を持つ形（`SkyLookColors`）を返し、useFrame は `copy` だけにする。再塗り判定は文字列比較ではなく、blend の進み（k が十分小さくなったら止める）で行う。
8. [scene/Precipitation.tsx（テスト: season-look.test.ts:231-259）] 「車内の粒は描かない」のテストは、100 km/h で回したあとに出力の位置が車内に無いことを見るだけで、そもそも車内に粒があったかを確かめていない。隠す処理を消しても、車内に粒が入らなければ通る恐れがある。
   → 粒を 1 つ `insideCabin` の座標に手で置き、`writePrecipPositions` の出力の y が `HIDDEN_Y`（地面の下）になることを直接確かめる。

## Info（参考）

- [packages/trip/src/day/conditions.ts] 当日の条件 v2 の読み。
  - 冬: `WEATHER.winter` の割合は 25/30/40/5、キーの順は clear, cloudy, snow, fog。`surfaceWeights` の冬は packed-snow→ice→dry の順。`pickWeighted` は書いた順に区間を割り当てるので、順序が v1 と同じかが同一性の条件。コード側の読みでは、冬に雨は無く乱数の消費も v1 と同じ流れ（天候 1 回→路面 1 回→運転者 1 回）。ただし v1 の実体は確認できなかった。テストの指紋 `7f9b0c8d` も私は再計算できていない。`git show cff9f43:packages/trip/src/day/conditions.ts` と照らして、表の順番まで同じか、指紋を一度手元で確かめてほしい。
  - 天候の指定: `drawn` を必ず 1 回引いてから `wanted` で上書きするので、乱数の列は指定の有無で変わらない（運転者・車が変わらないテスト UC-1e が裏づけている）。指定がその月の表に無い（重み 0 または未定義）ときは `drawn` に戻る。この実装は正しい。
  - 型: `WEATHER[season] as Record<Weather, number>` と `surfaceWeights(...) as Record<Surface, number>` は、Partial を Record に偽る型アサーション。`pickWeighted` を `Partial<Record<T, number>>` を受けるようにすれば不要。
  - `fourWd` の `['winter','shoulder'].includes(...)` は、`season === 'winter' || season === 'shoulder'` のほうが型の絞り込みも効く（軽微）。
  - `DayConditionsSchema` は `z.literal(CONDITIONS_VERSION)`（=2）なので、API が v1 のままで sim が v2 の組み合わせ（デプロイのずれ）では safeParse が落ちる。保存はしていないので通常は問題ないが、api と sim は同時にデプロイすること。
- [domain/demo-season.ts] URL の読み方は堅い。`MONTH` の正規表現が `07`・`7.5`・`13`・`0` を弾き、`WEATHERS.find` で未知の天候を null にしている。`month` も `weather` も無効なら `DEMO_DEFAULT` を返し、テストが `'?month=07x'` などを網羅している。`'?month=07'`（先頭ゼロ）は仕様上の扱いがテストに無い。`WEATHERS` は `Weather` の全要素を網羅する保証が型に無い（`satisfies Record<Weather, true>` などで漏れを検出できる）。`(typeof DEMO_SEASONS)[number]['id']` が 2 か所に出るので `DemoSeasonId` 型を export すると読みやすい。
- [scene/Forest.tsx:34-59] 季節の差し替えは「geometry を作る→ useFrame で mesh に差し替え、旧を dispose」で、InstancedMesh と行列を保てている（良い設計）。初回は `InstancedMesh(undefined)` の空 geometry を dispose するだけなので問題ない。`buildForestGeometries` は季節が変わるたびに `arrow`（季節で変わらない）も作り直す。軽いので許容。
- [scene/Road.tsx:96-123] 範囲が変わったときだけ区間を作る構造（`cache.range`）と、材質を 1 つ使い回して `shininess` / `specular` / uniform だけ書き換える設計は妥当で、毎フレームの割り当ては無い。`customProgramCacheKey` も固定で、シェーダーは 1 つに保たれる。
- [scene/precip-field.ts, Precipitation.tsx] 毎フレームの割り当ては、`object.position.set(...carToWorld(...))` の配列 1 つ程度。粒の更新は Float64Array/Float32Array に直接書き、色・行列も使い回しで良い。雨は粒ごとに `Math.hypot` を 2 回呼ぶ（1500 粒で 3000 回/フレーム）。`vy`・`vz` から 1 度だけ求めれば半分になり、`** 0.5` は `Math.sqrt` のほうが速い。速度が変わらない間は `norm` を粒の外に出せる。粒の再配置は `rng` を使うので「同じシード」でも、フレーム間隔が違えば列は変わる（見た目だけで、判定には影響しない）。
- [scene/tree-models.ts] 色は全部 `palette.ts`（`TREE` / `TERRAIN`）から引いており、直書きは無い。`mix` は新しい `Color` を返すので、共有の `SNOW` を `lerp` で壊さない。葉の塊は 150 三角形以下をテストで固定している。
- [scene/road-geometry.ts] `Strip` / `roadCrossSection` / `carriageway` の分離が分かりやすく、形が季節・路面で変わらないこともテスト済み。`buildRoadChunk` の `aL/aR/bL/bR` を 4 回ずつ書く部分（160-179 行）は、小さなヘルパ `at(pose, d, y)` にまとめると 20 行ほど減る。
- [scene/Atmosphere.tsx] `useState` で初期値を 1 回だけ読み、天候の変化は useFrame の中で寄せる設計は、コメントの理由どおりで正しい。空のドームは `geometry=` / `material=` の props で渡しているので R3F が dispose する。`paintDome` の再塗り判定の key が zenith と horizon だけで、fog の色を含まない（fog だけが変わる場面は現状ほぼ無い）。
- 色の直書き: `apps/sim/src` で `#xxxxxx` が出るのは `palette.ts` だけ（`stop-events.css` はコメント中の旧色の説明）。`rgba(` も無い。絵文字は `apps/sim/src/features/drive` に無い。統計の実数（6,705・61.5）も無い。
- テスト全体: 純粋関数（横断面・色・粒の動き・空の目標値）は網羅されていて、palette の定数と比べる書き方（テストに色の値を書かない）は規約に沿っている。足りないのは、scene のコンポーネント（Road / Forest / Precipitation / Atmosphere）のライフサイクル（dispose、cache の作り直し、季節の差し替え）。`@react-three/test-renderer` を DriveScene のテストが既に使っているので、`rerender` で surface/season を変え、`BufferGeometry.prototype.dispose` のスパイで漏れを検出する 1 本を足すと Warning 1〜3 が守れる。
