import * as THREE from 'three';

/** OrthographicCamera.near の下限 */
export const DEPTH_NEAR_MARGIN = 0.1;
/** near と far の最小差（m） */
export const DEPTH_MIN_SPAN = 1;
/** スライダー操作レンジの最大幅（m） */
export const SLIDER_MAX_SPAN = 2500;
/** far の上限（カメラ距離倍率・絶対上限） */
export const FAR_CAP_DISTANCE_MUL = 40;
export const ABSOLUTE_FAR_CAP = 8000;
/** 深度範囲の再計算間隔（ms） */
export const DEPTH_RECOMPUTE_MS = 250;

const _depthScratch = new THREE.Vector3();
const _meshBoxScratch = new THREE.Box3();
const _cornerScratch = new THREE.Vector3();

const isPipelineMesh = (obj) =>
  obj.visible && obj.isMesh && obj.geometry && obj.userData?.objectData;

const expandBoxCornersDepth = (boxMin, boxMax, cameraPosition, viewDir, acc) => {
  const corners = [
    [boxMin.x, boxMin.y, boxMin.z],
    [boxMin.x, boxMin.y, boxMax.z],
    [boxMin.x, boxMax.y, boxMin.z],
    [boxMin.x, boxMax.y, boxMax.z],
    [boxMax.x, boxMin.y, boxMin.z],
    [boxMax.x, boxMin.y, boxMax.z],
    [boxMax.x, boxMax.y, boxMin.z],
    [boxMax.x, boxMax.y, boxMax.z]
  ];
  corners.forEach(([x, y, z]) => {
    const d = depthAlongView(_cornerScratch.set(x, y, z), cameraPosition, viewDir);
    acc.min = Math.min(acc.min, d);
    acc.max = Math.max(acc.max, d);
  });
};

const finalizeDepthRange = (acc, fallbackMax = 2000) => {
  if (!Number.isFinite(acc.min) || !Number.isFinite(acc.max)) {
    return { min: DEPTH_NEAR_MARGIN, max: fallbackMax };
  }
  return {
    min: Math.max(DEPTH_NEAR_MARGIN, acc.min),
    max: Math.max(acc.min + DEPTH_MIN_SPAN, acc.max)
  };
};

/**
 * 視線方向への深度（m）。小さいほど手前。
 */
export function depthAlongView(point, cameraPosition, viewDir) {
  return _depthScratch.copy(point).sub(cameraPosition).dot(viewDir);
}

/**
 * 単一メッシュの bbox 8頂点から視線方向の深度範囲を求める。
 * 視野 ON 時の near 用（最手前深度 = min）。
 */
export function computeMeshDepthRangeAlongView(mesh, cameraPosition, viewDir) {
  if (!mesh) {
    return { min: DEPTH_NEAR_MARGIN, max: DEPTH_NEAR_MARGIN + DEPTH_MIN_SPAN };
  }
  mesh.updateWorldMatrix(true, false);
  _meshBoxScratch.setFromObject(mesh);
  if (_meshBoxScratch.isEmpty()) {
    return { min: DEPTH_NEAR_MARGIN, max: DEPTH_NEAR_MARGIN + DEPTH_MIN_SPAN };
  }
  const acc = { min: Infinity, max: -Infinity };
  expandBoxCornersDepth(
    _meshBoxScratch.min,
    _meshBoxScratch.max,
    cameraPosition,
    viewDir,
    acc
  );
  return finalizeDepthRange(acc);
}

/**
 * シーン traverse 1 回で全体・管路の深度範囲をまとめて求める。
 */
export function computeDepthRangesFromScene(scene, cameraPosition, viewDir) {
  const sceneAcc = { min: Infinity, max: -Infinity };
  const pipeAcc = { min: Infinity, max: -Infinity };
  let pipeFound = false;

  scene.traverse((obj) => {
    if (!obj.visible || !obj.isMesh || !obj.geometry) return;
    obj.updateWorldMatrix(true, false);
    _meshBoxScratch.setFromObject(obj);
    if (_meshBoxScratch.isEmpty()) return;

    expandBoxCornersDepth(
      _meshBoxScratch.min,
      _meshBoxScratch.max,
      cameraPosition,
      viewDir,
      sceneAcc
    );

    if (isPipelineMesh(obj)) {
      pipeFound = true;
      expandBoxCornersDepth(
        _meshBoxScratch.min,
        _meshBoxScratch.max,
        cameraPosition,
        viewDir,
        pipeAcc
      );
    }
  });

  const sceneLimits = finalizeDepthRange(sceneAcc);
  const pipeLimits = pipeFound
    ? finalizeDepthRange(pipeAcc)
    : sceneLimits;

  return { sceneLimits, pipeLimits };
}

