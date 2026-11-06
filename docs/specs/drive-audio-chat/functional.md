---
feature: drive-audio-chat
target_paths:
  - apps/sim/src/features/drive/audio/
  - apps/sim/src/features/drive/chat/
  - apps/api/src/domain/chats/
  - apps/api/src/application/usecases/chats/
  - apps/api/src/application/ports/gateways/chat-writer.gateway.ts
  - apps/api/src/application/ports/repositories/chat.repository.ts
  - apps/api/src/infrastructure/gateways/claude-chat-writer.gateway.ts
  - apps/api/src/infrastructure/gateways/prompts/chat-writing.ts
  - apps/api/src/infrastructure/repositories/drizzle-chat.repository.ts
  - apps/api/src/infrastructure/http/routes/chat.routes.ts
  - apps/api/src/infrastructure/http/schemas/chat.schema.ts
spec_confirmed_at: c7cea1f
tier: 2
---

# 仕様: drive-audio-chat（A-3 運転中の音・車内の会話）

> 2026-11-06 i18n（`docs/specs/i18n/functional.md`）で 会話・音量の操作の `lang` 属性の zh を `zh-TW` から `zh-Hant` にそろえ（ほかの画面と同じ）、api の会話の文の検証を共通の文字種の規則（`lang-script-policy`。zh の簡体字も落とす）に寄せた。会話の楽しみの文の関数は `i18n-tables.test.ts` が見本を出して検査する。この仕様のルールは変えていない。

> 2026-11-06 mobile-landscape: `useKeyboardDrive` はエンジンではなく、指の入力と合わせる口（`InputMixer` の keys）に渡す（入力欄のフォーカスの扱いは同じ）。小さい画面では音量の操作のスライダーが右の列の幅に縮む（`docs/specs/mobile-landscape/functional.md` R1・R3）。

> 2026-11-07 drive-crash-spot（`docs/specs/drive-crash-spot/functional.md`）が `DrivePage.tsx`（車内のスマホを HUD に固定・衝突の演出・鹿の発見の件数）と、会話のテストの snapshot（`spotting` の欄）を変えた。会話・音のルールは変えていない。衝突の `collided` の合図は今までどおり当たった `frame()` で出る。ステージが入口の 1 km 手前からになり、ゾーンの前の会話の時間は短い。

## 概要

**drive-season（2026-11-06）での変更**: 天候に `rain` を足したので、`apps/api/src/domain/chats/models/chat-deck.ts` の天候の union と `chat-ui.test.tsx` の `DATA.conditions`（版 2）を 1 行ずつ直した。会話の振る舞いは変えていない（`docs/specs/drive-season/functional.md`）。

A-3 の運転画面に、運転の音（エンジン・ブレーキ・車内のラジオ風の BGM）と、車内の会話を足す。
会話は視界の右側にたまっていくメッセージとして出し、出るたびに短い 2 音の通知音を鳴らす。
会話の文は、api が旅程から「いつ・誰が・何の話題で」を決定的に決め、Claude に 4 言語の短い一言を書かせて、旅と日の組で 1 回だけ作って保存する（`POST /api/trips/:id/day/:n/chat`）。旅の無い見本の運転・トークンの無い端末・api の失敗のときは、端末の決まった会話（見本の会話）で走る。

要件: ch3 A3-5（同乗者の吹き出し・下部操作・音トグル）、A3-8（同乗者の会話とラジオ。アラート時はラジオ自動ミュート。SHOULD）、ch5（A ではアラート時にラジオ・会話を自動ミュート、4 言語）、ch6（レート制限・ログ）、付録 A #1（Claude の活用。生成結果を保存してシードで再生）、ユーザーの指摘（2026-11-06。「運転中の音要素がまったくない」「運転中のメッセージがない」）。
画面: UI キャンバス v2 の A3（運転中）。night テーマ。会話は HUD の右側、音量の操作は下部の操作列。

**Tier 2 の理由**: 外部副作用（Claude API。費用と遅延）、永続化（会話の束の表 `trip_chats`。表の版が 2 → 3）、認可（ownerToken を会話の生成の権利に使う）、並行性（同じ日の会話の同時生成）。

**組み込み（2026-11-06、drive-tune（PR #38）が main に入った後）**: 運転画面（`DrivePage`）で `useDriveSoundAndChat` を呼び、「出発」「もう一度」の操作の中で運転の音を鳴らし始める。HUD の右の列（drive-tune が空けた `--drive-chat-w`）に会話と音量の操作を置く。音の合図は drive-tune の `DriveEngine.telemetry()`（回転数・段・ブレーキの強さ・ABS・アクセル）から取る。音量のスライダーにフォーカスがあるときは、矢印キーで運転しない（`use-keyboard-drive.ts`）

**後の変更（2026-11-06、drive-tourism）**: R11 の話題（話の行の 3 分の 2 を楽しみの話に）、R13 の位置と行数（右上から 3 行・写真と出典つき）、R15 の保存の鍵の版（`chat:v2`）、R16 の材料（楽しみの名前・拠点・切り口）、R19 の見本の会話（楽しみの話を入れる）は `docs/specs/drive-tourism/functional.md` の T1〜T10 が正。

**範囲外**:

