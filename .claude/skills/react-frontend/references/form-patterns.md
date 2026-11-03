# フォームパターン (Zod + React)

React でフォームを実装する際の標準パターン集。全パターンで Zod バリデーションを使う。

---

## 基本原則

1. **バリデーションは onSubmit で一括実行** - フィールドごとに逐次表示せず、送信時に全エラーを同時表示する
2. **aria-describedby でエラーとフィールドを紐付ける** - スクリーンリーダーが読める
3. **送信中は disabled にする** - 二重送信防止
4. **エラーは `role="alert"` で即時通知する** - スクリーンリーダーへの通知

---

## Zod スキーマ + React フォーム統合

### 基本パターン

```tsx
import { z } from 'zod';
import { useState } from 'react';

// スキーマ定義 (shared パッケージから import するか、ローカルで定義)
const createEventSchema = z.object({
  title:       z.string().min(1, 'タイトルは必須です').max(100, '100文字以内で入力してください'),
  description: z.string().max(500, '500文字以内で入力してください').optional(),
  date:        z.string().min(1, '日付は必須です'),
  capacity:    z.number({ invalid_type_error: '数値を入力してください' })
               .int('整数を入力してください')
               .positive('1以上を入力してください'),
});

type CreateEventInput = z.infer<typeof createEventSchema>;

// フォームフック
function useZodForm<T>(schema: z.ZodType<T>) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const setValue = (field: string, value: unknown) => {
    setValues(prev => ({ ...prev, [field]: value }));
    // フィールドのエラーをリアルタイムでクリア (入力中に消す)
    if (errors[field]) {
      setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    }
  };

  const validate = (): T | null => {
    const result = schema.safeParse(values);
    if (result.success) {
      setErrors({});
      return result.data;
    }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0]?.toString() ?? '_root';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message; // 最初のエラーのみ
    }
    setErrors(fieldErrors);
    return null;
  };

  const reset = () => { setValues({}); setErrors({}); };

  return { values, setValue, errors, validate, reset };
}
```

### フォームコンポーネント

```tsx
function CreateEventForm({ onSuccess }: { onSuccess: () => void }) {
  const { values, setValue, errors, validate, reset } = useZodForm(createEventSchema);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const createEvent = useCreateEvent(); // API mutation hook

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const data = validate();
    if (!data) return; // バリデーション失敗: 全エラーを同時表示済み

    setIsSubmitting(true);
    try {
      await createEvent.mutateAsync(data);
      reset();
      onSuccess();
    } catch (err) {
      // API エラーはここで処理 (フィールドエラーやトースト)
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {/* タイトル */}
      <FormField
        id="title"
        label="タイトル"
        required
        error={errors.title}
      >
        <input
          id="title"
          type="text"
          value={(values.title as string) ?? ''}
          onChange={(e) => setValue('title', e.target.value)}
          aria-describedby={errors.title ? 'title-error' : undefined}
          aria-invalid={!!errors.title}
          className={inputClass(!!errors.title)}
        />
      </FormField>

      {/* 定員 */}
      <FormField id="capacity" label="定員" required error={errors.capacity}>
        <input
          id="capacity"
          type="number"
          min={1}
          value={(values.capacity as number) ?? ''}
          onChange={(e) => setValue('capacity', e.target.valueAsNumber)}
          aria-describedby={errors.capacity ? 'capacity-error' : undefined}
          aria-invalid={!!errors.capacity}
          className={inputClass(!!errors.capacity)}
        />
      </FormField>

      <button
        type="submit"
        disabled={isSubmitting}
        className="w-full px-4 py-2 bg-primary-600 text-white rounded-md
                   hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isSubmitting ? '作成中...' : 'イベントを作成'}
      </button>
    </form>
  );
}

// 再利用可能なフォームフィールドラッパー
function FormField({
  id, label, required = false, error, children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-gray-700">
        {label}
        {required && <span className="text-red-500 ml-1" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-red-600 text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function inputClass(hasError: boolean) {
  return [
    'w-full border rounded-md px-3 py-2 text-sm',
    'focus:outline-none focus:ring-2 focus:border-transparent',
    hasError
      ? 'border-red-500 focus:ring-red-500'
      : 'border-gray-300 focus:ring-primary-500',
  ].join(' ');
}
```

---

## リアルタイムバリデーション (onChange + onBlur)

**推奨: onBlur でフィールドごとにバリデーション、onChange でエラーをクリア。**

