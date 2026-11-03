# ディレクトリ構成

## 標準構成

```
src/
├── components/
│   ├── features/              # 機能コンポーネント
│   │   ├── user-profile/      # ユーザープロフィール機能
│   │   │   ├── index.tsx      # Container (エントリポイント)
│   │   │   ├── components/    # サブコンポーネント
│   │   │   │   ├── ProfileCard.tsx
│   │   │   │   └── ProfileForm.tsx
│   │   │   ├── hooks.ts       # ローカルフック
│   │   │   └── index.module.css
│   │   ├── task-board/        # タスクボード機能
│   │   │   ├── index.tsx
│   │   │   ├── components/
│   │   │   │   ├── TaskColumn.tsx
│   │   │   │   ├── TaskCard.tsx
│   │   │   │   └── TaskFilter.tsx
│   │   │   ├── hooks.ts
│   │   │   └── index.module.css
│   │   └── dashboard/         # ダッシュボード機能
│   │       ├── index.tsx
│   │       ├── components/
│   │       │   ├── StatsPanel.tsx
│   │       │   └── ActivityFeed.tsx
│   │       ├── hooks.ts
│   │       └── index.module.css
│   │
│   ├── ui/                    # 再利用可能 UI コンポーネント
│   │   ├── Button/
│   │   │   ├── index.tsx
│   │   │   └── index.module.css
│   │   ├── Modal/
│   │   ├── DataTable/
│   │   ├── SearchInput/
│   │   └── StatusBadge/
│   │
│   └── context/               # Context Provider
│       ├── AuthContext.tsx
│       ├── ThemeContext.tsx
│       └── NotificationContext.tsx
│
├── hooks/                     # グローバルフック (API フック)
│   ├── use-users.ts           # ユーザー CRUD フック
│   ├── use-tasks.ts           # タスク CRUD フック
│   ├── use-notifications.ts   # 通知フック
│   └── use-auth.ts            # 認証フック
│
├── lib/                       # ライブラリ・ユーティリティ
│   └── api/
│       ├── client.ts          # fetch ベース API クライアント
│       ├── use-api-query.ts   # TanStack Query ラッパー
│       ├── use-api-mutation.ts # TanStack Mutation ラッパー
│       └── query-keys.ts      # Query Key ファクトリ
│
├── pages/                     # ルートベースページ
│   ├── index.tsx              # ホーム
│   ├── users/
│   │   ├── index.tsx          # ユーザー一覧
│   │   └── [userId]/
│   │       └── index.tsx      # ユーザー詳細
│   ├── tasks/
│   │   ├── index.tsx          # タスク一覧
│   │   └── [taskId]/
│   │       └── index.tsx      # タスク詳細
│   └── settings/
│       └── index.tsx          # 設定
│
├── types/                     # 型定義
│   ├── user.d.ts
│   ├── task.d.ts
│   ├── notification.d.ts
│   └── common.d.ts            # 共通型 (Pagination, ApiError, etc.)
│
├── utils/                     # ユーティリティ関数
│   ├── format.ts
│   ├── validation.ts
│   └── constants.ts
│
├── App.tsx
├── main.tsx
└── vite-env.d.ts
```

---

## ディレクトリルール

### features/ の構成ルール

```
features/<domain>/
├── index.tsx          # 必須: Container コンポーネント (エントリポイント)
├── components/        # 任意: サブコンポーネント (分割時)
├── hooks.ts           # 任意: ローカルフック (ロジック抽出時)
└── index.module.css   # 任意: スタイル
```

**ルール**:
- 1 ドメイン = 1 ディレクトリ
- `index.tsx` が外部公開する唯一のエントリポイント
- サブコンポーネントは `components/` に閉じ込める
- ドメイン固有フックは `hooks.ts` に配置

### ui/ の構成ルール

```
ui/<ComponentName>/
├── index.tsx          # コンポーネント本体
└── index.module.css   # スタイル (任意)
```

**ルール**:
- PascalCase ディレクトリ名
- Props のみに依存 (API 呼び出し禁止)
- 複数 Feature で再利用可能なもののみ配置

### hooks/ の構成ルール

```
hooks/
├── use-<resource>.ts       # API CRUD フック
├── use-<utility>.ts        # ユーティリティフック
└── index.ts                # バレルエクスポート (任意)
```

**ルール**:
- `use-` プレフィックス必須
- kebab-case ファイル名
- 1 フック = 1 関心 (Single Responsibility)

### types/ の構成ルール

```
types/
├── <domain>.d.ts           # ドメインモデル型
└── common.d.ts             # 共通ユーティリティ型
```

**ルール**:
- `.d.ts` 拡張子 (宣言ファイル)
- 実装コード禁止
- `any` 禁止

---

## Feature コンポーネントの構成

### 推奨構成 (小規模機能)

```
features/notification-bell/
├── index.tsx              # 単一ファイルで完結 (300行以下)
└── index.module.css
```

### 推奨構成 (中規模機能)

```
features/task-board/
├── index.tsx              # Container
├── components/
│   ├── TaskColumn.tsx
│   └── TaskCard.tsx
├── hooks.ts               # ローカルフック
└── index.module.css
```

### 推奨構成 (大規模機能)

```
features/dashboard/
├── index.tsx              # メインエントリ
├── components/
│   ├── StatsPanel/
│   │   ├── index.tsx
│   │   └── index.module.css
│   ├── ActivityFeed/
│   │   ├── index.tsx
│   │   └── ActivityItem.tsx
│   └── ChartSection/
│       ├── index.tsx
│       └── charts/
├── hooks/
│   ├── use-dashboard-stats.ts
│   ├── use-activity-feed.ts
│   └── use-chart-data.ts
├── utils/
│   └── calculations.ts
├── types.ts               # ローカル型定義
└── index.module.css
```

---

## インポートパス

```ts
// エイリアス (@/) を使用
import { UserProfile } from '@/components/features/user-profile';
import { Button } from '@/components/ui/Button';
import { useUsers } from '@/hooks/use-users';
import { apiClient } from '@/lib/api/client';
import type { User } from '@/types/user';

// 相対パスは同一 Feature 内のみ
import { ProfileCard } from './components/ProfileCard';
import { useUserProfile } from './hooks';
import styles from './index.module.css';
```

---

## 移動の目安

| 状態 | アクション |
|------|----------|
| フックが 2+ Feature で使われる | `features/*/hooks.ts` → `hooks/` に移動 |
| UI が 3+ 箇所で使われる | `features/*/components/` → `ui/` に移動 |
| 型が 2+ ファイルで使われる | ローカル定義 → `types/` に移動 |

---

## 関連ドキュメント

- **[レイヤ別ルール](layers.md)** - 各レイヤの OK/NG
- **[命名規則](conventions.md)** - 詳細な命名ルール
- **[コンポーネントパターン](component-patterns.md)** - 分割戦略
