/**
 * Container/Presentational パターンの実装例
 *
 * このファイルは大規模 Feature コンポーネントのテンプレートとして使用できます。
 *
 * パターン説明:
 * - Container: ロジック担当 (データ取得、状態管理、イベントハンドリング)
 * - Presentational: 表示担当 (Props のみに依存、純粋コンポーネント)
 *
 * メリット:
 * - 関心の分離が明確
 * - テストしやすい
 * - 再利用しやすい
 *
 * 使い方:
 * 1. このファイルを components/features/<domain>/ にコピー
 * 2. ItemList → 実際の機能名に置換
 * 3. 型とロジックを実際の要件に合わせて修正
 */

import React, { useMemo, useCallback } from 'react';
import { Button, Table, Tag, Space, Modal, message, Input, Empty } from 'antd';
import { DeleteOutlined, EditOutlined, SearchOutlined } from '@ant-design/icons';
import { useApiQuery } from '@/lib/api/use-api-query';
import { useApiMutation } from '@/lib/api/use-api-mutation';
import { useQueryClient } from '@tanstack/react-query';
import { useDebounce, usePagination, useSelection } from '@/hooks';
import styles from './index.module.css';

// =============================================================================
// 型定義
// =============================================================================

interface Item {
  id: number;
  name: string;
  duration: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  thumbnailUrl: string;
  createdAt: string;
}

interface ItemListResponse {
  items: Item[];
  total: number;
}

// Container の Props
interface ItemListContainerProps {
  projectId: number;
}

// Presentational の Props
interface ItemListViewProps {
  // データ
  items: Item[];
  total: number;
  selectedIds: number[];

  // 状態
  isLoading: boolean;
  searchTerm: string;

  // ページネーション
  pagination: {
    current: number;
    pageSize: number;
    total: number;
    onChange: (page: number) => void;
    onShowSizeChange: (current: number, size: number) => void;
  };

  // イベントハンドラ
  onSearch: (value: string) => void;
  onSelect: (id: number) => void;
  onSelectAll: (ids: number[]) => void;
  onEdit: (item: Item) => void;
  onDelete: (item: Item) => void;
  onBatchDelete: () => void;
}

// =============================================================================
// Presentational Components (表示のみ、ロジックなし)
// =============================================================================

/**
 * ステータスバッジ
 * 純粋コンポーネント: Props のみに依存
 */
const StatusBadge: React.FC<{ status: Item['status'] }> = ({ status }) => {
  const config: Record<Item['status'], { color: string; label: string }> = {
    pending: { color: 'default', label: '待機中' },
    processing: { color: 'processing', label: '処理中' },
    completed: { color: 'success', label: '完了' },
    error: { color: 'error', label: 'エラー' },
  };

  const { color, label } = config[status];
  return <Tag color={color}>{label}</Tag>;
};

/**
 * 時間フォーマッター
 */
const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

/**
 * 検索バー
 * Presentational: 値とコールバックを Props で受け取る
 */
const SearchBar: React.FC<{
  value: string;
  onChange: (value: string) => void;
}> = ({ value, onChange }) => (
  <Input
    placeholder="検索..."
    prefix={<SearchOutlined />}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    allowClear
    className={styles.searchInput}
  />
);

/**
 * バッチアクションバー
 * Presentational: 選択状態とコールバックを Props で受け取る
 */
const BatchActionBar: React.FC<{
  selectedCount: number;
  onDelete: () => void;
}> = ({ selectedCount, onDelete }) => {
  if (selectedCount === 0) return null;

  return (
    <div className={styles.batchActions}>
      <span>{selectedCount} 件選択中</span>
      <Button danger icon={<DeleteOutlined />} onClick={onDelete}>
        一括削除
      </Button>
    </div>
  );
};

/**
 * ItemListView (Presentational)
 *
 * 責務:
 * - Props を受け取って表示する
 * - イベントを Props のコールバックに委譲する
 * - ビジネスロジックを持たない
 * - API 呼び出しをしない
 */
