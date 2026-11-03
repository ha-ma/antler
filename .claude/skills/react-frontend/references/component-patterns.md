# コンポーネントパターン

## 目次

- [300行ルール](#300行ルール)
- [分割戦略](#分割戦略)
- [Container/Presentational パターン](#containerpresentational-パターン)
- [コンポーネント構成パターン](#コンポーネント構成パターン)
- [実際の分割例](#実際の分割例)

---

## 300行ルール

### 原則

**コンポーネントファイルは 300行以下に保つ**

| 行数 | 状態 | アクション |
|------|------|----------|
| ~150行 | 健全 | そのまま |
| 150~300行 | 注意 | 分割を検討 |
| 300行~ | 要対応 | **即座に分割** |

### なぜ 300行か？

1. **可読性**: 1画面で全体を把握できる
2. **テスト容易性**: 小さいほどテストしやすい
3. **再利用性**: 小さいほど再利用しやすい
4. **変更影響範囲**: 小さいほど影響が限定される

### 警告サイン

以下の兆候があれば分割を検討:

```tsx
// ⚠️ useState が 5+ 個
const [a, setA] = useState();
const [b, setB] = useState();
const [c, setC] = useState();
const [d, setD] = useState();
const [e, setE] = useState();

// ⚠️ useEffect が 3+ 個
useEffect(() => { ... }, [a]);
useEffect(() => { ... }, [b]);
useEffect(() => { ... }, [c]);

// ⚠️ ネストが 5+ レベル
// ⚠️ 条件分岐が多い
```

---

## 分割戦略

### 戦略1: カスタムフックへの抽出

**対象**: ロジックが多い、useState/useEffect が多い

```tsx
// ❌ Before: ロジックが混在
const MediaPlayer: React.FC = () => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const mediaRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const media = mediaRef.current;
    if (!media) return;
    const handleTimeUpdate = () => setCurrentTime(media.currentTime);
    const handleDurationChange = () => setDuration(media.duration);
    media.addEventListener('timeupdate', handleTimeUpdate);
    media.addEventListener('durationchange', handleDurationChange);
    return () => {
      media.removeEventListener('timeupdate', handleTimeUpdate);
      media.removeEventListener('durationchange', handleDurationChange);
    };
  }, []);

  const play = () => { mediaRef.current?.play(); setIsPlaying(true); };
  const pause = () => { mediaRef.current?.pause(); setIsPlaying(false); };
  // ... 200行以上のロジック

  return ( /* JSX */ );
};

// ✅ After: フックに抽出
// hooks.ts
export const useMediaPlayer = (mediaRef: RefObject<HTMLVideoElement>) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);

  useEffect(() => { /* イベントリスナー */ }, []);

  const play = () => { /* ... */ };
  const pause = () => { /* ... */ };
  const seek = (time: number) => { /* ... */ };

  return { isPlaying, currentTime, duration, volume, play, pause, seek };
};

// index.tsx
const MediaPlayer: React.FC = () => {
  const mediaRef = useRef<HTMLVideoElement>(null);
  const player = useMediaPlayer(mediaRef);

  return (
    <div className={styles.container}>
      <video ref={mediaRef} />
      <PlayerControls {...player} />
    </div>
  );
};
```

### 戦略2: サブコンポーネントへの分割

**対象**: JSX が長い、UI 要素が多い

```tsx
// ❌ Before: 巨大な JSX
const Dashboard: React.FC = () => {
  return (
    <div>
      <header>
        {/* 50行の header JSX */}
      </header>
      <main>
        {/* 200行の main JSX */}
      </main>
      <footer>
        {/* 30行の footer JSX */}
      </footer>
    </div>
  );
};

// ✅ After: サブコンポーネントに分割
const Dashboard: React.FC = () => {
  const { data: stats } = useDashboardStats();

  return (
    <div>
      <DashboardHeader />
      <main>
        <StatsPanel stats={stats} />
        <ActivityFeed />
      </main>
      <DashboardFooter />
    </div>
  );
};
```

### 戦略3: 条件分岐のコンポーネント化

**対象**: 条件分岐が多い

```tsx
// ❌ Before: 条件分岐が散らばる
const TaskStatus: React.FC<{ task: Task }> = ({ task }) => {
  return (
    <div>
      {task.status === 'todo' && <Badge color="gray">未着手</Badge>}
      {task.status === 'in_progress' && <Badge color="blue">進行中</Badge>}
      {task.status === 'done' && <Badge color="green">完了</Badge>}
      {task.status === 'blocked' && <Badge color="red">ブロック</Badge>}
    </div>
  );
};

// ✅ After: マッピングオブジェクト
const STATUS_CONFIG: Record<TaskStatus, { color: string; label: string }> = {
  todo: { color: 'gray', label: '未着手' },
  in_progress: { color: 'blue', label: '進行中' },
  done: { color: 'green', label: '完了' },
  blocked: { color: 'red', label: 'ブロック' },
};

const TaskStatus: React.FC<{ task: Task }> = ({ task }) => {
  const config = STATUS_CONFIG[task.status];
  return <Badge color={config.color}>{config.label}</Badge>;
};
```

---

## Container/Presentational パターン

### 構造

```
features/<domain>/
├── index.tsx              # Container (ロジック)
└── components/
    └── <Name>View.tsx     # Presentational (表示)
```

### Container コンポーネント

**責務**: データ取得、状態管理、イベントハンドリング

```tsx
// index.tsx (Container)
import { TaskBoardView } from './components/TaskBoardView';
import { useTaskBoard } from './hooks';

export const TaskBoard: React.FC<{ projectId: number }> = ({ projectId }) => {
  const {
    tasks,
    columns,
    isLoading,
    moveTask,
    addTask,
    deleteTask,
  } = useTaskBoard(projectId);

  return (
    <TaskBoardView
      tasks={tasks}
      columns={columns}
      isLoading={isLoading}
      onMoveTask={moveTask}
      onAddTask={addTask}
      onDeleteTask={deleteTask}
    />
  );
};
```

### Presentational コンポーネント

**責務**: 表示のみ、Props に完全依存

```tsx
// components/TaskBoardView.tsx (Presentational)
interface TaskBoardViewProps {
  tasks: Task[];
  columns: Column[];
  isLoading: boolean;
  onMoveTask: (taskId: number, columnId: number) => void;
  onAddTask: (columnId: number) => void;
  onDeleteTask: (taskId: number) => void;
}

export const TaskBoardView: React.FC<TaskBoardViewProps> = ({
  tasks,
  columns,
  isLoading,
  onMoveTask,
  onAddTask,
  onDeleteTask,
}) => (
  <div className={styles.board}>
    {columns.map((column) => (
      <TaskColumn
        key={column.id}
        column={column}
        tasks={tasks.filter((t) => t.columnId === column.id)}
        onMove={onMoveTask}
        onAdd={() => onAddTask(column.id)}
        onDelete={onDeleteTask}
      />
    ))}
  </div>
);
```

---

## コンポーネント構成パターン

### パターン1: 単一ファイル (小規模)

```
features/simple-feature/
├── index.tsx          # すべて含む (< 150行)
└── index.module.css
```

### パターン2: フック分離 (中規模)

```
features/medium-feature/
├── index.tsx          # UI
├── hooks.ts           # ロジック
└── index.module.css
```

### パターン3: Container/Presentational (大規模)

```
features/large-feature/
├── index.tsx          # Container
├── components/
│   ├── FeatureView.tsx
│   ├── SubComponent1.tsx
│   └── SubComponent2.tsx
├── hooks.ts
└── index.module.css
```

### パターン4: 完全分離 (超大規模)

```
features/complex-feature/
├── index.tsx
├── components/
│   ├── Section1/
│   │   ├── index.tsx
│   │   └── components/
│   ├── Section2/
│   └── Section3/
├── hooks/
│   ├── use-section1.ts
│   ├── use-section2.ts
│   └── index.ts
├── utils/
├── types.ts
└── index.module.css
```

---

## 実際の分割例

### 巨大コンポーネントの分割案

**問題**: 1,800行超の巨大コンポーネント (50+ useState, 20+ useEffect)

**分割後の構成**:

```
features/data-sync/
├── index.tsx                    # Container (~100行)
├── components/
│   ├── SourcePanel.tsx          # ソース表示 (~150行)
│   ├── WaveformDisplay.tsx      # 波形/データ表示 (~100行)
│   ├── SyncControls.tsx         # 操作コントロール (~80行)
│   ├── TimelineMarker.tsx       # タイムラインマーカー (~60行)
│   └── ResultPanel.tsx          # 結果表示 (~80行)
├── hooks/
│   ├── use-data-sync.ts         # メインロジック (~200行)
│   ├── use-waveform.ts          # 波形処理 (~100行)
│   └── use-playback.ts          # 再生制御 (~150行)
├── utils/
│   └── calculations.ts          # 計算ロジック (~100行)
├── types.ts                     # 型定義 (~50行)
└── index.module.css
```

**分割後の index.tsx**:

```tsx
// features/data-sync/index.tsx (~100行)
import { SourcePanel } from './components/SourcePanel';
import { WaveformDisplay } from './components/WaveformDisplay';
import { SyncControls } from './components/SyncControls';
import { ResultPanel } from './components/ResultPanel';
import { useDataSync } from './hooks/use-data-sync';

export const DataSync: React.FC<{ projectId: number }> = ({ projectId }) => {
  const {
    sources,
    waveforms,
    syncState,
    selectedSource,
    selectSource,
    updateOffset,
    confirmSync,
  } = useDataSync(projectId);

  return (
    <div className={styles.container}>
      <div className={styles.sourceSection}>
        {sources.map(source => (
          <SourcePanel
            key={source.id}
            source={source}
            isSelected={source.id === selectedSource?.id}
            onSelect={() => selectSource(source)}
          />
        ))}
      </div>
      <WaveformDisplay waveforms={waveforms} syncState={syncState} />
      <SyncControls
        syncState={syncState}
        onOffsetChange={updateOffset}
        onConfirm={confirmSync}
      />
      <ResultPanel result={syncState.result} />
    </div>
  );
};
```

---

## 関連ドキュメント

- **[フックパターン](hooks-patterns.md)** - カスタムフックの作り方
- **[Container/Presentational 例](../examples/container-presentational.tsx)** - 完全な実装例
- **[アンチパターン](anti-patterns.md)** - 巨大コンポーネントの問題