- 会話の読み上げ（A3-8 の「音声」）。文字と通知音だけ（Questions の Deferred）
- A-2 の画面で会話を先に作っておくこと（運転の画面を開いたときに取りに行く。Deferred）
- 鹿の警告の音（`@antler/alert-ui` が持つ。凍結済み。この feature は触らない）

## Example Map

Story: 台湾から 4 人で初めての北海道を走るドライバーとして、運転中にエンジンとブレーキの手応えを耳で感じ、車内のラジオと同乗者の一言で旅らしさを味わいたい。ただし鹿が出たときは、警告の音だけが聞こえてほしい。

Questions は 2026-11-06 に推奨で決定（CLAUDE.md の方針「推奨案のある判断は推奨案で決めて進める」）。決めたことは各 Rule に「推奨で決定」と書いた。spec-adversary の指摘と決定は `docs/reports/2026-11-06-spec-adversary-drive-audio-chat.md`。

### 音（sim の `features/drive/audio/`）

- R1 鳴らすかの決まり: 本番は鳴らす。開発中（`import.meta.env.DEV`）は `VITE_GAME_AUDIO=on` のときだけ鳴らす（`VITE_ALERT_SOUND` と同じ形。推奨で決定）。鳴らさないときは AudioContext を作らない。AudioContext は「出発」のボタンの操作の中で 1 つだけ作り、「もう一度」では resume だけをする（ブラウザの自動再生の決まりと、AudioContext の数の上限）。画面を離れたら close する。alert-ui の音とは別の context
- R2 音源: すべて Web Audio でプログラム的に作る自作の音（音声ファイルを使わない。推奨で決定）。`CREDITS.md` に「自作（Web Audio の合成）」と書く。実在の製品・サービスの音（LINE の通知音など）をまねない
- R3 エンジン音: 回転数で音の高さ、アクセルと回転数で大きさを変える
  - 回転数: drive-tune の `telemetry().rpm`（オートマ 6 段、750〜3,000 rpm）を使う。無いとき（テスト）だけ速さから仮のギア（5 段。0〜20・20〜40・40〜60・60〜80・80 km/h〜）を選び、そのギアの中の速さの割合で 750〜2,700 rpm、アクセルで +300 rpm（上限 6,000）
  - 音の高さ: 4 気筒の爆発の周波数（rpm ÷ 60 × 2 Hz）を基音にする（750 rpm で 25 Hz、3,000 rpm で 100 Hz）
  - 大きさ（0〜1 の相対値）: 止まっていてアクセルを踏んでいない（アイドリング）は 0.25、それ以外は 0.25 + 回転数の割合（750 rpm で 0、3,000 rpm で 1）× 0.35 + アクセル × 0.3（上限 0.9）
  - 一時停止・走行の終わり（衝突・完走）は 0
- R4 ブレーキ音: ブレーキの強さ（0〜1）と速さで鳴らす
  - 3 km/h 未満では鳴らさない。ノイズの大きさ = 強さ × min(1, 速さ ÷ 60 km/h) × 0.6
  - 強さ 0.6 以上かつ 20 km/h 以上で、高い音（鳴き）を少し足す（大きさ 0.15 × 強さ）
  - ABS が効いているときは、ノイズを 1 秒に 14 回の断続にする（ABS の手応え）
  - ブレーキの強さと ABS は drive-tune の `telemetry().brake`（0〜1、踏んでから 0.15 秒で立ち上がる。S は 0.6 まで）・`abs`（滑りやすい路面で 10 km/h 以上のブレーキ中）
- R5 BGM（車内のラジオ）: シード（`DriveScenario.seed`）で決まる 8 小節の自作の曲（和音の進行と分散和音。84 BPM）を、ラジオのような帯域（300〜3,000 Hz）と小さなノイズで、低い音量でくり返す（推奨で決定）。同じシードは同じ曲
- R6 音量の混ぜ方（音量のつまみと自動の下げ）
  - 利用者の設定: 全体の音量（0〜100、10 きざみ。既定 60）、消音（既定 OFF）、BGM の ON/OFF（既定 ON）。端末に残す（localStorage `antler.drive.audio`。読めなければ既定値）
  - 実際の大きさ = 部品の大きさ × 全体の音量 ÷ 100 × 部品の係数（エンジン 0.5・ブレーキ 0.6・BGM 0.18・通知音 0.5）。消音なら全部 0
  - 鹿の警告の赤（`danger`）の間: BGM は 0（ラジオの自動ミュート。ch5・A3-8。ch5 の「アラート時」は赤と読む）、エンジンとブレーキは 0.5 倍（警告のビープと読み上げを聞こえやすく）、通知音は鳴らさない。琥珀（`zone`）の間は BGM を 0.6 倍（推奨で決定）
  - 走行の終わり（衝突・完走）は BGM も 0。一時停止の間は BGM を流したまま（エンジン・ブレーキは 0）
