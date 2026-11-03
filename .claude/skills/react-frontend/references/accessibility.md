# アクセシビリティ (WCAG AA)

React コンポーネントに適用する必須アクセシビリティ要件。全コンポーネントに適用する。

---

## WCAG AA 要件チートシート

| カテゴリ | 要件 | レベル |
|---------|------|--------|
| テキストコントラスト (18px未満) | 4.5:1 以上 | AA |
| テキストコントラスト (18px以上 / 14px bold以上) | 3:1 以上 | AA |
| UI コンポーネント・グラフィック | 3:1 以上 | AA |
| キーボード操作 | 全機能がキーボードで操作可能 | A |
| フォーカスの可視性 | フォーカスインジケーター表示 | AA |
| alt テキスト | 意味のある画像に必須 | A |
| ページタイトル | 各ページにユニークなタイトル | A |
| 見出し構造 | h1→h2→h3 の順を守る | - |
| ラベル | 全フォーム要素にラベル | A |
| エラー識別 | エラーをテキストで説明 | A |

---

## セマンティック HTML 要素チートシート

| 目的 | 正しい要素 | 誤った代替 | 理由 |
|------|----------|-----------|------|
| クリック操作 (ページ内) | `<button type="button">` | `<div onClick>` | Enter/Space 自動対応、role 不要 |
| ページ移動 | `<a href="...">` | `<div onClick>` | キーボード対応、history 対応 |
| モーダル | `<dialog>` | `<div role="dialog">` | showModal() でフォーカストラップ自動 |
| メインコンテンツ | `<main>` | `<div id="main">` | スキップナビのターゲット |
| ナビゲーション | `<nav aria-label="...">` | `<div class="nav">` | ランドマーク |
| ヘッダー | `<header>` | `<div class="header">` | ランドマーク |
| フッター | `<footer>` | `<div class="footer">` | ランドマーク |
| フォーム | `<form>` | `<div>` | submit イベント、ブラウザ自動補完 |
| 入力ラベル | `<label htmlFor="id">` | テキストをそばに置くだけ | スクリーンリーダーが紐付けを認識 |
| リスト | `<ul>/<ol>` + `<li>` | `<div>` の連列 | リストとして読み上げ |
| 見出し | `<h1>〜<h6>` (順序通り) | `<div class="title">` | ドキュメント構造 |
| 強調 (意味あり) | `<strong>`, `<em>` | `<b>`, `<i>` | セマンティック意味あり |
| 表 | `<table>` + `<th scope>` | CSS でグリッド風 | スクリーンリーダーが行・列を認識 |
| 引用 | `<blockquote>`, `<q>` | `<div class="quote">` | 引用として認識 |

---

## ARIA 属性リファレンス

### 状態属性

| 属性 | 型 | 使用場面 | 例 |
|------|-----|---------|-----|
| `aria-expanded` | boolean | アコーディオン、ドロップダウン | `<button aria-expanded={isOpen}>` |
| `aria-selected` | boolean | タブ、リストアイテム | `<button role="tab" aria-selected={isActive}>` |
| `aria-checked` | boolean / 'mixed' | カスタムチェックボックス | `<div role="checkbox" aria-checked={checked}>` |
| `aria-disabled` | boolean | 無効化された要素 | `<button aria-disabled="true">` |
| `aria-pressed` | boolean | トグルボタン | `<button aria-pressed={isActive}>` |
| `aria-busy` | boolean | ローディング中 | `<div aria-busy={isLoading}>` |
| `aria-invalid` | boolean / 'grammar' / 'spelling' | バリデーションエラー | `<input aria-invalid={!!error}>` |
| `aria-hidden` | boolean | 装飾要素を非表示 | `<span aria-hidden="true">✓</span>` |
| `aria-live` | 'polite' / 'assertive' / 'off' | 動的コンテンツの通知 | `<div aria-live="polite">` |

### 関係属性

| 属性 | 使用場面 | 例 |
|------|---------|-----|
| `aria-label` | 視覚的ラベルがない要素 | `<button aria-label="メニューを開く">☰</button>` |
| `aria-labelledby` | 別の要素がラベルになる場合 | `<div role="dialog" aria-labelledby="dialog-title">` |
| `aria-describedby` | 補足説明・エラーメッセージ | `<input aria-describedby="email-error">` |
| `aria-controls` | この要素が制御する要素 | `<button aria-controls="panel-1">` |
| `aria-owns` | DOM の親子関係と異なる論理構造 | コンボボックス等 |
| `aria-haspopup` | ポップアップを持つ要素 | `<button aria-haspopup="listbox">` |

### ロール

| role | 使用場面 |
|------|---------|
| `alert` | 即時通知が必要なエラーメッセージ |
| `status` | 低優先度の状態更新 |
| `dialog` | モーダル (できれば `<dialog>` 要素を使う) |
| `tab` / `tablist` / `tabpanel` | タブUIパターン |
| `listbox` / `option` | カスタムセレクト |
| `combobox` | 検索付きセレクト |
| `progressbar` | プログレスバー |
| `tooltip` | ツールチップ |
| `navigation` | `<nav>` と同等 |
| `main` | `<main>` と同等 |
| `banner` | `<header>` と同等 |

