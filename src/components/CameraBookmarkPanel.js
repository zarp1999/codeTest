import React, { useEffect, useMemo, useState } from 'react';
import './CameraBookmarkPanel.css';

const DEFAULT_BOOKMARKS_PATH = '/camera_list.json';
const FALLBACK_BOOKMARKS_PATH = '/Camera_list.json';

const parsePointWkt = (wkt) => {
  if (!wkt || typeof wkt !== 'string') return null;
  const match = /POINT\s*\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s*\)/i.exec(wkt);
  if (!match) return null;
  return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
};

const toNumberOrDefault = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const normalizeLoadedBookmark = (item, index) => {
  const cameraInfo = item?.camera ?? item?.camera_info ?? {};
  const regionWkt = cameraInfo.reqion_position ?? cameraInfo.region_position;
  const regionPoint = parsePointWkt(regionWkt);

  const mapped = {
    id: toNumberOrDefault(item?.id ?? item?.camera_id, index + 1),
    memo: typeof item?.memo === 'string' ? item.memo : '',
    createdAt: item?.createdAt ?? item?.created_at ?? cameraInfo?.created_at ?? new Date().toISOString(),
    camera: {
      x: toNumberOrDefault(
        cameraInfo?.x ?? cameraInfo?.region_x ?? regionPoint?.x,
        0
      ),
      y: toNumberOrDefault(
        cameraInfo?.y ?? cameraInfo?.height ?? cameraInfo?.reqion_hight ?? cameraInfo?.region_hight,
        0
      ),
      z: toNumberOrDefault(
        cameraInfo?.z ?? cameraInfo?.region_z ?? regionPoint?.y,
        0
      ),
      roll: toNumberOrDefault(cameraInfo?.roll, 0),
      pitch: toNumberOrDefault(cameraInfo?.pitch, 0),
      yaw: toNumberOrDefault(cameraInfo?.yaw, 0)
    }
  };

  return mapped;
};

const toPersistedJson = (bookmarks) => {
  return bookmarks.map((b) => ({
    id: b.id,
    camera_info: {
      created_at: b.createdAt,
      global_position: '',
      id: 1,
      pitch: b.camera.pitch,
      reqion_hight: b.camera.height,
      reqion_id: '',
      reqion_position: b.camera.region_position,
      reqion_ref_point: '',
      roll: b.camera.roll,
      updated_at: '',
      user_id: 1,
      yaw: b.camera.yaw
    },
    memo: b.memo
  }));
};

