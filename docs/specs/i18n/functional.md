---
feature: i18n
target_paths:
  - packages/i18n-check/
  - apps/sim/src/i18n-tables.test.ts
  - apps/pwa/src/i18n-tables.test.ts
  - packages/trip/src/i18n-tables.test.ts
  - packages/alert-ui/src/i18n-tables.test.ts
  - packages/alert-ui/package.json
  - apps/sim/src/features/drive/components/hud/hud-text.ts
  - apps/sim/src/features/drive/components/season-text.ts
  - apps/sim/src/features/drive/scene/dashboard-text.ts
  - apps/sim/src/app/app-text.ts
  - apps/pwa/src/app/app-text.ts
  - apps/api/src/domain/shared/policies/lang-script-policy.ts
  - .claude/hooks/dispatch_local_rules.py
  - scripts/tests/test_antler_hooks.py
spec_confirmed_at: 056dadd
tier: 1
---

# 仕様: i18n（A と B の全画面が 4 言語で欠けないことを機械で確かめる）

## 概要

ロードマップ Day 5、付録 A #9「4 言語が全画面で欠けない」。ch5 の多言語（ja / en / zh-TW / ko を MUST）を、**文言の表を全部読む共通の検査**で守る。
いまは表ごとのテストが「空でない」だけを見ていて、(1) ja のままの写し・別の言語の文字（ko に仮名、zh に簡体字や日本の字体）を見ない、(2) テストの無い表がある（HUD・季節・会話・音量・おすすめ・出来事・喪失の一部）、(3) alert-ui の `i18n.test.ts` は `test` の script が無く `npm test` で回っていない、(4) 運転の HUD・季節の切り替え・エラー画面・A-6 の読み込み前は ja しか無い（drive-3d の Deferred「HUD の文言の 4 言語化（担当 i18n、期日 Day 5）」）。

Tier 1 の理由: 認可・永続化スキーマ・外部副作用・並行性に触れない。文言の表と、その検査、表を読む側の取り出し方だけが変わる（api の Claude の出力の検証は規則を 1 つにまとめるだけで、口・保存・作り直しの回数は変えない）。

要件: ch5（多言語）、ch8（UI 実装規約）、付録 A #9・#4、`docs/design/AlertState.md`（主文の言語と副文 3 言語）。

**範囲外**: CSS・配置・入力（mobile-landscape のセッション）、`scene/` の描画とバンドル（performance のセッション）。文言の中身のネイティブ確認（zh-TW・ko。一覧を `docs/reports/` に残して Deferred）。

## Example Map

Story: 台湾から 4 人で来た運転手が、旅をつくってから記録を共有するまで、どの画面でも日本語だけの行・読めない四角・空の欄に出会わない。開発者が文言を 1 つ足し忘れても、CI が落ちて気づく。

- R1 置き場所（推奨で決定）: **TS の表のまま**にし、JSON に移さない。ch5 の「UI 文字列は JSON 辞書」は「画面のコードから分けた、データだけの辞書」と読み、TS のオブジェクトのリテラル（`Record<Lang, string>` の型つき）で満たす
  - 理由: 表は 16 ファイル・約 2,300 行あり、差し込み（`{name}`）・関数（AlertState の読み上げ）・型（`Record<Lang, …>` で言語の欠けを型が止める）を持つ。JSON に移すと型の保証が無くなり、関数の文言は移せない。Day 5 に 2 つのセッションが同じ画面を並行して直しているので、全部の import を書き換える移行は衝突の費用が大きい（推定 1 日分、得るものは「JSON であること」だけ）
  - 楽しみ・地点・ゾーンの名前はもとから JSON（`packages/trip/data/*.json`、zones の GeoJSON）。これも同じ検査に通す
