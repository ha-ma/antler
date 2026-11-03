# Tailwind CSS パターン集

React フロントエンドで使う Tailwind CSS のパターン。AI が迷わず使えるよう具体例を中心に記述する。

---

## Breakpoint 使用ルール

**常にモバイルファーストで書く。** デフォルト (prefix なし) がモバイル。

| Prefix | 幅 | 用途 |
|--------|-----|------|
| (なし) | 0px〜 | モバイル (320px〜) |
| `sm:` | 640px〜 | 小型タブレット |
| `md:` | 768px〜 | タブレット |
| `lg:` | 1024px〜 | デスクトップ |
| `xl:` | 1280px〜 | ワイドデスクトップ |
| `2xl:` | 1536px〜 | 超ワイド |

```tsx
// NG: デスクトップファーストの思考で書く
<div className="w-1/3">  // モバイルでも 1/3 幅になってしまう

// OK: モバイルファースト
<div className="w-full md:w-1/2 lg:w-1/3">
```

---

## レイアウトパターン

### Flexbox

```tsx
// 横並び (モバイルは縦積み、タブレット以上は横並び)
<div className="flex flex-col md:flex-row gap-4">
  <div className="flex-1">左</div>
  <div className="flex-1">右</div>
</div>

// 中央揃え (水平・垂直)
<div className="flex items-center justify-center min-h-screen">
  <div>中央のコンテンツ</div>
</div>

// 左右に分散
<div className="flex items-center justify-between">
  <span>左</span>
  <button type="button">右</button>
</div>

// ラップするタグリスト
<div className="flex flex-wrap gap-2">
  {tags.map(tag => (
    <span key={tag} className="px-2 py-1 bg-gray-100 rounded text-sm">{tag}</span>
  ))}
</div>
```

### Grid

```tsx
// レスポンシブカードグリッド
<ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
  {items.map(item => (
    <li key={item.id}><ItemCard item={item} /></li>
  ))}
</ul>

// サイドバー付きレイアウト
<div className="grid grid-cols-1 lg:grid-cols-[256px_1fr] gap-6">
  <aside className="lg:sticky lg:top-4 h-fit">サイドバー</aside>
  <main>メインコンテンツ</main>
</div>

// 2カラムフォーム
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
  <div>
    <label htmlFor="firstName">名</label>
    <input id="firstName" type="text" className="w-full border rounded px-3 py-2" />
  </div>
  <div>
    <label htmlFor="lastName">姓</label>
    <input id="lastName" type="text" className="w-full border rounded px-3 py-2" />
  </div>
</div>
```

### コンテナ

```tsx
// ページ幅を制限してセンタリング
<div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
  {children}
</div>

// セクションの縦余白
<section className="py-8 md:py-12 lg:py-16">
  {children}
</section>
```

---

## カラーシステム (セマンティック)

プロジェクトの `tailwind.config.ts` で定義するセマンティックカラー。以下は標準的なマッピング例。

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        primary: {
          50:  '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',  // メインカラー
          600: '#2563eb',  // ホバー
          700: '#1d4ed8',  // アクティブ
        },
        'status-success': '#16a34a',  // green-600
        'status-error':   '#dc2626',  // red-600
        'status-warning': '#d97706',  // amber-600
        'status-info':    '#2563eb',  // blue-600
      },
    },
  },
};
```

```tsx
// 使用例
<button className="bg-primary-500 hover:bg-primary-600 text-white px-4 py-2 rounded">
  送信
</button>

<p className="text-status-error text-sm">エラーメッセージ</p>
<p className="text-status-success text-sm">成功メッセージ</p>
```

**カラー使用ガイドライン**:
- ブランドカラーは `primary-*` を使う
- 状態表示は `status-*` を使う
- テキストは `text-gray-900` (本文) / `text-gray-600` (補助) を基本にする
- ボーダーは `border-gray-200` / `border-gray-300` を基本にする

---

## フォームスタイリング

```tsx
// 基本 input
<input
  type="text"
  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
             disabled:bg-gray-50 disabled:text-gray-400 disabled:cursor-not-allowed"
/>

// エラー状態の input
<input
  type="text"
  aria-invalid="true"
  className="w-full border border-red-500 rounded-md px-3 py-2 text-sm
             focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
/>

// select
<select
  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm bg-white
             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
>
  <option value="">選択してください</option>
  <option value="a">選択肢A</option>
</select>

// textarea
<textarea
  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm
             focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
             resize-vertical min-h-[100px]"
/>

// checkbox
<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="checkbox"
    className="h-4 w-4 rounded border-gray-300 text-primary-500
               focus:ring-2 focus:ring-primary-500"
  />
  <span className="text-sm text-gray-700">同意する</span>
</label>

// フォームグループ (label + input + error)
<div className="flex flex-col gap-1">
  <label htmlFor="email" className="text-sm font-medium text-gray-700">
    メールアドレス <span className="text-red-500">*</span>
  </label>
  <input
    id="email"
    type="email"
    aria-describedby="email-error"
    aria-invalid={!!error}
    className={`w-full border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2
      ${error
        ? 'border-red-500 focus:ring-red-500'
        : 'border-gray-300 focus:ring-primary-500 focus:border-transparent'
      }`}
  />
  {error && (
    <p id="email-error" role="alert" className="text-red-600 text-xs">
      {error}
    </p>
  )}
