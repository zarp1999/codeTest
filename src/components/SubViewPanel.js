/**
 * SubViewPanel — 下部3面サブビュー
 *
 * 深度レンジ（最小〜最大）:
 * - サブビュー初回表示時に全管路範囲で固定（追従・管路選択では変えない）
 * - トップ「視野」ON … 表示レンジは固定、初期 near は選択管路重心深度（左ハンドルは手動調整可）
 * - 下部「視野範囲」ON … スライダー幅は固定、視野 ON 時は未操作時のみ左ハンドルが重心深度へ追従
 */
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import DepthRangeSlider from './DepthRangeSlider';
import './SubViewPanel.css';
import {
  DEPTH_MIN_SPAN,
  DEPTH_NEAR_MARGIN,
  DEPTH_RECOMPUTE_MS,
  buildViewDepthData,
  depthAlongView,
  getDepthSliderStep,
  makeDepthCacheSignature,
  resolveNearFar
} from '../utils/subviewDepthUtils';

/** 下部「視野範囲」UIの帯の高さ（px）。この範囲ではパン・ズームを無効化 */
const DEPTH_CONTROLS_BAND = 56;

/** サブビュー領域の高さ（キャンバス全体に対する比率） */
const SUB_VIEW_HEIGHT_RATIO = 0.35;

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
    up: new THREE.Vector3(0, 0, -1)
  }
];

const MIN_HALF_SIZE = 2;
const MAX_HALF_SIZE = 200000;
const DIRECTION_MODE = {
  NORMAL: 'normal',
  REVERSE: 'reverse'
};

const DEFAULT_DEPTH_LIMITS = { min: 0, max: 1000 };

const createDefaultDepthMap = () => ({
  front: { ...DEFAULT_DEPTH_LIMITS },
  side: { ...DEFAULT_DEPTH_LIMITS },
  top: { ...DEFAULT_DEPTH_LIMITS }
});

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

const clampRangeMin = (value, limits) =>
  THREE.MathUtils.clamp(value, limits.min, limits.max - DEPTH_MIN_SPAN);

/** 視野範囲 ON 時の near(min) / far(max) 初期値 */
const makeRangeValues = (limits, focusDepth, depthFocusOn) => {
  const useFocusNear = depthFocusOn && Number.isFinite(focusDepth);
  const min = useFocusNear
    ? clampRangeMin(focusDepth, limits)
    : limits.min;
  return {
    min: Math.max(DEPTH_NEAR_MARGIN, min),
    max: limits.max
  };
};

