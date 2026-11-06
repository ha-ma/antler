---
feature: result-screens
target_paths:
  - apps/sim/src/features/plan-trip/text.ts
  - apps/sim/src/features/loss/components/
  - apps/sim/src/features/loss/utils/drop.ts
  - apps/sim/src/features/loss/utils/links.ts
  - apps/sim/src/features/loss/text.ts
  - apps/sim/src/features/record/components/
  - apps/sim/src/features/record/utils/celebration.ts
  - apps/sim/src/features/record/hooks/useCelebration.ts
  - apps/sim/src/features/record/hooks/useTripRecord.ts
  - apps/sim/src/features/record/text.ts
  - apps/sim/src/features/record/index.ts
spec_confirmed_at: 0aa0bc1
tier: 1
---

# 仕様: result-screens（A-1 の送信ボタンの文言、A-6 の「落ちて積み重なる」、A-7 の「クリア」）

## 概要

ユーザーの 3 回目のローカル確認の指摘（2026-11-06）の 3 つを直す。

1. A-1（`/plan`）の送信ボタン「この旅を守りに行く →」が何をするのか分からない → 押すと起きること（しおりを作り、次の A-2 で鹿ゾーンを地図で確かめる）が分かる言葉にする
2. A-6（`/loss/:id`）: カードのセクションが上から落ちてきて積み重なる。「がっかり感」を出す
3. A-7（`/t/:id`）: 鹿にぶつからずに走りきったあとは「無事にクリアした」と分かる表現。衝突のあと（A-6 から）に来たときは、成功の表現を一切出さない

要件: ch3 A-1・A6-1〜A6-4・A7、ch5（4 言語・アクセシビリティ）、ch8 規約 1・4・7（トークンの色・数字の書体・SVG のアイコン）、`docs/design/README.md` の原則（喪失は clay、alert-danger は鹿検知専用）、AlertState.md（safe の形は円）。
画面: UI キャンバス v2 の A1_Plan・A6_Loss・A7_Record。

**Tier 1 の理由**: 画面の表示と動きだけが変わる。認可・永続化・外部副作用・並行性に触れない（A-6 → A-7 の合図は画面遷移の location state で、保存も送信もしない）。

**範囲外**: 衝突の 3 秒前からのリプレイ（2026-11-06 にユーザーが見送り。R6 で副の導線の文言だけを直す）、鹿の発見の件数の 1 行（drive-crash-spot のセッションが A-6・A-7 に足す。この仕様は、その 1 行が入っても並びが崩れない作りにする）、`features/drive/**` と `app/DriveRoute.tsx`（別セッションが直している）、api の SSR の `/t/:id`（共有の記録。祝いの表現は sim の画面だけ。見出しの文言は変えない）、音（開発中は音を出さない。祝い・落下の効果音は作らない）。

## Example Map

Story: 台湾から来た 4 人の代表として、A-1 でしおりを決めて次へ進む。D2 を鹿アラート ON で走りきったら A-7 で「クリア」を見て安心し、OFF で挑戦して衝突したら A-6 でカードが次々に落ちて積み重なるのを見て、失ったものの重さを感じる。そのあと A-7 の記録を開いても、祝いの表現は出ない。

Questions は 2026-11-06 にすべて推奨で決定した（ユーザーの方針「推奨案のある判断は推奨案で決めて進める」、2026-11-03）。決定は各 Rule に「推奨で決定」と書いた。

- R1 A-1 の送信ボタンの文言（推奨で決定）: 候補 3 つから (a) を選ぶ
  - (a) 「しおりを作って鹿ゾーンを確かめる →」← **推奨**。押すと起きる 2 つ（しおりができる・次の画面で鹿ゾーンを地図で見る）が両方分かる
  - (b) 「この旅の鹿ゾーンを地図で見る →」: しおりを作る（Claude がタイトルを書く・待ちがある）ことが分からない
  - (c) 「しおりを仕上げて次へ →」: 何のために次へ行くのかが分からない
  - 4 言語: en「Make my plan & check deer zones →」、zh「製作手冊並確認鹿區 →」、ko「일정표 만들고 사슴 구역 확인하기 →」（「鹿區」「사슴 구역」は A-2 の文言と同じ語）
  - 同じ言い回しを指すコメント（`useSubmitTrip`・`useCreateTrip`）と plan-trip の仕様（R5 の本文）を合わせる。`docs/reports/` の過去の報告は記録なので直さない