- R2 共通の検査（推奨で決定）: 新しい dev 用のパッケージ `@antler/i18n-check`（`packages/i18n-check`）に、規則を 1 つだけ置く。各 workspace は `src/i18n-tables.test.ts` を 1 つ持ち、表を `import.meta.glob` で**ファイル名から自動で集めて**検査に渡す（登録を忘れられない）。名前の規則に合わない表は、そのテストに明示して足す
  - 4 言語の組: キーに `ja`・`en`・`zh`・`ko` のうち **2 つ以上**を持つオブジェクト（足りない言語は `missing`。spec-adversary H1）。表の中を辿って全部の組を見る。`Record<Lang, {…}>` の形（言語が外側）の表は、4 言語の道筋の和集合で組をつくり、ある言語に無い道筋を `missing` にする（配列の長さ違いも当たる）
  - 組の外にある、仮名・漢字・ハングルを含む文は `untranslated`（1 言語だけの表を見つける。HUD がこれだった）
  - 表の中の関数（文を作る関数。モジュールの一番上の export の関数は道具なので数えない）は `unsampled`。値を読めないので、テストで呼び出しの見本を足して検査し、その道筋を理由つきの例外にする（code-reviewer C1: 会話の楽しみの文の関数が一度も検査されていなかった）
  - 関数の葉は辿らない。表は `Record<Lang, …>` の定数で export し、言語での取り出し（`hudText(lang)`）は添字で引くだけにする。差し込みは関数でなく `{name}` のテンプレートにする。関数で作る文（`@antler/trip` の `draftTitles`・`riskReasons`、AlertState の読み上げ）は、その表のテストで見本を出して組にして渡す
  - JSON の表（`packages/trip/data/pleasures.json`・`places.json`、`packages/zones/data/zones.geojson` の名前）は trip のテストが明示して読む
- R3 規則（1 つの組ごと。外れたら道筋と規則の名前を出して落とす）:
  - `missing`: 4 言語のどれかが無い / `empty`: 空・空白・見えない文字（ゼロ幅スペースなど）だけ
  - 文字種の判定は `\p{Script=…}`（`Script_Extensions` ではない。`・`・`ー` は仮名に数えない）
  - 英語の語: 小文字のラテン文字が 3 つ以上続くもの（`Loading`）。略語・単位（`ON`・`4WD`・`km`・`DAY`）は当たらない
  - 中立の文: 4 言語がまったく同じで、仮名・漢字・ハングルも英語の語も含まない文（`EZO ROAD`・`km/h`・`TRIP RECORD ・ {dates}`）は、文字種の規則を当てない。4 言語に同じ英文を写した組（`Loading` ×4）は中立にならず落ちる（spec-adversary H3）
  - `script`: ja は仮名か漢字を含みハングルを含まない / en はラテン文字を含み仮名・漢字・ハングルを含まない / zh は漢字を含み仮名・ハングルを含まない / ko はハングルを含み仮名を含まない（漢字語は許す）。ja・zh・ko で仮名・漢字・ハングルを含まない文は、英語の語が無ければ許す（`ON`・`4WD`・`{km} km`）。差し込み `{…}` を除いて文字の無い文（数字・記号だけ）は当てない
  - `simplified`: zh に簡体字（決まった字の一覧。繁体字でも別の意味で使う `云`・`万`・`后`・`里`・`台`・`干` は入れない）/ `japanese-form`: zh に日本の新字体（`発`・`駅`・`図`・`転`・`気`・`内` など、繁体字で別の字になるもの）。両方の一覧は `@antler/i18n-check` の 1 か所だけに置き、同じ字を両方に入れない
  - `copy`: en・ko が ja と同じ文（ja が仮名・漢字・ハングルを含むとき）。zh が ja と同じ漢字だけの文は `copy` にしない（spec-adversary M1 は検討したが、「阿寒湖」「富良野」「旭山動物園」のような地名・固有名詞が繁体字でも同じ字で、実データで 9 件すべてが誤検出だった。ja の写しは `script`（仮名）と `japanese-form`（新字体）で拾う。漢字だけで新字体の無い語の写し（「再開」など）は拾えないので、ネイティブ確認に回す）
  - `placeholder`: `{name}` の名前の集まりが 4 言語でそろわない
  - 例外は表ごとに「道筋・規則・理由」を書いて許す（理由の無い例外は書けない型にする）
- R4 漏れの検査（推奨で決定。spec-adversary H2・M4 を受けて「行の形」でなく「文字」で見る）: antler の規則（`.claude/hooks/dispatch_local_rules.py` の規則 5）に「i18n の直書き」を足し、hook（Write / Edit）と `scripts/ci_arch_check.py`（CI。dispatcher 越しに全追跡ファイル）の両方で当てる（推奨で決定: `ci_arch_check.py` 本体は Amptech 由来で `setup-from-amptech.sh` が上書きするので、antler の規則の置き場所に書く。自己テストは `scripts/tests/test_antler_hooks.py`、`--self-test` には `routes.toml` の probe を 1 つ足す）。UI の源（`apps/sim/src`・`apps/pwa/src`・`packages/alert-ui/src`・`packages/trip/src`・api の SSR `apps/api/src/infrastructure/http/views`）のテストでない `.ts`・`.tsx` から**コメントを除いて**、仮名・漢字・ハングルが 1 字でも残るファイルは、次のどれかでなければ CI が落ちる
  - 名前の規則（`text.ts`・`*-text.ts`・`i18n.ts`）に合う表（その workspace の `i18n-tables.test.ts` が自動で集める）
  - その workspace の `i18n-tables.test.ts` が**相対パスの import** で読む表（コメントに名前を書くだけでは通らない）
  - `dispatch_local_rules.py` の例外の表（`I18N_EXEMPT`）に、ファイルと理由が書いてある（例: 利用者に出ない内部の例外の文・開発用の見本のデータ）
  - これで JSX の地の文・属性・`throw new Error('…')`・フックの中の文字列・canvas に描く文も拾う。`--self-test` に、Prettier の折り返し・外側が言語の表・JSX の地の文・属性・コメントだけのファイル（落ちない）を入れる
