import React, { useEffect, useState } from 'react';
import { useAppConfig } from '../../contexts/AppConfigContext';
import DemPanel from '../DemPanel/DemPanel';
import { useDemDisplay } from '../../contexts/DemDisplayContext';
import Scene3D from '../Scene3D';
import './Scene3DView.css';

/**
 * 3Dシーンビュー
 * - 既存のScene3Dコンポーネントをラップ
 * - 3D表示、管路情報、距離計測機能を提供
 * - GeoTIFF地形表示機能を統合
 */
function Scene3DView({ cityJsonData, userPositions, shapeTypes, layerData, sourceTypes, geoTiffUrl, potreeMetadataUrl, accessor, apiBaseUrl }) {
  const config = useAppConfig();
  const mode = config?.mode || 'normal';
  const [terrainVisible, setTerrainVisible] = useState(mode === 'elevation');
  const [terrainOpacity, setTerrainOpacity] = useState(1.0);

  useEffect(() => {
    setTerrainVisible(mode === 'elevation');
  }, [mode]);

  const demCtx = useDemDisplay();
  const activeDem = demCtx.activeDem;
  const markLoaded = demCtx.markLoaded;
  const handleToggleTerrain = () => {
    setTerrainVisible(!terrainVisible);
  };

  const handleDemLoaded = useCallback((terrainKey) => {
    if (markLoaded) {
      markLoaded(terrainKey);
    }
  },[markLoaded]);

  return (
    <div className="scene3d-view-container">
      {geoTiffUrl && (
        <div className="terrain-controls">
          <button
            className="terrain-toggle-button"
            onClick={handleToggleTerrain}
            title={terrainVisible ? '地形を非表示' : '地形を表示'}
          >
            {terrainVisible ? '地形: 表示' : '地形: 非表示'}
          </button>

          {terrainVisible && (
            <div className="terrain-opacity-controls">
              <div className="terrain-opacity-label-row">
                <span className="terrain-opacity-label">地形opacity</span>
                <span className="terrain-opacity-value">{terrainOpacity.toFixed(2)}</span>
              </div>
              <input
                type="range"
                className="terrain-opacity-range"
                min="0"
                max="1"
                step="0.01"
                value={terrainOpacity}
                onChange={(e) => setTerrainOpacity(Number(e.target.value))}
              />
            </div>
          )}
        </div>
      )}
      {demCtx && (
        <div className="dem-panel-container">
          <DemPanel apiBaseUrl={apiBaseUrl} />
        </div>
      )}
      <Scene3D
        cityJsonData={cityJsonData}
        userPositions={userPositions}
        shapeTypes={shapeTypes}
        layerData={layerData}
        sourceTypes={sourceTypes}
        geoTiffUrl={geoTiffUrl}
        potreeMetadataUrl={potreeMetadataUrl}
        terrainVisible={terrainVisible}
        terrainOpacity={terrainOpacity}
        accessor={accessor}
        activeDem={activeDem}
        onDemLoaded={handleDemLoaded}
      />
    </div>
  );
}

export default Scene3DView;