- R2 A-6 の「落ちて積み重なる」（推奨で決定）
  - 落ちるもの: 画面のカードのセクション（Claude の文の欄・4 指標の各タイル・しおりのカード・統計カード）。導線（ボタン）は落とさず、並びの順番の位置で静かに現れる（フェード）。見出し・事実の 1 文は最初から出しておく（遷移で見出しにフォーカスが移り、読み上げが最初に読むもの）
  - 順番: DOM の順（＝読み上げ・Tab の順）。左の列（文の欄 → 4 指標 → 導線）、右の列（しおりのカード → 統計カード）。広い画面でも狭い画面でも同じ順
  - 動き: 画面の上（−70vh）から加速して落ち（ease-in。重さ）、着地で少し潰れて小さく 2 回弾み、わずかに傾いた（−1°〜+1°、しおりのカードは今までどおり −1.5°）まま止まる。1 枚 820 ms、次のカードは 150 ms 遅れて落ちる（全部で 2 秒前後）
  - 傾きは決まった表（乱数を使わない）。落ちたあとも傾きは残る（積み重なった感じ）
  - 色は今のまま（喪失の金額は clay、✕ の行だけ alert-danger）。動きのために新しい色を使わない
  - `prefers-reduced-motion: reduce` では落下・弾み・潰れなし。同じ順に不透明度だけで現れる（1 枚 240 ms、80 ms ずつ遅れる）。傾き（静止）は残す
  - 番号の数え手（`dropSequence()`）は `LossContent` の 1 回の描画ごとに作る（モジュールのスコープ・ref に持たない。再描画・StrictMode でずれない）。傾きの表は番号が表の長さを超えたら頭に戻る
  - 後から足す行（例: 鹿の発見の件数）は、`dropSequence` の次の番号を受け取れば同じ並びに入る。受け取らない要素は動かずに最初から出る（崩れない）
  - 落ちる前（不透明度 0）の要素に Tab でフォーカスが入ったら、その要素は即座に止まった形で見える（`:focus-within` で opacity と transform を `!important` で固定。WCAG 2.4.7。spec-adversary）。animation は外さない（外すとフォーカスが抜けたときに最初から再生し直し、カードが消えて落ち直す。accessibility-checker C-1）
  - しおりの読み込み中・読めない・失敗の画面は動かさない
- R3 A-7 の「クリア」（推奨で決定）
  - 出すもの: (1) 3 状態の safe と同じ形の円（`alert-safe` の線）が描かれ、続いてチェックが描かれる、(2) 大きな「クリア」の見出し（display-xl、`spruce`）と 1 行の説明「D{n} を、鹿にぶつからずに走りきりました。」、(3) 控えめな紙吹雪（24 片、`spruce`・`alert-safe`・`spruce-deep`、1 回だけ落ちて消える。位置と遅れは番号から決まる式で、乱数を使わない）
  - 数字のカウントアップは作らない（推奨で決定）。理由: 4 指標の値は「3 / 4」「1.2 秒」のような組み合わせで、途中の値を読み上げ・画像の保存が拾ってしまう。円とチェックと見出しで「成功」が分かる
  - 置き場所: 本文の左の列の一番上（見出しの上）。円とチェック・紙吹雪は `aria-hidden`・`pointer-events: none`。紙吹雪は落ち終わったら不透明度 0 で残る。「クリア」の文字は読み上げる
  - 「クリア」は見出しにしない（h1 は記録の見出しのまま、見出しの順を崩さない）。祝いを出すときだけ遷移のフォーカスを「クリア」と説明の塊（`<div tabIndex=-1>`。読み上げが両方を読む。accessibility-checker W-1）に移し、h1 のフォーカスを外す。出さないときは今までどおり h1
  - 紙吹雪は帯の幅の 4〜92 % から落ち、横の流れは ±20 px。横は帯の幅で切る（`overflow-x: clip`。320 px 幅で横スクロールを出さない。accessibility-checker W-2）
  - `prefers-reduced-motion: reduce` では動きなし: 円とチェックは描き終わった形で最初から出し、紙吹雪は出さない。「クリア」の文字と説明は出す（成功の情報なので消さない）
