# code-reviewer: i18n（e4b3d4a）

対象: `git show e4b3d4a`。仕様 `docs/specs/i18n/functional.md`、記録 `docs/changes/2026-11-06-day5-i18n.md`。
注意: このセッションには shell が無く、テストもフックも実行していない。`git diff 925bb98..e4b3d4a` も取れなかったので、api の 3 つの writing-policy は変更後のファイルだけを読んだ。指摘はすべてコードを読んだ範囲の証拠による。

良い点

- 検査を `packages/i18n-check` に 1 か所へ集め、`mode: 'table' | 'output'` で「UI の固定文は厳しく、Claude の出力は作り直しを増やさない」を分けた設計は筋が良い。
- `2 言語以上のキーで組とみなす → 足りない言語を missing` は、4 つそろうものだけを見る実装より安全。「2 言語だけの組」のテストもある。
- 例外に理由を必須にし、使われなかった例外を落とす（`unusedAllowances`）。古い例外が溜まらない。
- 「表を読めている」(`entries > 300`) と workspaces.test.ts で、検査が黙って止まる事故を防いでいる。
- api の Domain に写しを持ちつつ、`apps/api/tests/i18n/lang-script-parity.test.ts` で i18n-check と一致を見ている。「domain は外部依存なし」の規約と両立しており、api の依存方向は守られている。
- `test_antler_hooks.py` に、`/'/g` や URL の `//` など strip_comments の基本の落とし穴のテストがある。

## Critical（修正必須）

### C1. 関数の葉を黙って飛ばすので、sim の `FALLBACK_PLEASURE_TEXT` / `RADIO_PLEASURE_TEXT`（5 関数 × 4 言語）が 4 言語の検査に一度も当たっていない

- `packages/i18n-check/src/tables.ts:38-52`（flatten は string・配列・plain object だけ辿る）、`:6` のコメント「関数の葉は辿らない」。
- `apps/sim/src/features/drive/chat/chat-text.ts:162-203` は `(n) => ({ ja, en, zh, ko })` の配列。`apps/sim/src/i18n-tables.test.ts` の `EXTRA = {}` で、見本を出していない（`packages/trip` は `samples()` を出している）。
- 影響: ここで zh を簡体字に、ko を ja の写しにしても、ある言語を書き忘れても、`npm test` は緑のまま。`tourism.test.ts:164-172` が見るのはキーの有無・数字・鹿の語・差し込みの含有だけで、文字種・簡体字・新字体は見ない。仕様の目的（全画面が 4 言語で欠けない）に穴がある。
- 直し方（どちらか。両方が望ましい）:
  1. sim の `i18n-tables.test.ts` に、trip と同じく見本を足す。
     ```ts
     const NAME = { ja: '阿寒湖', en: 'Lake Akan', zh: '阿寒湖', ko: '아칸호' }
     const EXTRA = {
       './chat-text.ts（関数の見本）': [...FALLBACK_PLEASURE_TEXT, ...RADIO_PLEASURE_TEXT].map(
         (make) => make(NAME),
       ),
     }
     ```
  2. `collect` で、4 言語の組の中の関数の葉を見つけたら無言で捨てず、`unsampled`（道筋つき）として返し、`checkTables` が「見本の無い関数」を問題として返す。登録は `ALLOW` と同じ理由つき。これで今後の関数の表も黙って抜けない。
- `tables.test.ts:49-58` の「関数は辿らない」テストは、この穴を仕様として固定してしまっている。2 の方針にするなら期待値を変える。

### C2. フックの規則 5 が、Edit / MultiEdit の「差分の断片」に strip_comments を当てるので、ブロックコメントの途中を直すだけで止まる（実行して確かめてはいない。コードから）

