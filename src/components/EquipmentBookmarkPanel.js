import React, { useMemo, useState } from 'react';
import './EquipmentBookmarkPanel.css';

/**
 * 設備ブックマーク一覧パネル。
 * bookmark=1 の設備のみを表示する。
 *
 * @param {Object} props
 * @param {() => Array<{key: string, featureId: string, memo: string, lastCreatedAt: string}>} props.onListBookmarks 一覧取得関数
 * @param {(key: string) => boolean} [props.onFocusResult] 行クリック時のフォーカス関数
 * @returns {JSX.Element}
 */
function EquipmentBookmarkPanel({ onListBookmarks, onFocusResult }) {
  const [selectedKey, setSelectedKey] = useState(null);
  const [status, setStatus] = useState('');

  const rows = useMemo(() => {
    const listedRaw = typeof onListBookmarks === 'function' ? onListBookmarks() : [];
    return Array.isArray(listedRaw) ? listedRaw : [];
  }, [onListBookmarks, selectedKey]);

  const handleRowClick = (row) => {
    setSelectedKey(row.key);
    const moved = onFocusResult?.(row.key);
    if (moved) {
      setStatus(`Feature ID ${row.featureId || '-'} を中心へ移動しました`);
    } else {
      setStatus('対象設備へ移動できませんでした');
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
                <td>{row.memo}</td>
                <td>{row.lastCreatedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="equipment-bookmark-status">
        {status || `${rows.length} 件を表示`}
      </div>
    </div>
  );
}

export default EquipmentBookmarkPanel;
