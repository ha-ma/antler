# code-reviewer: feature loss（A-6 喪失画面と POST /api/trips/:id/losses）

対象: `git diff main...HEAD -- apps/`（ブランチ claude/loss-1adb87）。仕様: `docs/specs/loss/functional.md`（R1〜R10・Test List）。
読んだもの: sim の `features/loss/` の全ソース（テストは名前とドメイン部分）、api の losses の usecase・policy・route・schema・repository・gateway・prompt・di・error-mapper・migrate。
コマンド実行（Bash）はこのセッションでは使えなかったため、テスト・lint は走らせていない。指摘はすべてコードを読んだ証拠による。

## 件数

Critical 0 / Warning 8 / Info 9

## 良い点

- 冪等の鍵が「文の材料を決める欄だけ」（tripId・day・leg・alertEnabled・並べ替えた achievedStops）で、`at` を外している。`LOSS_KEY_VERSION` で正規化の版も持つ（collision-policy.ts:85-92）。
- single-flight の `get` と `set` の間に `await` が無く、競合の隙間がない。`finally` で失敗時も必ず消す（write-loss.usecase.ts:73-85）。保存の負け（`onConflictDoNothing` の `rowsAffected`）は例外の文言ではなく件数で見分けている。
- 保存済みの鍵を旅ごとの上限（20 件）より先に引くので、上限後も保存済みの文は返せる。replay では 1 日の上限を数えない（FAIL-5 のテストあり）。
- 応答は `toOutput` で欄を明示して組み立て、鍵のハッシュ・記述子を漏らさない。
- sim: 衝突の情報は URL だけ。`parseCollision` は strict・重複キー拒否・先頭 0 や小数を拒否。しおりを読んだあとの `checkAgainstDay` が api の `checkCollision` と同じ規則。喪失文の fetch は検証後にだけ mount される `StoryPanel` の中にあり、読めない URL では api を呼ばない（UC-1b）。
- `assessLoss` / `strikeItinerary` は純粋関数で、単価は引数（`baseline`）注入。数字は STATS と json から読み、コードに実数が無い。
- MUST の確認: 色の直書きなし（loss 配下に `#hex`・`rgb()` の一致なし。CSS は `var(--…)` のみ）、絵文字なし（✓ / ✕ は SVG の stroke。text.test.ts でも検査）、統計の実数の埋め込みなし（text.ts に 3 桁以上の数なし）。`alert-danger` は ✕ の行だけ、金額は `clay`。

## Critical（修正必須）

なし。

## Warning（推奨）

- [apps/sim/src/features/loss/utils/collision-url.ts:43-56] `lossHref` が値を丸めない。仕様 R1 は「`speedKmh` は 0〜199 の整数に丸める」だが、型のコメントが呼び出し側に整数を求めるだけで、`String(report.speedKmh)` をそのまま書く。drive の速さ・`simMs`（World.t）は実数になりやすく、`54.7` や `812345.6` を渡すと `IntText` が拒否して、衝突のたびに「衝突の情報が読めません」になる。drive-link が丸め忘れると画面全体が失敗するので、契約の側（唯一の生成点）で正規化する。

  ```ts
  const MAX_STOPS = 10
  export function lossHref(report: CollisionReport): string {
    const q = new URLSearchParams({
      day: String(report.day),
      leg: String(report.leg),
      at: report.at,
      speed: String(Math.min(MAX_SPEED_KMH, Math.max(0, Math.round(report.speedKmh)))),
      light: report.light,
      side: report.side,
      stops: report.achievedStops.slice(0, MAX_STOPS).join(','),
      t: String(Math.min(MAX_SIM_MS, Math.max(0, Math.round(report.simMs)))),
    })
    ...
  ```

  テスト `lossHref(速さ 54.7・simMs 812345.6)` → `parseCollision` が null にならない、を UC-1a に足す。

- [apps/sim/src/features/loss/components/LossPage.tsx:124-166 と LossCard/StatTile の呼び出し] `免責・NOC` のプレースホルダが画面で `assessLoss` の `vehicle.deductiblePlaceholder` を使っていない。`text.ts:111` の `tileVehicleNote` に「準備中」が常に書かれ、フラグは計算されるだけの死んだ欄になっている（R3 は「STATS.deductible がプレースホルダのあいだ」と条件つき）。`stats.json` の deductible が確定したとき、画面は「準備中」のまま嘘になる。→ `loss.vehicle.deductiblePlaceholder` が false のとき別の文言（または最大額だけの文言 `tileVehicleNoteMaxOnly`）を出す。UC-3c のテストもフラグの両方で書く。