---

## キーボードナビゲーションパターン

### 基本ルール

```tsx
// NG: div は Enter/Space で発火しない
<div onClick={handleDelete} className="cursor-pointer text-red-600">削除</div>

// OK: button は Enter/Space で自動発火
<button type="button" onClick={handleDelete} className="text-red-600">削除</button>

// OK: アイコンボタン (ラベルが見えない場合)
<button type="button" onClick={handleDelete} aria-label="削除">
  <TrashIcon className="h-4 w-4" aria-hidden="true" />
</button>
```

### ドロップダウン / アコーディオン

```tsx
// キーボード対応のドロップダウン
function Dropdown({ label, items }: { label: string; items: { id: string; label: string }[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setIsOpen(true);
        setActiveIndex(prev => Math.min(prev + 1, items.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Escape':
        setIsOpen(false);
        setActiveIndex(-1);
        buttonRef.current?.focus();
        break;
      case 'Enter':
      case ' ':
        if (activeIndex >= 0 && items[activeIndex]) {
          // アイテム選択
          setIsOpen(false);
          buttonRef.current?.focus();
        }
        break;
      case 'Tab':
        setIsOpen(false);
        break;
    }
  };

  return (
    <div className="relative" onKeyDown={handleKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={() => setIsOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 border rounded-md"
      >
        {label}
        <ChevronDownIcon className="h-4 w-4" aria-hidden="true" />
      </button>

      {isOpen && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={label}
          className="absolute top-full left-0 mt-1 w-full bg-white border rounded-md shadow-lg z-10"
        >
          {items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === activeIndex}
              className={`px-4 py-2 cursor-pointer text-sm ${
                i === activeIndex ? 'bg-primary-50 text-primary-700' : 'hover:bg-gray-50'
              }`}
            >
              {item.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

### タブ UI

```tsx
// ARIA タブパターン
function Tabs({ tabs }: { tabs: { id: string; label: string; content: React.ReactNode }[] }) {
  const [activeTab, setActiveTab] = useState(tabs[0]?.id ?? '');

  const handleKeyDown = (e: React.KeyboardEvent, currentId: string) => {
    const currentIndex = tabs.findIndex(t => t.id === currentId);
    let nextIndex: number | null = null;

    if (e.key === 'ArrowRight') nextIndex = (currentIndex + 1) % tabs.length;
    if (e.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    if (e.key === 'Home') nextIndex = 0;
    if (e.key === 'End') nextIndex = tabs.length - 1;

    if (nextIndex !== null) {
      e.preventDefault();
      const nextTab = tabs[nextIndex];
      if (nextTab) {
        setActiveTab(nextTab.id);
        document.getElementById(`tab-${nextTab.id}`)?.focus();
      }
    }
  };

  return (
    <div>
      <div role="tablist" aria-label="コンテンツタブ" className="flex border-b border-gray-200">
        {tabs.map(tab => (
          <button
            key={tab.id}
            id={`tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={e => handleKeyDown(e, tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
              ${activeTab === tab.id
                ? 'border-primary-500 text-primary-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map(tab => (
        <div
          key={tab.id}
          id={`panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`tab-${tab.id}`}
          hidden={activeTab !== tab.id}
          className="py-4"
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}
```

---

## フォーカス管理

### フォーカストラップ (モーダル)

```tsx
// フォーカス可能な要素のセレクター
const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

function useFocusTrap(containerRef: React.RefObject<HTMLElement>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusables = container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    first?.focus(); // モーダルを開いたときに最初の要素にフォーカス

    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [isActive, containerRef]);
}
```

### フォーカスの復元

```tsx
// モーダルを閉じたときに元の要素にフォーカスを戻す
function useRestoreFocus(isOpen: boolean) {
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
    } else {
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);
}
```

---

## アクセシブルモーダル (完全実装)

```tsx
// components/ui/Dialog.tsx
import { useEffect, useRef } from 'react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function Dialog({ isOpen, onClose, title, description, children }: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement;
      dialog.showModal();
    } else {
      dialog.close();
      previousFocusRef.current?.focus();
    }
  }, [isOpen]);

  // Escape キーを dialog のネイティブ onClose にフォールバック
  const handleDialogClose = () => onClose();

  return (
    <dialog
      ref={dialogRef}
      onClose={handleDialogClose}
      aria-labelledby="dialog-title"
      aria-describedby={description ? 'dialog-description' : undefined}
      className="rounded-lg shadow-xl p-0 max-w-md w-full backdrop:bg-black/50"
    >
      <div className="p-6">
        <h2 id="dialog-title" className="text-lg font-semibold text-gray-900 mb-2">
          {title}
        </h2>
        {description && (
          <p id="dialog-description" className="text-sm text-gray-600 mb-4">
            {description}
          </p>
        )}
        {children}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="閉じる"
        className="absolute top-4 right-4 p-1 rounded hover:bg-gray-100"
      >
        <XIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
      </button>
    </dialog>
  );
}
```

---

## アクセシブルフォーム (エラー紐付け完全実装)

```tsx
// 全要件を満たすフォームフィールドパターン
function AccessibleFormField({
  id,
  label,
  hint,
  error,
  required = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactElement;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  // aria-describedby に hint と error の両方を含める
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;

  // children (input) に必要な属性を注入
  const enhancedChild = React.cloneElement(children, {
    id,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    'aria-required': required ? true : undefined,
  });

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
        {required && (
          <>
            <span className="text-red-500 ml-1" aria-hidden="true">*</span>
            <span className="sr-only">必須</span>
          </>
        )}
      </label>

      {hint && (
        <p id={hintId} className="text-xs text-gray-500">
          {hint}
        </p>
      )}

      {enhancedChild}

      {error && (
        <p id={errorId} role="alert" className="text-red-600 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

// 使用例
<AccessibleFormField
  id="password"
  label="パスワード"
  hint="8文字以上、大文字・小文字・数字を含めてください"
  error={errors.password}
  required
>
  <input type="password" className={inputClass(!!errors.password)} />
</AccessibleFormField>
```

---

## スキップナビゲーション

```tsx
// layout.tsx の最初の要素として配置
function SkipNav() {
  return (
    <a
      href="#main-content"
      className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4
                 focus:z-50 focus:px-4 focus:py-2 focus:bg-primary-600 focus:text-white
                 focus:rounded-md focus:shadow-lg"
    >
      メインコンテンツにスキップ
    </a>
  );
}

// メインコンテンツに id を付ける
<main id="main-content" tabIndex={-1}>
  {children}
</main>
```

---

## ライブリージョン (動的コンテンツ通知)

```tsx
// aria-live で動的な更新をスクリーンリーダーに通知
// polite: 現在の読み上げが終わったら通知 (非緊急)
// assertive: 即座に割り込んで通知 (エラー、重要なアラート)

// トースト通知
function ToastContainer({ message, type }: { message: string; type: 'info' | 'error' }) {
  return (
    <div
      role={type === 'error' ? 'alert' : 'status'}
      aria-live={type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg text-white
        ${type === 'error' ? 'bg-red-600' : 'bg-gray-800'}`}
    >
      {message}
    </div>
  );
}

// ローディング状態の通知
function DataTable({ isLoading, data }: { isLoading: boolean; data: unknown[] }) {
  return (
    <div>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {isLoading ? 'データを読み込み中です' : `${data.length}件のデータを表示しています`}
      </div>
      {/* テーブル本体 */}
    </div>
  );
}
```

---

## スクリーンリーダーテストチェックリスト

VoiceOver (macOS/iOS) または NVDA (Windows) でテストする。

- [ ] タブキーで全インタラクティブ要素に到達できる
- [ ] フォーカスインジケーターが常に見える
- [ ] ボタン・リンクのラベルが意味を表している (「クリック」「こちら」は NG)
- [ ] フォームの各 input に対応するラベルが読まれる
- [ ] エラーメッセージが入力欄の説明として読まれる (aria-describedby)
- [ ] モーダルを開くとフォーカスがモーダル内に移動する
- [ ] モーダルを閉じるとフォーカスがトリガーボタンに戻る
- [ ] モーダル外のコンテンツがスクリーンリーダーに読まれない (aria-modal)
- [ ] 動的な更新 (エラー表示、成功メッセージ) が通知される
- [ ] 画像に適切な alt テキストがある (装飾的な画像は `alt=""`)
- [ ] 見出し構造が正しい (h1 → h2 → h3 の順)
- [ ] ページタイトルが各ページでユニーク

---

## よくある間違いと修正例

```tsx
// 間違い1: アイコンボタンにラベルなし
<button onClick={onDelete}><TrashIcon /></button>
// 修正
<button onClick={onDelete} aria-label="削除"><TrashIcon aria-hidden="true" /></button>

// 間違い2: プレースホルダーをラベル代わりに使う
<input placeholder="メールアドレス" />
// 修正
<label htmlFor="email">メールアドレス</label>
<input id="email" type="email" placeholder="example@example.com" />

// 間違い3: 色だけでエラーを伝える
<input className="border-red-500" />
// 修正
<input className="border-red-500" aria-invalid="true" aria-describedby="email-error" />
<p id="email-error" role="alert">メールアドレスの形式が正しくありません</p>

// 間違い4: role="button" に tabIndex がない
<div role="button" onClick={handleClick}>クリック</div>
// 修正 (可能なら <button> を使う)
<div role="button" tabIndex={0} onClick={handleClick}
     onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') handleClick(); }}>
  クリック
</div>

// 間違い5: disabled な要素が完全に非インタラクティブ (ツールチップが出せない)
<button disabled>送信</button>
// 修正: aria-disabled を使ってフォーカス可能にしつつ無効化
<button aria-disabled="true" onClick={e => e.preventDefault()} className="opacity-50">
  送信
</button>
```
