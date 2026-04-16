import React, { forwardRef, useImperativeHandle, useRef } from 'react';
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
    title: '正面（北向き）',
    direction: new THREE.Vector3(0, 0, -1),
    up: new THREE.Vector3(0, 1, 0)
  },
  {
    key: 'side',
    title: '側面（西向き）',
    direction: new THREE.Vector3(-1, 0, 0),
    up: new THREE.Vector3(0, 1, 0)
  },
  {
    key: 'top',
    title: '平面（下向き）',
    direction: new THREE.Vector3(0, -1, 0),
    // 北方向(-Z)が画面上になるように上方向を固定
    up: new THREE.Vector3(0, 0, -1)
  }
];

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
 *     target?: THREE.Vector3 | null,
 *     canvasWidth: number,
 *     canvasHeight: number
 *   }) => void
 * }>} ref
 */
const SubViewPanel = forwardRef(function SubViewPanel({ visible }, ref) {
  // 3面それぞれのサブビュー専用カメラ（毎フレーム使い回す）
  const subCamerasRef = useRef({
    front: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000),
    side: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000),
    top: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100000)
  });

  useImperativeHandle(ref, () => ({
    /**
     * メイン描画の直後に呼び出されるサブビュー描画処理。
     * 同じWebGLRendererに対して scissor/viewport を切り替えながら3回描画する。
     *
     * @param {{
     *   renderer: THREE.WebGLRenderer,
     *   scene: THREE.Scene,
     *   mainCamera: THREE.Camera,
     *   target?: THREE.Vector3 | null,
     *   canvasWidth: number,
     *   canvasHeight: number
     * }} args
     */
    renderSubViews({ renderer, scene, mainCamera, target, canvasWidth, canvasHeight }) {
      if (!visible || !renderer || !scene || !mainCamera) return;
      if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight)) return;
      if (canvasWidth <= 0 || canvasHeight <= 0) return;

      // 下部35%を3分割して使用
      const subHeight = Math.max(1, Math.floor(canvasHeight * SUB_VIEW_HEIGHT_RATIO));
      const panelWidth = Math.floor(canvasWidth / VIEW_DEFS.length);
      // OrbitControls.target を注視点として使い、無い場合は原点を採用
      const center = (target && target.isVector3) ? target : new THREE.Vector3(0, 0, 0);
      // メインカメラとの距離を基準に、サブビューの引き具合を決定
      const distance = Math.max(20, mainCamera.position.distanceTo(center) * 0.65);
      const near = Math.max(0.1, distance * 0.01);
      const far = Math.max(2000, distance * 40);

      VIEW_DEFS.forEach((viewDef, index) => {
        const camera = subCamerasRef.current[viewDef.key];
        if (!camera) return;

        const x = index * panelWidth;
        const width = index === VIEW_DEFS.length - 1 ? canvasWidth - x : panelWidth;
        const aspect = Math.max(width / subHeight, 0.1);
        const halfSize = getHalfViewSize(mainCamera, distance);

        // 各サブビュー用の正射投影範囲を更新
        camera.left = -halfSize * aspect;
        camera.right = halfSize * aspect;
        camera.top = halfSize;
        camera.bottom = -halfSize;
        camera.near = near;
        camera.far = far;

        camera.position.copy(center).addScaledVector(viewDef.direction, -distance);
        camera.up.copy(viewDef.up);
        camera.lookAt(center);
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld(true);

        // 領域を切り替えて同一sceneを描画
        renderer.setViewport(x, 0, width, subHeight);
        renderer.setScissor(x, 0, width, subHeight);
        renderer.setScissorTest(true);
        renderer.clearDepth();
        renderer.render(scene, camera);
      });

      renderer.setScissorTest(false);
      // 以降の描画処理に影響しないよう、viewportを全体へ戻す
      renderer.setViewport(0, 0, canvasWidth, canvasHeight);
    }
  }), [visible]);

  if (!visible) return null;

  return (
    <div className="subview-overlay" aria-hidden="true">
      <div className="subview-root-title">サブビュー</div>
      <div className="subview-panels">
        {VIEW_DEFS.map((view) => (
          <div className="subview-panel" key={view.key}>
            <div className="subview-panel-title">{view.title}</div>
          </div>
        ))}
      </div>
    </div>
  );
});

export default SubViewPanel;