- R6a アラート OFF の走行（`?alert=off`）: 赤が出ないので、赤による下げ・抑えは起きない。さらに、ゾーンで BGM を下げない（ゾーンの判定は GPS 側で生きているが、OFF の走行にゾーンを音で知らせない。A-6 の ON と OFF の比べを汚さない）。通知音はゾーンでも鳴る（支援が無い姿のまま。推奨で決定）
  - 消音・音量のつまみは、運転の音（エンジン・ブレーキ・BGM・通知音）だけに効く。鹿の警告の音（alert-ui）は消さない（alert-ui の `muted` の決まりのまま。アラート OFF の走行では alert-ui がもともと鳴らさない）
  - 音の大きさの変化は 0.1 秒程度でならす（ぷつぷつ鳴らない）。BGM が赤で 0 になるときは 0.15 秒以内に下げる
- R7 タブを隠したら（`document.hidden`）運転の音を止め（AudioContext を suspend）、戻したら再開する
- R8 通知音: 会話が 1 つ以上出たときに 1 回だけ鳴らす。高さの違う 2 つの短い正弦波（C6 → F6、60 ms と 90 ms、間 40 ms、柔らかい立ち上がり）（推奨で決定。実在の通知音をまねない）。2 秒（実時間）以内に続けては鳴らさない（後のものは音を鳴らさず表示だけ）。鳴らすのは緑（`safe`）のときだけ。琥珀の間は表示だけ（ゾーンの中は前を見てほしい）、赤の間は R12 で会話自体を待たせる。アラート OFF の走行は R6a
- R9 更新の頻度: 音の値は運転のスナップショット（約 10 Hz）か合図の変化のときに `setTargetAtTime` で変える。毎フレームに音のノードを作らない。BGM は 1 小節先までをまとめて予約する（60 / 30 fps を落とさない）

### 会話（api ＋ sim の `features/drive/chat/`）

- R10 会話の束（ChatDeck）: 1 日の会話を 1 つの束にし、行（ChatLine）は `{ id, cue, topic, speaker, text }`
  - 話し手（speaker）: 同乗者 `p1`（助手席）・`p2`（後部座席・左）・`p3`（後部座席・右）を人数 − 1 人（最大 3 人）。1 人旅は `radio`（ラジオの DJ）だけ（推奨で決定。氏名は作らない）
  - きっかけ（cue）は 2 種:
    - `road`（`{ kind: 'road', leg, km }`）: その日の leg 番目の移動の km 地点を過ぎたら出す
    - 反応（`{ kind: 'zone-enter' | 'zone-exit' | 'avoided' }`）: 鹿ゾーンに入った・出た・鹿を避けた（遭遇が avoided になった）とき。種類ごとに 2 行あり、その走行で n 回目（1 から数える）の出来事には添字 (n − 1) mod 2 の行を出す
    - 反応の 6 行は Claude に書かせない。端末の固定の 4 言語の表（見本の会話と共有。人が書いた文。鹿を見つけたとは言わない）から出す（spec-adversary Critical。推奨で決定）。話し手は束の話し手の中からシードで決める
  - 話題（topic）: road は `depart`（出発）・`pleasure`（その日のこれからの楽しみ）・`weather`・`light`（時間帯・空）・`scenery`（景色）・`snack`（おやつ・休憩）・`music`（ラジオの曲）。反応は cue と同じ名前
- R11 束の組み立て（api の domain。決定的。road の行だけを作る）
  - 出発の行: 各移動の 0.2 km に `depart` を 1 行。0.2 km が鹿ゾーンの中なら、そのゾーンの出口の 0.2 km 先に動かす（出口が移動の終わりの 1 km 手前より先なら作らない）
  - 話の行: 各移動に k = min(3, floor(移動の距離 ÷ 15 km)) 行の候補（15 km 未満の移動は 0 行）。候補の位置は移動の距離を k + 1 等分した点に ±10% の揺らぎ（シード付き乱数）。次の順に置き場所を決める（spec-adversary Major。推奨で決定）:
    1. [1 km, 移動の距離 − 1 km] に収める
    2. 鹿ゾーンの中なら、そのゾーンの入口の 1 km 手前に動かす。動かした先がまた別のゾーンの中なら、そのゾーンの入口の 1 km 手前へ繰り返す（ゾーンの中は前を見てほしいので話しかけない）
    3. 1 km 未満になった、または同じ移動の他の行（出発の行を含む）と 1 km 以内なら、その候補は作らない
  - 話の行の合計は 1 日 10 行まで（超えたら後ろの移動から減らす）
  - 話題: road の depart 以外は、`pleasure`（その日に楽しみが残っているときだけ）・`weather`・`light`・`scenery`・`snack`・`music` からシード付き乱数で選び、同じ話題を続けない。`light` には、その地点のしおりどおりの通過時刻で測った光（dawn / day / dusk / night）を材料に付ける
  - 話し手: シード付き乱数で選び、2 人以上いれば同じ人を続けない
  - 乱数は旅の `seed` と日から作る mulberry32（同じ旅・同じ日は同じ束）。束はそれを作ったデータの版（`data.routes`・`data.zones`）を持つ
  - 行の id は `l{2 桁の連番}`（並び: 移動の順 → km の順）
