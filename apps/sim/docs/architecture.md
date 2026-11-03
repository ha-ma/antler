# React アーキテクチャ設計ノート

この文書は **「なぜこの構成にしているか」** を人間が読むためのものです。

**「何をどう書くか」の実行ルールは `.claude/rules/` にあります。** そちらが正で、AI もそこを読みます。
この文書はルールを繰り返さず、背景・判断基準・トレードオフだけを扱います。

---

## 基本方針

```
app -> features -> shared
```

feature は自己完結し、feature 間のやり取りは barrel（`index.ts`）だけを通します。

| 層 | 置き場所 | 責務 | 依存してよいもの |
|---|---|---|---|
| Components | `features/{name}/components/` | 表示、ローカル UI state、`hooks/` と `store.ts` の消費 | 同 feature の hooks / store（selector 経由）、shared |
| Hooks | `features/{name}/hooks/` | TanStack Query によるデータ取得、再利用可能なロジック | shared、同 feature の store（selector 経由） |
| Store | `features/{name}/store.ts` | Zustand store 1つ。state + 動詞始まりのアクション | なし（zustand のみ） |
| Types | `features/{name}/types.ts` | feature 固有の型定義 | なし |
| Index | `features/{name}/index.ts` | 公開 API（barrel）。named re-export のみ | 同 feature 内 |
| Shared | `shared/{components,hooks,utils}/` | feature 知識のない汎用コード | 何にも依存しない |
| App | `app/` | ルーティング、プロバイダ、レイアウト | features（barrel 経由）、shared |

---

## なぜ feature 単位で閉じるのか

規模が大きくなったとき、コードの探しにくさは **「機能を横断して探す回数」** に比例します。
`components/` `hooks/` `stores/` のように**種類で切る**と、1つの機能を直すのに3〜4箇所を回ることになります。

feature で切れば、その機能に関わるものが1つのディレクトリに揃います。
削除するときも、ディレクトリごと消せば済みます。

barrel を強制しているのは、**feature の内部構造を外から見えなくするため**です。
他 feature が内部ファイルを直接 import できると、実質的に全部が公開 API になり、
リファクタするたびに他 feature が壊れます。`index.ts` に出したものだけが契約です。

同じ理由で `shared/` は `features/` を一切知りません。逆流を許すと依存が循環し、
「どこから読み始めればいいか」が決まらないコードベースになります。

---

## なぜ状態を5種類に分けるのか

React の設計で最も事故が起きるのが、**すべての state を同じ道具で持とうとすること**です。
性質が違うものを1箇所に集めると、どれも中途半端になります。

| 状態の種類 | 持つ場所 | なぜそこか |
|---|---|---|
| サーバーデータ | TanStack Query（`hooks/`） | キャッシュ・再取得・loading/error を自前で書かずに済む |
| 共有クライアント状態 | Zustand（`store.ts`） | 複数コンポーネントで共有するが、サーバーとは無関係なもの |
| フォーム状態 | React Hook Form | 入力ごとの再描画を避け、検証を宣言的に書ける |
| ローカル UI 状態 | `useState`（3個まで） | そのコンポーネントの外に出す必要がないもの |
| URL 状態 | Router の param | 共有・ブックマーク・リロードで保たれるべきもの |

とくに **サーバーデータを Zustand に入れない**ことが重要です。
入れた瞬間に、いつ再取得するか・古くなったキャッシュをどう捨てるかを自分で管理することになります。
それは TanStack Query が既に解いている問題です。

### 認証トークンは、この5つのどれでもない

トークンは**状態管理の対象にしません**。`localStorage` にも Zustand にも置かない、が既定です。

JavaScript から読める場所に置くと、XSS が1つ成立しただけでトークンごと持ち出され、
攻撃者の手元で有効期限まで使われ続けます。サーバが発行する HttpOnly Cookie に持たせれば、
JS から読めないので持ち出せません。