</div>
```

---

## Modal / Dialog スタイリング

```tsx
// <dialog> 要素を使う (アクセシビリティ対応)
<dialog
  className="rounded-lg shadow-xl p-0 max-w-md w-full mx-4
             backdrop:bg-black/50 backdrop:backdrop-blur-sm"
>
  {/* ヘッダー */}
  <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
    <h2 className="text-lg font-semibold text-gray-900">タイトル</h2>
    <button
      type="button"
      onClick={onClose}
      aria-label="閉じる"
      className="p-1 rounded hover:bg-gray-100 transition-colors"
    >
      <XIcon className="h-5 w-5 text-gray-500" />
    </button>
  </div>

  {/* ボディ */}
  <div className="px-6 py-4">
    {children}
  </div>

  {/* フッター */}
  <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
    <button
      type="button"
      onClick={onClose}
      className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300
                 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2
                 focus:ring-primary-500"
    >
      キャンセル
    </button>
    <button
      type="submit"
      className="px-4 py-2 text-sm font-medium text-white bg-primary-600
                 rounded-md hover:bg-primary-700 focus:outline-none focus:ring-2
                 focus:ring-offset-2 focus:ring-primary-500"
    >
      確定
    </button>
  </div>
</dialog>
```

---

## カード / リストパターン

```tsx
// 基本カード
<div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-shadow">
  <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
  <p className="text-sm text-gray-600">{description}</p>
</div>

// アクション付きカード
<article className="bg-white rounded-lg border border-gray-200 overflow-hidden">
  <div className="p-4">
    <h3 className="font-semibold text-gray-900">{title}</h3>
    <p className="text-sm text-gray-600 mt-1">{description}</p>
  </div>
  <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-2">
    <button type="button" className="text-sm text-gray-600 hover:text-gray-900">
      編集
    </button>
    <button type="button" className="text-sm text-red-600 hover:text-red-800">
      削除
    </button>
  </div>
</article>

// リストアイテム (区切り線)
<ul className="divide-y divide-gray-200">
  {items.map(item => (
    <li key={item.id} className="py-3 flex items-center justify-between">
      <span className="text-sm text-gray-900">{item.name}</span>
      <span className="text-xs text-gray-500">{item.date}</span>
    </li>
  ))}
</ul>
```

---

## レスポンシブテーブル

テーブルはモバイルで横スクロールさせるか、カード形式に切り替える。

```tsx
// 方法1: 横スクロール
<div className="overflow-x-auto rounded-lg border border-gray-200">
  <table className="min-w-full divide-y divide-gray-200">
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          名前
        </th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          メール
        </th>
        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
          操作
        </th>
      </tr>
    </thead>
    <tbody className="bg-white divide-y divide-gray-200">
      {rows.map(row => (
        <tr key={row.id} className="hover:bg-gray-50 transition-colors">
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{row.name}</td>
          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.email}</td>
          <td className="px-6 py-4 whitespace-nowrap text-right text-sm">
            <button type="button" className="text-primary-600 hover:text-primary-800">
              編集
            </button>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>

// 方法2: モバイルでカード、デスクトップでテーブル
<div>
  {/* モバイル: カードリスト */}
  <ul className="lg:hidden space-y-3">
    {rows.map(row => (
      <li key={row.id} className="bg-white rounded-lg border border-gray-200 p-4">
        <p className="font-medium text-gray-900">{row.name}</p>
        <p className="text-sm text-gray-500">{row.email}</p>
      </li>
    ))}
  </ul>

  {/* デスクトップ: テーブル */}
  <table className="hidden lg:table min-w-full">
    {/* ... */}
  </table>
</div>
```

---

## ボタンバリアント

```tsx
// Primary
<button className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-md
                   hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2
                   focus:ring-primary-500 disabled:opacity-50 disabled:cursor-not-allowed
                   transition-colors">
  送信
</button>

// Secondary
<button className="px-4 py-2 bg-white text-gray-700 text-sm font-medium rounded-md
                   border border-gray-300 hover:bg-gray-50 focus:outline-none focus:ring-2
                   focus:ring-offset-2 focus:ring-primary-500 transition-colors">
  キャンセル
</button>

// Danger
<button className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-md
                   hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2
                   focus:ring-red-500 transition-colors">
  削除
</button>

// Ghost (テキストのみ)
<button className="px-4 py-2 text-primary-600 text-sm font-medium rounded-md
                   hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-offset-2
                   focus:ring-primary-500 transition-colors">
  詳細を見る
</button>

// Icon button
<button
  type="button"
  aria-label="削除"
  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md
             focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500
             transition-colors"
>
  <TrashIcon className="h-5 w-5" />
</button>
```

---

## ローディング / 空状態

```tsx
// スケルトンローダー
function SkeletonCard() {
  return (
    <div className="animate-pulse bg-white rounded-lg border border-gray-200 p-4">
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-200 rounded w-1/2" />
    </div>
  );
}

// 空状態
function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12">
      <p className="text-gray-500 text-sm">{message}</p>
    </div>
  );
}

// ローディングスピナー
function Spinner() {
  return (
    <div
      aria-label="読み込み中"
      role="status"
      className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-primary-600"
    />
  );
}
```