- R5 HUD の 4 言語化（drive-3d の Deferred を閉じる）: `HUD_TEXT`・`WEATHER_TEXT`・`SURFACE_TEXT`・`SEASON_TEXT` を 4 言語にし、`hudText(lang)` のように言語で取り出す。言語は旅の `TripPlan.lang`（エンジンの `snapshot.lang`、出発の案内は場面の言語）
  - 旅を読み込む前（読み込み中・見つからない・失敗）の文は、ブラウザの言語で出す。A-6 の読み込み前・失敗（いまは `lang="ja"` 固定）も同じにする
  - 「ブラウザの言語」の正（推奨で決定。spec-adversary Q1）: **A（sim）は `@antler/trip` の `initialLang`、B（pwa）は `@antler/alert-ui` の `resolveLang`** のまま。A-1 と B-0 がすでにそれぞれを使っていて、同じアプリの中で揃っていることを優先する。`resolveLang` は凍結の API なので変えない。違いは「当てはまる言語が無いときの既定」（A は ja、B は en）と、`zh-CN`・素の `zh` の扱い（A は ja、B は次の候補か en）。A は日本の道の案内が主で、B は車載の警告で英語が最も広く読めるため。対応表:

    | navigator.languages           | A（initialLang） | B（resolveLang） |
    | ----------------------------- | ---------------- | ---------------- |
    | `['ja']`                      | ja               | ja               |
    | `['en-US']`                   | en               | en               |
    | `['ko-KR']`                   | ko               | ko               |
    | `['zh-TW']`・`['zh-Hant-TW']` | zh               | zh               |
    | `['zh-CN','en']`              | ja               | en               |
    | `['fr']`・`[]`                | ja               | en               |

  - 見本の場面（`/drive` に `trip` が無い開発用）は `?lang=ja|en|zh|ko` で言語を選べる（無い・知らない値ならブラウザの言語）。4 言語の画面を撮って確かめるため（推奨で決定）。旅の場面では `?lang=` を読まない（旅の言語が正）
  - 読み込み中から旅の言語に切り替わるとき、`lang` 属性（`htmlLang`）も同じ言語に変わる。読み上げ（AlertState）はもとから旅の言語
  - キーの名前（W・S・A / D・Space）と単位（km/h・km）は言語に依存しない。「マウス」は 4 言語にする
  - ダッシュボードのナビの文字（`scene/dashboard-text.ts` の `navText`）は 4 言語の表にし、`lang` を受け取れるようにする（既定は ja）。**Dashboard.tsx（canvas の描画）への配線は performance のセッションの範囲なので Deferred**
- R6 エラー画面（`AppErrorBoundary`、sim と pwa）: 描画が壊れたときは旅の言語を信用できないので、**4 言語を全部並べて出す**（AlertState の副文と同じ考え。推奨で決定）。主の行はブラウザの言語
- R7 TopBar の `aria-label="条件"` などの直書きを表に移す
- R8 Claude が書く文の口（しおり・出来事の場面・喪失文・車内の会話）: 4 つの口の検証（`trip-writing-policy`・`stop-writing-policy`・`loss-story-policy`・`chat-writing-policy`）の文字種の規則を 1 つ（`apps/api/src/domain/shared/policies/lang-script-policy.ts`）にまとめる。外れたら今までどおり 1 回だけ作り直す。4 言語の出力の検査がすべての口・すべての文の欄にあることをテストで固定する
  - 置き場所（推奨で決定。spec-adversary 甘い仮定 1）: api の Domain は外部のパッケージに依存しない決まり（apps/api/CLAUDE.md）なので、`@antler/i18n-check` を import しない。domain に純粋な TS で規則を書き、api のテストが `@antler/i18n-check` の `scriptProblems(lang, text, { mode: 'output' })` と同じ判定になることを見本の文で確かめる（2 か所の定義がずれたら落ちる）
  - 実行時の規則は表より緩くする（作り直しを増やさない。spec-adversary Q2・Q3）: **en は漢字を許す**（「Lake Mashu (摩周湖)」のような標識と同じ地名の併記。仮名・ハングルは落とす）、`japanese-form` は当てない。zh は「漢字を含む・仮名とハングルなし・簡体字なし」に 4 つの口でそろえる（いままで簡体字と「漢字を含む」は会話だけだった）。ko・ja は表と同じ
  - 作り直しの増え方: 既存のテストの fixture（4 つの口の正しい出力）が新しい規則でも通ることで確かめる。本番の外れの割合はログ（`*.validation_failed` の code）で見る（Deferred）