- R12 出すタイミング（sim。純粋関数 `advanceChat`。時間はシミュレーションの経過 `t`。一時停止の間は t が進まないので待ちも止まる）
  - road の行: 運転の道のり（`zone.positionKm`）が前の値からいまの値までの間に、その行の道のり（移動の始まりの道のり ＋ km。drive の `legStarts`。次の移動の始まり − 1 km で抑える）を越えたら出す。一度に越えた複数の行は道のりの順に出す（16× でも飛ばさない）。出した行の id を覚え、後退して戻っても同じ行は 2 回出さない
  - 反応の行: ゾーンの外 → 中で zone-enter、中 → 外で zone-exit（どちらも区間の番号ごとに 1 回だけ。境界を行き来しても繰り返さない）、avoided の遭遇が 1 つ増えるごとに avoided。zone-enter は入ってから 2.5 秒後に出す（琥珀のチャイムと重ねない）。2.5 秒の前に出たら、その区間は zone-enter も zone-exit も出さない（短い出入りでは何も言わない。zone-exit は zone-enter を出した区間だけ。code-reviewer W8。推奨で決定）
  - アラート OFF の走行では zone-enter・zone-exit を出さない（R6a）。avoided は出す
  - 赤（`danger`）の間に出る予定になった行は、出さずに待たせる。赤が終わって 1.5 秒後にまとめて出す（その間にまた赤が来たら、終わってから 1.5 秒を数え直す）。待たせるのは新しい順に 3 行まで（古いものは捨てる）。出すフレームでさらに越えた行は、待たせた行と一緒にそのまま出す（code-reviewer W9）
  - 走り始めと、ステージを移って道のりが飛んだとき（drive-tune R1。運転は鹿ゾーンの区間ごとのステージだけで、ステージの間は先へ移る）は、飛ばした区間の行をまとめて出さず、最後の 1 行だけを出す（移動の間に交わした話として。ほかは出したことにする。推奨で決定）
  - 一度に出た行（まとめて出た・16× で越えた）に鳴らす通知音は 1 回（R8）
  - 一時停止の間は出さない（再開したら出す）。走行の終わりの後は出さない。「もう一度」（restart）は最初から（出した行・数えた回数・待ち行列を消す）
  - 束が途中で替わったら（見本の会話 → api の会話）、替わった時点の道のりより先の行だけを新しい束から出し、待ち行列は捨てる（同じ話を 2 回出さない。数えた回数は引き継ぐ）
- R13 会話の表示（`ChatFeed`）
  - HUD の右側に、新しいものを下にして積む。見えるのは新しい 4 行まで（それより古いものは消える）。1 行は話し手の名前（caption、`ink-muted`）と一言（body、`ink`）を、`surface` の面に `line` の枠で出す。色・文字・余白は tokens.json の CSS 変数だけ
  - 一言は旅の言語（`TripPlan.lang`）で出す。話し手の名前も 4 言語の表から（R10）
  - 現れるときは 0.2 秒で下からふわっと出る。点滅させない。`prefers-reduced-motion` では動かさない
  - 赤の間は会話の欄を不透明度 60% にする（A3-7 の「つぎの楽しみ」と同じ数。前を見てほしい。減光は装飾で、赤の間は新しい行を出さない）
  - 欄は `role="log"`・`aria-label`（4 言語）。読み上げは別の見えない `aria-live="polite"` の領域に、いちばん新しい行だけを入れる（まとめて出たときも 1 回だけ読み上げ、AlertState の読み上げと重ねない）。フォーカスを取らない、操作要素を置かない、ポインタを通す（視線の操作をじゃましない）
  - 絵文字を使わない（アイコンが要るならインライン SVG）
- R14 音量の操作（`AudioControls`）: 消音のボタン（`aria-pressed`）、全体の音量のスライダー（`input type="range"`、0〜100、10 きざみ、`aria-label`）、BGM の ON/OFF のボタン（`aria-pressed`）。押せる大きさは 44 px 以上。4 言語のラベル。鳴らさない設定（R1）のときも操作は出す（値は残る）
- R14a 鳴らさない設定（R1）のときも会話は出す（通知音だけ鳴らない）

### 会話の生成（api）

- R15 生成の API: `POST /api/trips/:id/day/:n/chat`。旅を作った端末だけ（ownerToken。`Authorization: Bearer`。stop-deck と同じ。推奨で決定。旅の id は公開の値なので、Claude の費用を使う権利にしない）
  - 保存の鍵は SHA-256（`chat:v1|tripId|day|data.routes|data.zones`）。同じ鍵の行があれば返し、Claude を呼ばない（200）。無ければ作って保存して返す（201）
  - 同じ鍵の同時の要求は、プロセスの中で 1 つにまとめる（single-flight）。保存で負けたら先に保存した行を返す
  - 1 つの旅に保存できる会話の束は 30 まで（旅程の作り直しで鍵を変え続けられないように）
  - Claude の呼び出しは、plan-trip と共有の同時の枠と 1 日の上限（`countWriterCall`）を使う。外れたら 1 回だけ作り直す（理由のコードだけを渡す）
  - 2 回とも中身が外れた（検証・上限で切れた・断られた・形が違う）鍵は、プロセスの中で 10 分覚え（時間切れ・上流の失敗・認証の失敗・同時の枠・1 日の上限は覚えない。FAIL-41 のとおり、もう一度送れば呼び直す）、その間の同じ鍵の要求には Claude を呼ばずに 502 を返す（画面を開き直すたびに呼ばない。spec-adversary Major。推奨で決定）
  - IP あたり 1 分 10 件（`rateLimit` の名前 `chats.prepare`）
