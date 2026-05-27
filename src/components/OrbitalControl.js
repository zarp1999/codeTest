import React from 'react';
import * as THREE from 'three';
import './OrbitalControl.css';

/** @typedef {'pitchDown'|'pitchUp'|'yawCW'|'yawCCW'} OrbitalDirection */

const ORBITAL_DIRECTION = {
  PITCH_DOWN: 'pitchDown',
  PITCH_UP: 'pitchUp',
  YAW_CW: 'yawCW',
  YAW_CCW: 'yawCCW',
};

const PITCH_LIMIT = Math.PI / 2 - 0.01;

const easeOutCubic = (t) => 1 - (1 - t) ** 3;

const rotatePointAroundPivot = (position, pivot, axis, angleRad, scratch) => {
  scratch.copy(position).sub(pivot);
  scratch.applyAxisAngle(axis, angleRad);
  return position.copy(pivot).add(scratch);
};

const resolveOrbitalPivot = (camera, controls, orbitalCfg, minDist, scratch) => {
  const fallbackDistance = orbitalCfg?.distance ?? 5;

  if (controls?.target) {
    const pivot = scratch.pivot.copy(controls.target);
    const dist = camera.position.distanceTo(pivot);
    if (Number.isFinite(dist) && dist >= minDist) {
      return { pivot: pivot.clone(), distance: dist };
    }
  }

  const forward = scratch.forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
  if (forward.lengthSq() < 1e-12) return null;
  forward.normalize();

  const pivot = scratch.pivot.copy(camera.position).addScaledVector(forward, fallbackDistance);
  return { pivot: pivot.clone(), distance: fallbackDistance };
};

const computeOrbitalStepOffsets = (direction, camera, controls, orbitalCfg, minDist, scratch) => {
  const stepRad = THREE.MathUtils.degToRad(orbitalCfg?.stepDegrees ?? 30);

  const pivotInfo = resolveOrbitalPivot(camera, controls, orbitalCfg, minDist, scratch);
  if (!pivotInfo) return null;

  const { pivot, distance } = pivotInfo;
  const startOffset = new THREE.Vector3().copy(camera.position).sub(pivot);
  if (startOffset.lengthSq() < 1e-8) return null;

  const endPosition = camera.position.clone();
  const right = scratch.right.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
  const worldUp = scratch.worldUp.set(0, 1, 0);

  switch (direction) {
    case ORBITAL_DIRECTION.PITCH_DOWN:
      rotatePointAroundPivot(endPosition, pivot, right, -stepRad, scratch.offset);
      break;
    case ORBITAL_DIRECTION.PITCH_UP:
      rotatePointAroundPivot(endPosition, pivot, right, stepRad, scratch.offset);
      break;
    case ORBITAL_DIRECTION.YAW_CW:
      rotatePointAroundPivot(endPosition, pivot, worldUp, -stepRad, scratch.offset);
      break;
    case ORBITAL_DIRECTION.YAW_CCW:
      rotatePointAroundPivot(endPosition, pivot, worldUp, stepRad, scratch.offset);
      break;
    default:
      return null;
  }

  const endOffset = endPosition.sub(pivot);
  return { pivot, startOffset, endOffset, distance };
};

/**
 * Orbital Control のカメラ軌道・アニメーションを管理する
 */
export class OrbitalControlController {
  constructor() {
    this.anim = null;
    this.scratch = {
      forward: new THREE.Vector3(),
      pivot: new THREE.Vector3(),
      right: new THREE.Vector3(),
      worldUp: new THREE.Vector3(0, 1, 0),
      offset: new THREE.Vector3(),
    };
  }

  isAnimating() {
    return Boolean(this.anim?.active);
  }

  startStep(direction, camera, controls, { orbitalCfg, minDist, callbacks }) {
    if (!camera || !controls || this.isAnimating()) return false;

    const step = computeOrbitalStepOffsets(
      direction,
      camera,
      controls,
      orbitalCfg,
      minDist,
      this.scratch,
    );
    if (!step) return false;

    this.anim = {
      active: true,
      pivot: step.pivot,
      startOffset: step.startOffset,
      endOffset: step.endOffset,
      distance: step.distance,
      startTime: performance.now(),
      durationMs: orbitalCfg?.durationMs ?? 300,
    };

    callbacks.onAnimationStart?.();
    return true;
  }