- `.claude/hooks/dispatch_local_rules.py:215-225`（`_new_text` は `new_string` の断片を返す）と `:121-175`（`strip_comments` は断片の外の `/*` を知らない）。
- 例: 既存の
  ```ts
  /**
   * 旅を読めるまではブラウザの言語
   */
  ```
  の 2 行目だけを Edit すると、`new_string` は ` * 旅を読めるまでは…` で、`/*` が断片に無い。コメントとして除かれず、`_CJK` に当たる。登録も例外も無いファイル（`DriveScreen.tsx` など大半の UI）では `i18n:` で止まる。
- 影響: このリポジトリは日本語の JSDoc が多い。止まった側は「`I18N_EXEMPT` に足せ」という案内に従いやすく、例外が実態と離れていく。CI（全文を当てる）と挙動がずれる。
- 直し方: Edit / MultiEdit のときは、断片でなく「ファイルの現在の中身に edit を当てた結果」に strip_comments を当てる。`tool_input["file_path"]` を読み、`old_string` を `new_string` に置換した全文で `i18n_violation` を呼ぶ（読めなければ断片に戻す）。さらに保険として、断片の行頭が `*` か `//` で始まる行は、コメントの続きとして除く。
- テストを足す: `i18n(UI, " * 説明\n", key="new_string")` が通ること（コメントの中の Edit）。

## Warning（推奨）

### W1. 簡体字・新字体の一覧に、この製品の中心の語の字が抜けている（すり抜け）

- `packages/i18n-check/src/script.ts:24-32`。
- 新字体（JAPANESE_FORM_CHARS）に無い: 国・観・関・画・体・覧・渓・隠・栄・礼・軽・働・労・戸 など。`国道 240 号`、`観光`、`関連`、`画面` を zh に ja のまま置いても `japanese-form` にならない（zh は `HAN` があるので `script` も通る）。zh の表が「日本語の写し」で通る。
- 簡体字（SIMPLIFIED_CHARS）に無い: 国・园・馆・长・图・单・无・体・区・气・汤・欢 など。観光地の語（公园・博物馆・长い）が通る。
- 直し方: 手書きの一覧をやめ、Unihan（`kJapaneseVariant` / `kSimplifiedVariant` / `kTraditionalVariant`）か OpenCC の対応表から生成する（生成物をコミットし、生成スクリプトは `scripts/` に置く）。当面は上の字を足し、「製品の頻出語（国道・観光・画面・公園・博物館・温泉・湿原）の簡体字・新字体の形が落ちる」ことを見るテストを足す。
- 関連: `内` `来` `当` `数` `区` `写` は簡体字でもあるので、簡体字の文が `simplified` でなく `japanese-form` と報告される（落ちはするが理由が違う）。メッセージの誤誘導だけ。

### W2. 「英語の語」の判定が小文字 3 字以上だけなので、大文字だけの英語が ja / zh / ko の表を通る

- `script.ts:18`（`ENGLISH_WORD = /\p{Ll}{3,}/u`）、`:93`（borrowed）、`tables.ts:126`（neutral）。
- 例: ko に `LOADING` / `DEER ZONE` / `GO TO MAP` を置く、4 言語すべてに `DEER AHEAD`（AlertState の見出しの型）を置く。borrowed または neutral になり、文字種も写しも見ない。`Go to` のように 2 字の語だけの句も通る。
- 直し方: 英語の語を「ラテン文字 3 字以上（大文字も）」にし、略語・単位は明示の許可リスト（`GPS` `USB` `DAY` `ON` `OFF` `km` `4WD` `EZO ROAD`）にする。許可リストはテストで固定する。許可リストの外の `GPS` 級の語が増えたら `ALLOW`（理由つき）で足す、という運用にする。
- 逆の過検出: `Mac Mini` `Google Maps` `iPhone` `Chrome` のような固有名詞だけの文は、ja / zh / ko では `script` になる（neutral でも borrowed でもない）。表に出たら `ALLOW` が要る。許可リストに固有名詞を足す方が素直。

### W3. 例外（`TableAllowance`）の効き方が広すぎる