- R16 事実と文の分担: いつ・誰が・何の話題で・どの楽しみ・天気・光は api が決める。Claude は road の行の一言（text）だけを書く。Claude に渡す材料は、マスターの地名・楽しみの名前（4 言語）、話題、話し手の席、人数、経験、月、天気・路面、光だけ（自由入力・統計の数字・金額・時刻を渡さない）。zh は繁体字（台湾）で書かせる
- R17 文の検証（外れたら作り直し → 2 回目も外れたら 502、保存しない）
  - 行の数・id・順が束と同じ。各行に ja / en / zh / ko がそろい、空でない
  - 長さ（コードポイント）: ja・zh 50 文字、ko 60 文字、en 100 文字まで（2026-11-06 に本物の Claude で確かめたら、一律 60 文字では英語が毎回外れて 502 になったため言語ごとにした）
  - 数字・数詞・記号・鹿の語は NFKC で揃えてから見る（全角・半角カナ・丸数字ですり抜けない）。制御文字・ゼロ幅の文字を含まない。zh は漢字を含む（security-auditor W3）
  - 数字（0-9・０-９）を一切含まない。数詞も含まない: 漢数字の 2 文字以上の連なり（「六千」「一万」。「一緒」「十分」は通る）、英語の数詞（hundred・thousand・million・percent など）、韓国語の漢数詞の連なり（「육천」「삼만」）
  - 絵文字・`% ％ ¥ ￥ $ ＄` を含まない（`件` `円` は数字と数詞の禁止で足りるので禁じない。「条件」「円滑」を通す）
  - 鹿の語（鹿・シカ・deer・사슴）を含まない（鹿を見つけた・いると言うのは赤の警告の役割。文字の偽警報を出さない）
  - 言語ごとの文字種（stop-events と同じ: ko はハングル、ja はかな・漢字、zh はかな・ハングルを含まない、en は英字）。zh はよく出る簡体字（们・这・车・开・说・话・没・还・现・边・过・时・会・对・见・么・风・乐）を含まない
  - プロンプトで、ドライバーの気をそらす長い問いかけ・運転の指図をさせない
- R18 端末の会話の取り方（`useChatDeck`）: 旅の場面（`source: 'trip'`）でトークンがあれば POST する（TanStack Query、`staleTime: Infinity`。やり直すのは通信の失敗の 1 回だけ。4xx・5xx はやり直さない）。応答の形を確かめ、さらに tripId・day・data（版）がいまの場面と同じで、すべての cue.leg が移動の数より小さいときだけ使う。トークンが無い・失敗・版が違う・見本の運転は、見本の会話（R19）を使う。取れたら途中からでも api の会話に替える（R12）
- R19 見本の会話（端末の決まった会話）: R11 と同じ形の road の行を端末で作る（各移動の 0.2 km に depart ＋ 20 km ごとの行。ゾーンの中には置かない）。文は決まった 4 言語の表から選ぶ（Claude を呼ばない。数字・鹿の語を含まない）。話し手は人数で決める（R10）。反応の 6 行（R10）は api の会話のときも、この表から出す

## API エンドポイント

### POST /api/trips/:id/day/:n/chat

- **認証**: ownerToken（ヘッダ `Authorization: Bearer`、16 進 64 文字）。詳細は threat.md
- **リクエスト**: body なし（送られても読まない）
- **レスポンス 201**（作った）/ **200**（保存済み）: `{ chat: ChatDeck }`
  - `ChatDeck`: `{ tripId, day, lines: ChatLine[], data: { routes, zones } }`
  - `ChatLine`: `{ id, cue: { kind: 'road', leg, km }, topic, speaker: 'p1' | 'p2' | 'p3' | 'radio', text: { ja, en, zh, ko } }`（反応の行は端末の固定の表なので、api は返さない）

## ユースケース

### UC-1: 会話の束を組み立てる（R10・R11）

- **Given**: 保存した旅とその日の DayPlan
- **When**: 会話の POST
- **Then**: 各移動に depart、距離に応じた話の行（鹿ゾーンの外）。話し手は人数で決まる
- **Examples**: ペルソナ（4 人）の D1（鹿ゾーンを通る）→ p1〜p3、どの行もゾーンの外 / 1 人旅 → radio だけ / 移動の無い日 → 空の束（Claude を呼ばない）/ 0.8 km の移動 → depart だけ / 入口が 1.5 km のゾーン → 候補は作らない / ゾーンの中から出る移動 → depart は出口の 0.2 km 先 / 同じ旅・同じ日 → 同じ束

### UC-2: Claude に書かせて保存する（R15〜R17）

- **Examples**: 正常 → 201、4 言語の一言、2 回目は 200 で Claude を呼ばない / 行が 1 つ足りない → 作り直し → 2 回目も外れたら 502、保存しない / 502 の直後にもう一度 → Claude を呼ばず 502 / 「3回目」「6,705」「六千」「six thousand」「前方に鹿」を含む → 外れ /「路面の条件がいい」「一緒に」→ 通る / トークンなし → 403

### UC-3: 運転の音（R1〜R9）

