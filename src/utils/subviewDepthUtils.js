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

/** スライダー操作レンジ（管路深度＋注視点付近） */
export function buildSliderDepthLimits(pipeRange, focusDepth, distance) {
  const farCap = capDepthMax(pipeRange.max, distance);
  let sliderMin = Math.max(DEPTH_NEAR_MARGIN, pipeRange.min);
  let sliderMax = Math.max(sliderMin + DEPTH_MIN_SPAN, Math.min(farCap, pipeRange.max));

  if (Number.isFinite(focusDepth)) {
    const nearPad = Math.max(40, distance * 0.35);
    const farPad = Math.max(120, distance * 2);
    sliderMin = Math.max(sliderMin, focusDepth - nearPad);
    sliderMax = Math.min(sliderMax, focusDepth + farPad);
  }

  if (sliderMax - sliderMin > SLIDER_MAX_SPAN) {
    const center = Number.isFinite(focusDepth)
      ? focusDepth
      : (sliderMin + sliderMax) * 0.5;
    const half = SLIDER_MAX_SPAN * 0.5;
    sliderMin = Math.max(sliderMin, center - half);
    sliderMax = Math.min(sliderMax, center + half);
  }

  sliderMin = Math.max(DEPTH_NEAR_MARGIN, sliderMin);
  sliderMax = Math.max(sliderMin + DEPTH_MIN_SPAN, sliderMax);
  return { min: sliderMin, max: sliderMax };
}

/** スライダー幅に応じた step（m） */
export function getDepthSliderStep(min, max) {
  const span = Math.max(DEPTH_MIN_SPAN, max - min);
  return Math.max(0.5, Math.min(10, span / 80));
}

/**
 * キャッシュ無効化用の署名（カメラ・注視点・向き・選択管路）。
 */
export function makeDepthCacheSignature({
  center,
  distance,
  directionMode,
  cameraPosition,
  viewDir,
  selectedFeatureId
}) {
  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : 'n');
  const fmt3 = (v) => `${fmt(v.x)},${fmt(v.y)},${fmt(v.z)}`;
  return [
    fmt3(center),
    fmt(distance),
    directionMode,
    fmt3(cameraPosition),
    `${fmt(viewDir.x)},${fmt(viewDir.y)},${fmt(viewDir.z)}`,
    selectedFeatureId ?? ''
  ].join('|');
}

/**
 * 1 面分の深度データ（traverse は呼び出し側で間引き）。
 */
export function buildViewDepthData({
  scene,
  cameraPosition,
  viewDir,
  distance,
  focusPoint
}) {
  const { sceneLimits, pipeLimits } = computeDepthRangesFromScene(
    scene,
    cameraPosition,
    viewDir
  );
  const focusDepth = focusPoint
    ? depthAlongView(focusPoint, cameraPosition, viewDir)
    : null;
  const displayLimits = {
    min: pipeLimits.min,
    max: capDepthMax(sceneLimits.max, distance)
  };
  const sliderLimits = buildSliderDepthLimits(pipeLimits, focusDepth, distance);

  return {
    sceneLimits,
    pipeLimits,
    displayLimits,
    sliderLimits,
    focusDepth
  };
}

/**
 * 「視野範囲」OFF 時 UI 用の最小〜最大（m）。
 * - 視野 OFF … frozenLimits をそのまま表示（固定）
 * - 視野 ON … 最小 = 選択管路重心深度、最大 = 管路奥側（キャップ済み）
 */
export function buildDepthLimitsForDisplay(
  depthFocusEnabled,
  displayLimits,
  focusDepth,
  frozenLimits
) {
  if (!depthFocusEnabled && frozenLimits) {
    return { min: frozenLimits.min, max: frozenLimits.max };
  }
  if (depthFocusEnabled && Number.isFinite(focusDepth)) {
    return {
      min: focusDepth,
      max: displayLimits.max
    };
  }
  return { min: displayLimits.min, max: displayLimits.max };
}

/**
 * サブビュー正射カメラの near / far。
 */
export function resolveNearFar({
  sceneLimits,
  sliderLimits,
  rangeEnabled,
  rangeValues,
  depthFocusEnabled,
  focusDepth,
  fallbackDistance
}) {
  const sceneMin = sceneLimits.min;
  const sceneMax = Math.max(sceneLimits.max, sceneMin + DEPTH_MIN_SPAN);
  const fallbackFar = Math.max(2000, (fallbackDistance || 60) * 40);

  if (rangeEnabled && rangeValues) {
    const lo = sliderLimits?.min ?? sceneMin;
    const hi = sliderLimits?.max ?? sceneMax;
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
