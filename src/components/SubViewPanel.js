/**
 * SubViewPanel — 下部3面サブビュー
 *
 * 奥行き視野（near / far）の2段階制御:
 * - Scene3D トップ「視野」… 選択管路重心より手前をまとめてクリップ（視野範囲 OFF 時）
 * - 各面下部「視野範囲」… near / far をスライダー左右で指定（管路付近のレンジで操作）
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import DepthRangeSlider from './DepthRangeSlider';
import './SubViewPanel.css';
import {
  DEPTH_MIN_SPAN,
  DEPTH_NEAR_MARGIN,
  DEPTH_RECOMPUTE_MS,
  buildViewDepthData,
  getDepthSliderStep,
  makeDepthCacheSignature,
  resolveNearFar
} from '../utils/subviewDepthUtils';

/** 下部「視野範囲」UIの帯の高さ（px）。この範囲ではパン・ズームを無効化 */
const DEPTH_CONTROLS_BAND = 56;

/**
 * サブビュー領域の高さ（キャンバス全体に対する比率）。
 * 例: 0.35 => 下部35%をサブビュー描画領域として使用。
 */
const SUB_VIEW_HEIGHT_RATIO = 0.35;

/**
 * 各サブビューの定義。
 * - direction: 注視点(center)からカメラへ向かう方向の基準（× -distance でカメラ位置）
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

const _viewDirScratch = new THREE.Vector3();

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
/** 各面の深度スライダー初期値（視野範囲 ON 時に sliderLimits で上書き） */
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
  // renderSubViews 毎フレーム更新: 参考表示用（管路＋キャップした全体深度）
  const depthLimitsRef = useRef(createDefaultDepthRangeValues());
  // スライダー操作レンジ（管路付近に絞った値）
  const sliderLimitsRef = useRef(createDefaultDepthRangeValues());
  // 「視野範囲」OFF 時に表示する最小〜最大（ref を React 表示へ同期）
  const [depthLimitsDisplay, setDepthLimitsDisplay] = useState(createDefaultDepthRangeValues);
  const depthLimitsDirtyRef = useRef(false);
  const depthDisplayRafRef = useRef(null);
  const depthCacheByViewRef = useRef({ front: null, side: null, top: null });
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

  /** 描画ループ外で depthLimitsDisplay を同期（setState を rAF に逃がす） */
  const scheduleDepthLimitsDisplaySync = useCallback(() => {
    if (depthDisplayRafRef.current != null) return;
    depthDisplayRafRef.current = requestAnimationFrame(() => {
      depthDisplayRafRef.current = null;
      setDepthLimitsDisplay({
        front: { ...depthLimitsRef.current.front },
        side: { ...depthLimitsRef.current.side },
        top: { ...depthLimitsRef.current.top }
      });
    });
  }, []);

  useEffect(() => () => {
    if (depthDisplayRafRef.current != null) {
      cancelAnimationFrame(depthDisplayRafRef.current);
    }
  }, []);

  const getViewDepthCached = (viewKey, signature, compute) => {
    const now = performance.now();
    const cached = depthCacheByViewRef.current[viewKey];
    if (
      cached
      && cached.signature === signature
      && now - cached.time < DEPTH_RECOMPUTE_MS
    ) {
      return { data: cached.data, fromCache: true };
    }
    const data = compute();
    depthCacheByViewRef.current[viewKey] = { signature, time: now, data };
    return { data, fromCache: false };
  };

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

      const mode = directionModeMap[viewKey] || DIRECTION_MODE.NORMAL;
      const directionSign = mode === DIRECTION_MODE.REVERSE ? -1 : 1;
      const effectiveDirection = viewDef.direction.clone().multiplyScalar(directionSign).normalize();
      const up = viewDef.up.clone().normalize();
      const right = new THREE.Vector3().crossVectors(effectiveDirection, up).normalize();
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

      const selectedFeatureId = selectedMesh?.userData?.objectData?.feature_id
        ?? selectedMesh?.uuid
        ?? null;
      let depthLimitsUpdated = false;

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
        _viewDirScratch.copy(state.center).sub(camera.position).normalize();
        const signature = makeDepthCacheSignature({
          center: state.center,
          distance,
          directionMode: mode,
          cameraPosition: camera.position,
          viewDir: _viewDirScratch,
          selectedFeatureId
        });
        const focusPoint = selectedMesh
          ? getMeshWorldCenter(selectedMesh, state.center)
          : null;
        const { data: depthData, fromCache } = getViewDepthCached(
          viewDef.key,
          signature,
          () => buildViewDepthData({
            scene,
            cameraPosition: camera.position,
            viewDir: _viewDirScratch,
            distance,
            focusPoint
          })
        );
        if (!fromCache) {
          depthLimitsUpdated = true;
        }

        depthLimitsRef.current[viewDef.key] = depthData.displayLimits;
        focusDepthByViewRef.current[viewDef.key] = depthData.focusDepth;
        sliderLimitsRef.current[viewDef.key] = depthData.sliderLimits;

        const rangeEnabled = depthRangeEnabledRef.current[viewDef.key];
        const rangeValues = depthRangeValuesRef.current[viewDef.key];
        const { near, far } = resolveNearFar({
          sceneLimits: depthData.displayLimits,
          sliderLimits: depthData.sliderLimits,
          rangeEnabled,
          rangeValues,
          depthFocusEnabled: depthFocusEnabledRef.current,
          focusDepth: depthData.focusDepth,
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

      const anyRangeOff = VIEW_DEFS.some((v) => !depthRangeEnabledRef.current[v.key]);
      if (anyRangeOff && depthLimitsUpdated) {
        depthLimitsDirtyRef.current = true;
      }
      if (anyRangeOff && depthLimitsDirtyRef.current) {
        depthLimitsDirtyRef.current = false;
        scheduleDepthLimitsDisplaySync();
      }

      renderer.setScissorTest(false);
      // 以降の描画処理に影響しないよう、viewportを全体へ戻す
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      renderer.autoClear = prevAutoClear;
    }
  }), [directionModeMap, visible, depthRangeEnabled, depthRangeValues, scheduleDepthLimitsDisplaySync]);

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
      const limits = sliderLimitsRef.current[viewKey]
        || depthLimitsRef.current[viewKey]
        || { min: 0, max: 1000 };
      const focusDepth = focusDepthByViewRef.current[viewKey];
      const useFocusNear = depthFocusEnabledRef.current && Number.isFinite(focusDepth);
      const initMin = useFocusNear
        ? THREE.MathUtils.clamp(focusDepth, limits.min, limits.max - DEPTH_MIN_SPAN)
        : limits.min;
      setDepthRangeValues((prev) => ({
        ...prev,
        [viewKey]: {
          min: Math.max(DEPTH_NEAR_MARGIN, initMin),
          max: limits.max
        }
      }));
    }
  };

  /** スライダー変更 → near(min) / far(max) を state に反映（操作レンジ内にクランプ） */
  const handleDepthRangeChange = (viewKey, min, max) => {
    const limits = sliderLimitsRef.current[viewKey]
      || depthLimitsRef.current[viewKey]
      || { min: 0, max: 1000 };
    const clampedMin = THREE.MathUtils.clamp(min, limits.min, limits.max - DEPTH_MIN_SPAN);
    const clampedMax = THREE.MathUtils.clamp(max, clampedMin + DEPTH_MIN_SPAN, limits.max);
    setDepthRangeValues((prev) => ({
      ...prev,
      [viewKey]: { min: clampedMin, max: clampedMax }
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
            {/* 面ごとの奥行きクリップ（near / far はスライダー。視野範囲 ON 時の初期 near は重心に合わせることあり） */}
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
                const limits = sliderLimitsRef.current[view.key]
                  || depthLimitsRef.current[view.key]
                  || { min: 0, max: 1000 };
                const values = depthRangeValues[view.key];
                return (
                  <DepthRangeSlider
                    minLimit={limits.min}
                    maxLimit={limits.max}
                    valueMin={values.min}
                    valueMax={values.max}
                    step={getDepthSliderStep(limits.min, limits.max)}
                    onChange={(min, max) => handleDepthRangeChange(view.key, min, max)}
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
