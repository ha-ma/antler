# コードレビュー: mobile-landscape（apps/sim/src/features/drive/）

日付: 2026-11-06 / 対象: 作業ツリーの差分と未追跡ファイル / 仕様: docs/specs/mobile-landscape/functional.md（R1〜R4）
読んだもの: gyro-look.ts、look-input.ts、input-mix.ts、touch-stick.ts、use-touch-drive.ts、use-mobile-drive.ts、use-media-query.ts、gyro-permission.ts、use-keyboard-drive.ts、DrivePage.tsx、TouchControls.tsx、RotateGuide.tsx、DriverCamera.tsx、drive.css（関係する部分）、テストの it 一覧。コードは直していない。

件数: Critical 0 / Warning 5 / Info 9

## 結論

Critical はなし。見てほしいと言われた 5 点のうち、回転行列・InputMixer と blur の分離・効果の依存と片づけ・縦の一時停止は仕様どおりで、正しい。指の捕まえと離す契機は、左右の円（use-touch-drive.ts）は穴がなく、運転画面のドラッグ視線（use-mobile-drive.ts の useSceneLook）にだけ取りこぼしがある（W1）。ジャイロは実機で見え方が崩れうる点が 2 つある（W2・W3）。

## Critical（修正必須）

なし。

## Warning（推奨）

### W1. [use-mobile-drive.ts:111-147] 運転画面のドラッグ視線は、離す契機の取りこぼしで固まる

- `onPointerDown` が `if (... || drag.current) return`（124 行）で、`drag.current` が残っていると以後の指をすべて無視する。`drag.current` を消すのは `onPointerUp` / `onPointerCancel` で pointerId が一致したときだけ。
- 左右の円と違って、ここには setPointerCapture も lostpointercapture も、window の blur・visibilitychange の購読もない。指を置いたまま通知・電話・アプリ切り替えで blur や hidden になり、pointerup も cancel も届かないと、`drag` が残る。以後は別の指の pointerdown が全部無視され、`driveLook` の drag も最後の値のまま（視線が横を向いたまま）になる。ジャイロが使えない端末では、運転画面のドラッグ視線がその場で死ぬ。
- 仕様 R3 の「離す契機」は円の話だが、R4 の「指を離したら正面に戻す」も同じ穴で守られていない。
- 修正案: 次のどちらか、または両方。
  - 新しい pointerdown は常に前の drag を置き換える（自己修復）:
    `drag.current = { id: e.pointerId, ... }` の前の `|| drag.current` を外す。2 本目の指で視線が移る副作用が気になるなら、`drag.current` があるときは古い id を捨てて新しい指を採る、でよい。
  - `useSceneLook` の effect に `window` の blur と `document` の visibilitychange を足し、`drag.current = null; driveLook.release()` を呼ぶ（use-touch-drive.ts:108-129 と同じ形）。

### W2. [gyro-look.ts:91] 「1 秒届かない」で打ち切ると、じっとした端末で視線がポインタに飛ぶ

- `target()` は `nowMs - lastAt > GYRO_STALE_MS`（1 秒）で null を返し、look-input.ts:36-38 の流れで `touch` が false なら R3F の `state.pointer`（最後に Canvas 上で指が触れた位置）に落ちる。
- deviceorientation は Chromium 系で、値が閾値（約 0.1°）以上変わらないとイベントを出さない（私の記憶による。実機での確認は Deferred に入っている）。端末をマウントや膝に置いて動かさない 1 秒間は「届かない」になり、視線が ±12° の最後の指の位置へ飛び、動かすとまた戻る、というちらつきが起こりうる。
- 修正案: 「一度でもジャイロが届いたら、その運転の間はジャイロを使い続ける」ほうが安全。止まっている間は基準が時定数 5 秒で寄る分だけ、`target()` の中で時刻から計算して 0 に減衰させる（`push` の再中心化を `target(nowMs)` 側に寄せる）。「届かない」とみなすのは最初の 1 つが来ないままの場合（許可されたが何も来ない）だけにする。仕様 R4 の「1 秒届かないときは使わない」を変えることになるので、PR に「推奨で決定」と書く。実機が確かめられるまでは仕様どおりでも可。

### W3. [gyro-look.ts:68-74, 77-81] 基準の取り方に 2 つの穴