- [apps/api/src/application/usecases/losses/write-loss.usecase.ts:95-103] 旅ごとの上限（20 件）の確認と INSERT が別の操作で、`countLosses` から `insertLoss` までの間に Claude の呼び出し（最大数十秒）が入る。鍵の違う要求が同時に複数入ると 20 件を超えて保存できる。超過幅は同時の枠（`CLAUDE_MAX_CONCURRENT_CALLS`）までなので害は小さいが、仕様は「20 件まで」と書く。→ 厳密にするなら INSERT 側で `WHERE (SELECT count(*) …) < 20` を条件にするか、仕様に「同時の枠のぶんだけ超えうる」と書く。どちらでもよいが、どちらかをテストか仕様に残す。

- [apps/sim/src/features/loss/hooks/useLossStory.ts:12-13 と apps/api/.../write-loss.usecase.ts:147] クライアントの時間切れ 40 秒の根拠（「api の 30 秒より少し長く」）が、作り直しを含めると成り立たない。api は 1 回の Claude 呼び出しごとに 30 秒、外れたら 2 回目で最悪 60 秒。クライアントは 40 秒で中断して「用意できませんでした」を出すが、api は裏で保存を続ける（その後の「もう一度」は 200 の replay で通るので壊れはしない）。→ 定数のコメントを実態に合わせるか、クライアントの上限を 65 秒前後にする。目標 15 秒（R5）の範囲では起きないので、優先度は低い。

- [apps/api/src/infrastructure/http/routes/loss.routes.test.ts（全体）] HTTP 層で確かめているのは 201/200・404・400・429 RATE_LIMITED・502 だけ。仕様のエラーパターン表のうち 409 ITINERARY_CHANGED、429 DAILY_LIMIT、429 LOSS_LIMIT、503 WRITER_BUSY が route（error-mapper 経由）では未検証。`LossLimitError` の写像は loss 専用に足した新しい分岐（error-mapper.ts:53-56）なのに、`LOSS_LIMIT` というコードが応答に出るテストが無い。sim 側は `error.code === 'LOSS_LIMIT'` で「ボタンなし」を分岐しているので、コード名のずれが画面の挙動を壊す。→ route テストに 4 行足す（usecase を差し替えて各例外を投げ、status と code を見る）。

- [apps/api/src/application/usecases/losses/write-loss.usecase.test.ts:150-162] UC-5f は「両方成功」の同時要求だけ。single-flight の肝は (a) 1 本目が失敗したとき 2 本目も同じ失敗を受ける、(b) 失敗後に `inFlight` が空で、次の要求は Claude を呼び直す、の 2 点。FAIL-1 のテストは逐次なので (b) を一部しか見ていない。→ `ScriptedLossWriter([new LossWriterError('timeout')], gate)` で同時 2 本とも `LossWriterError`、Claude 1 回、続けて 3 本目が成功、をテストに足す。
  あわせて「作り直しの 2 回目も `countWriterCall` を数える」（R8「呼び出しごと」）のテストが無い（FAIL-5 は replay の 0 回だけ）。`2 回目の呼び出しで上限に達したら DailyLimitError、保存しない` も足す。

- [apps/sim/src/features/loss/domain/assess-loss.test.ts:78-93] 実時間の閾値（平均 50 ms 未満）のテストは CI の負荷で揺れる。この関数は 10 日 × 10 件で定数時間に近く、実際は 0.01 ms 台なので、通常は落ちないが、性能の保証としては弱く、落ちたときの原因調査が重い。→ 削除するか、計算量が壊れていないことは `lostPleasures` などの結果で見る。resilience.md の性能の項目は計測ではなく設計（Map 参照で O(n)）で満たす、と書けば足りる。

- [docs/specs/loss/functional.md:13, 147-196, 210-216] `spec_confirmed_at: pending`、Test List と受け入れ基準のチェックボックスがすべて `[ ]` のまま。実装とテストはほぼ出そろっている（上のとおり UC-1〜UC-7 に対応するテストがある）ので、完成判定（sfad-done）の前に、確認日と Test List のチェックを更新する。また `collision-url.ts` 側・`types.ts:15`・`index.ts:2` が参照する `loss-handover.md` はリポジトリに存在しない（`docs/specs/loss/` は functional / plan / resilience / threat の 4 つ）。drive-link が契約を読む場所なので、作るか参照を `functional.md R1` に変える。

## Info（参考）