```tsx
function useFieldValidation<T>(schema: z.ZodType<T>) {
  const [values, setValues] = useState<Partial<T>>({} as Partial<T>);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [touched, setTouched] = useState<Partial<Record<keyof T, boolean>>>({});

  const handleChange = (field: keyof T, value: unknown) => {
    setValues(prev => ({ ...prev, [field]: value }));
    // 一度タッチしたフィールドはリアルタイムバリデーション
    if (touched[field]) validateField(field, value);
  };

  const handleBlur = (field: keyof T) => {
    setTouched(prev => ({ ...prev, [field]: true }));
    validateField(field, values[field]);
  };

  const validateField = (field: keyof T, value: unknown) => {
    const fieldSchema = (schema as z.ZodObject<z.ZodRawShape>).shape[field as string];
    if (!fieldSchema) return;
    const result = fieldSchema.safeParse(value);
    if (result.success) {
      setErrors(prev => { const next = { ...prev }; delete next[field]; return next; });
    } else {
      setErrors(prev => ({ ...prev, [field]: result.error.issues[0]?.message }));
    }
  };

  const validateAll = (): T | null => {
    // 全フィールドをタッチ済みにする
    const allTouched = Object.fromEntries(
      Object.keys((schema as z.ZodObject<z.ZodRawShape>).shape).map(k => [k, true])
    ) as Partial<Record<keyof T, boolean>>;
    setTouched(allTouched);

    const result = schema.safeParse(values);
    if (result.success) { setErrors({}); return result.data; }
    const fieldErrors: Partial<Record<keyof T, string>> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0] as keyof T;
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    setErrors(fieldErrors);
    return null;
  };

  return { values, errors, touched, handleChange, handleBlur, validateAll };
}
```

---

## 確認ダイアログ (破壊的操作の前)

```tsx
// 削除ボタンに確認ダイアログを挟む
function DeleteButton({ itemName, onConfirm }: { itemName: string; onConfirm: () => void }) {
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleConfirm = async () => {
    setIsDeleting(true);
    try {
      await onConfirm();
      setIsDialogOpen(false);
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsDialogOpen(true)}
        className="text-red-600 hover:text-red-800 text-sm"
      >
        削除
      </button>

      <Dialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} title="削除の確認">
        <p className="text-gray-700 mb-4">
          「{itemName}」を削除しますか？この操作は取り消せません。
        </p>
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={() => setIsDialogOpen(false)}
            disabled={isDeleting}
            className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isDeleting}
            className="px-4 py-2 text-white bg-red-600 rounded-md hover:bg-red-700 disabled:opacity-50"
          >
            {isDeleting ? '削除中...' : '削除する'}
          </button>
        </div>
      </Dialog>
    </>
  );
}
```

---

## ファイルアップロード

```tsx
const fileUploadSchema = z.object({
  file: z.instanceof(File, { message: 'ファイルを選択してください' })
        .refine(f => f.size <= 5 * 1024 * 1024, 'ファイルサイズは5MB以下にしてください')
        .refine(
          f => ['image/jpeg', 'image/png', 'image/webp'].includes(f.type),
          'JPEG、PNG、WebP のみアップロード可能です'
        ),
});

function FileUploadForm({ onUpload }: { onUpload: (file: File) => Promise<void> }) {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>('');
  const [isUploading, setIsUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    setError('');

    if (selected) {
      // バリデーション
      const result = fileUploadSchema.safeParse({ file: selected });
      if (!result.success) {
        setError(result.error.issues[0]?.message ?? 'ファイルが無効です');
        setFile(null);
        return;
      }
      // プレビュー生成
      const url = URL.createObjectURL(selected);
      setPreview(url);
      return () => URL.revokeObjectURL(url); // クリーンアップ
    }
    setPreview(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) { setError('ファイルを選択してください'); return; }

    setIsUploading(true);
    try {
      await onUpload(file);
    } catch {
      setError('アップロードに失敗しました。再試行してください。');
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="file-upload"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          画像ファイル
        </label>
        <input
          id="file-upload"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          aria-describedby={error ? 'file-error' : undefined}
          aria-invalid={!!error}
          className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4
                     file:rounded-md file:border-0 file:text-sm file:font-medium
                     file:bg-primary-50 file:text-primary-700 hover:file:bg-primary-100"
        />
        {error && (
          <p id="file-error" role="alert" className="mt-1 text-red-600 text-xs">
            {error}
          </p>
        )}
      </div>

      {preview && (
        <img src={preview} alt="プレビュー" className="h-32 w-32 object-cover rounded-md border" />
      )}

      <button
        type="submit"
        disabled={!file || !!error || isUploading}
        className="px-4 py-2 bg-primary-600 text-white rounded-md disabled:opacity-50"
      >
        {isUploading ? 'アップロード中...' : 'アップロード'}
      </button>
    </form>
  );
}
```

---

## マルチステップフォーム