- (a) 最初の向きが「ほぼ真上・真下」（仰角の絶対値が 70° 超）のとき、方角は atan2 がほぼ (0, 0) で定まらないのに、そのまま `base.headingDeg` になる。「出発」を押したとき端末を机や膝に寝かせていた場合、起こした後は基準が時定数 5 秒でゆっくり寄るため、数秒間 yaw が ±1 に張りつく。→ 最初のサンプルが flat なら、`base` を作るのを flat でなくなるまで待つ。
- (b) 向きが長く途切れたあと（タブが隠れた、W2 の静止など）の最初の push は `dt` が大きく `k ≈ 1` になり、基準がいきなり現在の向きに飛ぶ（視線が瞬時に 0 に戻る）。意図どおりの再中心化とも読めるが、`dt` に上限（例: `Math.min(dt, GYRO_STALE_MS)`）を置くと挙動が滑らかで、テストもしやすい。

### W4. [TouchControls.tsx:33] つまみの 36 がマジックナンバーで、指に 1:1 で付いてこない

- 36 は「円の半径 60 − つまみの半径 24」の手計算（drive.css の `--drive-stick: 120px`、`.drive-touch__knob` の 48px）。CSS 側を変えるとずれる。
- つまみは `stick.x * 36`、入力は `指のずれ / 半径(60)` なので、指が縁（60px）にいてもつまみは 36px。指の動きの 0.6 倍で動く。仕様 R3 は「つまみは指に付いていき、円の外には出ない」。
- 修正案: 比率をそのまま CSS に渡す（`style={{ '--x': stick.x, '--y': stick.y }}` と `translate(calc(-50% + var(--x) * var(--drive-knob-travel)), ...)`）。`--drive-knob-travel: calc((var(--drive-stick) - 48px) / 2)` を CSS 側に 1 か所だけ持つ。指に 1:1 で付ける意図なら、hook に px のずれ（縁で丸めた値）も返す。

### W5. [use-mobile-drive.ts:95-107] usePortraitPause が matchMedia をもう 1 本購読していて、重複している

- 同じ `PORTRAIT_TOUCH_QUERY` を `useMediaQuery`（53 行の `portrait`）と、この effect の `window.matchMedia(...)` の 2 か所で購読している。
- `portrait` の値は既にあるので、次の形で足りる（購読は useSyncExternalStore の 1 本、effect は state の反映だけ）:
  ```ts
  useEffect(() => {
    if (driving && portrait) engine.setPaused(true)
  }, [engine, driving, portrait])
  ```
  `usePortraitPause(engine, driving, portrait)` にする。typeof window.matchMedia のガードも要らなくなる。
- 副次: `MediaQueryList.addEventListener` は Safari 13 以前にない（`addListener` を使う）。Safari 13 には requestPermission があるので、そこでは use-media-query.ts:23 と、この effect の 105 行で例外になり、画面ごと落ちる。対応環境が iOS 14 以降と決まっているなら CLAUDE.md か仕様に 1 行書くだけでよい。

## Info（参考）

