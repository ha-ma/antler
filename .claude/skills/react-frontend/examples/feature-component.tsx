/**
 * Feature コンポーネントの完全な実装例
 *
 * このファイルは新規 Feature コンポーネント作成時のテンプレートとして使用できます。
 *
 * 構成:
 * 1. 型定義 (types.ts として分離可能)
 * 2. カスタムフック (hooks.ts として分離可能)
 * 3. サブコンポーネント (components/ に分離可能)
 * 4. メインコンポーネント (Container)
 *
 * 使い方:
 * 1. このファイルを components/features/<domain>/ にコピー
 * 2. TaskBoard → 実際の機能名に置換
 * 3. 型とロジックを実際の要件に合わせて修正
 */

import React, { useState, useMemo, useCallback } from 'react';
import { Button, message, Skeleton, Empty, Alert } from 'antd';
import { useApiQuery } from '@/lib/api/use-api-query';
import { useApiMutation } from '@/lib/api/use-api-mutation';
import { useQueryClient } from '@tanstack/react-query';
import styles from './index.module.css';

// =============================================================================
// 1. 型定義 (types.ts として分離可能)
// =============================================================================

/** タスクの型定義 */
interface Task {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeId: number | null;
  createdAt: string;
}

type TaskStatus = 'todo' | 'in_progress' | 'done';
type TaskPriority = 'low' | 'medium' | 'high';

/** タスク更新リクエスト */
interface UpdateTaskRequest {
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: number | null;
}

/** Props の型定義 */
interface TaskBoardProps {
  projectId: number;
}

/** フック戻り値の型定義 */
interface UseTaskBoardReturn {
  // データ
  tasks: Task[];
  selectedTask: Task | null;

  // 状態
  isLoadingTasks: boolean;
  isUpdating: boolean;
  error: Error | null;

  // アクション
  selectTask: (taskId: number) => void;
  moveTask: (taskId: number, status: TaskStatus) => Promise<void>;
  reset: () => void;
}

// =============================================================================
// 2. カスタムフック (hooks.ts として分離可能)
// =============================================================================

/**
 * タスクボード機能のカスタムフック
 *
 * 責務:
 * - タスク一覧の取得
 * - タスク選択状態の管理
 * - タスクステータス更新
 */
const useTaskBoard = (projectId: number): UseTaskBoardReturn => {
  const queryClient = useQueryClient();

  // --------------------------------------------------------------------------
  // データ取得
  // --------------------------------------------------------------------------

  const {
    data: tasks = [],
    isLoading: isLoadingTasks,
    error: tasksError,
  } = useApiQuery<Task[]>({
    queryKey: ['projects', projectId, 'tasks'],
    url: `/api/projects/${projectId}/tasks`,
    enabled: projectId > 0,
  });

  // --------------------------------------------------------------------------
  // ローカル状態
  // --------------------------------------------------------------------------

  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  // --------------------------------------------------------------------------
  // ミューテーション
  // --------------------------------------------------------------------------

  const updateMutation = useApiMutation<Task, UpdateTaskRequest & { taskId: number }>({
    url: (vars) => `/api/tasks/${vars.taskId}`,
    method: 'PATCH',
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['projects', projectId, 'tasks'],
      });
      message.success('タスクを更新しました');
    },
    onError: (error) => {
      message.error(`更新に失敗しました: ${error.message}`);
    },
  });

  // --------------------------------------------------------------------------
  // 派生状態
  // --------------------------------------------------------------------------

  const selectedTask = useMemo(
    () => tasks.find((t) => t.id === selectedTaskId) ?? null,
    [tasks, selectedTaskId]
  );

  // --------------------------------------------------------------------------
  // アクション
  // --------------------------------------------------------------------------

  const selectTask = useCallback((taskId: number) => {
    setSelectedTaskId(taskId);
  }, []);

  const moveTask = useCallback(
    async (taskId: number, status: TaskStatus) => {
      await updateMutation.mutateAsync({ taskId, status });
    },
    [updateMutation]
  );

  const reset = useCallback(() => {
    setSelectedTaskId(null);
    updateMutation.reset();
  }, [updateMutation]);

  // --------------------------------------------------------------------------
  // 戻り値
  // --------------------------------------------------------------------------

  return {
    tasks,
    selectedTask,
    isLoadingTasks,
    isUpdating: updateMutation.isPending,
    error: tasksError,
    selectTask,
    moveTask,
    reset,
  };
};

// =============================================================================
// 3. サブコンポーネント (components/ に分離可能)
// =============================================================================

/** タスクカードの Props */
interface TaskCardProps {
  task: Task;
  isSelected: boolean;
  onSelect: (taskId: number) => void;
}

