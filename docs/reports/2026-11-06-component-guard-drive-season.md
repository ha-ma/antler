# component-guard: drive-season（apps/sim/src/features/drive）

対象: StartOverlay.tsx, season-text.ts, scene/{DriveScene,Road,Ground,Forest,Atmosphere,Precipitation}.tsx
注意: この実行では Bash が使えず `git diff cff9f43..HEAD` を取れなかった。ファイルの現在の内容を読んで検査した（変更行だけでなくファイル全体）。既存のシーン（Cabin / Headlights / DeerHerd / DeerModel / RearMirror / Dashboard / DriverCamera）と流儀を比べた。

## 結論: Critical 0

検出した項目: データ取得（fetch / useEffect）なし。components/ と scene/ に useEffect なし。Zustand の import・create なし。feature 間 import なし（drive 内の相対 import のみ）。default export なし。any なし。絵文字なし。

## Warning

W1. StartOverlay.tsx に 2 コンポーネント（SeasonSwitch と StartOverlay）。
規約は「1 ファイル 1 コンポーネント」（react-architecture.md, react-components-rules.md）。
対応: SeasonSwitch を components/SeasonSwitch.tsx に分ける（season-text.ts と同じ階層）。

W2. SeasonSwitch が render 中に `window.location.search` を直接読む（StartOverlay.tsx 20 行付近）。

- 購読されないので値が変わっても再描画されない。ページを読み直すリンクなら実害は小さい。
- jsdom 以外（SSR）では壊れる。
- 同 feature の `use-drive-params`（hooks/）が URL を扱っているので、そこに `useDemoSeason()` のような hook を足して、コンポーネントは hook 経由で読むのが筋。DrivePage 側（engine を window.location.search から作る）と読み方をそろえる意図なら、コメントで残っている通りなので Warning 止まり。

W3. Road の cache を作り直すとき、古い cache.chunks の geometry を dispose しない（Road.tsx 81 行付近の useMemo [road, surface, season]）。

- 窓から出た区間は dispose しているが、季節・路面・ルートの変更で cache ごと捨てた分は GPU に残る。
- 見本の場面は季節の切り替えがページ再読み込みなので実害は小さい。同じセッションで「同じシードでもう一度」を繰り返すとルート変更の分が積もる。
- 対応: useFrame の先頭で `cache` が前回と別なら旧 cache の chunks を dispose する、または useEffect の cleanup（外部リソースの片づけなので useEffect を使ってよい）。

## Info

I1. useState の数。DriveScene が 3 個（road, initial, look）で上限ちょうど。次に足すなら ref か domain に逃がす。

- `[initial] = useState(() => ...)` は遅延初期化の 1 回限りの用途。DrivePage の `[engine] = useState(createEngine)` と同じ流儀。
- Atmosphere の `[start] = useState(...)` も同じ（1 個）。

I2. DriveScene が useFrame の中で setRoad / setLook（state 更新）を呼ぶ。

- setRoad は既存の流儀（ルートが変わったら作り直す）。setLook は同じ形で足されていて整合する。値が同じなら参照を保つ（`same ? look.look : next`）のも良い。
- `world()` の値は mutable で購読できないため、state にして比較するのは妥当。
- 軽微: 67 行の `const { scenario } = world()` は render 中の読み取りで、look（state）と 1 フレームずれうる。seed は scenario.trip.seed を渡している。ルートが変わる（setRoad）フレームでは Forest が旧 seed のまま 1 回描かれる可能性。見た目の影響はほぼない。`look.scenario` から seed を取れば同期できる。

I3. R3F の useFrame 内の状態の持ち方。既存と同じ流儀かどうか:

- ref を使う既存（Cabin steer, Headlights level, DriverCamera look, Dashboard painted）に対し、新規の Road / Forest / Atmosphere / Precipitation は「useMemo で作った mutable オブジェクト」（cache, now, tint, last）を useFrame で書き換える。
  - 既存の Dashboard が `useRef<Paint>` で持つのと比べると、useMemo の方が「依存が変わったら作り直す」を型で表せる利点がある。意図的（Road / Forest のコメントに理由あり）で、deps を持つキャッシュには適している。
  - 一方、`last`（Precipitation）や `target`（Atmosphere）のように deps が [] で作り直しが要らないものは useRef の方が既存と揃う。統一するなら ref。ただし挙動の問題はない。
- 描画コールを増やさない構成（pool / InstancedMesh を primitive で渡す）は既存の R12 の流儀どおり。
- 初期値を 1 回だけ読む（Atmosphere の start）は、コメントで理由が書かれていて良い。

I4. Atmosphere の useFrame が毎フレーム `getHexString()` を 2 回呼び、文字列を作る（114 行付近）。

- ごく小さい割り当て。60 fps で気になる量ではないが、performance-analyzer の対象なら lerp の差分がしきい値以下かどうかで比べる手もある。

I5. dispose の抜け。Ground（geometry と material。季節が変わるたび material を作り直す）、Forest（material, 全 geometry。アンマウント時）、Atmosphere / Precipitation（geometry, material, blobTexture）。

- 既存の Cabin / DeerHerd などもアンマウント時の dispose は持たない（リポジトリ内の dispose は mesh-utils.ts と Forest/Road の窓の出入りだけ）ので、流儀としては揃っている。
- 場面ごとにアンマウントされるなら問題は小さい。W3 と合わせて一括で対応するなら、小さな `useDisposable` 風の hook を hooks/ か scene/ に置く。

I6. Road.tsx の useFrame 内で `const { road, surface, season } = cache` が props と同名で shadow する。

- ESLint の no-shadow が有効なら引っかかる。意図は「cache の世代と一致させる」ことなので、`cache.road` のように名前を変えるか、コメントを足す。

I7. season-text.ts は components/ 内の .ts（hud/hud-text.ts と同じ置き方）。規約上 components/ に .ts は許可されているので問題なし。文言は SEASON_TEXT に出ていて、StartOverlay に直書きなし。型は DEMO_SEASONS から導出していて良い。

## 良い点

- 景色を文字列（season, surface, weather）で各部品に渡し、オブジェクトを渡さない設計はキャッシュを守る。DriveScene のコメントと実装が一致。
- Precipitation の外側コンポーネントは early return のみで、hook を条件の後に呼んでいない（Falling に分けているため hooks の順序は安全）。
- StartOverlay の key / aria-current / nav の aria-label は規約どおり。
