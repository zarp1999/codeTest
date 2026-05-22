/**
 * SubViewPanel — 下部3面サブビュー
 *
 * 奥行き視野（near / far）の2段階制御:
 * - Scene3D トップ「視野」… 選択管路重心より手前をまとめてクリップ
 * - 各面下部「視野範囲」… far をスライダーで指定（near はトップ「視野」ON 時は重心深度）
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import DepthRangeSlider from './DepthRangeSlider';
import './SubViewPanel.css';

// --- 奥行き視野（near / far）制御 ---
/** 下部「視野範囲」UIの帯の高さ（px）。この範囲ではパン・ズームを無効化 */
const DEPTH_CONTROLS_BAND = 56;
/** OrthographicCamera.near の下限（0 付近は描画が不安定になりやすい） */
const DEPTH_NEAR_MARGIN = 0.1;
/** near と far の最小差（m）。同一値だとクリップ面が潰れる */
const DEPTH_MIN_SPAN = 1;

/**
 * サブビュー領域の高さ（キャンバス全体に対する比率）。
 * 例: 0.35 => 下部35%をサブビュー描画領域として使用。
 */
const SUB_VIEW_HEIGHT_RATIO = 0.35;

/**
 * 各サブビューの定義。
 * - direction: 注視点(center)から見た視線方向
 * - up: 画面上方向（回転基準）
 */
const VIEW_DEFS = [
  {
    key: 'front',
    titleNormal: '正面（北向き）',
    titleReverse: '正面（南向き）',
    direction: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0)
  },
  {
    key: 'side',
    titleNormal: '側面（西向き）',
    titleReverse: '側面（東向き）',
    direction: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 1, 0)
  },
  {
    key: 'top',
    titleNormal: '平面（下向き）',
    titleReverse: '平面（上向き）',
    direction: new THREE.Vector3(0, -1, 0),
    // 北方向(-Z)が画面上になるように上方向を固定
    up: new THREE.Vector3(0, 0, -1)
  }
];

const MIN_HALF_SIZE = 2;
const MAX_HALF_SIZE = 200000;
const DIRECTION_MODE = {
  NORMAL: 'normal',
  REVERSE: 'reverse'
};

/**
 * メインカメラの見え方に合わせて、サブビュー正射カメラの半サイズを決める。
 * @param {THREE.Camera | null | undefined} mainCamera 現在のメインカメラ
 * @param {number} distance サブビューカメラと注視点の距離
 * @returns {number} 正射カメラの縦方向半サイズ
 */
const getHalfViewSize = (mainCamera, distance) => {
  if (!mainCamera) return 20;
  if (mainCamera.isPerspectiveCamera) {
    const fovRad = THREE.MathUtils.degToRad(mainCamera.fov || 50);
    return Math.max(8, distance * Math.tan(fovRad * 0.5));
  }
  if (mainCamera.isOrthographicCamera) {
    const halfVertical = Math.abs((mainCamera.top - mainCamera.bottom) * 0.5);
    const halfHorizontal = Math.abs((mainCamera.right - mainCamera.left) * 0.5);
    return Math.max(8, halfVertical, halfHorizontal);
  }
  return 20;
};

const createDefaultViewState = () => ({
  center: new THREE.Vector3(0, 0, 0),
  distance: 60,
  halfSize: 24
});

// 毎フレームの深度計算で使う作業用ベクトル（GC 抑制）
const _viewDirScratch = new THREE.Vector3();
const _depthScratch = new THREE.Vector3();
const _sceneBoxScratch = new THREE.Box3();
const _cornerScratch = new THREE.Vector3();

/**
 * ワールド座標の点を、カメラから見た「奥行き」（視線方向の距離）に変換する。
 *
 * イメージ: カメラ位置を原点にし、注視点方向（viewDir）への射影長。
 * 値が小さいほどカメラに近く（手前）、大きいほど奥。
 *
 * @param {THREE.Vector3} point 対象点
 * @param {THREE.Vector3} cameraPosition サブビューカメラ位置
 * @param {THREE.Vector3} viewDir 単位ベクトル（カメラ → 注視点）
 * @returns {number} 深度（m）
 */