`.claude/rules/` 側の API クライアントは `credentials: 'include'` で Cookie を送る形にしてあります。
**トークンを扱うコードをアプリ側に書かない**のが、この構成の意図です。

---

## なぜ `useEffect` を避けるのか

`useEffect` は「React の外の世界と同期する」ための道具で、
データ取得や派生値の計算に使うと、実行タイミングと依存配列を人間が管理することになります。
そこがバグの温床になります。

書きたくなったら、まず代替を確認します。

| やりたいこと | 代わりに使うもの |
|---|---|
| データ取得 | TanStack Query |
| 派生値の計算 | `useMemo`、あるいは描画時にそのまま計算する |
| ユーザー操作への反応 | イベントハンドラ |
| コンポーネントの状態リセット | `key` prop |
| 購読・タイマー | カスタム hook に隔離（**`useEffect` が許される唯一の場所**） |

`useState` が4個目に達したときも同じで、**設計を見直す合図**として扱います。
Zustand store に移すか、カスタム hook に切り出すか、コンポーネントを分割するかを検討します。

---

## 迷ったときの判断

### 新しい state を追加する前に

1. サーバーから取得するデータか → TanStack Query（`hooks/`）
2. URL / ナビゲーション状態か → Router の param
3. フォーム状態か → React Hook Form（+ zod）
4. 複数コンポーネントで共有するか → Zustand（`store.ts`）
5. このコンポーネントだけの UI 状態か → `useState`（3個まで）

### どこに置くか

6. UI 表示か → `features/{name}/components/`
7. feature 固有の型か → `features/{name}/types.ts`
8. 他 feature や `app/` に公開するか → `features/{name}/index.ts`（named export のみ）
9. feature 知識のない汎用コードか → **2箇所以上で実際に使われてから** `shared/` へ昇格
10. ルーティング / プロバイダ / レイアウトか → `app/`

### 実装前に State 設計を宣言する

feature を新規に作るときは、コードを書く前にこれを埋めます。

```
## State設計
- Server state:   [TanStack Query で取得するデータ]
- Shared state:   [Zustand store に入れるもの]
- Local UI state: [useState で持つもの（3個以内）]
- Form state:     [React Hook Form で管理するもの]
- URL state:      [Router param で持つもの]
- useEffect:      [使う場合、その理由]
```

埋められない項目があるときは、たいてい設計が固まっていません。
実装しながら考えると、置き場所の判断を後回しにしたまま state が増えていきます。

---

## テスト戦略の考え方

| レベル | 対象 | 手法 |
|---|---|---|
| Unit | Zustand store | 素の関数として。`create()` の戻り値を直接呼び、React なしで検証する |
| Unit | Hooks | `renderHook` + `act`。データ取得 hook は QueryClientProvider でラップ + MSW |
| Unit / Integration | Components | Testing Library。**ユーザーに見えるもの**（テキスト、role、操作）でテストする |
| Integration | データ取得フロー | MSW で loading / success / empty / error を再現する |

コンポーネントのテストで**実装詳細を見ない**のが要点です。
`useState` の呼び出し回数や className を検証すると、リファクタのたびにテストが壊れ、
「動作は変わっていないのにテストを直す」時間が積み上がります。

具体的な書き方は `.claude/skills/react-frontend/references/testing-patterns.md` を参照してください。

---

## 実行ルールの所在

| 知りたいこと | 見る場所 |
|---|---|
| 各層に何を書き、何を書かないか | `.claude/rules/react-{components,hooks,store,shared,app,feature-api}-rules.md` |
| 全体のディレクトリ構成 | `.claude/rules/react-architecture.md`、`.claude/skills/react-frontend/references/directory.md` |
| 状態管理の具体パターン | `.claude/rules/state-management.md` |
| よくあるアンチパターン | `.claude/skills/react-frontend/references/anti-patterns.md` |
| テストの書き方 | `.claude/skills/react-frontend/references/testing-patterns.md` |
| 違反の自動検出 | `.claude/hooks/check-react-architecture.py`、`.github/workflows/quality-check.yml` |
