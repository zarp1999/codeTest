import React, { useEffect, useState, useRef } from 'react';
import { useAppConfig } from '../../contexts/AppConfigContext';
import Scene3D from '../Scene3D';
import { DistanceMeasurementDisplay } from '../DistanceMeasurement';
import './CrossSectionView.css';
import * as THREE from 'three';

/**
 * 断面図生成ビュー
 * - 3Dシーンと同じ管路表示機能を使用
 * - 左上のUIパネルが異なる（断面図生成機能）
 * - 将来的に断面図生成専用の機能を追加予定
 */
function CrossSectionView({ cityJsonData, userPositions, shapeTypes, layerData, sourceTypes, geoTiffUrl, potreeMetadataUrl, accessor }) {
  const config = useAppConfig();
  const mode = config?.mode || 'normal';
  
  // 距離計測結果のstate
  const [measurementResult, setMeasurementResult] = useState(null);

  // ガイド（左上パネル）表示
  const [showGuides, setShowGuides] = useState(true);
  
  // 地形表示（modeに応じて初期値を設定）
  const [terrainVisible, setTerrainVisible] = useState(mode === 'elevation');
  // 地形opacity（0〜1）
  const [terrainOpacity, setTerrainOpacity] = useState(1.0);

  useEffect(() => {
    setTerrainVisible(mode === 'elevation');
  }, [mode]);
  
  // 断面自動作成モードのstate
  const [autoModeEnabled, setAutoModeEnabled] = useState(false);
  
  // 断面自動作成モードのパラメータ
  const [angle, setAngle] = useState(90);
  const [interval, setInterval] = useState(10);
  const [startPoint, setStartPoint] = useState('始点'); // '始点' or '終点'

  // 選択された管路の情報
  const [selectedObject, setSelectedObject] = useState(null);
  const selectedMeshRef = useRef(null);

  // 生成された断面のリスト
  const [generatedSections, setGeneratedSections] = useState([]);
  
  // 断面表示モードのstate
  const [sectionViewMode, setSectionViewMode] = useState(false); // false: 3D表示, true: 断面表示
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);

  // Scene3Dのref
  const scene3DRef = useRef(null);

  // 1キーでガイド表示をトグル（Scene3D側の挙動に合わせる）
  useEffect(() => {
    const handleKeyDown = (event) => {
      // 入力欄にフォーカスがある場合は無視
      if (event.target?.tagName === 'INPUT' || event.target?.tagName === 'TEXTAREA') {
        return;
      }
      if (event.key === '1' && !event.repeat) {
        setShowGuides((prev) => !prev);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);


  // Scene3Dから距離計測結果を受け取るコールバック
  const handleMeasurementUpdate = (result) => {
    setMeasurementResult(result);
  };

  // Scene3Dから選択されたオブジェクトを受け取るコールバック
  const handleSelectedObjectChange = (objectData, mesh) => {
    setSelectedObject(objectData);
    selectedMeshRef.current = mesh;
  };

  // 断面自動生成の計算と描画
  const generateCrossSections = () => {
    if (!selectedObject || !selectedMeshRef.current) {
      alert('管路を選択してください');
      return;
    }

    const objectData = selectedObject;
    const geometry = objectData.geometry?.[0];
    const shapeTypeName = objectData.shapeTypeName || geometry.type;

    // Polyhedronの場合はワールド座標のAABBからstart/endを作り、
    // LineString用の座標変換(getPipeStartEnd)を通さない（ズレ防止）
    const isPolyhedron = (shapeTypeName === 'Polyhedron' || geometry.type === 'Polyhedron');
    let polyStart = null;
    let polyEnd = null;
    
    // ExtrudeGeometryの場合はextrudePathを、それ以外はverticesを使用
    let pathPoints = [];
    if (geometry.type === "ExtrudeGeometry") {
      if (!geometry || !geometry.extrudePath || geometry.extrudePath.length < 2) {
        alert('管路の頂点データが不足しています');
        return;
      }
      // ExtrudeGeometryの場合はextrudePathを使用
      // convPointsと同じ変換: [x, y, z] -> [x, z, -y] (データ座標系からThree.js座標系へ)
      pathPoints = geometry.extrudePath.map(point => {
        const [x, y, z] = point;
        return [x, z, -y];
      });
    } else if (isPolyhedron) {
      const mesh = selectedMeshRef.current;
      if (!mesh) {
        alert('Polyhedronのメッシュが見つかりません');
        return;
      }

      // ワールド座標のAABBから主軸方向のstart/endを決定
      const boundingBox = new THREE.Box3().setFromObject(mesh);
      if (!Number.isFinite(boundingBox.min.x) || !Number.isFinite(boundingBox.max.x)) {
        alert('Polyhedronの境界ボックスの計算に失敗しました');
        return;
      }

      const size = new THREE.Vector3();
      boundingBox.getSize(size);
      const center = new THREE.Vector3();
      boundingBox.getCenter(center);

      let maxAxis = 'x';
      let maxLength = size.x;
      if (size.y > maxLength) {
        maxAxis = 'y';
        maxLength = size.y;
      }
      if (size.z > maxLength) {
        maxAxis = 'z';
        maxLength = size.z;
      }

      if (maxAxis === 'x') {
        polyStart = new THREE.Vector3(boundingBox.min.x, center.y, center.z);
        polyEnd = new THREE.Vector3(boundingBox.max.x, center.y, center.z);
      } else if (maxAxis === 'y') {
        polyStart = new THREE.Vector3(center.x, boundingBox.min.y, center.z);
        polyEnd = new THREE.Vector3(center.x, boundingBox.max.y, center.z);
      } else {
        polyStart = new THREE.Vector3(center.x, center.y, boundingBox.min.z);
        polyEnd = new THREE.Vector3(center.x, center.y, boundingBox.max.z);
      }
    } else {
    if (!geometry || !geometry.vertices || geometry.vertices.length < 2) {
      alert('管路の頂点データが不足しています');
      return;
      }
      // 通常のLineStringの場合はverticesを使用
      pathPoints = geometry.vertices;
    }

    // 管路の半径を取得
    const getPipeRadius = (objData) => {
      let radius = 0.3;
      if (objData.attributes?.radius != null) {
        radius = Number(objData.attributes.radius);
      } else if (objData.attributes?.diameter != null) {
        radius = Number(objData.attributes.diameter) / 2;
      }
      if (radius > 5) radius = radius / 1000;
      return Number.isFinite(radius) && radius > 0 ? radius : 0.3;
    };

    const radius = getPipeRadius(objectData);

    // 管路の始点と終点を計算
    const getPipeStartEnd = (startVertex, endVertex, objData, r) => {
      const hasDepthAttrs = (
        objData.attributes &&
        objData.attributes.start_point_depth != null &&
        objData.attributes.end_point_depth != null &&
        Number.isFinite(Number(objData.attributes.start_point_depth)) &&
        Number.isFinite(Number(objData.attributes.end_point_depth))
      );

      // pathPointsはデータ座標系 [x, y, z] または [x, z, -y] (ExtrudeGeometryの場合、既に変換済み)
      // ExtrudeGeometryの場合は既にThree.js座標系に変換されているので、そのまま使用
      // 通常のLineStringの場合はデータ座標系なので、Three.js座標系に変換
      const isExtrudeGeometry = geometry.type === "ExtrudeGeometry";

      let start, end;
      if (hasDepthAttrs) {
        const startDepth = Number(objData.attributes.start_point_depth / 100);
        const endDepth = Number(objData.attributes.end_point_depth / 100);
        const startCenterY = startDepth > 0 ? -(startDepth + r) : startDepth;
        const endCenterY = endDepth > 0 ? -(endDepth + r) : endDepth;
        
        if (isExtrudeGeometry) {
          // ExtrudeGeometryの場合、pathPointsは既に [x, z, -y] 形式（Three.js座標系）
          // [x, z, -y] -> THREE.Vector3(x, z, -y) = THREE.Vector3(x, Y, Z)
          start = new THREE.Vector3(startVertex[0], startCenterY, startVertex[2]);
          end = new THREE.Vector3(endVertex[0], endCenterY, endVertex[2]);
        } else {
          // 通常のLineStringの場合、データ座標系 [x, y, z] をThree.js座標系に変換
        start = new THREE.Vector3(startVertex[0], startCenterY, -startVertex[1]);
        end = new THREE.Vector3(endVertex[0], endCenterY, -endVertex[1]);
        }
      } else {
        if (isExtrudeGeometry) {
          // ExtrudeGeometryの場合、pathPointsは既に [x, z, -y] 形式（Three.js座標系）
          // [x, z, -y] -> THREE.Vector3(x, z, -y) = THREE.Vector3(x, Y, Z)
          start = new THREE.Vector3(startVertex[0], startVertex[1] - r, startVertex[2]);
          end = new THREE.Vector3(endVertex[0], endVertex[1] - r, endVertex[2]);
        } else {
          // 通常のLineStringの場合、データ座標系 [x, y, z] をThree.js座標系に変換
        start = new THREE.Vector3(startVertex[0], startVertex[2] - r, -startVertex[1]);
        end = new THREE.Vector3(endVertex[0], endVertex[2] - r, -endVertex[1]);
        }
      }

      return { start, end };
    };

    // Polyhedronはすでにワールド座標のstart/endがあるため、座標変換を通さない
    const { start, end } = isPolyhedron
      ? { start: polyStart, end: polyEnd }
      : getPipeStartEnd(pathPoints[0], pathPoints[pathPoints.length - 1], objectData, radius);

    if (!start || !end) {
      alert('管路の始点/終点が取得できません');
      return;
    }

    // 開始点を決定
    const startPosition = startPoint === '始点' ? start.clone() : end.clone();
    const endPosition = startPoint === '始点' ? end.clone() : start.clone();
    
    // 管路の方向ベクトル
    const pipeDirection = endPosition.clone().sub(startPosition).normalize();
    const pipeLength = startPosition.distanceTo(endPosition);

    // 断面の位置を計算
    const sections = [];
    let currentDistance = 0;
    let sectionIndex = 1;

    while (currentDistance <= pipeLength) {
      // 断面の位置（管路に沿った位置）
      const sectionPosition = startPosition.clone().add(
        pipeDirection.clone().multiplyScalar(currentDistance)
      );

      // 断面の法線ベクトル（管路の方向に垂直）
      const normal = pipeDirection.clone();

      sections.push({
        id: `断面_${String(sectionIndex).padStart(3, '0')}`,
        position: sectionPosition,
        normal: normal,
        pipeDirection: pipeDirection,
        angle: angle, // グリッド線の方向を変える角度（度）
        z: sectionPosition.z, // Z座標（断面平面の識別用）
        index: sectionIndex - 1
      });

      currentDistance += interval;
      sectionIndex++;
    }

    setGeneratedSections(sections);
    
    // Scene3Dに断面を描画するよう通知（後で実装）
    if (scene3DRef.current && scene3DRef.current.drawGeneratedSections) {
      scene3DRef.current.drawGeneratedSections(sections);
    }
  };

  return (
    <div className="cross-section-view">
      {/* 断面図生成用のUIパネル */}
      {showGuides && (
      <div className="cross-section-panel">
        <div className="panel-header">
          ◆断面<br />
          左クリック:中心軸に垂直な鉛直面による断面を表示します<br />
          左ドラッグ: 始点終点を含む鉛直面による断面を表示します<br />
          BSキー: 原面をクリア<br />
          ◆離隔計測<br />
          左Shift+左ドラッグ: 断面の間の最近接距離を計測します<br />
          ESCキー: 離隔をクリア<br />
          ◆表示切り替え<br />
          1: ガイド 2: 背景 5:離隔 6: 折れ線 7: 管路 8: 路面 9: 地表面<br />
          Space: 透視投影・正射投影 マウスホイール:拡大縮小 +左Ctrlキー:低達<br />
          ◆離隔計測結果
          {/* 距離計測結果を表示 */}
          {measurementResult && (
            <DistanceMeasurementDisplay measurementResult={measurementResult} />
          )}
          
          {/* 断面自動作成モードの設定テーブル */}
          {autoModeEnabled && (
            <div className="auto-mode-settings">
              <table className="auto-mode-table">
                <thead>
                  <tr>
                    <th>入力項目</th>
                    <th>入力欄</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>角度</td>
                    <td>
                      <input
                        type="number"
                        value={angle}
                        onChange={(e) => {
                          const nextAngle = parseFloat(e.target.value);
                          setAngle(Number.isNaN(nextAngle) ? 90 : nextAngle);
                        }}
                        step="0.1"
                        min="0"
                        max="180"
                        placeholder="90"
                      />
                      <span className="unit">[deg.]</span>
                    </td>
                  </tr>
                  <tr>
                    <td>間隔</td>
                    <td>
                      <input
                        type="number"
                        value={interval}
                        onChange={(e) => setInterval(parseFloat(e.target.value) || 10)}
                        step="0.1"
                        min="0.1"
                        placeholder="10"
                      />
                      <span className="unit">[m]</span>
                    </td>
                  </tr>
                  <tr>
                    <td>開始点</td>
                    <td>
                      <div className="radio-group">
                        <label className="radio-label">
                          <input
                            type="radio"
                            name="startPoint"
                            value="始点"
                            checked={startPoint === '始点'}
                            onChange={(e) => setStartPoint(e.target.value)}
                          />
                          <span>始点</span>
                        </label>
                        <label className="radio-label">
                          <input
                            type="radio"
                            name="startPoint"
                            value="終点"
                            checked={startPoint === '終点'}
                            onChange={(e) => setStartPoint(e.target.value)}
                          />
                          <span>終点</span>
                        </label>
                      </div>
                    </td>
                  </tr>
                </tbody>
              </table>
              
              {/* 実行ボタンと断面表示に遷移ボタン */}
              <div className="auto-mode-buttons">
                <button 
                  className="execute-button"
                  onClick={generateCrossSections}
                  disabled={!selectedObject}
                >
                  実行
                </button>
                <button 
                  className="transition-button"
                  onClick={() => {
                    if (generatedSections.length === 0) {
                      alert('先に断面を生成してください');
                      return;
                    }
                    setSectionViewMode(true);
                    setCurrentSectionIndex(0);
                  }}
                  disabled={generatedSections.length === 0}
                >
                  断面表示に遷移
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
      )}

      {/* 断面自動作成モードのトグルスイッチ（右上） */}
      <div className="auto-mode-toggle">
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={autoModeEnabled}
            onChange={(e) => setAutoModeEnabled(e.target.checked)}
          />
          <span className="toggle-label">断面自動作成モード</span>
        </label>
      </div>

      {/* 地形表示・opacity（右上：断面自動作成モードとは別div） */}
      {geoTiffUrl && (
        <div className="terrain-controls">
          <button
            type="button"
            className="terrain-toggle-button"
            onClick={() => setTerrainVisible((prev) => !prev)}
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

      {/* 3Dシーン（既存のScene3Dコンポーネントを使用） */}
      <Scene3D
        ref={scene3DRef}
        cityJsonData={cityJsonData}
        userPositions={userPositions}
        shapeTypes={shapeTypes}
        layerData={layerData}
        sourceTypes={sourceTypes}
        geoTiffUrl={geoTiffUrl}
        potreeMetadataUrl={potreeMetadataUrl}
        terrainVisible={terrainVisible}
        terrainOpacity={terrainOpacity}
        hideInfoPanel={true}
        hideBackground={true}
        enableCrossSectionMode={true}
        autoModeEnabled={autoModeEnabled}
        onMeasurementUpdate={handleMeasurementUpdate}
        onSelectedObjectChange={handleSelectedObjectChange}
        generatedSections={generatedSections}
        sectionViewMode={sectionViewMode}
        currentSectionIndex={currentSectionIndex}
        accessor={accessor}
      />

      {/* 画面下部に断面名のリストを表示 */}
      {/* {generatedSections.length > 0 && !sectionViewMode && (
        <div className="section-list">
          <div className="section-list-title">生成された断面:</div>
          <div className="section-list-items">
            {generatedSections.map((section, index) => (
              <div key={section.id} className="section-list-item">
                {section.id}
              </div>
            ))}
          </div>
        </div>
      )} */}

      {/* 画面下部に←断面_001→のナビゲーション */}
      {sectionViewMode && generatedSections.length > 0 && (
        <div className="section-navigation">
          <button
            className="nav-button prev-button"
            onClick={() => {
              const prevIndex = currentSectionIndex > 0 
                ? currentSectionIndex - 1 
                : generatedSections.length - 1;
              setCurrentSectionIndex(prevIndex);
            }}
          >
            ←
          </button>
          <div className="section-name">
            {generatedSections[currentSectionIndex]?.id || ''}
          </div>
          <button
            className="nav-button next-button"
            onClick={() => {
              const nextIndex = currentSectionIndex < generatedSections.length - 1
                ? currentSectionIndex + 1
                : 0;
              setCurrentSectionIndex(nextIndex);
            }}
          >
            →
          </button>
          <button
            className="nav-button close-button"
            onClick={() => {
              setSectionViewMode(false);
            }}
          >
            閉じる
          </button>
        </div>
      )}
    </div>
  );
}

export default CrossSectionView;

