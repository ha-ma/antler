---
paths:
  - "src/**/*.ts"
  - "src/**/*.tsx"
description: "React/RN状態管理ルール - ジュニア+AI時代の物理的制約"
---

# MUST: 状態管理の絶対ルール

- データ取得は TanStack Query (`useQuery`) を使う（useState+useEffectではなく）
- 共有stateは Zustand store を使う（propsバケツリレーではなく）
- フォームは React Hook Form (`useForm`) + zod を使う（useState連打ではなく）
- Zustand store は `src/features/{name}/store.ts` にだけ作る
- Zustand は selector で使う: `useStore(s => s.count)` （`useStore()` 全体取得ではなく）
- 1コンポーネントの useState は 3個まで。超えたら Zustand store かカスタムhookに切り出す

# 状態管理判断フロー（実装前に必ず確認）

新しいstateを追加する前に、以下の順番で検討:

1. **Server data?** → TanStack Query を使う
2. **URL/Navigation state?** → Router/Navigation param に持たせる
3. **Form state?** → React Hook Form を使う
4. **複数コンポーネントで共有?** → Zustand store
5. **このコンポーネントだけのUI状態?** → useState（3個まで）

# useEffect の代替ガイド

useEffectは原則使わない。以下の代替を先に検討:

| やりたいこと | useEffectではなく | これを使う |
|-------------|------------------|-----------|
| データ取得 | ~~useState+useEffect+fetch~~ | `useTanStack Query` |
| 派生値の計算 | ~~useEffect+setState~~ | `useMemo` |
| ユーザー操作への反応 | ~~useEffect+依存配列~~ | event handler |
| コンポーネントリセット | ~~useEffect+setState~~ | `key` prop |
| 購読/タイマー | ~~コンポーネント内useEffect~~ | カスタムhookに隔離 |

どうしても必要な場合は ESLint disable コメントに**理由を書く**。

# 実装前 State設計の宣言

新しいfeatureを作る前に、以下を宣言すること:

```
## State設計
- Server state: [TanStack Queryで取得するデータ一覧]
- Shared state: [Zustand storeに入れるもの]
- Local UI state: [useStateで持つもの（3個以内）]
- Form state: [React Hook Formで管理するもの]
- URL state: [Router paramで持つもの]
- useEffect: [使う場合その理由]
```

# React Native 固有

- Navigation state は React Navigation に任せる（Zustandに入れない）
- 永続化 → Zustand persist middleware + MMKV
- re-render最小化のため Zustand selector は必須（Webより重要）

# REMINDER

- 新しいstateを追加する前に State設計を宣言すること
- useEffectを書く前に上の代替表を確認すること
- サーバーデータは useState ではなく TanStack Query
