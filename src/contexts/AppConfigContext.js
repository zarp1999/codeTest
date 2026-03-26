import React, { createContext, useContext, useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// Contextの作成
const AppConfigContext = createContext(null);

// Providerコンポーネント
export function AppConfigProvider({ children }) {
  const location = useLocation();
  const initialMode = location.pathname.startsWith('/elevation') ? 'elevation' : 'normal';
  const [config, setConfig] = useState({ mode: initialMode });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // public/config.jsonを読み込む
    fetch('/config.json')
      .then(response => {
        if (!response.ok) {
          throw new Error('設定ファイルの読み込みに失敗しました');
        }
        return response.json();
      })
      .then(data => {
        // mode は URL に同期するため、config.json の mode は反映しない
        const { mode: _ignoredMode, ...rest } = data || {};
        setConfig(prev => ({ ...prev, ...rest }));
        setLoading(false);
      })
      .catch(err => {
        console.error('設定読み込みエラー:', err);
        setError(err.message);
        // デフォルト値を設定
        setConfig(prev => prev || { mode: 'normal' });
        setLoading(false);
      });
  }, []);

  // mode はルート（URL）に同期
  useEffect(() => {
    const modeFromPath = location.pathname.startsWith('/elevation') ? 'elevation' : 'normal';
    setConfig(prev => ({ ...(prev || {}), mode: modeFromPath }));
  }, [location.pathname]);

  if (loading) {
    return <div>設定を読み込み中...</div>;
  }

  if (error) {
    console.warn('設定ファイルの読み込みに失敗しました。デフォルト値を使用します。');
  }

  return (
    <AppConfigContext.Provider value={config}>
      {children}
    </AppConfigContext.Provider>
  );
}

// カスタムフック（Contextを使用するための便利な関数）
export function useAppConfig() {
  const context = useContext(AppConfigContext);
  if (!context) {
    throw new Error('useAppConfigはAppConfigProvider内で使用する必要があります');
  }
  return context;
}