- **Examples**: 10 km/h → 1 速の半ばで 2,250 rpm・75 Hz / 止まってアイドリング → 900 rpm・大きさ 0.25 / ブレーキ 1・60 km/h → ノイズ 0.6、鳴き 0.15 / ABS → 14 Hz の断続 / 赤 → BGM 0・エンジン半分・通知音なし / 琥珀 → BGM 0.6 倍・通知音なし / アラート OFF の琥珀 → BGM はそのまま・通知音は鳴る / 消音 → 全部 0（alert-ui は別）/ 開発中で `VITE_GAME_AUDIO` が無い → 鳴らさない

### UC-4: 会話を出す（R12〜R14a）

- **Examples**: 道のりが 0.2 km を越える → depart の行が出て通知音 / 0.3 km → 0.1 km（後退）→ 0.3 km → depart は 1 回だけ / 16× で 3 行を一度に越える → 3 行が順に出て通知音 1 回 / 赤の間に来た行 → 赤が終わって 1.5 秒後に出る / 赤が終わって 1.0 秒後にまた赤 → 2 回目が終わって 1.5 秒後に 1 回だけ出る / ゾーンに入る → 2.5 秒後に zone-enter（表示だけ）/ 入口の前後を行き来 → zone-enter は 1 回 / アラート OFF でゾーンに入る → zone-enter は出ない / 5 行目 → いちばん古い行が消える / restart → 最初から

## エラーパターン

| 条件                                         | ステータス | レスポンス                           |
| -------------------------------------------- | ---------- | ------------------------------------ |
| 旅が無い・id の形が違う                      | 404        | `{error:{code:"TRIP_NOT_FOUND"}}`    |
| その日が無い（n が日数を超える）             | 404        | `{error:{code:"DAY_NOT_FOUND"}}`     |
| n の形が違う                                 | 400        | `{error:{code:"INVALID_INPUT"}}`     |
| ownerToken が無い・違う                      | 403        | `{error:{code:"OWNER_REQUIRED"}}`    |
| 保存したしおりをいまのマスターで作り直せない | 409        | `{error:{code:"ITINERARY_CHANGED"}}` |
| 1 つの旅の会話の束が 30 を超える             | 409        | `{error:{code:"CHAT_LIMIT"}}`        |
| IP あたりの上限                              | 429        | `{error:{code:"RATE_LIMITED"}}`      |
| 全体の 1 日の上限（Claude の呼び出し）       | 429        | `{error:{code:"DAILY_LIMIT"}}`       |
| 同時の Claude の呼び出しが上限               | 503        | `{error:{code:"WRITER_BUSY"}}`       |
| Claude の失敗・時間切れ・検証で落ちた        | 502        | `{error:{code:"WRITER_FAILED"}}`     |

### 例外 → ステータスコードマッピング

| UseCase/Domain 例外                       | HTTP ステータス |
| ----------------------------------------- | --------------- |
| `TripNotFoundError`（既存）               | 404             |
| `TripDayNotFoundError`（既存）            | 404             |
| `TripInputError`（既存）                  | 400             |
| `OwnerRequiredError`（既存、stop-events） | 403             |
| `ItineraryChangedError`（既存）           | 409             |
| `ChatLimitError`                          | 409             |
| `DailyLimitError`（既存）                 | 429             |
| `TripWriterBusyError`（既存）             | 503             |
| `ChatWriterError`                         | 502             |

## ビジネスルール

R1〜R19 のとおり。音の値（R3〜R6・R8）は `apps/sim/src/features/drive/audio/` の純粋関数で決め、Web Audio のグラフは薄い差し込み口（テストではフェイク）にする。会話の出し方（R12）は `apps/sim/src/features/drive/chat/` の純粋関数。束の組み立て（R11）と文の検証（R17）は `apps/api/src/domain/chats/policies/` の純粋関数（domain は `@antler/*` を import しない。application が DayPlan と `lightPeriod` から材料を作る）。

## Questions（Deferred のみ残存可）

- [Deferred: 担当=ユーザー（好み）/ 期日=2026-11-08（Day 6）/ 暫定挙動=R3〜R6・R8 の数値] 音の大きさ・高さの釣り合い（実機で聞いて決める）
- [Deferred: 担当=次の feature / 期日=Day 5 / 暫定挙動=文字と通知音だけ] 会話の読み上げ（A3-8 の「テキスト＋音声」）
- [Deferred: 担当=ユーザー / 期日=2026-11-08 / 暫定挙動=消さない（旅の削除で消える）] 会話の束の保持期間（TripPlan と一緒に決める）
- [Deferred: 担当=ユーザー（公開の判断）/ 期日=公開前（Day 6）/ 暫定挙動=共有の 1 日の上限・旅ごと 30 束・失敗の 10 分の記憶・IP あたり 1 分 10 件] 会話専用の 1 日の枠（共有の上限の 25% など。数える表を足すので、濫用が見えてから）

## Test List（Canon TDD Step 1）

外側ループ（受け入れ）:

- [x] AC-41: ペルソナの旅の D1 で会話の POST（Claude はフェイク）→ 201。各移動に depart、話の行は鹿ゾーンの外、話し手は p1〜p3、text は 4 言語。2 回目は 200 で Claude を呼ばない
- [x] AC-42: 会話の束のフィクスチャと運転のスナップショットの列（出発 → 16× で 3 行を越える → ゾーンに入る → 赤 → 赤が終わる）を部品に流すと、ChatFeed に行が順に出て、通知音は緑のときだけ 1 回ずつ鳴り、エンジン・BGM の大きさが赤で下がる（フェイクの音の差し込み口で確かめる）

