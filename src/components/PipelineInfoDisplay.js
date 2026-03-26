import React, { useState, useEffect, useRef } from 'react';
import * as THREE from 'three';
import './PipelineInfoDisplay.css';
import PipelineActionButtons from './PipelineActionButtons';
 
const RADIUS_CONFIG = {
  threshold: 5,
  scale: 1000,
  min: 0.05,
  defaultValue: 0.3,
};

/**
 * 管路情報表示コンポーネント
 * クリックされた管路オブジェクトの情報をテーブル形式で表示
 */
function PipelineInfoDisplay({ 
  selectedObject, 
  selectedMesh,
  shapeTypes,
  onRegister,
  onDuplicate,
  onDelete,
  onAdd,
  onRestore,
  onRestoreAll,
  onInputEdited
}) {
  const [originalValues, setOriginalValues] = useState({}); // 元の値（設定済み）
  const [inputValues, setInputValues] = useState({}); // 入力欄の値
  const [hasChanges, setHasChanges] = useState(false); // 変更があるかどうか
 
  const [isComposing, setIsComposing] = React.useState(false);
  const isApplyingRef = useRef(false);
  
  // selectedObjectが変更された時にoriginalValuesとinputValuesを更新
  const updateSelectedObject = () => {
    if (selectedObject) {
      const { feature_id, attributes, geometry, shape_type } = selectedObject;
      const geom = geometry?.[0];

      // shape_typeからshape_type名を取得
      const getShapeTypeName = () => {
        if (!shapeTypes || !shape_type) return '';
        const shapeTypeData = shapeTypes.find(st => String(st.id) === String(shape_type));
        return shapeTypeData ? shapeTypeData.shape_type : '';
      };

      // 管路情報のデータを準備
      const getPipelineData = () => {
        const isExtrude = Array.isArray(geom?.extrudePath) && geom.extrudePath.length >= 2;
        const shapeTypeName = getShapeTypeName();
        const isPolyhedron = shapeTypeName === 'Polyhedron' || geom?.type === 'Polyhedron';
        const startPoint = isExtrude
          ? geom.extrudePath[0]
          : geom?.vertices?.[0];
        const endPoint = isExtrude
          ? geom.extrudePath[geom.extrudePath.length - 1]
          : geom?.vertices?.[geom.vertices.length - 1];
        let center = geom?.center;
        
        // Polyhedronは vertices[0]/last が「端点」になる保証がないため、
        // 選択中メッシュのワールドAABB(Box3)から中心/端点相当を算出する
        let polyInfo = null; // { centerWorld, startWorld, endWorld, length }
        if (isPolyhedron && selectedMesh) {
          try {
            selectedMesh.updateMatrixWorld?.(true);
            const bbox = new THREE.Box3().setFromObject(selectedMesh);
            if (Number.isFinite(bbox.min.x) && Number.isFinite(bbox.max.x)) {
              const size = new THREE.Vector3();
              bbox.getSize(size);
              const centerWorld = bbox.getCenter(new THREE.Vector3());

              // AABBの最長軸方向を「主軸」とみなし、端点相当(start/end)を決める
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

              let startWorld, endWorld;
              if (maxAxis === 'x') {
                startWorld = new THREE.Vector3(bbox.min.x, centerWorld.y, centerWorld.z);
                endWorld = new THREE.Vector3(bbox.max.x, centerWorld.y, centerWorld.z);
              } else if (maxAxis === 'y') {
                startWorld = new THREE.Vector3(centerWorld.x, bbox.min.y, centerWorld.z);
                endWorld = new THREE.Vector3(centerWorld.x, bbox.max.y, centerWorld.z);
              } else {
                startWorld = new THREE.Vector3(centerWorld.x, centerWorld.y, bbox.min.z);
                endWorld = new THREE.Vector3(centerWorld.x, centerWorld.y, bbox.max.z);
              }

              polyInfo = {
                centerWorld,
                startWorld,
                endWorld,
                length: startWorld.distanceTo(endWorld),
                size: size  // AABBのサイズを追加
              };
            }
          } catch (e) {
            // AABB取得失敗時は従来ロジックへフォールバック
            polyInfo = null;
          }
        }

        // centerが存在しない場合は始点と終点から中点を計算（PolyhedronはAABB優先）
        if (!center && startPoint && endPoint && !polyInfo) {
          center = [
            (startPoint[0] + endPoint[0]) / 2,
            (startPoint[1] + endPoint[1]) / 2,
            (startPoint[2] + endPoint[2]) / 2
          ];
        }

        // 半径を取得（メートル単位）
        const { threshold, scale, min } = RADIUS_CONFIG;
 
        const getRadiusInMeters = () => {
          if (attributes?.radius != null) {
            let radius = Number(attributes.radius);
            // radiusが大きい場合はmm単位と判断してm単位に変換
            if (radius > threshold) radius = radius / scale;
            if (Number.isFinite(radius) && radius > 0) {
              return radius;
            }
          } else if (attributes?.diameter != null) {
            let diameter = Number(attributes.diameter);
            // diameterが大きい場合はmm単位と判断してm単位に変換
            if (diameter > threshold) diameter = diameter / scale;
            const radius = diameter / 2;
            if (Number.isFinite(radius) && radius > 0) {
              return radius;
            }
          }
          return min;
        };

        const radiusInMeters = getRadiusInMeters();
        const isBox = shapeTypeName === 'Box';

        // 長さの計算
        let length = 0;
        if (polyInfo) {
          length = polyInfo.length;
        } else if (isExtrude) {
          for (let i = 1; i < geom.extrudePath.length; i++) {
            const a = geom.extrudePath[i - 1];
            const b = geom.extrudePath[i];
            length += Math.sqrt(
              Math.pow(b[0] - a[0], 2) +
              Math.pow(b[1] - a[1], 2) +
              Math.pow(b[2] - a[2], 2)
            );
          }
        } else if (startPoint && endPoint) {
          const dx = Number(endPoint[0]) - Number(startPoint[0]);
          const dy = Number(endPoint[1]) - Number(startPoint[1]);
          const dz = Number(endPoint[2]) - Number(startPoint[2]);
          const hasDepthAttrs =
            attributes?.start_point_depth != null &&
            attributes?.end_point_depth != null &&
            Number.isFinite(Number(attributes.start_point_depth)) &&
            Number.isFinite(Number(attributes.end_point_depth));

          // start/end depth属性があるデータは、頂点zがcmで格納されるケースがあるため
          // Unity表示に合わせて平面距離（XY）を長さとして扱う。
          length = hasDepthAttrs
            ? Math.hypot(dx, dy)
            : Math.hypot(dx, dy, dz);
        }

        const getCoverDepthFromDepthAxisMeters = (depthAxisMeters) => {
          if (depthAxisMeters == null) return '';
          // vertices[2]やcenter[2]は管頂の座標を表しているため、
          // そのまま土被り深さとして表示する（半径を加算する必要はない）
          // depthAxisMetersは負の値（地面から下方向）なので、符号を反転して正の値にする
          return (-Number(depthAxisMeters)).toFixed(3);
        };
        const toDepthAxisMeters = (depthValue) => {
          if (depthValue == null) return null;
          const n = Number(depthValue);
          if (!Number.isFinite(n)) return null;
          // ExtrusionのextrudePath/centerはm、その他のvertices系はcmで保持されるデータがある
          return isExtrude ? n : (n / 100);
        };

        // AABB(ワールド)を表示系（東西=X, 南北=-Z, 鉛直=Y）へ落とす
        const toDisplayXYZ = (worldVec3) => {
          if (!worldVec3) return null;
          return {
            x: worldVec3.x,
            y: -worldVec3.z, // 南北
            z: worldVec3.y   // 鉛直
          };
        };

        const polyCenterDisp = polyInfo ? toDisplayXYZ(polyInfo.centerWorld) : null;
        const polyStartDisp = polyInfo ? toDisplayXYZ(polyInfo.startWorld) : null;
        const polyEndDisp = polyInfo ? toDisplayXYZ(polyInfo.endWorld) : null;
 
        // Boxタイプの場合は幅と高さを表示、PolyhedronもAABBから幅と高さを表示、それ以外は直径を表示
        const sizeData = isBox ? {
          '幅[m]': attributes?.width ? Number(attributes.width).toFixed(3) : '',
          '高さ[m]': attributes?.height ? Number(attributes.height).toFixed(3) : '',
        } : isPolyhedron && polyInfo?.size ? {
          '幅[m]': polyInfo.size.x.toFixed(3),  // AABBのX方向（東西）を幅として表示
          '高さ[m]': polyInfo.size.y.toFixed(3),  // AABBのY方向（鉛直）を高さとして表示
        } : {
          '直径[mm]': attributes?.radius ? (attributes.radius * 2).toFixed(3) : (attributes?.diameter ? (attributes.diameter).toFixed(3) : ''),
          '': '',
        };

        // depth属性（start_point_depth / end_point_depth）があれば、位置設定と同様に
        // 「depth をソース」として土被り深さを算出する。
        // Cylinder/LineString/Extrusion が対象（Polyhedron 以外）。
        const hasDepthAttrsForDisplay =
          !isPolyhedron &&
          attributes?.start_point_depth != null &&
          attributes?.end_point_depth != null &&
          Number.isFinite(Number(attributes.start_point_depth)) &&
          Number.isFinite(Number(attributes.end_point_depth));

        let centerCoverDepthFromAttrs = '';
        let startCoverDepthFromAttrs = '';
        let endCoverDepthFromAttrs = '';

        if (hasDepthAttrsForDisplay) {
          const startDepthM = Number(attributes.start_point_depth) / 100; // cm → m
          const endDepthM = Number(attributes.end_point_depth) / 100;     // cm → m
          const centerDepthM = (startDepthM + endDepthM) / 2;

          startCoverDepthFromAttrs = startDepthM.toFixed(3);
          endCoverDepthFromAttrs = endDepthM.toFixed(3);
          centerCoverDepthFromAttrs = centerDepthM.toFixed(3);
        }

        const pipelineData = {
          形状: shapeTypeName,
          識別番号: feature_id || '',
          '東西[m]': polyCenterDisp
            ? polyCenterDisp.x.toFixed(3)
            : (center ? center[0].toFixed(3) : (startPoint ? startPoint[0].toFixed(3) : '')),
          '土被り深さ[m]': hasDepthAttrsForDisplay
            ? centerCoverDepthFromAttrs
            : (polyCenterDisp
                ? (isPolyhedron 
                    ? (-polyCenterDisp.z).toFixed(3)  // Polyhedron: 直接 -centerWorld.y を表示
                    : getCoverDepthFromDepthAxisMeters(polyCenterDisp.z))  // その他: 従来通り
                : (center
                    ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(center[2]))
                    : (startPoint
                        ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(startPoint[2]))
                        : ''))),
          '南北[m]': polyCenterDisp
            ? polyCenterDisp.y.toFixed(3)
            : (center ? center[1].toFixed(3) : (startPoint ? startPoint[1].toFixed(3) : '')),
          ...sizeData,
          '長さ[m]': length.toFixed(3),
          '端点1東西[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (polyStartDisp
                ? polyStartDisp.x.toFixed(3)
                : (startPoint ? startPoint[0].toFixed(3) : '')),
          '端点1土被り深さ[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (hasDepthAttrsForDisplay
                ? startCoverDepthFromAttrs
                : (polyStartDisp
                    ? getCoverDepthFromDepthAxisMeters(polyStartDisp.z)
                    : (startPoint
                        ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(startPoint[2]))
                        : ''))),
          '端点1南北[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (polyStartDisp
                ? polyStartDisp.y.toFixed(3)
                : (startPoint ? startPoint[1].toFixed(3) : '')),
          '端点2東西[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (polyEndDisp
                ? polyEndDisp.x.toFixed(3)
                : (endPoint ? endPoint[0].toFixed(3) : '')),
          '端点2土被り深さ[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (hasDepthAttrsForDisplay
                ? endCoverDepthFromAttrs
                : (polyEndDisp
                    ? getCoverDepthFromDepthAxisMeters(polyEndDisp.z)
                    : (endPoint
                        ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(endPoint[2]))
                        : ''))),
          '端点2南北[m]': isPolyhedron 
            ? ''  // Polyhedron: 端点情報は表示しない
            : (polyEndDisp
                ? polyEndDisp.y.toFixed(3)
                : (endPoint ? endPoint[1].toFixed(3) : '')),
          種別: attributes?.pipe_kind || '',
          材質: attributes?.material || ''
        };
        
        return pipelineData;
      };

      const pipelineData = getPipelineData();
      setOriginalValues(pipelineData); // 元の値を設定
      setInputValues({}); // 入力欄の値を完全にクリア
      setHasChanges(false); // 変更フラグをリセット
    }
  }
 
  // selectedObjectが変更された時にoriginalValuesとinputValuesを更新
  useEffect(() => {
    updateSelectedObject();
  }, [selectedObject, shapeTypes, selectedObject?.geometry]);

  if (!selectedObject) return null;

  // 入力値の変更ハンドラー
  const handleInputChange = (key, value) => {
    setInputValues(prev => ({
      ...prev,
      [key]: value
    }));
    setHasChanges(true); // 変更があったことを記録
  };
 
  // 入力値の変更ハンドラー
  const handleEdited = () => {
    if (isApplyingRef.current) return;
    isApplyingRef.current = true;
    if (onInputEdited) {
      onInputEdited(inputValues);
    }
    setHasChanges(false);
    setTimeout(() => {
      isApplyingRef.current = false;
    }, 0);
  };
 
  const handleBlur = (key, value) => {
    if (isApplyingRef.current) return;
    if (hasChanges) {
      handleEdited();
    }
  };

  // 入力欄のクリックイベントが3Dシーンに伝播しないようにする
  const handleInputClick = (event) => {
    event.stopPropagation();
  };

  // ボタンハンドラー
  const handleRegisterClick = () => {
    if (onRegister) {
      onRegister(selectedObject, inputValues);
      setInputValues({});
      setHasChanges(false);
      updateSelectedObject();
    }
  };

  const handleDuplicateClick = () => {
    if (onDuplicate) {
      onDuplicate(selectedObject);
    }
  };

  const handleDeleteClick = () => {
    if (onDelete) {
      onDelete(selectedObject);
    }
  };

  const handleAddClick = () => {
    if (onAdd) {
      onAdd();
    }
  };

  const handleRestoreClick = () => {
    if (onRestore) {
      onRestore(selectedObject);
      setInputValues({});
      setHasChanges(false);
    }
  };

  const handleRestoreAllClick = () => {
    if (onRestoreAll) {
      onRestoreAll();
      setInputValues({});
      setHasChanges(false);
    }
  };

  return (
    <div className="pipeline-info-display" onClick={handleInputClick}>
      <table className="pipeline-table">
        <thead>
          <tr>
            <th>[項目]</th>
            <th>[設定済み]</th>
            <th>[入力欄]</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(originalValues).map(([key, value]) => (
            <tr key={key}>
              <td className="item-label">{key}</td>
              <td className="set-value">{value || ''}</td>
              <td className="input-field">
                {(key === '') ? (
                <input 
                  type="text" 
                    value={inputValues[key] ?? value}
                  onChange={(e) => handleInputChange(key, e.target.value)}
                  className="pipeline-input"
                    placeholder={value || ''}
                  onClick={handleInputClick}
                />
                ) : (
                  <input
                    type="text"
                    value={inputValues[key] ?? value}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    className="pipeline-input"
                    placeholder={value || '入力'}
                    onClick={handleInputClick}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={(e) => {
                      setIsComposing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isComposing) {
                        e.preventDefault();
                        handleEdited();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={(e) => handleBlur(key, e.target.value)}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PipelineActionButtons
        onRegister={handleRegisterClick}
        onDuplicate={handleDuplicateClick}
        onDelete={handleDeleteClick}
        onAdd={handleAddClick}
        onRestore={handleRestoreClick}
        onRestoreAll={handleRestoreAllClick}
        hasChanges={hasChanges}
      />
    </div>
  );
}

export default PipelineInfoDisplay;