- [LossPage.tsx:92-195 と StoryPanel.tsx:28-47] 可読性。`LossContent` が約 100 行で、4 つの `StatTile` の組み立て（`fillText` の差し込み）が JSX の中に直書きされている。`MetricTiles({ loss, lang })` に切り出すと `LossContent` が 40 行ほどになる。`StoryPanel` は三項演算子が 3 段（`isSuccess ? … : isError && !isFetching ? (limited ? … : …) : …`）で、レビュー基準の「3 段以上は要リファクタ」に当たる。`renderBody()` を作って早期 return に分けるとよい。
- [collision-url.ts:60-67] `const raw: Record<string,string> = {}` に `key in raw` を使うと、`__proto__` や `toString` のような継承名が「重複」として null になる、または `raw['__proto__'] = value` が無視されて strict を素通りする。実害は無い（知らない欄は strict が拒否、`__proto__` への代入は無視されるだけ）が、`Object.create(null)` か `Map` / `Object.fromEntries` + `getAll` の長さ検査にすると意図が明確になる。
- [collision-url.ts:21] `z.strictObject` なので、共有リンクに `utm_*` や `fbclid` が付くと「読めません」になる。仕様 R1（知らない値は読めない）には合っているが、デモで SNS 経由の URL を使うなら、既知の欄だけ取り出す（`pick`）方が安全。仕様側の判断。
- [hooks/useLossTripDay.ts と hooks/api.ts] brief-map の `useTripDay` と `apiBase` / `errorCode` の重複（ファイル冒頭のコメントで自覚されている）。feature 間 import は barrel 経由のみという規約のため妥当な判断。brief-map 側が barrel で公開した時点で寄せる、と TODO を 1 行残しておくとよい。
- [collision-url.ts:88-101 と api collision-policy.ts:13-37] `checkAgainstDay`（sim）と `checkCollision`（api）は同じ規則の二重実装で、片方だけ直すとずれる。いまは両方のテストがあり規則も一致している（拠点の判定は sim が `legs[].from`、api が `legs[].fromId` で、どちらも slug なので同じ）。共有のテーブルテスト（同じ入力・同じ期待を JSON で置いて双方が読む）にすると、ずれを CI が拾える。
- [claude-loss-writer.gateway.ts:113-114] コメントは「拡張の思考はしない」だが、指定は `thinking: { type: 'between_tools' }`。plan-trip の gateway（claude-trip-writer.gateway.ts:130）と同じ値なので既存パターンには合っているが、コメントと値が食い違って読める。plan-trip と合わせて、値の意味をコメントに書くか、コメントを直す。
- [loss.routes.ts:34-37] body の上限超過は 413 + `INVALID_INPUT`。仕様のエラーパターン表には 413 が無い（入力の形が違うは 400）。sim は 400/413 とも「用意できませんでした」＋「もう一度」になり、押しても必ず失敗する。URL を検証してから送るので到達しないが、表に 413 を足すか 400 にそろえる。
- [LossCard.tsx:63, 82, 88] 読み上げ用の補足の括弧が全言語で全角の `（）` 固定。en/ko の読み上げでは不自然に区切られる可能性があるが、`loss-visually-hidden` 内なので実害は小さい。`aria-label` か `<span class="…"> {t.struck}</span>` の括弧なしでもよい。
- [loss.css:246] 主ボタンの影 `0 6px 0 var(--spruce-deep)` は `tokens.json` の `shadow-press` と同じ値。トークン変数が `--shadow-press` として生成されているなら、そちらを使うと値の二重管理がなくなる。`.loss-row--collision` の alert-danger は trip の紙の上で約 4.3:1（大きい文字の 3:1 は満たす。20px・太字）。コメントで明記されており、accessibility-checker に渡す点として妥当。
- [StatsCard.tsx:39] `key={s.name}`。2 つの出典名が同じになると key が重複する（現状の stats.json は「北海道警察」と「日本損害保険協会」で別）。`${s.name}-${i}` かキーを出典の種別にしておくと安全。

## 仕様とのずれの一覧（R1〜R10）

R1: `lossHref` の丸めが無い（Warning 1）。それ以外は一致（クエリの形・範囲・重複・しおり後の再検証）。
R2: 一致（前の日は達成、衝突日は達成 → ✕ → 残り → 宿、後の日は取り消し線、タイトルにも `<s>`、−1.5° 回転、SVG の ✓ ✕）。
R3: 計算は一致（宿は衝突日以降で stay のある日、`(泊数×宿 + 楽しみ×体験)×人数` を千円で切り捨て、skipped は N に入れない）。免責・NOC の条件つき文言のみずれ（Warning 2）。
R4: 一致（出典名・再照合中の注記）。
R5: 一致（材料は名前と選択肢由来の値だけ。ON のときの文面ルールは prompt にあり、`retry: false`、429 でボタンなし、文の欄だけの失敗）。
R6: 一致（鍵から `at` を外す、成功時のみ保存、single-flight、負けは 200、20 件上限）。上限の厳密さのみ Warning 3。
R7: 一致（`checkCollision` が日・移動・暦日・重複・その日の楽しみ・衝突した移動より先の町を検査）。
R8: 一致（IP 10/分、共有の枠と数え上げ、replay は数えない）。
R9: 一致（ON のときの文言切替、replay の下限 0、alert=off）。
R10: 4 言語の欠けは text.test.ts が落とす。
