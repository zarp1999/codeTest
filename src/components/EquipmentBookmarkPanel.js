import React, { useMemo, useState } from 'react';
import './EquipmentBookmarkPanel.css';

/**
 * 設備ブックマーク一覧パネル。
 * bookmark=1 の設備のみを表示する。
 *
 * @param {Object} props
 * @param {() => Array<{key: string, featureId: string, memo: string, lastCreatedAt: string}>} props.onListBookmarks 一覧取得関数
 * @param {(key: string) => boolean} [props.onFocusResult] 行クリック時のフォーカス関数
 * @param {(memo: string) => Promise<{ok: boolean, message?: string}>|{ok: boolean, message?: string}} [props.onRegisterBookmark] 現在選択中設備の登録
 * @param {() => Promise<{ok: boolean, message?: string}>|{ok: boolean, message?: string}} [props.onDeleteBookmark] 現在選択中設備の削除
 * @returns {JSX.Element}
 */
function EquipmentBookmarkPanel({
  onListBookmarks,
  onFocusResult,
  onRegisterBookmark,
  onDeleteBookmark
}) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [memoInput, setMemoInput] = useState('');
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const listedRaw = typeof onListBookmarks === 'function' ? onListBookmarks() : [];
    return Array.isArray(listedRaw) ? listedRaw : [];
  }, [onListBookmarks, selectedKey]);

  const handleRowClick = (row) => {
    setSelectedKey(row.key);
    setMemoInput(row.memo || '');
    const moved = onFocusResult?.(row.key);
    if (moved) {
      setStatus(`Feature ID ${row.featureId || '-'} を中心へ移動しました`);
    } else {
      setStatus('対象設備へ移動できませんでした');
    }
  };

  const handleRegisterClick = async () => {
    if (typeof onRegisterBookmark !== 'function') {
      setStatus('登録処理が利用できません');
      return;
    }
    const result = await onRegisterBookmark(memoInput);
    if (result?.ok) {
      setStatus(result.message || '登録しました');
    } else {
      setStatus(result?.message || '登録に失敗しました');
    }
  };

  const handleDeleteClick = async () => {
    if (typeof onDeleteBookmark !== 'function') {
      setStatus('削除処理が利用できません');
      return;
    }
    const result = await onDeleteBookmark();
    if (result?.ok) {
      setStatus(result.message || '削除しました');
      setMemoInput('');
    } else {
      setStatus(result?.message || '削除に失敗しました');
    }
  };

  return (
    <div className="equipment-bookmark-panel">
      <div className="equipment-bookmark-title">◆設備ブックマーク</div>
      <div className="equipment-bookmark-table-wrap">
        <table className="equipment-bookmark-table">
          <thead>
            <tr>
              <th>識別番号</th>
              <th>メモ</th>
              <th>作成日(最終)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.key}
                className={selectedKey === row.key ? 'selected' : ''}
                onClick={() => handleRowClick(row)}
              >
                <td>{row.featureId}</td>
                <td>
                  {selectedKey === row.key ? (
                    <input
                      type="text"
                      className="equipment-bookmark-memo-input"
                      value={memoInput}
                      onChange={(e) => setMemoInput(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="メモを入力"
                    />
                  ) : (
                    row.memo
                  )}
                </td>
                <td>{row.lastCreatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="equipment-bookmark-actions">
        <button type="button" onClick={handleRegisterClick}>登録</button>
        <button type="button" onClick={handleDeleteClick}>削除</button>
      </div>
      <div className="equipment-bookmark-status">
        {status || `${rows.length} 件を表示`}
      </div>
    </div>
  );
}

export default EquipmentBookmarkPanel;
