import React, { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import * as THREE from 'three';
import './SubViewPanel.css';

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
 * @param {{ visible: boolean }} props
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
const SubViewPanel = forwardRef(function SubViewPanel({ visible }, ref) {
  const [directionModeMap, setDirectionModeMap] = useState({
    front: DIRECTION_MODE.NORMAL,
    side: DIRECTION_MODE.NORMAL,
    top: DIRECTION_MODE.NORMAL
  });
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

  const getHit = ({ clientX, clientY, rect }) => {
    if (!visible || !rect) return null;
    const frame = lastFrameRef.current;
    if (frame.canvasWidth <= 0 || frame.canvasHeight <= 0 || frame.subHeight <= 0) return null;

    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localX > frame.canvasWidth || localY < frame.subTop || localY > frame.canvasHeight) {
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
      const hit = getHit({ clientX, clientY, rect });
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
      if (!dragStateRef.current.active) {
        return !!getHit({ clientX, clientY, rect });
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

      const frame = lastFrameRef.current;
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
      const hit = getHit({ clientX, clientY, rect });
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
        const near = Math.max(0.1, distance * 0.01);
        const far = Math.max(2000, distance * 40);

        // 各サブビュー用の正射投影範囲を更新
        camera.left = -halfSize * aspect;
        camera.right = halfSize * aspect;
        camera.top = halfSize;
        camera.bottom = -halfSize;
        camera.near = near;
        camera.far = far;

        camera.position.copy(state.center).addScaledVector(effectiveDirection, -distance);
        camera.up.copy(viewDef.up);
        camera.lookAt(state.center);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

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

      renderer.setScissorTest(false);
      // 以降の描画処理に影響しないよう、viewportを全体へ戻す
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
      renderer.autoClear = prevAutoClear;
    }
  }), [directionModeMap, visible]);

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
          </div>
        ))}
      </div>
    </div>
  );
});

export default SubViewPanel;