```tsx
// スキーマをステップごとに定義
const step1Schema = z.object({
  firstName: z.string().min(1, '名は必須です'),
  lastName:  z.string().min(1, '姓は必須です'),
});

const step2Schema = z.object({
  email:    z.string().email('メールアドレスの形式が正しくありません'),
  password: z.string().min(8, '8文字以上で入力してください'),
});

const step3Schema = z.object({
  agreedToTerms: z.literal(true, { errorMap: () => ({ message: '利用規約への同意が必要です' }) }),
});

// 全体スキーマ
const registrationSchema = step1Schema.merge(step2Schema).merge(step3Schema);
type RegistrationInput = z.infer<typeof registrationSchema>;

const STEPS = ['基本情報', 'アカウント情報', '利用規約'] as const;

function MultiStepForm({ onComplete }: { onComplete: (data: RegistrationInput) => void }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [formData, setFormData] = useState<Partial<RegistrationInput>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const stepSchemas = [step1Schema, step2Schema, step3Schema] as const;

  const validateCurrentStep = (): boolean => {
    const schema = stepSchemas[currentStep];
    const result = schema.safeParse(formData);
    if (result.success) { setErrors({}); return true; }
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path[0]?.toString() ?? '';
      if (!fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    setErrors(fieldErrors);
    return false;
  };

  const handleNext = () => {
    if (!validateCurrentStep()) return;
    setCurrentStep(s => s + 1);
  };

  const handleBack = () => setCurrentStep(s => s - 1);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateCurrentStep()) return;
    const result = registrationSchema.safeParse(formData);
    if (result.success) onComplete(result.data);
  };

  const updateField = (field: keyof RegistrationInput, value: unknown) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => { const n = { ...prev }; delete n[field]; return n; });
  };

  return (
    <div className="max-w-md mx-auto">
      {/* ステップインジケーター */}
      <nav aria-label="フォームの進捗" className="mb-6">
        <ol className="flex items-center gap-2">
          {STEPS.map((step, i) => (
            <li key={step} className="flex items-center gap-2">
              <span
                aria-current={i === currentStep ? 'step' : undefined}
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium
                  ${i < currentStep ? 'bg-primary-600 text-white'
                  : i === currentStep ? 'bg-primary-100 text-primary-700 border-2 border-primary-600'
                  : 'bg-gray-100 text-gray-400'}`}
              >
                {i + 1}
              </span>
              <span className="text-sm text-gray-600 hidden sm:block">{step}</span>
              {i < STEPS.length - 1 && <span className="text-gray-300">→</span>}
            </li>
          ))}
        </ol>
      </nav>

      <form onSubmit={handleSubmit} noValidate>
        {/* ステップ 1: 基本情報 */}
        {currentStep === 0 && (
          <div className="flex flex-col gap-4">
            <FormField id="firstName" label="名" required error={errors.firstName}>
              <input
                id="firstName"
                type="text"
                value={formData.firstName ?? ''}
                onChange={e => updateField('firstName', e.target.value)}
                aria-describedby={errors.firstName ? 'firstName-error' : undefined}
                aria-invalid={!!errors.firstName}
                className={inputClass(!!errors.firstName)}
              />
            </FormField>
          </div>
        )}

        {/* ステップ 2: アカウント情報 */}
        {currentStep === 1 && (
          <div className="flex flex-col gap-4">
            <FormField id="email" label="メールアドレス" required error={errors.email}>
              <input
                id="email"
                type="email"
                value={formData.email ?? ''}
                onChange={e => updateField('email', e.target.value)}
                aria-describedby={errors.email ? 'email-error' : undefined}
                aria-invalid={!!errors.email}
                className={inputClass(!!errors.email)}
              />
            </FormField>
          </div>
        )}

        {/* ステップ 3: 利用規約 */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-4">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={formData.agreedToTerms ?? false}
                onChange={e => updateField('agreedToTerms', e.target.checked || undefined)}
                aria-describedby={errors.agreedToTerms ? 'terms-error' : undefined}
                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-500"
              />
              <span className="text-sm text-gray-700">利用規約に同意します</span>
            </label>
            {errors.agreedToTerms && (
              <p id="terms-error" role="alert" className="text-red-600 text-xs">
                {errors.agreedToTerms}
              </p>
            )}
          </div>
        )}

        {/* ナビゲーションボタン */}
        <div className="flex justify-between mt-6">
          {currentStep > 0 && (
            <button type="button" onClick={handleBack}
              className="px-4 py-2 text-gray-700 border border-gray-300 rounded-md hover:bg-gray-50">
              戻る
            </button>
          )}
          {currentStep < STEPS.length - 1 ? (
            <button type="button" onClick={handleNext}
              className="ml-auto px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700">
              次へ
            </button>
          ) : (
            <button type="submit"
              className="ml-auto px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700">
              登録する
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
```

---

## 全エラー一括表示

フォームの上部にサマリーを表示するパターン (特にスクリーンリーダー向けに有効)。

```tsx
// エラーサマリー (フォーム送信後、最初の要素にフォーカスを移す)
function ErrorSummary({ errors }: { errors: Record<string, string> }) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const hasErrors = Object.keys(errors).length > 0;

  useEffect(() => {
    if (hasErrors) summaryRef.current?.focus();
  }, [hasErrors]);

  if (!hasErrors) return null;

  return (
    <div
      ref={summaryRef}
      tabIndex={-1}
      role="alert"
      aria-live="assertive"
      className="bg-red-50 border border-red-200 rounded-md p-4 mb-4 focus:outline-none focus:ring-2 focus:ring-red-500"
    >
      <p className="text-red-800 font-medium text-sm mb-2">
        {Object.keys(errors).length} 件のエラーがあります:
      </p>
      <ul className="list-disc list-inside text-red-700 text-sm space-y-1">
        {Object.entries(errors).map(([field, message]) => (
          <li key={field}>
            <a href={`#${field}`} className="underline hover:no-underline">
              {message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
```