/** 表示・far 用に深度上限をキャップ */
export function capDepthMax(rawMax, distance) {
  const cap = Math.min(
    ABSOLUTE_FAR_CAP,
    Math.max(DEPTH_NEAR_MARGIN + DEPTH_MIN_SPAN, (distance || 60) * FAR_CAP_DISTANCE_MUL)
  );
  return Math.min(rawMax, cap);
}

/**
 * 全管路ベースの表示・スライダー共通レンジ（min/max 固定用）。
 */
export function buildPipeDepthLimits(pipeLimits, sceneLimits, distance) {
  let min = Math.max(DEPTH_NEAR_MARGIN, pipeLimits.min);
  let max = Math.max(min + DEPTH_MIN_SPAN, capDepthMax(sceneLimits.max, distance));

  if (max - min > SLIDER_MAX_SPAN) {
    const center = (min + max) * 0.5;
    const half = SLIDER_MAX_SPAN * 0.5;
    min = Math.max(min, center - half);
    max = Math.min(max, center + half);
  }

  min = Math.max(DEPTH_NEAR_MARGIN, min);
  max = Math.max(min + DEPTH_MIN_SPAN, max);
  return { min, max };
}

/** スライダー幅に応じた step（m） */
export function getDepthSliderStep(min, max) {
  const span = Math.max(DEPTH_MIN_SPAN, max - min);
  return Math.max(0.5, Math.min(10, span / 80));
}

/**
 * キャッシュ無効化用の署名（カメラ・向き。管路選択は含めない）。
 */
export function makeDepthCacheSignature({
  center,
  distance,
  directionMode,
  cameraPosition,
  viewDir
}) {
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n');
  const fmt3 = (v) => `${fmt(v.x)},${fmt(v.y)},${fmt(v.z)}`;
  return [
    fmt3(center),
    fmt(distance),
    directionMode,
    fmt3(cameraPosition),
    `${fmt(viewDir.x)},${fmt(viewDir.y)},${fmt(viewDir.z)}`
  ].join('|');
}

/**
 * 1 面分の全管路深度レンジ（初回固定スナップショット用）。
 */
export function buildViewDepthData({
  scene,
  cameraPosition,
  viewDir,
  distance
}) {
  const { sceneLimits, pipeLimits } = computeDepthRangesFromScene(
    scene,
    cameraPosition,
    viewDir
  );
  const depthLimits = buildPipeDepthLimits(pipeLimits, sceneLimits, distance);

  return {
    sceneLimits,
    pipeLimits,
    depthLimits
  };
}

/**
 * サブビュー正射カメラの near / far。
 */
export function resolveNearFar({
  depthLimits,
  rangeEnabled,
  rangeValues,
  depthFocusEnabled,
  focusDepth,
  fallbackDistance
}) {
  const sceneMin = depthLimits.min;
  const sceneMax = Math.max(depthLimits.max, sceneMin + DEPTH_MIN_SPAN);
  const fallbackFar = Math.max(2000, (fallbackDistance || 60) * 40);

  if (rangeEnabled && rangeValues) {
    const lo = sceneMin;
    const hi = sceneMax;
    const minVal = THREE.MathUtils.clamp(rangeValues.min, lo, hi - DEPTH_MIN_SPAN);
    const maxVal = THREE.MathUtils.clamp(rangeValues.max, minVal + DEPTH_MIN_SPAN, hi);
    const near = Math.max(DEPTH_NEAR_MARGIN, minVal);
    const far = Math.max(near + DEPTH_MIN_SPAN, maxVal);
    return { near, far };
  }

  if (depthFocusEnabled && Number.isFinite(focusDepth)) {
    const near = THREE.MathUtils.clamp(
      focusDepth,
      sceneMin,
      sceneMax - DEPTH_MIN_SPAN
    );
    return {
      near: Math.max(DEPTH_NEAR_MARGIN, near),
      far: Math.max(near + DEPTH_MIN_SPAN, sceneMax)
    };
  }

  return {
    near: Math.max(DEPTH_NEAR_MARGIN, sceneMin),
    far: Math.max(sceneMax, fallbackFar)
  };
}
