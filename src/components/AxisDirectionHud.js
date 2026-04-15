import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import './AxisDirectionHud.css';

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
        if (!camera) {
          hud.style.display = 'none';
        } else {
          const isPerspective = activeCameraTypeRef?.current === 'perspective';
          hud.style.display = isPerspective ? 'block' : 'none';
          if (isPerspective) {
            const center = 44;
            const radius = 28;
            invQuat.copy(camera.quaternion).invert();

            ['east', 'north', 'up'].forEach((key) => {
              const v = tempVec.copy(baseVectors[key]).applyQuaternion(invQuat);
              const x = center + v.x * radius;
              const y = center - v.y * radius;
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
      }
      frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [cameraRef, activeCameraTypeRef]);

  return (
    <div className="axis-hud" ref={hudRef} title="方位HUD">
      <svg className="axis-hud-svg" viewBox="0 0 88 88" aria-hidden="true">
        <circle cx="44" cy="44" r="39" className="axis-hud-ring" />
        <line x1="44" y1="44" x2="44" y2="44" className="axis-line axis-line-east" ref={(el) => { lineRefs.current.east = el; }} />
        <line x1="44" y1="44" x2="44" y2="44" className="axis-line axis-line-north" ref={(el) => { lineRefs.current.north = el; }} />
        <line x1="44" y1="44" x2="44" y2="44" className="axis-line axis-line-up" ref={(el) => { lineRefs.current.up = el; }} />
        <circle cx="44" cy="44" r="2.2" className="axis-hud-center" />
      </svg>
      <span className="axis-label axis-label-east" ref={(el) => { labelRefs.current.east = el; }}>東</span>
      <span className="axis-label axis-label-north" ref={(el) => { labelRefs.current.north = el; }}>北</span>
      <span className="axis-label axis-label-up" ref={(el) => { labelRefs.current.up = el; }}>上</span>
    </div>
  );
}

export default AxisDirectionHud;