- [use-touch-drive.ts:50-55] `send` は pointermove のたびに setState 2 つと `target.setInput` を呼ぶ。120 Hz の端末では毎回 InputMixer が新しい入力を作ってエンジンに渡す（エンジンの inputLog は変化があるときだけ積むので、データは膨らまない）。`stickInput` の結果と brake が前回と同じなら `target.setInput` を飛ばすと素直（keyboard の `if (input[key] === pressed) return` と同じ考え方）。
- [use-touch-drive.ts:76, 96] 円ごとに `fingers.current.* !== null` なら以後の指を無視する。離す契機を取りこぼした指があると（blur・hidden 以外で）、その円は次の blur まで反応しない。捕まえを `hasPointerCapture(fingers.current.stick)` で確かめて、外れていたら新しい指を採る、という自己修復を足せる。現状は blur・hidden・cancel・lostpointercapture が揃っているので、実害は小さい。
- [use-touch-drive.ts:102, 104] ブレーキの `onPointerMove: () => undefined` は YAGNI。`PadHandlers` の `onPointerMove` を optional にして外してよい。
- [TouchControls.tsx:54-61] ブレーキは button だが onClick がなく、`aria-pressed` は「押している間」の状態。キーボードの Space は use-keyboard-drive.ts:41 で「button にフォーカスがあると無視」なので、キーボード付き iPad・タッチの PC でブレーキの button にフォーカスが乗ると Space のブレーキが効かなくなりうる（実機の確認が要る。iOS の Safari は tap で button にフォーカスしない）。対策は、ブレーキの button に `tabIndex={-1}` を付けるか、use-keyboard-drive の例外を data 属性つきの button に限る。
- [gyro-look.ts:84] `alpha ?? 0`（use-mobile-drive.ts:84）。alpha が null の端末（コンパスなし）では、`alpha = 0` 固定で方角は「端末の回転」ではなく倒し方の関数になり、yaw が不自然に動く。alpha が null のサンプルは捨てる（beta・gamma と同じ扱い）ほうが安全。
- [use-media-query.ts:30] `getSnapshot` が呼ばれるたびに `window.matchMedia(query)` を作り直している。呼ぶ頻度は低いが、query ごとに MediaQueryList を 1 つ持つ（`useMemo` かモジュールの Map）とよい。
- [look-input.ts:55] `driveLook` はモジュールのシングルトン。テストの間に状態が残る（各テストで `driveLook.reset()` を呼ぶ決まりが要る）。運転画面は同時に 1 つなので設計としては許容。将来は DriveEngine と同じくインスタンスを `useState` で持ち、DriverCamera に context か prop で渡す形にできる。
- [use-mobile-drive.ts:107-110, DrivePage.tsx:107-111] `askGyro()` は `sound.start()` の後。`sound.start()` が同期で投げると iOS の許可を聞けずに終わる。ユーザー操作の中で最初にやるべきものなので、先頭に置くほうが堅い（`void sound.start()` は async 関数なら同期では投げないが、順序の保証が楽になる）。
- [RotateGuide.tsx, DrivePage.tsx:197] 案内は全面を覆うが、`inert` や `aria-hidden` を HUD にかけていないので、スクリーンリーダーは下の HUD も読める。操作はできない（案内が pointer を受ける）。余裕があれば `.drive-hud` に縦の間 `inert` を付ける。また 21 行目のとおり `role="alert"` の `section` はそのまま機能する。
- [drive.css:`.drive-touch__stick` の `left: var(--drive-edge)`] 左端 12px にあるので、iOS Safari の左端スワイプ（戻る）と競合しうる。実機の確認項目に入れておく。

## テストの穴（Info）

- 運転画面のドラッグ視線で、cancel・blur・pointerup の取りこぼし後に次の指が効くか（W1）。
- `lostpointercapture` と `visibilitychange: hidden` で円が離れるか（ML-3b は up・cancel・blur と 2 本目の指のみ）。
- 「もう一度」（`retry`）で `askGyro` が基準を取り直すか。
- GyroLook に flat な最初のサンプル、`dt` が大きい push（W3）。

## 良い点

- 回転行列: R = Rz(α)·Rx(β)·Ry(γ) を (0, 0, -1) に掛けた結果（x = -cα·sγ - sα·sβ·cγ、y = -sα·sγ + cα·sβ·cγ、z = -cβ·cγ）を手で展開して一致を確かめた。方角は atan2(x, y) で北 0・時計回り正、α が反時計回りに増えるので右回りで増える向きも合う。背面ベクトルで求めるため、縦持ち・横持ち（γ ≈ ±90 の特異点の付近も、表現が違うだけで同じ R になる）で式を分けずに済んでいる。
- 時計: DriverCamera（performance.now()）と push（performance.now()）が同じ時計で、`target(nowMs)` との差が正しく出る。
- InputMixer: 入力元ごとの窓口と OR だけの小さなクラスで、blur の分離（キーの blur はキーだけ、指は指の契機）が構造で守られている。窓口が `source()` で 1 回だけ作られ（useState の初期化）、hook の依存も安定。unmount・enabled=false の片づけも両方の hook で `NO_INPUT` を自分の窓口に渡している。
- use-touch-drive.ts: pointerId を ref で持って最初の指だけを使い、up・cancel・lostpointercapture・blur・hidden・unmount を全部 `releaseAll` / `release*` に集約。`lostpointercapture` は up の後にも来るが、pointerId の一致で二重に離さない。円ごとの State が TouchControls の中にあり、pointermove で DrivePage が再描画されない。
- 縦の一時停止: 縦のとき TouchControls をアンマウントして cleanup で指の入力を離す設計（DrivePage.tsx:173）と、回転で pointercancel が来ない端末を想定した注釈が的確。hook は早期 return の前にすべて呼ばれている。
- requestGyroPermission は `ctor.requestPermission()` をメソッドとして呼び（this を保つ）、reject・例外・関数なし・コンストラクタなしを分けて false/true にしている。
- ファイルの先頭の State 設計の注釈、分離された domain の純粋関数（touch-stick・gyro-look・input-mix）がテストしやすい。
