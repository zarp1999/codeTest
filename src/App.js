import React, { useState, useEffect, useRef, useContext } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import './App3D.css';
import Scene3DView from './components/views/Scene3DView';
import CrossSectionView from './components/views/CrossSectionView';
 
// import { createDataAccessor } from './DataAccessor/Factory.js';
import { LayerContext } from './ViewerApp.js'
import { AppConfigProvider, useAppConfig } from './contexts/AppConfigContext.js';
 
/**
 * メインアプリケーションコンポーネント
 * CityJSONデータを読み込み、3Dシーンを表示
 */
function AppContent({ dataAccessor }) {
  const config = useAppConfig(); // Contextから設定を取得
  const mode = config?.mode || 'normal';
  const [cityJsonData, setCityJsonData] = useState(null);
  const { layerData, setLayerData } = useContext(LayerContext);
  const [shapeTypes, setShapeTypes] = useState(null);
  const [sourceTypes, setSourceTypes] = useState(null);
  const [userPositions, setUserPositions] = useState(null);
  const [loadingError, setLoadingError] = useState(null);
  const [geoTiffUrl, setGeoTiffUrl] = useState(null);
  const [potreeMetadataUrl, setPotreeMetadataUrl] = useState(null);
 
  let loaded = useRef(false); // Strict modeの場合renderが2回実行されるが、ロードを2回実行すると重いので抑止
  const didMountRef = useRef(false); // 初回マウント時のmode監視useEffectをスキップ
 
  // const accessor = createDataAccessor();
  const accessor = dataAccessor;
 
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    loaded.current = false; // mode変更時にリセット
    setCityJsonData(null);
  }, [mode]);
 
  // GeoTIFFファイルの自動検索
  useEffect(() => {
    if (mode === 'normal') {
      setGeoTiffUrl(null);
      return;
    }
    const findGeoTiffFile = async () => {
      const possibleTiffFiles = [
        //'/cloud.tif'
        '/unify_bilinear.tif'
      ];
 
      // 各候補を順番に試す
      for (const tiffPath of possibleTiffFiles) {
        try {
          const response = await fetch(tiffPath, { method: 'HEAD' });
          if (response.ok) {
            console.log(`GeoTIFFファイルが見つかりました: ${tiffPath}`);
            setGeoTiffUrl(tiffPath);
            return;
          }
        } catch (error) {
          // ファイルが見つからない場合は次の候補を試す
          continue;
        }
      }
      console.log('GeoTIFFファイルが見つかりませんでした。地形表示はスキップされます。');
    };
 
    findGeoTiffFile();
  }, [mode]);
 
  // Potree metadata.json の自動検索
  useEffect(() => {
    const findPotreeMetadataFile = async () => {
      const possibleMetadataFiles = [
        '/potree/hikifune/metadata.json'
      ];
 
      for (const metadataPath of possibleMetadataFiles) {
        try {
          const response = await fetch(metadataPath, { method: 'HEAD' });
          if (response.ok) {
            console.log(`Potree metadata.json が見つかりました: ${metadataPath}`);
            setPotreeMetadataUrl(metadataPath);
            return;
          }
        } catch (error) {
          continue;
        }
      }
      console.log('Potree metadata.json が見つかりませんでした。点群表示はスキップされます。');
    };
 
    findPotreeMetadataFile();
  }, []);
 
  // データの読み込み
  useEffect(() => {
 
    if (loaded.current) {
      return;
    }
    loaded.current = true;
 
    const loadData = async () => {
      try {
        setLoadingError(null);
        let cityJson, layers, shapes, sources, positions
        if (mode === 'elevation') {
          [cityJson, layers, shapes, sources, positions] = await Promise.all([
            accessor.fetchCityJsonElevationData(),
            accessor.fetchLayerPanelElevationData(),
            accessor.fetchShapeTypesElevationData(),
            accessor.fetchSourceTypesElevationData(),
            accessor.fetchUserPositionElevationDataList()
          ]);
        } else {
          [cityJson, layers, shapes, sources, positions] = await Promise.all([
            accessor.fetchCityJsonData(),
            accessor.fetchLayerPanelData(),
            accessor.fetchShapeTypesData(),
            accessor.fetchSourceTypesData(),
            accessor.fetchUserPositionDataList()
          ]);
        }
 
        setCityJsonData(cityJson);
        setLayerData(layers);
        setShapeTypes(shapes);
        setSourceTypes(sources);
        setUserPositions(positions);
      } catch (error) {
        console.error('データの読み込みエラー:', error);
        setLoadingError(error.message || 'データの読み込みに失敗しました');
      }
    };
 
    loadData();
  }, [accessor, mode]);
 
  useEffect(() => {
    // サーバーからのイベント受信登録
    const eventSource = accessor.getEventSource(`events/user_pos`);
    eventSource.onmessage = (event) => {
 
      // ユーザー位置情報更新。
      updateUserPositions();
    };
    return () => {
      eventSource.close();
    };
  }, []);
 
  // ユーザー位置情報更新。
  const updateUserPositions = async () => {
    // DBを読み直す事で3Dビューのカメラ位置を更新する。
    const regionPosList = await accessor.fetchUserPositionDataList();
    setUserPositions(regionPosList);
  };
 
  const handleRetry = () => {
    window.location.reload();
  };
 
  if (loadingError) {
    return (
      <div className="loading error">
        <p className="error-message">{loadingError}</p>
        <button className="retry-button" onClick={handleRetry}>
          再読み込み
        </button>
      </div>
    );
  }
 
  if (!cityJsonData || !layerData) {
    return (
      <div className="loading">
        <div className="loading-spinner"></div>
        <p>データを読み込み中...</p>
      </div>
    );
  }
 
  return (
    <div className="App3D">
      <div className="main-content">
        <div className="scene-container">
          <Routes>
            {/* Normal 3Dシーンビュー*/}
            <Route
              path="/normal"
              element={
                <Scene3DView
                  cityJsonData={cityJsonData}
                  userPositions={userPositions}
                  shapeTypes={shapeTypes}
                  layerData={layerData}
                  sourceTypes={sourceTypes}
                  geoTiffUrl={geoTiffUrl}
                  accessor={accessor}
                  potreeMetadataUrl={potreeMetadataUrl}
                />
              }
            />
 
            {/* Normal 断面図生成ビュー */}
            <Route
              path="/normal/cross-section"
              element={
                <CrossSectionView
                  cityJsonData={cityJsonData}
                  userPositions={userPositions}
                  shapeTypes={shapeTypes}
                  layerData={layerData}
                  sourceTypes={sourceTypes}
                  geoTiffUrl={geoTiffUrl}
                  accessor={accessor}
                  potreeMetadataUrl={potreeMetadataUrl}
                />
              }
            />
 
            {/* Elevation 3Dシーンビュー */}
            <Route
              path="/elevation"
              element={
                <Scene3DView
                  cityJsonData={cityJsonData}
                  userPositions={userPositions}
                  shapeTypes={shapeTypes}
                  layerData={layerData}
                  sourceTypes={sourceTypes}
                  geoTiffUrl={geoTiffUrl}
                  accessor={accessor}
                  potreeMetadataUrl={potreeMetadataUrl}
                />
              }
            />
 
            {/* Elevation 断面図生成ビュー */}
            <Route
              path="/elevation/cross-section"
              element={
                <CrossSectionView
                  cityJsonData={cityJsonData}
                  userPositions={userPositions}
                  shapeTypes={shapeTypes}
                  layerData={layerData}
                  sourceTypes={sourceTypes}
                  geoTiffUrl={geoTiffUrl}
                  accessor={accessor}
                  potreeMetadataUrl={potreeMetadataUrl}
                />
              }
            />
          </Routes>
        </div>
      </div>
    </div>
  );
}
 
/**
 * Appコンポーネント（Providerでラップ）
 */
function App3D({ dataAccessor }) {
  return (
    <AppConfigProvider>
      <AppContent dataAccessor={dataAccessor} />
    </AppConfigProvider>
  );
}
 
export default App3D;