- `tables.ts:166-172`。`a.path === path`（ファイル名なし）で一致すると、同じ道筋の別ファイルの同じ規則も隠す。規則だけで言語を見ないので、`script` の例外が 4 言語すべてに効く（`Space` のつもりが他言語の崩れも隠す）。
- 直し方: `TableAllowance` に `lang?: Lang` を足し、必須に近い扱いにする。ファイル名なしの道筋は許さず、`'file:path'` に絞る。sim の例外（`HUD_TEXT.controls.3.0`）は `lang` を足すだけで済む。

### W4. `isLangRecord` の「2 言語以上」の境目

- `tables.ts:28-30`。キーが 1 つだけ（`{ en: 'Loading' }`）の組は組と見ず、CJK を含むときだけ `untranslated` になる。英語だけが書かれた組は無言で通る。型（`Record<Lang, …>`）が守る場所は問題ないが、`Partial` の表や `satisfies` の無い表では抜ける。
- 直し方: 1 キーでも `LANGS` のキーなら組として見る方針にできないか検討（`{ ja, en }` の autonym など 1 言語キーの別用途が出ると過検出になるので、`ALLOW` で受ける）。しないなら、仕様に「1 言語だけの組は見ない」と明記してテストで固定する。
- 補足: `collect` の `seen` は同じオブジェクトを 2 回見ない。同じ表が 2 つのファイルから再 export されると、2 つ目の道筋の例外が `unusedAllowances` になる。

### W5. 規則 5 の「登録」が import されていれば足りる

- `dispatch_local_rules.py:178-191`。`i18n-tables.test.ts` が import するファイルは、中身が検査されなくても「登録済み」になる（見本づくりの補助関数を import しただけで、そのファイルの直書きが通る）。
- 直し方（軽い方）: 登録は `EXTRA` / `import.meta.glob` に渡すものだけ、というテスト側の約束にして、i18n-tables.test.ts の先頭に `// i18n-registered: ./locale.ts` のような明示のコメントを並べる（コメントは strip で消えるので、strip 前に読む）。重い方: 検査後に「渡した表のモジュール名の一覧」を JSON に書いて hook が読む。
- 同じ関数 `:189` の `resolved in (target, posixpath.join(target, "index"))` は、`x.ts` の判定に `./x/index` の import が当たる。意図は「`./x`（ディレクトリ）の import が `x/index.ts` に当たる」だけで、`f"{resolved}/index" == target` の項で足りている。`posixpath.join(target, "index")` の項は削る（別ファイルを登録済みと誤る）。

### W6. `strip_comments` の字句解析の穴

- `dispatch_local_rules.py:121-175`。
  - `=>` と `return` の直後の正規表現（`s => /'/.test(s)`、`return /["']/g`）。`prev` が `>` や英字なので割り算扱いになり、中の `'` が文字列の始まりになる。以降の引用符の偶奇が逆になり、本物の文字列を「コード」として扱って `//` 以降を捨てる（URL の後ろの CJK が消える）。`_REGEX_BEFORE` に `>` を足し、`return`/`typeof` の直前語の判定を足す。
  - テンプレートの `${ … }` の中の別の引用符・テンプレートで引用符の対応が崩れる。`${}` の深さを数えるか、「引用符が行の終わりまで閉じなければ戻す」（`'` と `"` は改行で閉じる）。後者だけでも JSX の地の文のアポストロフィ（`Don't`）による全文の取り違えを防げる。
  - 取り違えは「残す方」（コメントの CJK を数える）には安全側だが、上の `//` の後ろを捨てる方向では見逃しになる。
- テストを足す: 上の 3 ケース、`</p>` を含む JSX、`'https://x' + '出発'`。

### W7. `I18N_EXEMPT` はファイル単位で、今後の画面の文を通してしまう