const SubViewPanel = forwardRef(function SubViewPanel({ visible, depthFocusEnabled = false }, ref) {
  const [directionModeMap, setDirectionModeMap] = useState({
    front: DIRECTION_MODE.NORMAL,
    side: DIRECTION_MODE.NORMAL,
    top: DIRECTION_MODE.NORMAL
  });
  const [depthRangeEnabled, setDepthRangeEnabled] = useState({
    front: false,
    side: false,
    top: false
  });
  const [depthRangeValues, setDepthRangeValues] = useState(createDefaultDepthMap);
  const [depthLimitsDisplay, setDepthLimitsDisplay] = useState(createDefaultDepthMap);

  /** 全管路ベースで固定する表示・スライダー共通レンジ（面ごと） */
  const frozenDepthLimitsRef = useRef({});
  const depthCacheByViewRef = useRef({ front: null, side: null, top: null });
  const focusDepthByViewRef = useRef({ front: null, side: null, top: null });
  const depthFocusEnabledRef = useRef(depthFocusEnabled);
  const depthRangeEnabledRef = useRef(depthRangeEnabled);
  const depthRangeValuesRef = useRef(depthRangeValues);
  /** 視野 ON 時に左ハンドルを手動調整済みか（面ごと） */
  const manualNearOverrideRef = useRef({});
  const lastSelectedFeatureIdRef = useRef(null);

  useEffect(() => {
    depthFocusEnabledRef.current = depthFocusEnabled;
    const patch = {};
    VIEW_DEFS.forEach((v) => {
      manualNearOverrideRef.current[v.key] = false;
      if (!depthRangeEnabledRef.current[v.key]) return;
      const limits = frozenDepthLimitsRef.current[v.key];
      if (!limits) return;
      const prev = depthRangeValuesRef.current[v.key] || limits;
      const focus = focusDepthByViewRef.current[v.key];
      patch[v.key] = makeRangeValues(limits, focus, depthFocusEnabled);
      patch[v.key].max = prev.max;
    });
    if (Object.keys(patch).length === 0) return;
    depthRangeValuesRef.current = { ...depthRangeValuesRef.current, ...patch };
    setDepthRangeValues((prev) => ({ ...prev, ...patch }));
  }, [depthFocusEnabled]);

  useEffect(() => {
    depthRangeEnabledRef.current = depthRangeEnabled;
  }, [depthRangeEnabled]);

  useEffect(() => {
    depthRangeValuesRef.current = depthRangeValues;
  }, [depthRangeValues]);

  const getViewDepthCached = (viewKey, signature, compute) => {
    const now = performance.now();
    const cached = depthCacheByViewRef.current[viewKey];
    if (
      cached
      && cached.signature === signature
      && now - cached.time < DEPTH_RECOMPUTE_MS
    ) {
      return cached.data;
    }
    const data = compute();
    depthCacheByViewRef.current[viewKey] = { signature, time: now, data };
    return data;
  };

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

  const applySubViewProjection = (camera, halfSize, aspect, near, far) => {
    camera.left = -halfSize * aspect;
    camera.right = halfSize * aspect;
    camera.top = halfSize;
    camera.bottom = -halfSize;
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  };

  const drawSubView = (renderer, scene, camera, state, x, width, subHeight, halfSize, aspect, near, far) => {
    applySubViewProjection(camera, halfSize, aspect, near, far);
    renderer.setViewport(x, 0, width, subHeight);
    renderer.setScissor(x, 0, width, subHeight);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(scene, camera);

    if (subViewAxesRef.current && subViewOverlaySceneRef.current) {
      const axisSize = Math.max(2, halfSize * 0.45);
      subViewAxesRef.current.position.copy(state.center);
      subViewAxesRef.current.scale.setScalar(axisSize);
      renderer.clearDepth();
      renderer.render(subViewOverlaySceneRef.current, camera);
    }
  };

  useImperativeHandle(ref, () => ({
    isPointInSubView({ clientX, clientY, rect }) {
      return !!getHit({ clientX, clientY, rect });
    },

    handlePointerDown({ clientX, clientY, rect, followEnabled }) {
      if (!rect) return false;
      const frame = lastFrameRef.current;
      const localY = clientY - rect.top;
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

    renderSubViews({ renderer, scene, mainCamera, selectedMesh, followEnabled, canvasWidth, canvasHeight }) {
      if (!visible || !renderer || !scene || !mainCamera) return;
      if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return;
      if (canvasWidth <= 0 || canvasHeight <= 0) return;

      const prevAutoClear = renderer.autoClear;
      renderer.autoClear = false;

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

      const depthFocusOn = depthFocusEnabledRef.current;
      const selectedFeatureId = selectedMesh?.userData?.objectData?.feature_id
        ?? selectedMesh?.uuid
        ?? null;
      const selectionChanged = selectedFeatureId !== lastSelectedFeatureIdRef.current;
      lastSelectedFeatureIdRef.current = selectedFeatureId;
      let frozenDisplayInitialized = false;
      const depthRangeResyncPatch = {};

      VIEW_DEFS.forEach((viewDef, index) => {
        const camera = subCamerasRef.current[viewDef.key];
        const state = viewStatesRef.current[viewDef.key];
        if (!camera || !state) return;

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

        _viewDirScratch.copy(state.center).sub(camera.position).normalize();
        const rangeEnabled = depthRangeEnabledRef.current[viewDef.key];

        let focusDepth = null;
        if (depthFocusOn && selectedMesh) {
          const focusPoint = getMeshWorldCenter(selectedMesh, state.center);
          focusDepth = depthAlongView(focusPoint, camera.position, _viewDirScratch);
          focusDepthByViewRef.current[viewDef.key] = focusDepth;
        } else {
          focusDepthByViewRef.current[viewDef.key] = null;
        }

        let depthLimits = frozenDepthLimitsRef.current[viewDef.key];

        if (!depthLimits) {
          const signature = makeDepthCacheSignature({
            center: state.center,
            distance,
            directionMode: mode,
            cameraPosition: camera.position,
            viewDir: _viewDirScratch
          });
          const depthData = getViewDepthCached(
            viewDef.key,
            signature,
            () => buildViewDepthData({
              scene,
              cameraPosition: camera.position,
              viewDir: _viewDirScratch,
              distance
            })
          );
          depthLimits = { ...depthData.depthLimits };
          frozenDepthLimitsRef.current[viewDef.key] = depthLimits;
          frozenDisplayInitialized = true;

          if (rangeEnabled) {
            const initValues = makeRangeValues(depthLimits, focusDepth, depthFocusOn);
            depthRangeValuesRef.current[viewDef.key] = initValues;
            depthRangeResyncPatch[viewDef.key] = initValues;
          }
        }

        let rangeValues = depthRangeValuesRef.current[viewDef.key];
        if (rangeEnabled && depthFocusOn && Number.isFinite(focusDepth)) {
          if (selectionChanged) {
            manualNearOverrideRef.current[viewDef.key] = false;
          }
          if (!manualNearOverrideRef.current[viewDef.key]) {
            const autoMin = clampRangeMin(focusDepth, depthLimits);
            if (!rangeValues || Math.abs(rangeValues.min - autoMin) > 0.001) {
              rangeValues = {
                min: autoMin,
                max: rangeValues?.max ?? depthLimits.max
              };
              depthRangeValuesRef.current[viewDef.key] = rangeValues;
              depthRangeResyncPatch[viewDef.key] = rangeValues;
            }
          }
        }

        const { near, far } = resolveNearFar({
          depthLimits,
          rangeEnabled,
          rangeValues: rangeEnabled ? rangeValues : null,
          depthFocusEnabled: depthFocusOn && !rangeEnabled,
          focusDepth,
          fallbackDistance: distance
        });

        drawSubView(renderer, scene, camera, state, x, width, subHeight, halfSize, aspect, near, far);
      });

      if (frozenDisplayInitialized) {
        const nextDisplay = createDefaultDepthMap();
        VIEW_DEFS.forEach((v) => {
          const limits = frozenDepthLimitsRef.current[v.key] || DEFAULT_DEPTH_LIMITS;
          nextDisplay[v.key] = { min: limits.min, max: limits.max };
        });
        setDepthLimitsDisplay(nextDisplay);
      }

      const resyncKeys = Object.keys(depthRangeResyncPatch);
      if (resyncKeys.length > 0) {
        setDepthRangeValues((prev) => {
          const next = { ...prev };
          resyncKeys.forEach((key) => {
            next[key] = { ...depthRangeResyncPatch[key] };
          });
          return next;
        });
      }

      renderer.setScissorTest(false);
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      renderer.autoClear = prevAutoClear;
    }
  }), [directionModeMap, visible, depthRangeEnabled, depthRangeValues, depthFocusEnabled]);

  const handleToggleDepthRange = (viewKey, enabled) => {
    setDepthRangeEnabled((prev) => ({ ...prev, [viewKey]: enabled }));
    const limits = frozenDepthLimitsRef.current[viewKey] || DEFAULT_DEPTH_LIMITS;

    if (!enabled) {
      setDepthLimitsDisplay((prev) => ({
        ...prev,
        [viewKey]: { min: limits.min, max: limits.max }
      }));
      return;
    }

    manualNearOverrideRef.current[viewKey] = false;
    const focus = depthFocusEnabledRef.current
      ? focusDepthByViewRef.current[viewKey]
      : null;
    const initValues = makeRangeValues(limits, focus, depthFocusEnabledRef.current);
    depthRangeValuesRef.current[viewKey] = initValues;
    setDepthRangeValues((prev) => ({
      ...prev,
      [viewKey]: initValues
    }));
  };

  const handleDepthRangeChange = (viewKey, min, max) => {
    const limits = frozenDepthLimitsRef.current[viewKey] || DEFAULT_DEPTH_LIMITS;
    const clampedMin = THREE.MathUtils.clamp(min, limits.min, limits.max - DEPTH_MIN_SPAN);
    const clampedMax = THREE.MathUtils.clamp(max, clampedMin + DEPTH_MIN_SPAN, limits.max);
    manualNearOverrideRef.current[viewKey] = true;
    setDepthRangeValues((prev) => ({
      ...prev,
      [viewKey]: { min: clampedMin, max: clampedMax }
    }));
  };

  const handleDirectionModeChange = (viewKey, mode) => {
    setDirectionModeMap((prev) => {
      if (prev[viewKey] === mode) return prev;
      depthCacheByViewRef.current[viewKey] = null;
      delete frozenDepthLimitsRef.current[viewKey];
      delete manualNearOverrideRef.current[viewKey];
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
        {VIEW_DEFS.map((view) => {
          const limits = depthLimitsDisplay[view.key] || DEFAULT_DEPTH_LIMITS;
          return (
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
                  {depthRangeEnabled[view.key] ? (
                    <DepthRangeSlider
                      className="subview-depth-range-slider"
                      minLimit={limits.min}
                      maxLimit={limits.max}
                      valueMin={depthRangeValues[view.key].min}
                      valueMax={depthRangeValues[view.key].max}
                      step={getDepthSliderStep(limits.min, limits.max)}
                      onChange={(min, max) => handleDepthRangeChange(view.key, min, max)}
                    />
                  ) : (
                    <span className="subview-depth-limits-hint">
                      {`最小(${limits.min.toFixed(1)})〜最大(${limits.max.toFixed(1)})`}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

export default SubViewPanel;