const depthAlongView = (point, cameraPosition, viewDir) =>
  _depthScratch.copy(point).sub(cameraPosition).dot(viewDir);

/**
 * シーン全体が、このサブビューの視線方向に占める深度の min / max を求める。
 *
 * 全メッシュの AABB 8 頂点を depthAlongView で投影し、
 * スライダーの可動範囲や「全範囲表示」の基準に使う。
 */
const computeSceneDepthRange = (scene, cameraPosition, viewDir) => {
  _sceneBoxScratch.makeEmpty();
  scene.traverse((obj) => {
    if (!obj.visible || !obj.isMesh || !obj.geometry) return;
    obj.updateWorldMatrix(true, false);
    _sceneBoxScratch.expandByObject(obj);
  });

  if (_sceneBoxScratch.isEmpty()) {
    return { min: DEPTH_NEAR_MARGIN, max: 2000 };
  }

  const { min: boxMin, max: boxMax } = _sceneBoxScratch;
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

  let min = Infinity;
  let max = -Infinity;
  corners.forEach(([x, y, z]) => {
    const d = depthAlongView(_cornerScratch.set(x, y, z), cameraPosition, viewDir);
    min = Math.min(min, d);
    max = Math.max(max, d);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { min: DEPTH_NEAR_MARGIN, max: 2000 };
  }

  return {
    min: Math.max(DEPTH_NEAR_MARGIN, min),
    max: Math.max(min + DEPTH_MIN_SPAN, max)
  };
};

/**
 * サブビュー正射カメラの near / far を決める。
 *
 * 優先順位:
 * - 下部「視野範囲」ON … far = スライダー右。near はトップ「視野」ON なら重心深度、でなければスライダー左
 * - 両方 OFF … シーン全体の深度範囲
 * - トップ「視野」のみ ON … near = 重心深度、far = シーン最大
 *
 * Three.js では near より手前（深度が小さい）の物体が描画されなくなる。
 * 「視野」ON 時は選択管路より手前の管路を隠して、奥の管路を見やすくする。
 */
const resolveNearFar = ({
  sceneLimits,
  rangeEnabled,
  rangeValues,
  depthFocusEnabled,
  focusDepth,
  fallbackDistance
}) => {
  const sceneMin = sceneLimits.min;
  const sceneMax = Math.max(sceneLimits.max, sceneMin + DEPTH_MIN_SPAN);
  const fallbackFar = Math.max(2000, (fallbackDistance || 60) * 40);

  // 下部「視野範囲」ON: far はスライダー右。near はトップ「視野」+ 選択管路があれば重心深度
  if (rangeEnabled && rangeValues) {
    let near;
    if (depthFocusEnabled && Number.isFinite(focusDepth)) {
      near = THREE.MathUtils.clamp(focusDepth, sceneMin, sceneMax - DEPTH_MIN_SPAN);
      near = Math.max(DEPTH_NEAR_MARGIN, near);
    } else {
      near = Math.max(DEPTH_NEAR_MARGIN, Math.min(rangeValues.min, rangeValues.max - DEPTH_MIN_SPAN));
    }
    const far = Math.max(near + DEPTH_MIN_SPAN, rangeValues.max);
    return { near, far };
  }

  // トップ「視野」のみ（選択管路の重心深度を near に）
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

  // 優先度 3: 全範囲（従来の自動 near/far に近い挙動）
  return {
    near: Math.max(DEPTH_NEAR_MARGIN, sceneMin),
    far: Math.max(sceneMax, fallbackFar)
  };
};

const getMeshWorldCenter = (mesh, fallback) => {
  if (!mesh || !mesh.isObject3D) return fallback.clone();
  mesh.updateWorldMatrix(true, true);

  if (mesh.geometry) {
    if (!mesh.geometry.boundingBox) {
      mesh.geometry.computeBoundingBox();
    }
    if (mesh.geometry.boundingBox) {
      const center = new THREE.Vector3();
      mesh.geometry.boundingBox.getCenter(center);
      return center.applyMatrix4(mesh.matrixWorld);
    }
  }

  const worldPos = new THREE.Vector3();
  mesh.getWorldPosition(worldPos);
  return worldPos;
};

/**
 * メイン3Dキャンバスの下部に3面サブビューを重ねるオーバーレイ。
 *
 * 機能:
 * - JSX側: タイトルや枠線などのUIのみを表示
 * - imperative API: 同一renderer / 同一sceneに対し、viewportを切って3カメラ描画
 *
 * @param {{ visible: boolean, depthFocusEnabled?: boolean }} props
 *   depthFocusEnabled … Scene3D トップの「視野」チェック（選択管路手前をクリップ）
 * @param {React.Ref<{
 *   renderSubViews: (args: {
 *     renderer: THREE.WebGLRenderer,
 *     scene: THREE.Scene,
 *     mainCamera: THREE.Camera,
 *     canvasWidth: number,
 *     canvasHeight: number
 *   }) => void
 * }>} ref
 */
/** 各面スライダーの初期値（ON 時に直近の sceneLimits で上書き） */
const createDefaultDepthRangeValues = () => ({
  front: { min: 0, max: 1000 },
  side: { min: 0, max: 1000 },
  top: { min: 0, max: 1000 }
});

const SubViewPanel = forwardRef(function SubViewPanel({ visible, depthFocusEnabled = false }, ref) {
  const [directionModeMap, setDirectionModeMap] = useState({
    front: DIRECTION_MODE.NORMAL,
    side: DIRECTION_MODE.NORMAL,
    top: DIRECTION_MODE.NORMAL
  });
  // 面ごと下部「視野範囲」チェック（ON でスライダー表示・near/far を手動指定）
  const [depthRangeEnabled, setDepthRangeEnabled] = useState({
    front: false,
    side: false,
    top: false
  });
  // スライダー左端=min(near)、右端=max(far) の値（m）
  const [depthRangeValues, setDepthRangeValues] = useState(createDefaultDepthRangeValues);
  // renderSubViews 毎フレーム更新: シーンが視線上に占める深度範囲（スライダー上限下限の目安）
  const depthLimitsRef = useRef(createDefaultDepthRangeValues());
  // 「視野範囲」OFF 時に表示する最小〜最大（ref を React 表示へ同期）
  const [depthLimitsDisplay, setDepthLimitsDisplay] = useState(createDefaultDepthRangeValues);
  const depthLimitsSyncSnapshotRef = useRef('');
  const depthLimitsSyncTimeRef = useRef(0);
  // renderSubViews で更新: トップ「視野」+ 下部「視野範囲」時の near 表示用
  const focusDepthByViewRef = useRef({ front: null, side: null, top: null });
  // animate ループから読むため React state を ref に同期
  const depthFocusEnabledRef = useRef(depthFocusEnabled);
  const depthRangeEnabledRef = useRef(depthRangeEnabled);
  const depthRangeValuesRef = useRef(depthRangeValues);

  useEffect(() => {
    depthFocusEnabledRef.current = depthFocusEnabled;
  }, [depthFocusEnabled]);

  useEffect(() => {
    depthRangeEnabledRef.current = depthRangeEnabled;
  }, [depthRangeEnabled]);

  useEffect(() => {
    depthRangeValuesRef.current = depthRangeValues;
  }, [depthRangeValues]);
  // 3面それぞれのサブビュー専用カメラ（毎フレーム使い回す）
  const subCamerasRef = useRef({
    front: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000),
    side: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000),
    top: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000)
  });
  const viewStatesRef = useRef({
    front: createDefaultViewState(),
    side: createDefaultViewState(),
    top: createDefaultViewState()
  });
  const lastFrameRef = useRef({
    canvasWidth: 0,
    canvasHeight: 0,
    subHeight: 0,
    panelWidth: 0,
    subTop: 0
  });
  const dragStateRef = useRef({
    active: false,
    viewKey: null,
    startX: 0,
    startY: 0,
    startCenter: new THREE.Vector3()
  });
  const subViewOverlaySceneRef = useRef(null);
  const subViewAxesRef = useRef(null);

  if (!subViewOverlaySceneRef.current) {
    const overlayScene = new THREE.Scene();
    const axes = new THREE.AxesHelper(1);
    if (axes.material) {
      axes.material.depthTest = false;
      axes.material.depthWrite = false;
      axes.material.transparent = true;
      axes.material.opacity = 0.95;
    }
    overlayScene.add(axes);
    subViewOverlaySceneRef.current = overlayScene;
    subViewAxesRef.current = axes;
  }

  /** クリック座標が下部「視野範囲」UI 帯内か（パン・ズームと干渉させない） */
  const isInDepthControlsBand = (localY, frame) => {
    const bandTop = frame.subTop + frame.subHeight - DEPTH_CONTROLS_BAND;
    return localY >= bandTop;
  };

  const getHit = ({ clientX, clientY, rect, excludeDepthControls = false }) => {
    if (!visible || !rect) return null;
    const frame = lastFrameRef.current;
    if (frame.canvasWidth <= 0 || frame.canvasHeight <= 0 || frame.subHeight <= 0) return null;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localX > frame.canvasWidth || localY < frame.subTop || localY > frame.canvasHeight) {
      return null;
    }
    // スライダー操作エリアはサブビュー操作対象外（excludeDepthControls 時）
    if (excludeDepthControls && isInDepthControlsBand(localY, frame)) {
      return null;
    }

    const panelWidth = frame.panelWidth > 0 ? frame.panelWidth : Math.floor(frame.canvasWidth / VIEW_DEFS.length);
    const rawIndex = Math.floor(localX / Math.max(1, panelWidth));
    const index = Math.min(VIEW_DEFS.length - 1, Math.max(0, rawIndex));
    const x = index * panelWidth;
    const width = index === VIEW_DEFS.length - 1 ? frame.canvasWidth - x : panelWidth;

    return {
      index,
      viewDef: VIEW_DEFS[index],
      localX,
      localY,
      width,
      height: frame.subHeight
    };
  };

  useImperativeHandle(ref, () => ({
    isPointInSubView({ clientX, clientY, rect }) {
      return !!getHit({ clientX, clientY, rect });
    },

    handlePointerDown({ clientX, clientY, rect, followEnabled }) {
      if (!rect) return false;
      const frame = lastFrameRef.current;
      const localY = clientY - rect.top;
      // 視野範囲 UI 上のクリックはメイン操作に渡さない（ドラッグ開始もしない）
      if (isInDepthControlsBand(localY, frame)) return true;

      const hit = getHit({ clientX, clientY, rect, excludeDepthControls: true });
      if (!hit) return false;
      if (followEnabled) return true;

      const state = viewStatesRef.current[hit.viewDef.key];
      dragStateRef.current.active = true;
      dragStateRef.current.viewKey = hit.viewDef.key;
      dragStateRef.current.startX = clientX;
      dragStateRef.current.startY = clientY;
      dragStateRef.current.startCenter.copy(state.center);
      return true;
    },

    handlePointerMove({ clientX, clientY, rect, followEnabled }) {
      if (!rect) return false;
      const frame = lastFrameRef.current;
      const localY = clientY - rect.top;
      if (isInDepthControlsBand(localY, frame)) return true;

      if (!dragStateRef.current.active) {
        return !!getHit({ clientX, clientY, rect, excludeDepthControls: true });
      }
      if (followEnabled) {
        dragStateRef.current.active = false;
        dragStateRef.current.viewKey = null;
        return true;
      }

      const viewKey = dragStateRef.current.viewKey;
      const viewDef = VIEW_DEFS.find((v) => v.key === viewKey);
      const state = viewStatesRef.current[viewKey];
      if (!viewDef || !state) return true;

      const panelWidth = Math.max(1, frame.panelWidth || Math.floor(frame.canvasWidth / VIEW_DEFS.length));
      const width = viewDef.key === VIEW_DEFS[VIEW_DEFS.length - 1].key
        ? Math.max(1, frame.canvasWidth - panelWidth * (VIEW_DEFS.length - 1))
        : panelWidth;
      const height = Math.max(1, frame.subHeight);

      const dx = clientX - dragStateRef.current.startX;
      const dy = clientY - dragStateRef.current.startY;
      const aspect = Math.max(width / height, 0.1);
      const worldPerPixelX = (state.halfSize * 2 * aspect) / width;
      const worldPerPixelY = (state.halfSize * 2) / height;

      const forward = viewDef.direction.clone().normalize();
      const up = viewDef.up.clone().normalize();
      const right = new THREE.Vector3().crossVectors(forward, up).normalize();
      const panX = -dx * worldPerPixelX;
      const panY = dy * worldPerPixelY;

      state.center.copy(dragStateRef.current.startCenter)
        .addScaledVector(right, panX)
        .addScaledVector(up, panY);
      return true;
    },

    handlePointerUp({ clientX, clientY, rect }) {
      const wasDragging = dragStateRef.current.active;
      dragStateRef.current.active = false;
      dragStateRef.current.viewKey = null;
      if (wasDragging) return true;
      return !!getHit({ clientX, clientY, rect });
    },

    handleWheel({ clientX, clientY, rect, deltaY }) {
      if (!rect) return false;
      const frame = lastFrameRef.current;
      const localY = clientY - rect.top;
      if (isInDepthControlsBand(localY, frame)) return true;

      const hit = getHit({ clientX, clientY, rect, excludeDepthControls: true });
      if (!hit) return false;

      const state = viewStatesRef.current[hit.viewDef.key];
      if (!state) return true;
      const zoomFactor = deltaY > 0 ? 1.1 : 0.9;
      state.halfSize = THREE.MathUtils.clamp(state.halfSize * zoomFactor, MIN_HALF_SIZE, MAX_HALF_SIZE);
      return true;
    },

    handleDoubleClick({ clientX, clientY, rect, followEnabled, selectedMesh }) {
      const hit = getHit({ clientX, clientY, rect });
      if (!hit) return false;
      if (followEnabled) return true;

      const fallback = viewStatesRef.current.front.center;
      const nextCenter = getMeshWorldCenter(selectedMesh, fallback);
      Object.values(viewStatesRef.current).forEach((state) => {
        state.center.copy(nextCenter);
      });
      return true;
    },

    /**
     * メイン描画の直後に呼び出されるサブビュー描画処理。
     * 同じWebGLRendererに対して scissor/viewport を切り替えながら3回描画する。
     *
     * @param {{
     *   renderer: THREE.WebGLRenderer,
     *   scene: THREE.Scene,
     *   mainCamera: THREE.Camera,
     *   selectedMesh?: THREE.Object3D | null,
     *   followEnabled?: boolean,
     *   canvasWidth: number,
     *   canvasHeight: number
     * }} args
     * selectedMesh … トップ「視野」ON 時の near 算出に使用（重心深度）
     */
    renderSubViews({ renderer, scene, mainCamera, selectedMesh, followEnabled, canvasWidth, canvasHeight }) {
      if (!visible || !renderer || !scene || !mainCamera) return;
      if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return;
      if (canvasWidth <= 0 || canvasHeight <= 0) return;
      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;

      // 下部35%を3分割して使用
      const subHeight = Math.max(1, Math.floor(canvasHeight * SUB_VIEW_HEIGHT_RATIO));
      const panelWidth = Math.floor(canvasWidth / VIEW_DEFS.length);
      const followCenter = selectedMesh
        ? getMeshWorldCenter(selectedMesh, new THREE.Vector3(0, 0, 0))
        : null;

      lastFrameRef.current.canvasWidth = canvasWidth;
      lastFrameRef.current.canvasHeight = canvasHeight;
      lastFrameRef.current.subHeight = subHeight;
      lastFrameRef.current.panelWidth = panelWidth;
      lastFrameRef.current.subTop = canvasHeight - subHeight;

      VIEW_DEFS.forEach((viewDef, index) => {
        const camera = subCamerasRef.current[viewDef.key];
        const state = viewStatesRef.current[viewDef.key];
        if (!camera) return;
        if (!state) return;
        const mode = directionModeMap[viewDef.key] || DIRECTION_MODE.NORMAL;
        const directionSign = mode === DIRECTION_MODE.REVERSE ? -1 : 1;
        const effectiveDirection = viewDef.direction.clone().multiplyScalar(directionSign);

        if (followEnabled && followCenter) {
          state.center.copy(followCenter);
        }

        if (!Number.isFinite(state.distance) || state.distance <= 0) {
          state.distance = Math.max(20, mainCamera.position.distanceTo(state.center) * 0.65);
        }
        if (!Number.isFinite(state.halfSize) || state.halfSize <= 0) {
          state.halfSize = getHalfViewSize(mainCamera, state.distance);
        }

        const x = index * panelWidth;
        const width = index === VIEW_DEFS.length - 1 ? canvasWidth - x : panelWidth;
        const aspect = Math.max(width / subHeight, 0.1);
        const distance = state.distance;
        const halfSize = state.halfSize;
        camera.position.copy(state.center).addScaledVector(effectiveDirection, -distance);
        camera.up.copy(viewDef.up);
        camera.lookAt(state.center);
        camera.updateMatrixWorld(true);

        // --- 奥行きクリップ（near / far）---
        // 視線方向: 注視点 - カメラ位置（lookAt 後の forward と一致）
        _viewDirScratch.copy(state.center).sub(camera.position).normalize();
        const sceneLimits = computeSceneDepthRange(scene, camera.position, _viewDirScratch);
        depthLimitsRef.current[viewDef.key] = sceneLimits;

        // トップ「視野」用: 選択管路重心の深度（未選択なら null → 全範囲）
        let focusDepth = null;
        if (selectedMesh) {
          const meshCenter = getMeshWorldCenter(selectedMesh, state.center);
          focusDepth = depthAlongView(meshCenter, camera.position, _viewDirScratch);
        }
        focusDepthByViewRef.current[viewDef.key] = focusDepth;

        const rangeEnabled = depthRangeEnabledRef.current[viewDef.key];
        const rangeValues = depthRangeValuesRef.current[viewDef.key];
        const { near, far } = resolveNearFar({
          sceneLimits,
          rangeEnabled,
          rangeValues,
          depthFocusEnabled: depthFocusEnabledRef.current,
          focusDepth,
          fallbackDistance: distance
        });

        // 各サブビュー用の正射投影範囲を更新
        camera.left = -halfSize * aspect;
        camera.right = halfSize * aspect;
        camera.top = halfSize;
        camera.bottom = -halfSize;
        camera.near = near;
        camera.far = far;
        camera.updateProjectionMatrix();

        // 領域を切り替えて同一sceneを描画
        renderer.setViewport(x, 0, width, subHeight);
        renderer.setScissor(x, 0, width, subHeight);
        renderer.setScissorTest(true);
        renderer.clearDepth();
        renderer.render(scene, camera);

        // サブビュー専用の軸線を重ねて描画（メインビューには表示しない）
        if (subViewAxesRef.current && subViewOverlaySceneRef.current) {
          const axisSize = Math.max(2, halfSize * 0.45);
          subViewAxesRef.current.position.copy(state.center);
          subViewAxesRef.current.scale.setScalar(axisSize);
          renderer.clearDepth();
          renderer.render(subViewOverlaySceneRef.current, camera);
        }
      });

      // 「視野範囲」OFF の面向け: 深度範囲表示を定期的に同期
      const anyRangeOff = VIEW_DEFS.some((v) => !depthRangeEnabledRef.current[v.key]);
      if (anyRangeOff) {
        const snapshot = JSON.stringify(depthLimitsRef.current);
        const now = performance.now();
        if (
          snapshot !== depthLimitsSyncSnapshotRef.current
          && now - depthLimitsSyncTimeRef.current > 200
        ) {
          depthLimitsSyncSnapshotRef.current = snapshot;
          depthLimitsSyncTimeRef.current = now;
          setDepthLimitsDisplay({ ...depthLimitsRef.current });
        }
      }

      renderer.setScissorTest(false);
      // 以降の描画処理に影響しないよう、viewportを全体へ戻す
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      renderer.autoClear = prevAutoClear;
    }
  }), [directionModeMap, visible, depthRangeEnabled, depthRangeValues]);

  /** 下部「視野範囲」ON 時、直近フレームのシーン深度範囲でスライダーを初期化 */
  const handleToggleDepthRange = (viewKey, enabled) => {
    setDepthRangeEnabled((prev) => ({ ...prev, [viewKey]: enabled }));
    if (!enabled) {
      const limits = depthLimitsRef.current[viewKey] || { min: 0, max: 1000 };
      setDepthLimitsDisplay((prev) => ({
        ...prev,
        [viewKey]: { min: limits.min, max: limits.max }
      }));
    }
    if (enabled) {
      const limits = depthLimitsRef.current[viewKey] || { min: 0, max: 1000 };
      const focusDepth = focusDepthByViewRef.current[viewKey];
      const useFocusNear = depthFocusEnabledRef.current && Number.isFinite(focusDepth);
      setDepthRangeValues((prev) => ({
        ...prev,
        [viewKey]: {
          min: useFocusNear ? focusDepth : limits.min,
          max: limits.max
        }
      }));
    }
  };

  /**
   * スライダー変更 → state に反映。
   * トップ「視野」+ 下部「視野範囲」かつ重心深度ありのときは far のみ更新（near は毎フレーム重心から算出）。
   */
  const handleDepthRangeChange = (viewKey, min, max, lockNearToFocus = false) => {
    setDepthRangeValues((prev) => ({
      ...prev,
      [viewKey]: lockNearToFocus
        ? { min: prev[viewKey].min, max }
        : { min, max }
    }));
  };

  const handleDirectionModeChange = (viewKey, mode) => {
    setDirectionModeMap((prev) => {
      if (prev[viewKey] === mode) return prev;
      return { ...prev, [viewKey]: mode };
    });
  };

  const toggleDirectionMode = (viewKey) => {
    const current = directionModeMap[viewKey] || DIRECTION_MODE.NORMAL;
    const next = current === DIRECTION_MODE.NORMAL ? DIRECTION_MODE.REVERSE : DIRECTION_MODE.NORMAL;
    handleDirectionModeChange(viewKey, next);
  };

  if (!visible) return null;

  return (
    <div className="subview-overlay" aria-hidden="true">
      <div className="subview-root-title">サブビュー</div>
      <div className="subview-panels">
        {VIEW_DEFS.map((view) => (
          <div className="subview-panel" key={view.key}>
            <div className="subview-panel-title">
              <label className="subview-direction-toggle">
                <input
                  type="radio"
                  name={`subview-direction-${view.key}`}
                  checked={directionModeMap[view.key] === DIRECTION_MODE.REVERSE}
                  onClick={() => toggleDirectionMode(view.key)}
                  readOnly
                />
                <span>
                  {directionModeMap[view.key] === DIRECTION_MODE.REVERSE
                    ? view.titleReverse
                    : view.titleNormal}
                </span>
              </label>
            </div>
            {/* 面ごとの奥行きクリップ。far はスライダー。トップ「視野」ON 時は near=重心で左ハンドル固定 */}
            <div className="subview-depth-controls">
              <div className="subview-depth-row">
                <label className="subview-depth-toggle">
                  <input
                    type="checkbox"
                    checked={depthRangeEnabled[view.key]}
                    onChange={(e) => handleToggleDepthRange(view.key, e.target.checked)}
                  />
                  <span>視野範囲</span>
                </label>
                {!depthRangeEnabled[view.key] && (() => {
                  const limits = depthLimitsDisplay[view.key]
                    || depthLimitsRef.current[view.key]
                    || { min: 0, max: 1000 };
                  return (
                    <span className="subview-depth-limits-hint">
                      {`最小(${limits.min.toFixed(1)})〜最大(${limits.max.toFixed(1)})`}
                    </span>
                  );
                })()}
              </div>
              {depthRangeEnabled[view.key] && (() => {
                const limits = depthLimitsRef.current[view.key] || { min: 0, max: 1000 };
                const values = depthRangeValues[view.key];
                const focusDepth = focusDepthByViewRef.current[view.key];
                const lockNearToFocus = depthFocusEnabled
                  && Number.isFinite(focusDepth);
                const displayMin = lockNearToFocus ? focusDepth : values.min;
                return (
                  <DepthRangeSlider
                    minLimit={Math.min(limits.min, displayMin)}
                    maxLimit={Math.max(limits.max, values.max)}
                    valueMin={displayMin}
                    valueMax={values.max}
                    lockMin={lockNearToFocus}
                    onChange={(min, max) => handleDepthRangeChange(view.key, min, max, lockNearToFocus)}
                  />
                );
              })()}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default SubViewPanel;