UC-1 束の組み立て（api）:

- [x] PLAN-1a: 各移動の 0.2 km に depart、話の行は min(3, floor(距離 ÷ 15)) 行の候補、[1 km, 距離 − 1 km] に収める。15 km 未満の移動は depart だけ
- [x] PLAN-1b: 鹿ゾーンの中に落ちた候補は入口の 1 km 手前に動き、また別のゾーンなら繰り返す。1 km 未満・他の行と 1 km 以内になった候補は作らない
- [x] PLAN-1c: 話の行は 1 日 10 行まで（後ろの移動から減らす）
- [x] PLAN-1d: 話題は同じものが続かず、楽しみが残っていない日は pleasure を選ばない。light には通過時刻の光が付く
- [x] PLAN-1e: 話し手は人数 − 1 人（最大 3）、1 人旅は radio。2 人以上なら同じ人が続かない
- [x] PLAN-1f: 移動の無い日は空の束。depart の 0.2 km がゾーンの中なら出口の 0.2 km 先（出口が終わりの 1 km 手前より先なら作らない）
- [x] PLAN-1g: 同じ旅・同じ日 → 同じ束。別の seed → 話の行の位置か話題か話し手が変わる。id は l01 から順

UC-2 Claude の文（api）:

- [x] WRITE-2a: 正常な文 → 検証を通る（4 言語・id・数・順）。「路面の条件がいい」「一緒に」「十分」も通る
- [x] WRITE-2b: 行の id・数・順が違う、1 言語が空、上限（ja・zh 50 / ko 60 / en 100 文字）を超える → 外れ
- [x] WRITE-2c: 数字（半角・全角）・漢数字の連なり・英語の数詞・韓国語の数詞・% ¥ $・絵文字を含む → 外れ。言語ごとの文字種が違う・zh に簡体字 → 外れ
- [x] WRITE-2d: Claude に渡す材料は、話題・席・人数・経験・月・天気・路面・光・マスターの名前だけ（自由入力・時刻・金額・統計の数字が無い）
- [x] WRITE-2e: gateway は max_tokens・refusal・形の違う JSON を rejected で返し、時間切れ・認証の失敗を ChatWriterError にする
- [x] WRITE-2f: 1 回目が外れ → 理由のコードだけを渡して作り直し → 通れば保存して 201。2 回目も外れ → 502、保存しない
- [x] WRITE-2g: 鹿の語（鹿・シカ・deer・사슴）・「前方に鹿」「DEER AHEAD」を含む → 外れ

UC-2 保存と生成（api）:

- [x] SAVE-2a: 同じ鍵の行があれば 200 で返し、Claude を呼ばない（数えない）。data の版が変われば作り直す
- [x] SAVE-2b: 移動の無い日は空の束を保存して返し、Claude を呼ばない
- [x] SAVE-2c: 応答は欄を明示して組み立てる（鍵のハッシュを返さない）

UC-3 運転の音（sim）:

- [x] AUD-3a: 鳴らすかの決まり: 本番は鳴らす。開発は VITE_GAME_AUDIO=on のときだけ。鳴らさないときは音の差し込み口を作らない
- [x] AUD-3b: 仮のギアと回転数（速さ・アクセル）。合図の rpm があればそれを使う。周波数は rpm ÷ 30
- [x] AUD-3c: エンジンの大きさ（アイドリング 0.25、上限 0.9、一時停止・終わりは 0）
- [x] AUD-3d: ブレーキ音（3 km/h 未満は 0、強さ × 速さ、鳴きは 0.6 以上・20 km/h 以上、ABS は 14 Hz）。合図が無ければ入力から強さ 0 / 1
- [x] AUD-3e: 混ぜ方: 音量 × 係数、消音は 0、BGM OFF、赤で BGM 0・エンジンとブレーキ半分・通知音なし、琥珀で BGM 0.6 倍、走行の終わりは BGM 0。アラート OFF ではゾーンで BGM を下げない
- [x] AUD-3f: BGM の曲はシードで決まる（同じシード → 同じ音の列。8 小節・84 BPM・音の高さは範囲の中）
- [x] AUD-3g: 通知音は 2 音（C6 → F6）。2 秒（実時間）以内の 2 回目は鳴らさない。鳴るのは緑のとき（アラート OFF はゾーンでも鳴る）
- [x] AUD-3h: 音のコントローラは差し込み口に値を渡すだけで、同じ値なら変えない。AudioContext は 1 つを使い回す。BGM は 1 小節先まで予約。タブを隠したら止め、戻したら再開。dispose で閉じる
- [x] AUD-3i: 設定は localStorage に残り、壊れた値・読めないときは既定値（60・消音 OFF・BGM ON）

UC-4 会話を出す（sim）:

- [x] CHAT-4a: 話の行は道のりを越えたら出る。一度に越えた複数の行は道のりの順に出る。後退して戻っても同じ行は 1 回だけ
- [x] CHAT-4b: 反応: ゾーンに入って 2.5 秒後に zone-enter、出たら zone-exit（区間ごとに 1 回）、avoided が増えたら avoided。n 回目は添字 (n − 1) mod 2 の行
- [x] CHAT-4c: 赤の間の行は待たせ、赤が終わって 1.5 秒後にまとめて出る（新しい 3 行まで）。間にまた赤が来たら数え直す
- [x] CHAT-4d: 一時停止の間・走行の終わりの後は出さない。restart で最初から
- [x] CHAT-4e: 束が替わったら、替わった時点より先の行だけを新しい束から出し、待ち行列は捨てる
- [x] CHAT-4f: 見本の会話は人数で話し手が決まり、各移動に depart と 20 km ごとの行（ゾーンの外）。反応の表は 6 行。文に数字・絵文字・鹿の語が無く、4 言語そろう
- [x] CHAT-4g: useChatDeck はトークンがあれば Authorization: Bearer つきで POST し、応答の形・日・版・移動の数を確かめる。トークンが無い・見本の運転では取りに行かない。やり直しは通信の失敗だけ
- [x] CHAT-4h: ChatFeed は新しい 4 行まで、新しいものを下に、話し手の名前と旅の言語の一言。role=log・aria-label、見えない aria-live にいちばん新しい行だけ。赤の間は減光のクラス
- [x] CHAT-4i: AudioControls は消音（aria-pressed）・音量のスライダー（0〜100、10 きざみ）・BGM（aria-pressed）を出し、押すと設定が変わる。4 言語のラベル
- [x] CHAT-4j: 道のりは次の移動の始まり − 1 km で抑える（api の km と道の長さがずれても次の移動に食い込まない）
- [x] CHAT-4k: アラート OFF の走行では zone-enter・zone-exit を出さない（avoided は出す）
- [x] CHAT-4l: 走り始めが途中の道のり・ステージを移って道のりが飛んだときは、飛ばした区間の行は最後の 1 行だけ
- [x] CHAT-4m: 運転画面で「出発」「もう一度」が運転の音を鳴らし始め、HUD の右の列に会話と音量の操作が出る。音量のスライダーにフォーカスがあるとき矢印キーで運転しない

認可（threat.md）:

- [x] AUTH-41: 会話の POST にトークンが無い → 403 OWNER_REQUIRED、Claude を呼ばない
- [x] AUTH-42: 会話の POST に別の旅のトークン → 403
- [x] AUTH-43: 会話の POST が 1 分に 11 件目 → 429 RATE_LIMITED
- [x] AUTH-44: 1 日の上限に達したあと会話の POST → 429 DAILY_LIMIT、Claude を呼ばない
- [x] AUTH-45: 1 つの旅の会話の束が 30 に達したあと、新しい鍵の POST → 409 CHAT_LIMIT

## Rule → ドメイン語彙対応

| Rule                       | 語彙                                             | 置き場所                                 | 証明           |
| -------------------------- | ------------------------------------------------ | ---------------------------------------- | -------------- |
| R1: 鳴らすか               | `gameAudioEnabled`                               | apps/sim/src/features/drive/audio/       | AUD-3a         |
| R3・R4: エンジン・ブレーキ | `engineVoice` / `brakeVoice`                     | apps/sim/src/features/drive/audio/       | AUD-3b〜d      |
| R5: BGM                    | `radioScore`                                     | apps/sim/src/features/drive/audio/       | AUD-3f         |
| R6: 混ぜ方                 | `mixLevels`                                      | apps/sim/src/features/drive/audio/       | AUD-3e         |
| R7〜R9: 鳴らし方           | `DriveAudio` / `AudioGraphPort`                  | apps/sim/src/features/drive/audio/       | AUD-3g〜i      |
| R11: 束の組み立て          | `buildChatPlan`                                  | apps/api/src/domain/chats/policies/      | PLAN-*         |
| R12: 出すタイミング        | `advanceChat`                                    | apps/sim/src/features/drive/chat/        | CHAT-4a〜e     |
| R13: 会話の表示            | `ChatFeed`                                       | apps/sim/src/features/drive/chat/        | CHAT-4h        |
| R14: 音量の操作            | `AudioControls`                                  | apps/sim/src/features/drive/audio/       | CHAT-4i        |
| R15: 生成の API            | `PrepareChatUseCase`                             | apps/api/src/application/usecases/chats/ | SAVE-_・AUTH-_ |
| R17: 文の検証              | `ChatWriterGateway` / `validateChatWriting`      | apps/api/src/domain/chats/policies/      | WRITE-*        |
| R18・R19: 端末の取り方     | `useChatDeck` / `fallbackChatDeck`               | apps/sim/src/features/drive/chat/        | CHAT-4f〜g     |
| 組み込み                   | `useDriveSoundAndChat` / `linkDriveSoundAndChat` | apps/sim/src/features/drive/chat/        | CHAT-4m・AC-42 |

## 受け入れ基準

- [x] 受け入れテスト AC-41・AC-42 が Green
- [x] 全 UC / 全エラーパターンのテストが Green
- [x] Test List の全項目にチェック
- [x] 静的解析ゲート通過（lint / format / 型 / 依存方向）
- [x] component-guard・accessibility-checker・performance-analyzer・code-reviewer・security-auditor・layer-guard の Critical 0