const ItemListView: React.FC<ItemListViewProps> = ({
  items,
  total,
  selectedIds,
  isLoading,
  searchTerm,
  pagination,
  onSearch,
  onSelect,
  onSelectAll,
  onEdit,
  onDelete,
  onBatchDelete,
}) => {
  const columns = [
    {
      title: 'サムネイル',
      dataIndex: 'thumbnailUrl',
      key: 'thumbnail',
      width: 120,
      render: (url: string, item: Item) => (
        <img src={url} alt={item.name} className={styles.thumbnail} />
      ),
    },
    {
      title: '名前',
      dataIndex: 'name',
      key: 'name',
      sorter: true,
    },
    {
      title: '長さ',
      dataIndex: 'duration',
      key: 'duration',
      width: 100,
      render: (duration: number) => formatDuration(duration),
    },
    {
      title: 'ステータス',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: Item['status']) => <StatusBadge status={status} />,
    },
    {
      title: '作成日',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 180,
      render: (date: string) => new Date(date).toLocaleString(),
    },
    {
      title: 'アクション',
      key: 'actions',
      width: 120,
      render: (_: unknown, item: Item) => (
        <Space>
          <Button type="text" icon={<EditOutlined />} onClick={() => onEdit(item)} />
          <Button type="text" danger icon={<DeleteOutlined />} onClick={() => onDelete(item)} />
        </Space>
      ),
    },
  ];

  if (!isLoading && items.length === 0) {
    return (
      <div className={styles.container}>
        <SearchBar value={searchTerm} onChange={onSearch} />
        <Empty description="アイテムがありません" />
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <SearchBar value={searchTerm} onChange={onSearch} />
        <BatchActionBar selectedCount={selectedIds.length} onDelete={onBatchDelete} />
      </div>

      <Table
        dataSource={items}
        columns={columns}
        rowKey="id"
        loading={isLoading}
        pagination={{
          ...pagination,
          total,
          showSizeChanger: true,
          showTotal: (t) => `全 ${t} 件`,
        }}
        rowSelection={{
          selectedRowKeys: selectedIds,
          onChange: (keys) => onSelectAll(keys as number[]),
          onSelect: (record) => onSelect(record.id),
        }}
      />
    </div>
  );
};

// =============================================================================
// Container Component (ロジック担当)
// =============================================================================

/**
 * ItemListContainer (Container)
 *
 * 責務:
 * - データ取得 (useApiQuery)
 * - 状態管理 (useState, カスタムフック)
 * - イベントハンドリング
 * - ビジネスロジック
 * - Presentational コンポーネントに Props を渡す
 */
export const ItemListContainer: React.FC<ItemListContainerProps> = ({
  projectId,
}) => {
  const queryClient = useQueryClient();

  // 状態管理
  const [searchTerm, setSearchTerm] = React.useState('');
  const debouncedSearch = useDebounce(searchTerm, 300);

  const { page, pageSize, pagination, setPage } = usePagination({
    defaultPageSize: 10,
  });

  const {
    selectedIds,
    toggle: toggleSelection,
    selectAll,
    clear: clearSelection,
  } = useSelection<number>();

  // データ取得
  const { data, isLoading } = useApiQuery<ItemListResponse>({
    queryKey: ['projects', projectId, 'items', { page, pageSize, search: debouncedSearch }],
    url: `/api/projects/${projectId}/items`,
    params: {
      page,
      pageSize,
      search: debouncedSearch || undefined,
    },
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  // ミューテーション
  const deleteMutation = useApiMutation<void, number>({
    url: (itemId) => `/api/items/${itemId}`,
    method: 'DELETE',
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects', projectId, 'items'] });
      message.success('削除しました');
    },
    onError: () => {
      message.error('削除に失敗しました');
    },
  });

  // イベントハンドラ
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value);
    setPage(1);
  }, [setPage]);

  const handleEdit = useCallback((item: Item) => {
    console.log('Edit:', item);
  }, []);

  const handleDelete = useCallback((item: Item) => {
    Modal.confirm({
      title: '削除しますか？',
      content: `"${item.name}" を削除すると元に戻せません。`,
      okText: '削除',
      okType: 'danger',
      cancelText: 'キャンセル',
      onOk: () => deleteMutation.mutate(item.id),
    });
  }, [deleteMutation]);

  const handleBatchDelete = useCallback(() => {
    Modal.confirm({
      title: `${selectedIds.length} 件を削除しますか？`,
      content: '削除すると元に戻せません。',
      okText: '削除',
      okType: 'danger',
      cancelText: 'キャンセル',
      onOk: async () => {
        for (const id of selectedIds) {
          await deleteMutation.mutateAsync(id);
        }
        clearSelection();
      },
    });
  }, [selectedIds, deleteMutation, clearSelection]);

  // Presentational に Props を渡す
  return (
    <ItemListView
      items={items}
      total={total}
      selectedIds={selectedIds}
      isLoading={isLoading}
      searchTerm={searchTerm}
      pagination={{
        current: page,
        pageSize,
        total,
        onChange: pagination.onChange,
        onShowSizeChange: pagination.onShowSizeChange,
      }}
      onSearch={handleSearch}
      onSelect={toggleSelection}
      onSelectAll={selectAll}
      onEdit={handleEdit}
      onDelete={handleDelete}
      onBatchDelete={handleBatchDelete}
    />
  );
};

// =============================================================================
// エクスポート
// =============================================================================

export const ItemList = ItemListContainer;
export { ItemListView };
export default ItemList;