- R9 欠けを埋める: 検査で見つかった欠けを 4 言語で埋める。zh は繁体字（台湾の言い方）。ネイティブ確認が要るもの（新しく書いた zh・ko の文）は一覧を `docs/reports/2026-11-06-i18n-native-check.md` に残す
- R10 目で見る確認: 4 言語に切り替えて全ルート（sim: A-1 `/plan`・A-2 `/trip/:id/brief`・A-3/A-5 `/drive`・A-4 `/trip/:id/day/:n/stops`・A-6 `/loss/:id`・A-7 `/t/:id`、api の SSR `/t/:id`、pwa: B-0/B-1・B-2/B-3）を開き、文字の切れ・はみ出しを撮って確かめる。結果を `docs/reports/2026-11-06-i18n-screens.md` に残す（直すのが CSS なら mobile-landscape に渡す）

## ユースケース

### UC-1: 表の欠けで CI が落ちる

- **Given**: どれかの表の ko が空、または ja の写し
- **When**: `npm test`
- **Then**: その workspace の `i18n-tables.test.ts` が、ファイル・道筋・規則の名前つきで落ちる

### UC-2: 新しい表の登録漏れで CI が落ちる

- **Given**: 名前の規則に合わないファイルに 4 言語の文字列の表を足した
- **When**: `python scripts/ci_arch_check.py`
- **Then**: 「i18n-tables.test.ts に登録が無い」と落ちる

### UC-3: 運転の HUD が旅の言語で出る

- **Given**: zh の旅の 1 日目を開く
- **When**: 出発の案内・HUD・終わりの帯を見る
- **Then**: 地の文がすべて繁体字（キーの名前と単位を除く）。ja の文が残らない

### UC-4: Claude の zh の文に簡体字・仮名が混じると作り直す

- **Given**: 4 つの口のどれかで、Claude の zh の文に簡体字か仮名がある
- **When**: 出力を検証する
- **Then**: `script`（または `simplified`）で外れ、1 回だけ作り直す（今までの作り直しの流れのまま）

## 状態パターン

### S-1: 旅の言語が分からない間

- **Given**: 旅を読み込む前・読み込みに失敗した・描画が壊れた
- **Then**: ブラウザの言語で出す（エラー画面は 4 言語を並べる）。ja に固定しない

## Questions（Deferred のみ残存可）

決着済み（2026-11-06、推奨で決定）: TS の表のまま（R1）、検査の置き場所と自動の収集（R2）、規則（R3）、登録漏れの検査（R4）、読み込み前はブラウザの言語（R5）、エラー画面は 4 言語を並べる（R6）、規則の共有（R8）。

- [Deferred: 担当=ユーザー（ネイティブの確認者）/ 期日=2026-11-08（Day 6）/ 暫定挙動=Claude が書いた zh-TW・ko の文で出す。一覧は docs/reports/2026-11-06-i18n-native-check.md] zh-TW・ko の文言のネイティブ確認（付録 A #4、alert-ui の Deferred を引き継ぐ）
- [Deferred: 担当=人 A（api）/ 期日=2026-11-08（Day 6）/ 暫定挙動=R8 の規則で外れたら 1 回だけ作り直す（今までどおり）。fixture は新しい規則で通る] 本番の Claude の出力が新しい文字種の規則（zh の簡体字・漢字、en の仮名）で外れる割合。ログの `validation_failed` の code で見て、増えていたら規則を緩める
- [Deferred: 担当=performance のセッション / 期日=2026-11-07（Day 5）/ 暫定挙動=ダッシュボードのナビの文字は ja（表は 4 言語になっている。`Dashboard.tsx` が `navText(nav, lang)` を呼び、`dashboardKey` に言語が入れば出る）] ダッシュボードの canvas への言語の配線

