import * as THREE from 'three';

export const RADIUS_CONFIG = Object.freeze({
  threshold: 5,
  scale: 1000,
  min: 0.05,
  defaultValue: 0.3,
});

function getShapeTypeName(shapeTypes, shapeType) {
  if (!shapeTypes || shapeType == null) return '';
  const shapeTypeData = shapeTypes.find((st) => String(st.id) === String(shapeType));
  return shapeTypeData ? shapeTypeData.shape_type : '';
}

function getSourceTypeName(sourceTypes, sourceTypeId) {
  if (!sourceTypes || sourceTypeId == null) return '';
  const sourceTypeData = sourceTypes.find((st) => String(st.id) === String(sourceTypeId));
  return sourceTypeData ? sourceTypeData.source_type : '';
}

/**
 * 管路オブジェクトから左パネル表示用データを構築する（情報源は含めない）
 */
export function buildPipelineData(objectData, { selectedMesh = null, shapeTypes = null, sourceTypes = null } = {}) {
  if (!objectData) return null;

  const { feature_id, attributes, geometry, shape_type } = objectData;
  const geom = geometry?.[0];
  const isExtrude = Array.isArray(geom?.extrudePath) && geom.extrudePath.length >= 2;
  const shapeTypeName = getShapeTypeName(shapeTypes, shape_type);
  const isPolyhedron = shapeTypeName === 'Polyhedron' || geom?.type === 'Polyhedron';
  const startPoint = isExtrude ? geom.extrudePath[0] : geom?.vertices?.[0];
  const endPoint = isExtrude
    ? geom.extrudePath[geom.extrudePath.length - 1]
    : geom?.vertices?.[geom.vertices.length - 1];
  let center = geom?.center;

  let polyInfo = null;
  if (isPolyhedron && selectedMesh) {
    try {
      selectedMesh.updateMatrixWorld?.(true);
      const bbox = new THREE.Box3().setFromObject(selectedMesh);
      if (Number.isFinite(bbox.min.x) && Number.isFinite(bbox.max.x)) {
        const size = new THREE.Vector3();
        bbox.getSize(size);
        const centerWorld = bbox.getCenter(new THREE.Vector3());

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

        let startWorld;
        let endWorld;
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
          size,
        };
      }
    } catch (e) {
      polyInfo = null;
    }
  }

  if (!center && startPoint && endPoint && !polyInfo) {
    center = [
      (startPoint[0] + endPoint[0]) / 2,
      (startPoint[1] + endPoint[1]) / 2,
      (startPoint[2] + endPoint[2]) / 2,
    ];
  }

  const isBox = shapeTypeName === 'Box';

  let length = 0;
  if (polyInfo) {
    length = polyInfo.length;
  } else if (isExtrude) {
    for (let i = 1; i < geom.extrudePath.length; i++) {
      const a = geom.extrudePath[i - 1];
      const b = geom.extrudePath[i];
      length += Math.sqrt(
        (b[0] - a[0]) ** 2 +
        (b[1] - a[1]) ** 2 +
        (b[2] - a[2]) ** 2
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

    length = hasDepthAttrs ? Math.hypot(dx, dy) : Math.hypot(dx, dy, dz);
  }

  const getCoverDepthFromDepthAxisMeters = (depthAxisMeters) => {
    if (depthAxisMeters == null) return '';
    return (-Number(depthAxisMeters)).toFixed(3);
  };
  const toDepthAxisMeters = (depthValue) => {
    if (depthValue == null) return null;
    const n = Number(depthValue);
    if (!Number.isFinite(n)) return null;
    return n;
  };

  const toDisplayXYZ = (worldVec3) => {
    if (!worldVec3) return null;
    return {
      x: worldVec3.x,
      y: -worldVec3.z,
      z: worldVec3.y,
    };
  };

  const polyCenterDisp = polyInfo ? toDisplayXYZ(polyInfo.centerWorld) : null;
  const polyStartDisp = polyInfo ? toDisplayXYZ(polyInfo.startWorld) : null;
  const polyEndDisp = polyInfo ? toDisplayXYZ(polyInfo.endWorld) : null;

  const sizeData = isBox
    ? {
        '幅[m]': attributes?.width ? Number(attributes.width).toFixed(3) : '',
        '高さ[m]': attributes?.height ? Number(attributes.height).toFixed(3) : '',
      }
    : isPolyhedron && polyInfo?.size
      ? {
          '幅[m]': polyInfo.size.x.toFixed(3),
          '高さ[m]': polyInfo.size.y.toFixed(3),
        }
      : {
          '直径[mm]': attributes?.radius
            ? (attributes.radius * 2).toFixed(3)
            : attributes?.diameter
              ? Number(attributes.diameter).toFixed(3)
              : '',
          '': '',
        };

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
    const startDepthM = Number(attributes.start_point_depth);
    const endDepthM = Number(attributes.end_point_depth);
    const centerDepthM = (startDepthM + endDepthM) / 2;

    startCoverDepthFromAttrs = startDepthM.toFixed(3);
    endCoverDepthFromAttrs = endDepthM.toFixed(3);
    centerCoverDepthFromAttrs = centerDepthM.toFixed(3);
  }

  return {
    形状: shapeTypeName,
    識別番号: feature_id || '',
    '東西[m]': polyCenterDisp
      ? polyCenterDisp.x.toFixed(3)
      : center
        ? center[0].toFixed(3)
        : startPoint
          ? startPoint[0].toFixed(3)
          : '',
    '土被り深さ[m]': hasDepthAttrsForDisplay
      ? centerCoverDepthFromAttrs
      : polyCenterDisp
        ? isPolyhedron
          ? (-polyCenterDisp.z).toFixed(3)
          : getCoverDepthFromDepthAxisMeters(polyCenterDisp.z)
        : center
          ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(center[2]))
          : startPoint
            ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(startPoint[2]))
            : '',
    '南北[m]': polyCenterDisp
      ? polyCenterDisp.y.toFixed(3)
      : center
        ? center[1].toFixed(3)
        : startPoint
          ? startPoint[1].toFixed(3)
          : '',
    ...sizeData,
    '長さ[m]': length.toFixed(3),
    '端点1東西[m]': isPolyhedron
      ? ''
      : polyStartDisp
        ? polyStartDisp.x.toFixed(3)
        : startPoint
          ? startPoint[0].toFixed(3)
          : '',
    '端点1土被り深さ[m]': isPolyhedron
      ? ''
      : hasDepthAttrsForDisplay
        ? startCoverDepthFromAttrs
        : polyStartDisp
          ? getCoverDepthFromDepthAxisMeters(polyStartDisp.z)
          : startPoint
            ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(startPoint[2]))
            : '',
    '端点1南北[m]': isPolyhedron
      ? ''
      : polyStartDisp
        ? polyStartDisp.y.toFixed(3)
        : startPoint
          ? startPoint[1].toFixed(3)
          : '',
    '端点2東西[m]': isPolyhedron
      ? ''
      : polyEndDisp
        ? polyEndDisp.x.toFixed(3)
        : endPoint
          ? endPoint[0].toFixed(3)
          : '',
    '端点2土被り深さ[m]': isPolyhedron
      ? ''
      : hasDepthAttrsForDisplay
        ? endCoverDepthFromAttrs
        : polyEndDisp
          ? getCoverDepthFromDepthAxisMeters(polyEndDisp.z)
          : endPoint
            ? getCoverDepthFromDepthAxisMeters(toDepthAxisMeters(endPoint[2]))
            : '',
    '端点2南北[m]': isPolyhedron
      ? ''
      : polyEndDisp
        ? polyEndDisp.y.toFixed(3)
        : endPoint
          ? endPoint[1].toFixed(3)
          : '',
    種別: attributes?.pipe_kind || '',
    材質: attributes?.material || '',
  };
}

/** ホバーツールチップ用の要約（読み取り専用。情報源はホバーのみ表示） */
export function buildPipelineHoverSummary(objectData, options = {}) {
  const data = buildPipelineData(objectData, options);
  if (!data) return null;
  const { sourceTypes } = options;

  return {
    識別番号: data.識別番号,
    情報源: getSourceTypeName(sourceTypes, objectData?.source_type_id),
    '東西[m]': data['東西[m]'],
    '土被り深さ[m]': data['土被り深さ[m]'],
    '南北[m]': data['南北[m]'],
    '直径[mm]': data['直径[mm]'] ?? '',
    種別: data.種別,
    材質: data.材質,
  };
}