- R4 祝いを出すかの判定（推奨で決定）: 純粋関数 `celebrationOf(record, arrival)` が `{ day } | null` を返す
  - `arrival` が「衝突のあと」→ null（一切出さない）
  - そうでなければ、記録の「保存順で最後の run の日」（`record.lastDay`）の結果が `completed` → `{ day: lastDay }`。`collided`・`not-driven`・記録が無い（`not-started`）→ null
  - 「衝突のあと」の合図: A-6 の「旅の記録を見る」のリンクが location state `{ arrival: 'after-collision' }` を付ける（record の barrel の `RECORD_AFTER_COLLISION`）。URL には書かない（共有の URL を汚さない）。同じ履歴の再読み込みでは残る
  - 合図が要る理由（データだけでは足りない）: (a) OFF の挑戦（A7-4）で衝突しても、その日の結果は ON の完走のまま、(b) 衝突の run の保存は裏で続くので、すぐに A-7 を開くと前の記録が見える、(c) 所有者でない端末は衝突の run を保存しない
  - 走行の完走（`DriveRoute` が `recordHref(id)` に移る）は合図を付けない。`app/DriveRoute.tsx` は変えない
  - 合図の無い直の訪問（共有のリンク・ブックマーク・新しいタブ）は、最後の日が完走なら祝いを出す（その旅の記録の事実なので。推奨で決定）
  - OFF だけで走りきった日も「クリア」（鹿にぶつからずに走りきった事実は同じ。推奨で決定）
  - `offResult: 'collided'` では止めない（推奨で決定）: TripRecord に保存の順番が無く、止めると主なデモの流れ（OFF で衝突 → A-6 →「ON でやり直す」→ 完走）で祝いが出なくなる。OFF の衝突のあとは合図と次の「1 回だけ」で防ぐ
  - **祝いは 1 つの履歴につき 1 回**（spec-adversary の Critical。推奨で決定）: 出した履歴（`location.key`）を sessionStorage に覚え（新しい 20 件）、同じ履歴に戻る・再読み込みでは出さない（出すのは「クリア」の帯ごと）。ブラウザで直に開いた最初の履歴の key は `default` なので、同じタブで同じ旅の URL を直に 2 回開くと 2 回目は出ない（タブを変えれば出る。component-guard W1。許容）。衝突のあとにブラウザの戻るで前の A-7 の履歴に戻っても、祝いは繰り返さない。sessionStorage が使えないときは毎回判定する（祝いを出すかどうかだけに使い、失敗しても画面は出る）
  - **古いキャッシュで決めない**（spec-adversary の Critical。推奨で決定）: 画面を開いたあとに取り直した記録が来るまで A-7 は「読み込み中」を出す（TanStack Query の `isFetchedAfterMount`。`useTripRecord` は `refetchOnMount: 'always'` で、キャッシュが新しくても開くたびに取り直す。code-reviewer W2）。祝いを出すかは記録の画面の最初の描画で 1 回だけ決め、そのあとの再取得では足さない・消さない