- `dispatch_local_rules.py:87-112`。実態と理由は概ね合っている（`StartOverlay.tsx:34` は `trip ? scenario.trip.title : t.title` で見本の title を出さない、`LangSelect` は自称）。ただし単位がファイルなので、`scenario.ts`（見本の旅の title ＋ 例外の文）、`tourism.ts`、`day-plan.ts` に後から画面の文を足しても止まらない。`scenario.ts` の理由は TripPlan の title だけを述べ、`:106` `:111` の throw の文は書いていない。
- 直し方: 例外に「許す行の文字列」（部分一致）を持たせる（`{path: [理由, 許す文の断片...]}`）。最低でも `scenario.ts` の理由に throw の文を書く。
- `apps/api/src/infrastructure/http/views/` は検査のテストが無く（`None`）、名前の規則のファイル（`*-text.ts`）に移せば hook は通す。その表を 4 言語で見る場所が無いので、`:207-208` の案内どおりに移すと検査されない表が生まれる。views 用の `i18n-tables.test.ts` を api に作るか、案内を直す。

### W8. `htmlLang` が少なくとも 8 か所に複製され、`ChatFeed` だけ `zh-TW`

- `apps/sim/src/features/drive/chat/ChatFeed.tsx:23`（`zh-TW`）、他は `zh-Hant`: `app/AppErrorBoundary.tsx:8`、`pwa/src/app/AppErrorBoundary.tsx:7`、`loss/components/LossPage.tsx:29`、`record/components/RecordContent.tsx:20`、`RecordPage.tsx:14`、`brief-map/components/BriefPage.tsx:20`、`stop-events/utils/format.ts:32`、`plan-trip/utils/lang.ts:4`。
- `DriveScreen.tsx:6` は `../chat/ChatFeed`（コンポーネントのファイル）から `htmlLang` を取る。同じ画面の中で `lang` 属性が `zh-TW` と `zh-Hant` に割れる（`DriveScreen` の `<main>` が `zh-TW`、`LossPage` が `zh-Hant`）。
- 直し方: `@antler/trip` の `locale.ts`（`initialLang` の隣）に `htmlLang(lang)` を 1 つ置き、全部差し替える（B の pwa は alert-ui が凍結 API なので `@antler/trip` を使うか、pwa 内に 1 つにする）。`zh-Hant` に揃える（繁体字を示す。ch5 は繁体字）。

### W9. `initialLang` の取り出しがエラー画面・読み込み前にも広がった（既存の挙動の影響範囲の注意）

- `packages/trip/src/locale.ts:10-22`。`navigator.languages = ['zh-CN', 'en-US']` で、最初の `zh-CN` で `ja` を返し、次の `en-US` を見ない。簡体字の利用者が英語を第 2 言語にしていても日本語の読み込み中・エラーを見る。さらに `startsWith('ko')` は `kok`（コンカニ語）、`startsWith('en')` は `enm` などの別言語に当たる（実害は小さい）。
- この commit が `initialLang` を読み込み前・失敗・LossPage・AppErrorBoundary に広げたので、今は影響が目に見える。A-1 の既存の仕様（zh は繁体字の地域だけ。当てはまらなければ ja）を守るなら、`zh-Hans` / `zh-CN` は `continue`（次の候補へ）にし、全部外れたら `ja` にする。タグは `tag === 'ja' || tag.startsWith('ja-')` の形に。仕様変更になるなら「推奨で決定」を PR に書き、A-1 のテストを直す。
- 補足: sim の `errorLangOrder(first: Lang)` と pwa の `errorLangOrder(languages: readonly string[])` は同名で引数の型が違う。pwa に合わせて sim も `languages` を受け、`browserLang` の呼び出しを関数の中に閉じると読みやすい。

### W10. api の `lang-script-policy` の「含めば通る」判定（Domain の検証が緩いまま）

