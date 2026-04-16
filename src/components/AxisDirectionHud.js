import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './AxisDirectionHud.css';

const HUD_SIZE = 104;
const ARROW_LENGTH = 1.4;
const ARROW_HEAD_LENGTH = 0.32;
const ARROW_HEAD_WIDTH = 0.2;
const LABEL_DISTANCE = 1.58;

/**
 * カメラ姿勢を示す3軸HUD。
 * THREE.ArrowHelperで軸矢印を描画する。
 * - 赤: 東西(X)
 * - 青: 南北(North, -Z)
 * - 緑: 鉛直上(Y)
 */
function AxisDirectionHud({ cameraRef, activeCameraTypeRef, cameraInfo }) {
  const hudRef = useRef(null);
  const canvasHostRef = useRef(null);
  const labelRefs = useRef({ east: null, north: null, up: null });

  useEffect(() => {
    const host = canvasHostRef.current;
    if (!host) return undefined;

    const scene = new THREE.Scene();
    const hudCamera = new THREE.PerspectiveCamera(36, 1, 0.1, 10);
    hudCamera.position.set(0, 0, 3.2);
    hudCamera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(HUD_SIZE, HUD_SIZE);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);

    const origin = new THREE.Vector3(0, 0, 0);
    const baseVectors = {
      east: new THREE.Vector3(1, 0, 0),
      // 画面表示座標(南北=-Z)に合わせ、北方向はワールド -Z として扱う
      north: new THREE.Vector3(0, 0, -1),
      up: new THREE.Vector3(0, 1, 0)
    };
    const axisColors = {
      east: 0xff6b6b,
      north: 0x63b3ed,
      up: 0x68d391
    };

    const arrows = {
      east: new THREE.ArrowHelper(baseVectors.east, origin, ARROW_LENGTH, axisColors.east, ARROW_HEAD_LENGTH, ARROW_HEAD_WIDTH),
      north: new THREE.ArrowHelper(baseVectors.north, origin, ARROW_LENGTH, axisColors.north, ARROW_HEAD_LENGTH, ARROW_HEAD_WIDTH),
      up: new THREE.ArrowHelper(baseVectors.up, origin, ARROW_LENGTH, axisColors.up, ARROW_HEAD_LENGTH, ARROW_HEAD_WIDTH)
    };
    scene.add(arrows.east, arrows.north, arrows.up);

    const invQuat = new THREE.Quaternion();
    const tempVec = new THREE.Vector3();
    const labelPos = new THREE.Vector3();
    let frameId = 0;

    const update = () => {
      const hud = hudRef.current;
      const camera = cameraRef?.current;
      if (hud) {
        // HUDは常時表示（透視/正射の切替に関係なく表示）
        hud.style.display = 'block';
      }

      if (camera) {
        invQuat.copy(camera.quaternion).invert();
        ['east', 'north', 'up'].forEach((key) => {
          const dir = tempVec.copy(baseVectors[key]).applyQuaternion(invQuat).normalize();
          arrows[key].setDirection(dir);

          labelPos.copy(dir).multiplyScalar(LABEL_DISTANCE).project(hudCamera);
          const x = (labelPos.x * 0.5 + 0.5) * HUD_SIZE;
          const y = (-labelPos.y * 0.5 + 0.5) * HUD_SIZE;
          const depthOpacity = 0.45 + 0.55 * ((dir.z + 1) / 2);

          const label = labelRefs.current[key];
          if (label) {
            label.style.left = `${x.toFixed(2)}px`;
            label.style.top = `${y.toFixed(2)}px`;
            label.style.opacity = depthOpacity.toFixed(3);
          }
        });
      }

      renderer.render(scene, hudCamera);
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => {
      cancelAnimationFrame(frameId);
      Object.values(arrows).forEach((arrow) => {
        if (arrow.line?.geometry) arrow.line.geometry.dispose();
        if (arrow.line?.material) arrow.line.material.dispose();
        if (arrow.cone?.geometry) arrow.cone.geometry.dispose();
        if (arrow.cone?.material) arrow.cone.material.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === host) {
        host.removeChild(renderer.domElement);
      }
    };
  }, [cameraRef, activeCameraTypeRef]);

  return (
    <div
      className="axis-hud"
      ref={hudRef}
      title="方位HUD"
      style={{ '--axis-hud-size': `${HUD_SIZE}px` }}
    >
      <div className="axis-hud-canvas" ref={canvasHostRef} />
      <span className="axis-label axis-label-east" ref={(el) => { labelRefs.current.east = el; }}>東</span>
      <span className="axis-label axis-label-north" ref={(el) => { labelRefs.current.north = el; }}>北</span>
      <span className="axis-label axis-label-up" ref={(el) => { labelRefs.current.up = el; }}>上</span>
      <div className="axis-hud-info">
        <div>
          カメラ位置: 東西 {Number(cameraInfo?.x ?? 0).toFixed(3)}m, 南北 {Number(cameraInfo?.z ?? 0).toFixed(3)}m, 高さ {Number(cameraInfo?.y ?? 0).toFixed(3)}m
        </div>
        <div>
          カメラ向き: 方位 {Number(cameraInfo?.yaw ?? 0).toFixed(1)}度, 見下ろし {Number(cameraInfo?.pitch ?? 0).toFixed(1)}度
        </div>
      </div>
    </div>
  );
}

export default AxisDirectionHud;