  tick(camera, controls, { callbacks }) {
    const anim = this.anim;
    if (!anim?.active || !camera || !controls) return false;

    const elapsed = performance.now() - anim.startTime;
    const rawT = Math.min(1, elapsed / anim.durationMs);
    const t = easeOutCubic(rawT);

    this.scratch.offset.copy(anim.startOffset).lerp(anim.endOffset, t);
    camera.position.copy(anim.pivot).add(this.scratch.offset);
    camera.lookAt(anim.pivot);
    camera.updateMatrixWorld();
    controls.target.copy(anim.pivot);

    callbacks.syncCamerasFromActive?.(camera);
    callbacks.updateCameraInfoFromCamera?.(camera);
    if (camera.isOrthographicCamera) {
      callbacks.updateOrthographicFrustum?.(camera);
    }

    if (rawT >= 1) {
      camera.position.copy(anim.pivot).add(anim.endOffset);
      this.finalize(camera, controls, anim.pivot, anim.distance, callbacks);
      this.anim = null;
      callbacks.onAnimationEnd?.();
    }

    return true;
  }

  finalize(camera, controls, pivot, distance, callbacks) {
    camera.lookAt(pivot);
    camera.updateMatrixWorld();

    let euler = callbacks.getEulerYXZFromCamera(camera);
    if (euler.x > PITCH_LIMIT || euler.x < -PITCH_LIMIT) {
      euler.x = THREE.MathUtils.clamp(euler.x, -PITCH_LIMIT, PITCH_LIMIT);
      callbacks.applyEulerYXZToCamera(camera, euler);
      const clampedForward = this.scratch.forward
        .set(0, 0, -1)
        .applyQuaternion(camera.quaternion)
        .normalize();
      camera.position.copy(pivot).addScaledVector(clampedForward, -distance);
      camera.lookAt(pivot);
      camera.updateMatrixWorld();
      euler = callbacks.getEulerYXZFromCamera(camera);
    } else {
      callbacks.syncRightDragYawPitch?.(euler.y, euler.x);
    }

    callbacks.setRightDragTargetDistance?.(distance);
    controls.target.copy(pivot);
    callbacks.updateTargetOffsetFromCamera?.(camera);
    callbacks.syncCamerasFromActive?.(camera);
    callbacks.updateCameraInfoFromCamera?.(camera);
    if (camera.isOrthographicCamera) {
      callbacks.updateOrthographicFrustum?.(camera);
    }
    callbacks.syncPreviousCameraState?.(camera);
  }
}

/**
 * Orbital Control 操作パッド（↑見下ろし ↓見上げ ←時計回り →反時計回り）
 */
export function OrbitalControlPad({ onStep, stepDegrees = 30, disabled = false }) {
  const stepLabel = `${stepDegrees}°`;

  return (
    <div className="orbital-control-pad" role="group" aria-label="Orbital Control">
      <div className="orbital-control-title">Orbital Control</div>
      <div className="orbital-control-grid">
        <button
          type="button"
          className="orbital-control-button orbital-control-up"
          title={`見下ろし（${stepLabel}）`}
          disabled={disabled}
          onClick={() => onStep(ORBITAL_DIRECTION.PITCH_DOWN)}
        >
          ↑
        </button>
        <button
          type="button"
          className="orbital-control-button orbital-control-left"
          title={`時計回り（${stepLabel}）`}
          disabled={disabled}
          onClick={() => onStep(ORBITAL_DIRECTION.YAW_CW)}
        >
          ←
        </button>
        <button
          type="button"
          className="orbital-control-button orbital-control-right"
          title={`反時計回り（${stepLabel}）`}
          disabled={disabled}
          onClick={() => onStep(ORBITAL_DIRECTION.YAW_CCW)}
        >
          →
        </button>
        <button
          type="button"
          className="orbital-control-button orbital-control-down"
          title={`見上げ（${stepLabel}）`}
          disabled={disabled}
          onClick={() => onStep(ORBITAL_DIRECTION.PITCH_UP)}
        >
          ↓
        </button>
      </div>
    </div>
  );
}