## Test List（Canon TDD Step 1）

- [x] I18N-1: 4 言語の組で、言語が無い・空・空白・見えない文字だけを `missing`・`empty` で返す。2 言語だけの組（`{ja,en}`）も `missing` で落ちる
- [x] I18N-2: `Record<Lang, {…}>`（言語が外側）の表も、道筋の和集合で組にする（ある言語に無い道筋・配列の長さ違いは `missing`）。表の中の関数は `unsampled`（見本を出して例外にする）。循環しても止まる
- [x] I18N-3: 文字種（`script`）: ja に仮名か漢字・en に CJK なし・zh に仮名とハングルなし・ko にハングル。数字・記号だけの文と中立の文は当てない。ko の漢字語・zh と ja で同じ短い漢字の語は許す
- [x] I18N-3b: ja・zh・ko の略語・単位（`ON`・`4WD`・`{km} km`）は許し、英語の語は落とす。4 言語に同じ英文を写した組は中立にならない。組の外の 1 言語だけの文は `untranslated`
- [x] I18N-4: zh の簡体字（`simplified`）と日本の新字体（`japanese-form`）。2 つの一覧に同じ字が無い。出力の規則（`mode: 'output'`）は新字体を見ず、en の漢字を許す
- [x] I18N-5: en・ko が ja と同じ文（`copy`）。中立の文は外す。zh が ja と同じ漢字の文（地名）は copy にせず、新字体なら `japanese-form`
- [x] I18N-6: 差し込みの名前（`placeholder`）が 4 言語でそろわない
- [x] I18N-7: 例外は道筋・規則・理由つきでだけ許し、使われない例外は落とす
- [x] INV-1: sim・pwa・trip・alert-ui の `i18n-tables.test.ts` が名前の規則の表を全部集め（件数の下限つき）、明示の表（関数の見本・JSON・zones の名前）も足して、全部の組が規則を通る
- [x] INV-2: 規則 5（hook と `ci_arch_check.py`。hook は Edit を当てたあとのファイル全体で見る）が、コメントを除いて仮名・漢字・ハングルが残るのに、名前の規則・import の登録・理由つきの例外のどれでもないファイルを落とす（`scripts/tests/test_antler_hooks.py` で、折り返し・外側が言語の表・JSX の地の文・属性・コメントだけのファイルを確かめ、`--self-test` の probe で CI の経路が生きていることを確かめる）
- [x] INV-3: alert-ui のテストが `npm test` で回る（`test` の script）
- [x] HUD-1: `hudText(lang)` が 4 言語の HUD の文を返し、zh の旅の出発の案内と HUD に ja の文が残らない
- [x] HUD-2: 旅を読み込む前・見つからないときはブラウザの言語で出す
- [x] HUD-3: 見本の場面は `?lang=` の言語で出る（無ければブラウザの言語）
- [x] HUD-4: 季節の切り替え・天候・路面の文が 4 言語
- [x] HUD-5: `navText(nav, lang)` が 4 言語（既定は ja）
- [x] ERR-1: エラー画面（sim・pwa）は 4 言語を並べ、主の行はブラウザの言語
- [x] LOSS-1: A-6 の読み込み前・失敗はブラウザの言語
- [x] GEN-1: 4 つの口の検証が同じ文字種の規則（`lang-script-policy`）を使い、zh の簡体字・仮名、ko の仮名、en の仮名で外れる。en の漢字の地名の併記は通る。`@antler/i18n-check` の出力の規則と同じ判定になる
- [x] GEN-2: 4 つの口のすべての文の欄（しおりの題・日ごとの説明、場面の見出し・本文・選択肢・注、喪失文、会話の行）が 4 言語の検査を通る（欄を足して検査を忘れると落ちる）
- [x] AC-1（受け入れ）: 4 つの workspace（sim・pwa・trip・alert-ui）の i18n の検査と `ci_arch_check.py` の直書きの検査が CI で Green

## 非機能要件

- [x] 性能: 検査は vitest の 1 ファイル（workspace ごと）で 2 秒以内。実行時（api）の文字種の検査は正規表現だけ
- [x] アクセシビリティ: `lang` 属性は表示の言語と同じ（`htmlLang`: zh は `zh-Hant`）。エラー画面の 4 言語の行もそれぞれの `lang` を持つ
- [x] 既存のテストが Green（sim・pwa・api・trip・alert-ui）