function CameraBookmarkPanel({ onRequestCurrentCamera, onJumpToBookmark, accessor }) {
  const [bookmarks, setBookmarks] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [status, setStatus] = useState('');

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      let loaded = null;

      if (accessor && typeof accessor.fetchCameraBookmarkList === 'function') {
        try {
          const json = await accessor.fetchCameraBookmarkList();
          if (Array.isArray(json)) {
            loaded = json;
          }
        } catch (_) {
          // accessor 取得失敗時は fetch フォールバック
        }
      }

      if (!Array.isArray(loaded)) {
        const paths = [DEFAULT_BOOKMARKS_PATH, FALLBACK_BOOKMARKS_PATH];
        for (const path of paths) {
          try {
            const res = await fetch(path, { cache: 'no-store' });
            if (!res.ok) continue;
            const json = await res.json();
            if (Array.isArray(json)) {
              loaded = json;
              break;
            }
          } catch (_) {
            // try next path
          }
        }
      }

      if (cancelled) return;

      if (!Array.isArray(loaded)) {
        setBookmarks([]);
        setStatus('camera_list.json が見つからないため空一覧で開始しました');
        return;
      }

      const normalized = loaded.map(normalizeLoadedBookmark);
      setBookmarks(normalized);
      setStatus(`${normalized.length} 件のブックマークを読み込みました`);
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [accessor]);

  const nextId = useMemo(() => {
    if (bookmarks.length === 0) return 1;
    return bookmarks.reduce((max, b) => Math.max(max, toNumberOrDefault(b.id, 0)), 0) + 1;
  }, [bookmarks]);

  const handleAdd = () => {
    const camera = typeof onRequestCurrentCamera === 'function' ? onRequestCurrentCamera() : null;
    if (!camera) {
      setStatus('カメラ情報を取得できませんでした');
      return;
    }

    const item = {
      id: nextId,
      memo: '',
      createdAt: new Date().toISOString(),
      camera
    };
    setBookmarks((prev) => [...prev, item]);
    setSelectedId(item.id);
    setStatus(`ID ${item.id} を追加しました`);
  };

  const handleDelete = () => {
    if (selectedId == null) {
      setStatus('削除する行を選択してください');
      return;
    }
    setBookmarks((prev) => prev.filter((b) => b.id !== selectedId));
    setSelectedId(null);
    setStatus(`ID ${selectedId} を削除しました`);
  };

  const handleMemoChange = (id, memo) => {
    setBookmarks((prev) =>
      prev.map((b) => (b.id === id ? { ...b, memo } : b))
    );
  };

  const handleRowClick = (bookmark) => {
    setSelectedId(bookmark.id);
    if (typeof onJumpToBookmark === 'function') {
      onJumpToBookmark(bookmark.camera);
      setStatus(`ID ${bookmark.id} の視点へ移動しました`);
    }
  };

  const handleRegister = async () => {
    const payload = toPersistedJson(bookmarks);
    const jsonText = JSON.stringify(payload, null, 2);

    if (accessor && typeof accessor.saveCameraBookmarkList === 'function') {
      try {
        await accessor.saveCameraBookmarkList(payload);
        setStatus('一覧全件を accessor 経由で保存しました');
        return;
      } catch (_) {
        // accessor 保存失敗時はファイル保存にフォールバック
      }
    }

    const saveByDownload = () => {
      const blob = new Blob([jsonText], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'camera_list.json';
      a.click();
      URL.revokeObjectURL(url);
      setStatus('一覧全件を camera_list.json として保存しました（ダウンロード）');
    };

    // Chromium系では任意ファイルへ直接保存できる（ユーザー許可が必要）
    if (typeof window.showSaveFilePicker === 'function') {
      window.showSaveFilePicker({
        suggestedName: 'camera_list.json',
        types: [
          {
            description: 'JSON file',
            accept: { 'application/json': ['.json'] }
          }
        ]
      })
        .then((handle) => handle.createWritable())
        .then(async (writable) => {
          await writable.write(jsonText);
          await writable.close();
          setStatus('一覧全件を camera_list.json に保存しました');
        })
        .catch(() => {
          // キャンセル時やAPI非対応相当のケースではダウンロードにフォールバック
          saveByDownload();
        });
      return;
    }

    saveByDownload();
  };

  return (
    <div className="camera-bookmark-panel">
      <div className="camera-bookmark-title">◆カメラブックマーク</div>
      <div className="camera-bookmark-table-wrap">
        <table className="camera-bookmark-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>メモ</th>
              <th>作成日</th>
            </tr>
          </thead>
          <tbody>
            {bookmarks.map((b) => (
              <tr
                key={b.id}
                className={selectedId === b.id ? 'selected' : ''}
                onClick={() => handleRowClick(b)}
              >
                <td>{b.id}</td>
                <td>
                  <input
                    type="text"
                    value={b.memo}
                    onChange={(e) => handleMemoChange(b.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="メモを入力"
                  />
                </td>
                <td>{new Date(b.createdAt).toLocaleString('ja-JP')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="camera-bookmark-actions">
        <button type="button" onClick={handleAdd}>追加</button>
        <button type="button" onClick={handleRegister}>登録</button>
        <button type="button" onClick={handleDelete}>削除</button>
      </div>
      <div className="camera-bookmark-status">{status}</div>
    </div>
  );
}

export default CameraBookmarkPanel;