- `lang-script-policy.ts:24-29`。ja は仮名か漢字が 1 字あれば通る、zh は漢字が 1 字あれば通る、en はラテン文字が 1 字あれば通る。`雪原 a 路` は en で通る、`Snow road 雪` は zh で通る。出力の規則としては「訳し忘れ・言語の取り違え」の全体を見るには弱い。
- ただし、これは変更前から同じ強さかを diff で確かめられていない。弱めてはいないはずだが、`git diff` で、旧の各 policy が持っていた検査（特に chat-writing-policy の簡体字・仮名の検査、`norm`（NFKC）に当てていたか）が失われていないか、レビュー側で 1 度確かめてほしい。現在の chat は `langScriptProblems(lang, text)` を NFKC 前の `text` に当てる（簡体字・仮名には NFKC の差は出ない。半角カナは `Script=Katakana` に含まれるので通る）。
- 直し方（強めるなら）: 割合で見る（`Han|Kana` の字が文字種の字の過半、など）。作り直しを増やさない方針なら、今のままでよい。Info 扱いで構わない。

## Info（参考）

- `script.ts:12` と api の `lang-script-policy.ts` の `SIMPLIFIED` は同じ一覧の写し。parity テストが一覧と 15 の見本の判定を見ている。一覧を W1 で変えると、2 か所を同時に直す。生成にするなら domain の側は生成物を commit する形で（Domain は外部依存なし、を守れる）。
- `parity` の見本に `D{n} 雪`（差し込み）と空文字が入っているのは良い。`JAPANESE_FORM_CHARS` は output モードで使わないので parity の対象外で正しい。
- `_CJK`（Python）と `hasCjk`（TS の `\p{Script=…}`）が同じ範囲かは、片方に字を足したときにずれうる。両方に当てるサンプル（`々` `〇` `ｱ` `ﾡ` `\u{20000}` `ㇰ` `ᄀ`）を共通の JSON に置き、TS のテストと `test_antler_hooks.py` が同じ表を読むと、ずれが落ちる。
- `INVISIBLE`（tables.ts:33）は `U+200B-200D`、`2060`、`FEFF`、`00AD` だけ。`U+200E/200F`（LRM / RLM）や `U+180E`、`U+034F` は空判定をすり抜けるが、実害は小さい。api の chat は `\p{Cc}` と `200B-200F` まで見ている。揃えるなら共通化。
- テストが振る舞いを見ているか: `tables.test.ts` は `rules(...)` の戻り（問題の種類と言語）を見ていて、振る舞いのテストになっている。足りないのは、W1・W2 の「頻出語の落ち方」と、C1 の関数の葉、`mode: 'output'` で `ko` が漢字語だけの文を通すこと（`ko: '出發'` は table の `script:ko` を見ているが、output の期待は無い）。`lang-script-policy.test.ts` の GEN-2（4 つの口 × 全欄 × 4 言語で崩して `script` を期待）は、口の抜けを機械で止めていて、特に良い。
- sim の画面（`DriveScreen.tsx` / `LossPage.tsx` / `AppErrorBoundary.tsx`）: `lang` 属性は `<main>` に付き、4 言語を並べるエラー画面は `<p lang>` で行ごとに付いていて、読み上げの観点で正しい。`TripMessage` の `role` も `busy ? 'status' : 'alert'` で適切。`isPending` から旅の言語に変わる瞬間の言語の切り替え（ちらつき）は R5 の仕様どおり。
- `browserLang()` は render のたびに呼ばれる（安価）。`DriveScreen.tsx:37` の `browserLangs()` は `createEngine` の中で呼ばれるので、1 度だけ。
- `docs/changes/2026-11-06-day5-i18n.md:17` の表は `?lang=ja|en|zh|ko` の `|` が表の区切りに当たって崩れている（表が壊れて読める）。`\|` にする。
- 良い点（再掲）: 表を読めているかのカウント下限（`entries > 300` `> 150`）は、表を足しても減る事故を止めるが、表を削る正当な変更で落ちる。下限を「今の数の 8 割」に置いている点は保守的で良い。
