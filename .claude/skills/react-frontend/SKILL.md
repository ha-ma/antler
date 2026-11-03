---
name: react-frontend
description: |
  React/TypeScript フロントエンド開発のアーキテクチャガイド。
  以下の場合に使用:
  (1) React コンポーネント実装
  (2) カスタムフック作成
  (3) API 連携・状態管理
  (4) TypeScript 型定義
  (5) テスト実装
  キーワード: React, TypeScript, Component, Hook, TanStack Query, Vitest, Tailwind
---

> **設計哲学**: [functional-philosophy.md](../functional-philosophy.md) の 6 原則を React で実現する。
> UI コンポーネント (ui/) は純粋関数、副作用は hooks に隔離、型で仕様を表現する。

# React Frontend Skill

React/TypeScript フロントエンド開発のための包括的ガイド。

## 目次

- [コア原則](#コア原則)
- [レイヤ構成](#レイヤ構成)
- [Tech Stack](#tech-stack)
- [Scaffold: 新規Feature追加](#scaffold-新規feature追加)
- [Quick Start](#quick-start)
- [判断フロー](#判断フロー)
- [フォームパターン](#フォームパターン-zod--react)
- [アクセシビリティ](#アクセシビリティ-必須)
- [レスポンシブ](#レスポンシブ-tailwind-breakpoints)
- [Error Boundary](#error-boundary)
- [型共有](#型共有-shared-パッケージ)
- [生成後セルフチェック](#生成後セルフチェック)
- [詳細リファレンス](#詳細リファレンス)

---

## コア原則

### 1. 責務分離

```
Pages → Features → UI → Hooks → Types
```

| レイヤ | 責務 | 依存先 |
|--------|------|--------|
| **Pages** | ルーティングのみ | Features |
| **Features** | ビジネスロジック、状態管理 | UI, Hooks |
| **UI** | 純粋表示コンポーネント | なし（Props のみ） |
| **Hooks** | API 呼び出し、ロジック抽出 | lib/api, Types |
| **Types** | 型定義 | なし |

### 2. 300行ルール

**コンポーネントは 300行以下に保つ**

超えた場合の分割戦略:
1. ロジックをカスタムフックに抽出
2. UI をサブコンポーネントに分割
3. Container/Presentational 分離

### 3. 型安全

- **`any` 禁止**: `unknown` + Type Guard を使用
- **Discriminated Unions**: 状態管理に活用
- **Generic Components**: 再利用可能な型定義

### 4. 状態管理の使い分け

| 状態種別 | 推奨手法 | 例 |
|----------|----------|-----|
| サーバー状態 | TanStack Query | API データ、キャッシュ |
| グローバル UI | Context | テーマ、認証状態 |
| ローカル | useState | フォーム、モーダル |

---

## レイヤ構成

```
src/
├── components/
│   ├── features/<domain>/     # 機能コンポーネント (300行以下)
│   │   ├── index.tsx          # Container
│   │   ├── components/        # サブコンポーネント
│   │   ├── hooks.ts           # ローカルフック
│   │   └── index.module.css   # スタイル (CSS Modules使用時)
│   ├── ui/                    # 再利用可能 UI
│   └── context/               # Context Provider
├── hooks/                     # グローバルフック
│   └── use-<resource>.ts      # API フック
├── lib/api/                   # API クライアント (fetch ベース)
├── pages/                     # ルートベースページ
├── types/                     # 型定義
└── utils/                     # ユーティリティ
```

→ 詳細: [ディレクトリ構成](references/directory.md)

---

## Tech Stack

| 技術 | 用途 | 交換可能性 |
|------|------|-----------|
| React 18+ | コア | - |
| TypeScript (strict) | 型安全 | - |
| TanStack Query v5 | サーバー状態 | SWR |
| fetch + 薄いラッパー | HTTP クライアント | Axios (代替) |
| Vite | ビルド | - |
| Tailwind CSS | スタイリング | CSS Modules (代替) |
| Vitest | テスト | Jest |

> **fetch vs Axios**: 2025年時点では `fetch` + TanStack Query がベストプラクティス。
> - fetch はブラウザネイティブ (追加バンドル 0KB vs Axios ~13KB)
> - TanStack Query がリトライ、キャッシュ、エラーハンドリングを担当
> - Axios の主要メリット (interceptor, transform) は薄いラッパーで実現可能
> - 既存プロジェクトで Axios 導入済みなら無理に移行する必要はない

> **Tailwind vs CSS Modules**: 既存プロジェクトが CSS Modules を使用している場合はそのまま継続する。
> 新規プロジェクトは Tailwind を優先する。

---

## Scaffold: 新規Feature追加

新規 feature を追加する際の生成順序とファイル構成:

```
1. types/{name}.d.ts                     ← 型定義 (shared パッケージにあればスキップ)
2. hooks/use-{names}.ts                  ← API フック (query + mutations)
3. components/features/{name}/
   ├── index.tsx                         ← Container (hooks → View に渡す)
   ├── components/
   │   ├── {Name}View.tsx                ← Presentational (props → JSX)
   │   ├── {Name}Form.tsx                ← フォーム (Zod validation)
   │   ├── {Name}List.tsx                ← リスト表示
   │   └── {Name}Detail.tsx              ← 詳細表示
   └── hooks.ts                          ← Feature 専用フック (optional)
```

**生成順序の根拠**: 型 → API → Container → View の順で依存関係の上流から作る。型が確定してからコンポーネントを書くことで `any` を防ぐ。

**例: `event` feature の場合**:
```
types/event.d.ts
hooks/use-events.ts
components/features/event/index.tsx         (EventContainer)
components/features/event/components/
  EventView.tsx
  EventForm.tsx
  EventList.tsx
  EventDetail.tsx
```

---

## Quick Start

### Feature コンポーネント作成

```tsx
// src/components/features/user-profile/index.tsx
import { useUserProfile } from './hooks';
import { ProfileCard } from './components/ProfileCard';
import { ProfileForm } from './components/ProfileForm';

export const UserProfile: React.FC<{ userId: number }> = ({ userId }) => {
  const { data, isLoading, error } = useUserProfile(userId);

  if (isLoading) return <Skeleton />;
  if (error) return <ErrorFallback error={error} />;
  if (!data) return <EmptyState message="ユーザーが見つかりません" />;

  return (
    <div className="flex flex-col gap-4 p-4">
      <ProfileCard user={data} />
      <ProfileForm user={data} />
    </div>
  );
};
```

```ts
// src/components/features/user-profile/hooks.ts
import { useApiQuery } from '@/lib/api/use-api-query';
import type { User } from '@/types/user';

export const useUserProfile = (userId: number) => {
  return useApiQuery<User>({
    queryKey: ['users', userId],
    url: `/api/users/${userId}`,
  });
};
```

→ 完全例: [Feature コンポーネント例](examples/feature-component.tsx)

---

## 判断フロー

### 新しいコードの配置先

```
1. ルーティングのみ？ → pages/
2. API 呼び出しが必要？ → hooks/use-{resource}.ts
3. 複数画面で使う表示部品？ → components/ui/{Name}/
4. 特定機能のビジネスロジック？ → components/features/{name}/
5. 純粋なデータ変換？ → utils/{name}.ts
6. 型定義？ → types/ (or shared package)
7. アプリ全体の状態？ → components/context/
```

### コンポーネント内の判断

```
1. 300行超えた？ → Container + View に分割
2. useState 5個超えた？ → カスタムフックに抽出
3. 同じUIパターンが2回出た？ → components/ui/ に抽出
4. API呼び出しがある？ → hooks/ に移動
```

---

## フォームパターン (Zod + React)

```tsx
// Zod schema (from shared package or local)
import { z } from 'zod';
import { createUserSchema, type CreateUserInput } from '@myapp/shared';
// ↑ shared パッケージがある場合はそこから import。ない場合は local で定義。

// Form hook
function useForm<T>(schema: z.ZodType<T>) {
  const [values, setValues] = useState<Partial<T>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validate = (): T | null => {
    const result = schema.safeParse(values);
    if (result.success) { setErrors({}); return result.data; }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      fieldErrors[issue.path[0]?.toString() ?? ''] = issue.message;
    }
    setErrors(fieldErrors);
    return null;
  };

  return { values, setValues, errors, validate };
}

// Usage example
const createUserSchema = z.object({
  name: z.string().min(1, '名前は必須です'),
  email: z.string().email('メールアドレスの形式が正しくありません'),
});

function UserForm({ onSubmit }: { onSubmit: (data: CreateUserInput) => void }) {
  const { values, setValues, errors, validate } = useForm(createUserSchema);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = validate();
    if (!data) return; // バリデーション失敗: errors に詳細が入っている
    setIsSubmitting(true);
    try {
      await onSubmit(data);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <div>
        <label htmlFor="name">名前</label>
        <input
          id="name"
          type="text"
          value={values.name ?? ''}
          onChange={(e) => setValues({ ...values, name: e.target.value })}
          aria-describedby={errors.name ? 'name-error' : undefined}
          aria-invalid={!!errors.name}
          className={`border rounded px-3 py-2 ${errors.name ? 'border-red-500' : 'border-gray-300'}`}
        />
        {errors.name && (
          <p id="name-error" role="alert" className="text-red-600 text-sm mt-1">
            {errors.name}
          </p>
        )}
      </div>
      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? '送信中...' : '送信'}
      </button>
    </form>
  );
}
```

**ルール**:
- バリデーションは `onSubmit` で一括実行し、全エラーを同時表示する
- `aria-describedby` でエラーメッセージと input を紐付ける
- `aria-invalid` をエラー時に `true` にする
- `role="alert"` でスクリーンリーダーに即時通知する
- 送信中は `disabled` にし、フィードバックテキストを変更する

→ 詳細: [フォームパターン](references/form-patterns.md)

---

## アクセシビリティ (必須)

**全コンポーネントに適用する。オプションではない。**

### 必須 ARIA 属性

| 状況 | 必須属性 | 例 |
|------|---------|-----|
| ボタン・リンクにラベルがない | `aria-label` | `<button aria-label="削除">×</button>` |
| 開閉状態がある要素 | `aria-expanded` | `<button aria-expanded={isOpen}>メニュー</button>` |
| エラーメッセージがある入力 | `aria-describedby` + `aria-invalid` | フォームパターン参照 |
| 意味のある役割がある要素 | `role` | `<div role="dialog" aria-modal="true">` |
| ローディング中 | `aria-busy` | `<div aria-busy={isLoading}>` |

### キーボードナビゲーション

全インタラクティブ要素の要件:
- `<button>` は Enter + Space で発火する (ネイティブ対応)
- `<div onClick>` は使わない。必ず `<button>` を使う
- カスタムドロップダウンは `ArrowUp/ArrowDown/Enter/Escape` を実装する
- モーダルは `Escape` で閉じる

```tsx
// NG: div を onClick で使う
<div onClick={handleClick} className="cursor-pointer">クリック</div>

// OK: button を使う
<button type="button" onClick={handleClick}>クリック</button>

// OK: キーボード対応が必要なカスタム要素
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}
>
  クリック
</div>
```

### アクセシブルなモーダル (Dialog パターン)

```tsx
// components/ui/Dialog.tsx
import { useEffect, useRef } from 'react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function Dialog({ isOpen, onClose, title, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      dialogRef.current?.showModal();
      // フォーカスをモーダル内の最初のフォーカス可能要素に移動
      const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      firstFocusable?.focus();
    } else {
      dialogRef.current?.close();
      // モーダルを閉じたらフォーカスを元の要素に戻す
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="dialog-title"
      aria-modal="true"
      onClose={onClose}
      className="rounded-lg p-6 backdrop:bg-black/50"
    >
      <h2 id="dialog-title" className="text-lg font-semibold mb-4">{title}</h2>
      {children}
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="mt-4 px-4 py-2 bg-gray-200 rounded"
      >
        閉じる
      </button>
    </dialog>
  );
}

// Usage
<Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="確認">
  <p>本当に削除しますか？</p>
</Dialog>
```

### セマンティック HTML チートシート

| 目的 | 使う要素 | 使わない要素 |
|------|---------|------------|
| クリック操作 | `<button>` | `<div onClick>` |
| ページ移動 | `<a href>` | `<div onClick>` |
| モーダル | `<dialog>` | `<div role="dialog">` (可能な限り) |
| フォーム | `<form>` + `<label>` | `<div>` |
| 見出し | `<h1>〜<h6>` (階層順) | `<div class="heading">` |
| リスト | `<ul>/<ol>` + `<li>` | `<div>` の連列 |
| メインコンテンツ | `<main>` | `<div id="main">` |
| ナビゲーション | `<nav>` | `<div class="nav">` |

### カラーコントラスト (WCAG AA)

- 通常テキスト (18px未満 / 14px未満 bold): 4.5:1 以上
- 大きいテキスト (18px以上 / 14px以上 bold): 3:1 以上
- UI コンポーネント・グラフィック: 3:1 以上
- テキストのみのロゴ・装飾的テキスト: 要件なし

→ 詳細: [アクセシビリティリファレンス](references/accessibility.md)

---

## レスポンシブ (Tailwind breakpoints)

| Breakpoint | 名称 | 用途 |
|------------|------|------|
| default | mobile | モバイルファースト (320px〜) |
| `sm:` (640px) | - | 小型タブレット |
| `md:` (768px) | tablet | タブレット |
| `lg:` (1024px) | desktop | デスクトップ |
| `xl:` (1280px) | - | ワイドデスクトップ |
| `2xl:` (1536px) | - | 超ワイド |

**ルール: 常にモバイルファーストで書く。デスクトップ専用スタイルに `lg:` を使う。**

```tsx
// NG: デスクトップファースト (Tailwind では逆)
<div className="flex-row md-down:flex-col">...</div>

// OK: モバイルファースト
<div className="flex flex-col md:flex-row gap-4">
  <aside className="w-full md:w-64">サイドバー</aside>
  <main className="flex-1">メインコンテンツ</main>
</div>

// OK: レスポンシブグリッド
<ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map(item => <li key={item.id}><ItemCard item={item} /></li>)}
</ul>

// OK: テキストサイズのレスポンシブ
<h1 className="text-2xl md:text-3xl lg:text-4xl font-bold">タイトル</h1>
```

→ 詳細: [Tailwind パターン](references/tailwind-patterns.md)

---

## Error Boundary

**各 Feature / タブ単位で必ず ErrorBoundary で囲む。**

```tsx
// components/ui/ErrorBoundary.tsx
import { Component, type ReactNode } from 'react';

interface Props {
  fallback: ReactNode;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // エラーログサービスに送信 (例: Sentry)
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Fallback コンポーネント
export function ErrorFallback({ error, onReset }: { error?: Error | null; onReset?: () => void }) {
  return (
    <div role="alert" className="p-4 bg-red-50 border border-red-200 rounded">
      <p className="text-red-700">表示中にエラーが発生しました。</p>
      {onReset && (
        <button type="button" onClick={onReset} className="mt-2 text-sm text-red-600 underline">
          再試行
        </button>
      )}
    </div>
  );
}

// Usage: 各タブ / feature を囲む
function App() {
  return (
    <ErrorBoundary fallback={<ErrorFallback />}>
      <EventListTab />
    </ErrorBoundary>
  );
}

// QueryErrorResetBoundary と組み合わせる場合 (TanStack Query)
import { QueryErrorResetBoundary } from '@tanstack/react-query';

function EventPage() {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary fallback={<ErrorFallback onReset={reset} />}>
          <EventListTab />
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
```

---

## 型共有 (shared パッケージ)

**型はプロジェクト全体で一度だけ定義する。**

```
@myapp/shared (または packages/shared/)
├── types/         ← エンティティ型 (User, Event, etc.)
├── schemas/       ← Zod バリデーションスキーマ
└── constants/     ← 共通定数 (ステータスコード, etc.)
```

**ルール**:
- 型定義は `@myapp/shared` に一度だけ書く
- フロントエンドは型・定数・バリデータを shared から import する
- フロントエンド側で型を再定義しない (ドリフトの原因になる)
- Zod スキーマを shared から import してフォームバリデーションに使う

```ts
// NG: フロントエンドで型を再定義
// src/types/user.ts
type User = {
  id: number;
  name: string;
  email: string;
};

// OK: shared から import
import type { User } from '@myapp/shared';
import { createUserSchema } from '@myapp/shared/schemas';

// OK: shared の Zod スキーマをフォームバリデーションに流用
const { validate } = useForm(createUserSchema);
```

**shared パッケージがない場合**: `src/types/` に定義し、バックエンドの型と手動で同期する。型の変更時はバックエンドと必ず合わせる。

---

## 生成後セルフチェック

コード生成後、コミット前に必ず確認する:

- [ ] 全コンポーネントが 300 行以下か？
- [ ] `any` を使っていないか？
- [ ] Container と Presentational が分離されているか？
- [ ] API 呼び出しは useApiQuery/useApiMutation 経由か？
- [ ] フォームバリデーションは Zod を使っているか？
- [ ] エラー・ローディング・空状態を処理しているか？
- [ ] アクセシビリティ属性 (`aria-*`, `role`, `tabIndex`) があるか？
- [ ] レスポンシブ対応（モバイルファースト）か？
- [ ] 型は shared パッケージ (または `types/`) から import しているか？
- [ ] Feature コンポーネントは ErrorBoundary で囲まれているか？
- [ ] `<div onClick>` ではなく `<button>` を使っているか？
- [ ] lint + check-types が通るか？

---

## 詳細リファレンス

### アーキテクチャ
- [レイヤ別ルール](references/layers.md) - OK/NG 一覧
- [ディレクトリ構成](references/directory.md) - 標準構造
- [命名規則](references/conventions.md) - ファイル・変数命名

### パターン
- [コンポーネントパターン](references/component-patterns.md) - 300行ルール、分割戦略
- [フックパターン](references/hooks-patterns.md) - useApiQuery、カスタムフック
- [状態管理](references/state-management.md) - TanStack Query、Context
- [フォームパターン](references/form-patterns.md) - Zod + React、バリデーション
- [Tailwind パターン](references/tailwind-patterns.md) - レイアウト、カラー、レスポンシブ

### 品質
- [型安全](references/type-safety.md) - any 禁止、型パターン
- [テストパターン](references/testing-patterns.md) - Vitest、Testing Library
- [アンチパターン](references/anti-patterns.md) - 避けるべきこと
- [アクセシビリティ](references/accessibility.md) - WCAG AA、ARIA、キーボード

### 実装例
- [Feature コンポーネント](examples/feature-component.tsx)
- [カスタムフック](examples/custom-hook.ts)
- [Container/Presentational](examples/container-presentational.tsx)
- [型定義](examples/types.d.ts)
