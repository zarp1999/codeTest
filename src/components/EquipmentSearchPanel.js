import React, { useState } from 'react';
import './EquipmentSearchPanel.css';

function EquipmentSearchPanel({ onSearch, onFocusResult }) {
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState([]);
  const [selectedKey, setSelectedKey] = useState(null);
  const [status, setStatus] = useState('');

  const handleSearch = () => {
    const query = keyword.trim();
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
    <div className="equipment-search-panel">
      <div className="equipment-search-title">◆設備検索</div>
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
      <div className="equipment-search-table-wrap">
        <table className="equipment-search-table">
          <thead>
            <tr>
              <th>feature id</th>
              <th>material</th>
              <th>pipe_type</th>
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
    </div>
  );
}

export default EquipmentSearchPanel;