- R6 A-6 の副の導線「衝突の 3 秒前を見る」の文言（2026-11-06、ユーザーがリプレイを見送り。親セッション経由で推奨で決定）
  - 調べた事実: このボタンは 3 秒前には戻らず、その日の最初から走るだけ（drive は `replay` を読まない。`lossReportFromDrive` の `simMs` は常に null なので `replay` も付かない。`utils/collision-url.ts`）
  - 文言を実際にすることに直す: ja「この日を最初から走り直す」、en「Restart this day from the beginning」、zh「從頭重跑這一天」、ko「이 날을 처음부터 다시 달리기」。主ボタン（アラート ON の衝突では「同じ道を、もう一度走る」）と並んでも区別できるよう「最初から」を入れた
  - 行き先（`/drive?trip&day(&alert=off)`）・関数名 `replayHref`・`replay` のクエリを付ける処理は変えない（`simMs` が null のあいだは付かず、付いても drive は無視する）
- R5 鹿の発見の件数の 1 行（drive-crash-spot）との並び: A-6 は R2 の `dropSequence` を使えば並びに入る。A-7 の祝いの帯は見出しの上の 1 つの塊で、その下に何が足されても位置が変わらない

## ユースケース

### UC-1: A-1 の送信ボタンが何をするか分かる

- **Given**: A-1 をどの言語で開いても
- **When**: 送信ボタンを見る
- **Then**: ja「しおりを作って鹿ゾーンを確かめる →」（4 言語とも R1 の文）。押すと今までどおり `POST /api/trips` → A-2

### UC-2: A-6 のカードが DOM の順に落ちる

- **Given**: A-6 を衝突の情報としおりで開いた
- **When**: 画面が出る
- **Then**: 文の欄・4 指標・導線・しおりのカード・統計カードが `loss-drop` で、DOM の順に 0 から抜けなく増える番号（`--loss-drop-i`）と傾き（`--loss-tilt`）を持つ（テストは決まった番号を書かない。行が足されても通る）。見出しは番号を持たず、フォーカスを受ける

### UC-3: A-7 で完走のあと「クリア」が出る

- **Given**: 最後の run の日が完走の記録、合図なしで `/t/:id` を開いた
- **When**: 画面が出る
- **Then**: 「クリア」と「D{n} を、鹿にぶつからずに走りきりました。」が出て、フォーカスはその 2 つの塊。円・チェック・紙吹雪がある（`aria-hidden`）

### UC-4: A-6 から来たら祝いを一切出さない

- **Given**: 最後の run の日が完走の記録（OFF の挑戦で衝突したが ON の結果が残っている）、location state が `RECORD_AFTER_COLLISION`
- **When**: `/t/:id` を開く
- **Then**: 「クリア」・円の描画・紙吹雪が無い。フォーカスは今までどおり見出し

### UC-5: A-6 の「旅の記録を見る」が合図を付ける

- **Given**: A-6 の画面
- **When**: 「旅の記録を見る」を押す
- **Then**: `/t/:id` に移り、location state が `{ arrival: 'after-collision' }`

## 状態パターン

### S-1: 最後の日が衝突・走っていない・記録が無い

- **Given**: `lastDay` の結果が `collided` / `not-driven`、または `status` が `not-started` → **Then**: 合図が無くても祝いを出さない

### S-2: 動きを減らす設定

- **Given**: `prefers-reduced-motion: reduce` → **Then**: A-6 は transform を使わず不透明度だけで順に現れる。A-7 は円とチェックを描き終わった形で出し、紙吹雪は出さない（CSS の `@media` で切り替える）

## Questions（Deferred のみ残存可）

決着済み（2026-11-06）: リプレイの見送り（ユーザー判断）と副の導線の文言（R6）・文言 (a)・落ちるものと順番・速さ・傾き・reduced-motion・祝いの 3 つ・カウントアップなし・判定の規則・合図の運び方（location state）・直の訪問の扱い（すべて推奨で決定）。

