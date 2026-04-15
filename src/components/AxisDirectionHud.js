import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './AxisDirectionHud.css';

const HUD_SIZE = 104;
const HUD_CENTER = HUD_SIZE / 2;
const HUD_RADIUS = HUD_SIZE * 0.32;
const HUD_RING_RADIUS = HUD_SIZE / 2 - 5;
const HUD_CENTER_DOT_RADIUS = HUD_SIZE * 0.025;

/**
 * カメラ姿勢を示す3軸HUD。
 * - 赤: 東西(X)
 * - 青: 南北(North, -Z)
 * - 緑: 鉛直上(Y)
 */
function AxisDirectionHud({ cameraRef, activeCameraTypeRef }) {
  const hudRef = useRef(null);
  const lineRefs = useRef({ east: null, north: null, up: null });
  const labelRefs = useRef({ east: null, north: null, up: null });

  useEffect(() => {
    let frameId = 0;
    const invQuat = new THREE.Quaternion();
    const tempVec = new THREE.Vector3();
    const baseVectors = {
      east: new THREE.Vector3(1, 0, 0),
      // 画面表示座標(南北=-Z)に合わせ、北方向はワールド -Z として扱う
      north: new THREE.Vector3(0, 0, -1),
      up: new THREE.Vector3(0, 1, 0)
    };

    const update = () => {
      const hud = hudRef.current;
      const camera = cameraRef?.current;
      if (hud) {
        // HUDは常時表示（透視/正射の切替に関係なく表示）
        hud.style.display = 'block';
        if (camera) {
          invQuat.copy(camera.quaternion).invert();

          ['east', 'north', 'up'].forEach((key) => {
            const v = tempVec.copy(baseVectors[key]).applyQuaternion(invQuat);
            const x = HUD_CENTER + v.x * HUD_RADIUS;
            const y = HUD_CENTER - v.y * HUD_RADIUS;
            const depthOpacity = 0.45 + 0.55 * ((v.z + 1) / 2);

            const line = lineRefs.current[key];
            if (line) {
              line.setAttribute('x2', x.toFixed(2));
              line.setAttribute('y2', y.toFixed(2));
              line.style.opacity = depthOpacity.toFixed(3);
            }

            const label = labelRefs.current[key];
            if (label) {
              label.style.left = `${x.toFixed(2)}px`;
              label.style.top = `${y.toFixed(2)}px`;
              label.style.opacity = depthOpacity.toFixed(3);
            }
          });
        }
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [cameraRef, activeCameraTypeRef]);

  return (
    <div
      className="axis-hud"
      ref={hudRef}
      title="方位HUD"
      style={{ '--axis-hud-size': `${HUD_SIZE}px` }}
    >
      <svg className="axis-hud-svg" viewBox={`0 0 ${HUD_SIZE} ${HUD_SIZE}`} aria-hidden="true">
        <circle cx={HUD_CENTER} cy={HUD_CENTER} r={HUD_RING_RADIUS} className="axis-hud-ring" />
        <line x1={HUD_CENTER} y1={HUD_CENTER} x2={HUD_CENTER} y2={HUD_CENTER} className="axis-line axis-line-east" ref={(el) => { lineRefs.current.east = el; }} />
        <line x1={HUD_CENTER} y1={HUD_CENTER} x2={HUD_CENTER} y2={HUD_CENTER} className="axis-line axis-line-north" ref={(el) => { lineRefs.current.north = el; }} />
        <line x1={HUD_CENTER} y1={HUD_CENTER} x2={HUD_CENTER} y2={HUD_CENTER} className="axis-line axis-line-up" ref={(el) => { lineRefs.current.up = el; }} />
        <circle cx={HUD_CENTER} cy={HUD_CENTER} r={HUD_CENTER_DOT_RADIUS} className="axis-hud-center" />
      </svg>
      <span className="axis-label axis-label-east" ref={(el) => { labelRefs.current.east = el; }}>東</span>
      <span className="axis-label axis-label-north" ref={(el) => { labelRefs.current.north = el; }}>北</span>
      <span className="axis-label axis-label-up" ref={(el) => { labelRefs.current.up = el; }}>上</span>
    </div>
  );
}

export default AxisDirectionHud;
