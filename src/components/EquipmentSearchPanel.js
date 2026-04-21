import React, { useEffect, useState } from 'react';
import './EquipmentSearchPanel.css';

/**
 * 設備検索パネル。
 * 検索結果を一覧表示し、行クリックで対象設備へフォーカスさせる。
 *
 * @param {Object} props
 * @param {(keyword: string) => Array<{key: string, featureId: string, material: string, pipeType: string}>} props.onSearch 検索関数
 * @param {(key: string) => boolean} props.onFocusResult 結果クリック時のフォーカス関数
 * @param {(key: string) => Promise<{ok: boolean, message?: string}>|{ok: boolean, message?: string}} [props.onRegisterResult] 選択結果の登録処理
 * @param {boolean} [props.hideInput=false] true の場合はパネル内入力欄を隠す
 * @param {string} [props.externalKeyword=''] 外部入力欄のキーワード
 * @param {number} [props.searchRequestId=0] Enter押下などの検索実行トリガーID
 * @returns {JSX.Element}
 */
function EquipmentSearchPanel({
  onSearch,
  onFocusResult,
  onRegisterResult,
  hideInput = false,
  externalKeyword = '',
  searchRequestId = 0
}) {
  const [keyword, setKeyword] = useState(externalKeyword || '');
  const [results, setResults] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [status, setStatus] = useState('');

  /**
   * キーワードで設備一覧を検索して表示に反映する。
   *
   * @param {string|null} [queryOverride=null] 指定時はこの値を検索語として優先
   * @returns {void}
   */
  const handleSearch = (queryOverride = null) => {
    // 単体入力欄/外部入力欄どちらからでも同じ検索処理を使えるようにする
    const query = String(queryOverride ?? keyword).trim();
    if (!query) {
      setResults([]);
      setSelectedKey(null);
      setStatus('キーワードを入力してください');
      return;
    }

    const searchedRaw = typeof onSearch === 'function' ? onSearch(query) : [];
    const searched = Array.isArray(searchedRaw) ? searchedRaw : [];
    setResults(searched);
    setSelectedKey(null);
    setStatus(`${searched.length} 件ヒットしました`);
  };

  useEffect(() => {
    // 右上の検索inputと内部stateを同期する
    setKeyword(externalKeyword || '');
  }, [externalKeyword]);

  useEffect(() => {
    // Scene3D側でEnterが押されたら、現在の外部キーワードで検索を実行する
    if (!searchRequestId) return;
    handleSearch(externalKeyword);
  }, [searchRequestId]);

  const handleRowClick = (row) => {
    setSelectedKey(row.key);
    const moved = onFocusResult?.(row.key);
    if (moved) {
      setStatus(`Feature ID ${row.featureId || '-'} を中心へ移動しました`);
    } else {
      setStatus('対象設備へ移動できませんでした');
    }
  };

  const handleRegisterClick = async () => {
    if (!selectedKey) {
      setStatus('登録対象を選択してください');
      return;
    }
    if (typeof onRegisterResult !== 'function') {
      setStatus('登録処理が利用できません');
      return;
    }
    const result = await onRegisterResult(selectedKey);
    if (result?.ok) {
      setStatus(result.message || '登録しました');
    } else {
      setStatus(result?.message || '登録に失敗しました');
    }
  };

  return (
    <div className="equipment-search-panel">
      {!hideInput && (
        <div className="equipment-search-input-row">
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleSearch();
              }
            }}
            placeholder="キーワードを入力して Enter"
          />
        </div>
      )}
      <div className="equipment-search-table-wrap">
        <table className="equipment-search-table">
          <thead>
            <tr>
              <th>識別番号</th>
              <th>種別</th>
              <th>材質</th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr
                key={row.key}
                className={selectedKey === row.key ? 'selected' : ''}
                onClick={() => handleRowClick(row)}
              >
                <td>{row.featureId}</td>
                <td>{row.material}</td>
                <td>{row.pipeType}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="equipment-search-status">{status}</div>
      <div className="equipment-search-actions">
        <button
          type="button"
          className="equipment-search-register-button"
          onClick={handleRegisterClick}
          disabled={!selectedKey}
        >
          登録
        </button>
      </div>
    </div>
  );
}

export default EquipmentSearchPanel;