- [Deferred: 担当=人 A（@antler/trip・api）/ 期日=2026-11-08 / 暫定挙動=合図・1 つの履歴に 1 回で防ぐ。本人が OFF の挑戦で衝突した直後に、新しいタブ・ブックマークで A-7 を開くと、その日の ON の完走で祝いが出る] TripRecord に「保存順で最後の run の結果」を足し、判定をそれに替える（record の型・api・SSR に及ぶので別 feature）
- [Deferred: 担当=ユーザー / 期日=なし（2026-11-06 にユーザーが見送り）/ 暫定挙動=副の導線は「この日を最初から走り直す」（その日の最初から走る）] 衝突の 3 秒前から衝突までのリプレイ（推奨は入力の記録＋決定的な再シミュレーション、約 1.5〜2 日・1 回 1〜3 KB）は 2026-11-06 にユーザーが見送り
- [Deferred: 担当=ユーザー（見た目の確認）/ 期日=2026-11-08 / 暫定挙動=R2・R3 の速さ・弾み・紙吹雪の量は推奨の値。重すぎる・派手すぎるなら数値（CSS の変数）だけを直す] 動きの強さの好み

## Test List（Canon TDD Step 1）

- [x] TEXT-1: plan-trip の送信ボタンの文言が 4 言語とも R1 の文で、「守りに行く」系の言い回しが残っていない
- [x] TEXT-2: A-6 の副の導線の文言が 4 言語とも R6 の文で、「3 秒前」を言う文言が残っていない。行き先は変わらない
- [x] DROP-1: `dropSequence` は呼ぶたびに 0, 1, 2 … の番号と、決まった表の傾きを返す（明示した傾きはそれを使う）
- [x] DROP-2: A-6 のカード（文の欄・4 指標・導線・しおり・統計）が DOM の順に番号を持ち、見出しは持たない（UC-2）
- [x] DROP-3: `loss.css` の `prefers-reduced-motion` の中は transform を動かさず、不透明度だけで現れる（S-2）
- [x] DROP-4: 読み込み中・読めない画面には `loss-drop` が無い
- [x] CLEAR-1: `celebrationOf` — 最後の日が完走で合図なし → `{ day }`（UC-3）
- [x] CLEAR-2: `celebrationOf` — 合図「衝突のあと」→ null（最後の日が完走でも。UC-4）
- [x] CLEAR-3: `celebrationOf` — 最後の日が衝突・走っていない・記録なし → null（S-1）
- [x] CLEAR-4: A-7 で完走のあと「クリア」と説明が出て、フォーカスがその塊、円・紙吹雪は `aria-hidden`（UC-3）
- [x] CLEAR-5: A-7 に合図付きで来ると「クリア」・円・紙吹雪が無く、フォーカスは見出し（UC-4）
- [x] CLEAR-6: `record.css` の `prefers-reduced-motion` の中で紙吹雪を出さず、円とチェックの描画の動きを止める（S-2）
- [x] CLEAR-7: 祝いの文言（「クリア」・説明）が 4 言語の表にある（i18n の表の検査に入る）
- [x] LINK-1: A-6 の「旅の記録を見る」が location state `{ arrival: 'after-collision' }` で `/t/:id` に移る（UC-5）
- [x] ONCE-1: 祝いを出した履歴（location.key）に戻る・再読み込みでは出さない。別の履歴なら出す。sessionStorage が使えなくても画面は出る
- [x] FRESH-1: キャッシュに前の記録があるとき、取り直した記録が来るまで「読み込み中」で、来た記録で判定する（前の記録で祝いを出さない）
- [x] DROP-5: 落ちる要素の中にフォーカスが入ったら止まった形で見せ、animation は外さない（`loss.css` の `.loss-drop:focus-within`）

## 非機能要件

- [x] アクセシビリティ: 動きは `prefers-reduced-motion` で止まる。読み上げ・Tab の順と落ちる順が同じ。装飾（円・チェック・紙吹雪）は `aria-hidden`。点滅なし（1 Hz を超える明滅を作らない）。文字は既存のトークンの組み合わせ（spruce on ground 4.5:1 以上）
- [x] 性能: transform と opacity だけを動かす（レイアウトを動かさない）。紙吹雪は 24 片の CSS アニメーションで、終わったら消える
- [x] 決定性: 傾き・紙吹雪の位置は番号から決まる（乱数なし）
- [x] 既存のテストが Green（plan-trip・loss・record）