/**
 * タスクカードコンポーネント
 * Presentational: Props のみに依存
 */
const TaskCard: React.FC<TaskCardProps> = ({ task, isSelected, onSelect }) => {
  const priorityColors: Record<TaskPriority, string> = {
    low: '#52c41a',
    medium: '#faad14',
    high: '#f5222d',
  };

  return (
    <div
      className={`${styles.taskCard} ${isSelected ? styles.selected : ''}`}
      onClick={() => onSelect(task.id)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(task.id)}
    >
      <div className={styles.taskTitle}>{task.title}</div>
      <div
        className={styles.priority}
        style={{ color: priorityColors[task.priority] }}
      >
        {task.priority}
      </div>
    </div>
  );
};

/** タスクカラムの Props */
interface TaskColumnProps {
  title: string;
  tasks: Task[];
  selectedTaskId: number | null;
  onSelectTask: (taskId: number) => void;
}

/**
 * タスクカラムコンポーネント
 * Presentational: Props のみに依存
 */
const TaskColumn: React.FC<TaskColumnProps> = ({
  title,
  tasks,
  selectedTaskId,
  onSelectTask,
}) => {
  return (
    <div className={styles.column}>
      <h3 className={styles.columnTitle}>
        {title} ({tasks.length})
      </h3>
      <div className={styles.columnContent}>
        {tasks.length === 0 ? (
          <Empty description="タスクなし" />
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              isSelected={task.id === selectedTaskId}
              onSelect={onSelectTask}
            />
          ))
        )}
      </div>
    </div>
  );
};

/** タスク詳細パネルの Props */
interface TaskDetailPanelProps {
  task: Task;
  onMoveTask: (taskId: number, status: TaskStatus) => Promise<void>;
  isUpdating: boolean;
}

/**
 * タスク詳細パネル
 * Presentational: Props のみに依存
 */
const TaskDetailPanel: React.FC<TaskDetailPanelProps> = ({
  task,
  onMoveTask,
  isUpdating,
}) => {
  const nextStatusMap: Record<TaskStatus, TaskStatus | null> = {
    todo: 'in_progress',
    in_progress: 'done',
    done: null,
  };

  const nextStatus = nextStatusMap[task.status];

  return (
    <div className={styles.detailPanel}>
      <h3>{task.title}</h3>
      <p>{task.description}</p>
      <dl>
        <dt>ステータス</dt>
        <dd>{task.status}</dd>
        <dt>優先度</dt>
        <dd>{task.priority}</dd>
        <dt>作成日</dt>
        <dd>{new Date(task.createdAt).toLocaleString()}</dd>
      </dl>
      {nextStatus && (
        <Button
          type="primary"
          loading={isUpdating}
          onClick={() => onMoveTask(task.id, nextStatus)}
        >
          次のステータスへ移動
        </Button>
      )}
    </div>
  );
};

// =============================================================================
// 4. メインコンポーネント (Container)
// =============================================================================

/**
 * タスクボード Feature コンポーネント
 *
 * Container パターン:
 * - カスタムフックでロジックを管理
 * - Presentational コンポーネントに表示を委譲
 * - エラー・ローディング状態をハンドリング
 *
 * 行数目安: 100行以下
 */
export const TaskBoard: React.FC<TaskBoardProps> = ({ projectId }) => {
  const {
    tasks,
    selectedTask,
    isLoadingTasks,
    isUpdating,
    error,
    selectTask,
    moveTask,
    reset,
  } = useTaskBoard(projectId);

  // エラー状態
  if (error) {
    return (
      <Alert
        type="error"
        message="エラーが発生しました"
        description={error.message}
        action={
          <Button onClick={() => window.location.reload()}>再読み込み</Button>
        }
      />
    );
  }

  // ローディング状態
  if (isLoadingTasks) {
    return (
      <div className={styles.container}>
        <Skeleton active paragraph={{ rows: 4 }} />
      </div>
    );
  }

  // メインレンダリング
  const columns: { key: TaskStatus; title: string }[] = [
    { key: 'todo', title: '未着手' },
    { key: 'in_progress', title: '進行中' },
    { key: 'done', title: '完了' },
  ];

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h2>タスクボード</h2>
        <Button onClick={reset}>リセット</Button>
      </div>

      <div className={styles.board}>
        {columns.map((col) => (
          <TaskColumn
            key={col.key}
            title={col.title}
            tasks={tasks.filter((t) => t.status === col.key)}
            selectedTaskId={selectedTask?.id ?? null}
            onSelectTask={selectTask}
          />
        ))}
      </div>

      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          onMoveTask={moveTask}
          isUpdating={isUpdating}
        />
      )}
    </div>
  );
};

export default TaskBoard;
