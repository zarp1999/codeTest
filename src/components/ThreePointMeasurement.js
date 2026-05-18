import React from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import './ThreePointMeasurement.css';

const THREE_POINT_MEASUREMENT_CONFIG = Object.freeze({
  input: {
    mouseButton: 0,
  },
  groundPick: {
    preferTerrain: true,
  },
  point: {
    radius: 0.2,
    widthSegments: 16,
    heightSegments: 16,
    opacity: 0.95,
    colors: {
      start: 0x4caf50,
      end: 0x2196f3,
      measure: 0xff9800,
    },
  },
  line: {
    radius: 0.06,
    radialSegments: 12,
    opacity: 0.92,
    colors: {
      base: 0x4fc3f7,
      distance: 0xff5252,
      extension: 0xb0bec5,
    },
  },
  label: {
    canvasWidth: 1400,
    canvasHeight: 320,
    offsetY: 0.24,
    font: 'Bold 72px Arial',
    color: '#ffffff',
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    scale: {
      baseDistance: 20,
      baseScale: 2.0,
      minScale: 0.6,
      maxScale: 4.5,
      yRatio: 0.26,
    },
  },
  transformControl: {
    size: 0.9,
  },
  calculation: {
    minBaseLengthSquared: 1e-8,
  },
  pointOrder: ['start', 'end', 'measure'],
  pointTextPrefix: {
    start: '始点(A)',
    end: '終点(B)',
    measure: '計測点(P)',
  },
});

class ThreePointMeasurement {
  constructor(scene, camera, renderer, raycaster, getFloorMesh, getTerrainMesh, orbitControls = null) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.raycaster = raycaster;
    this.getFloorMesh = getFloorMesh;
    this.getTerrainMesh = getTerrainMesh;
    this.orbitControls = orbitControls;

    this.domElement = null;
    this.isActive = false;
    this.onResultUpdate = null;
    this.measurementResult = null;

    this.pointMeshes = { start: null, end: null, measure: null };
    this.pointLabels = {
      start: { sprite: null, texture: null, position: null },
      end: { sprite: null, texture: null, position: null },
      measure: { sprite: null, texture: null, position: null },
    };
    this.pointValues = { start: null, end: null, measure: null };

    this.baseLineMesh = null;
    this.distanceLineMesh = null;
    this.extensionLineMesh = null;

    this.transformControl = null;

    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleTransformDraggingChanged = this.handleTransformDraggingChanged.bind(this);
    this.handleTransformObjectChange = this.handleTransformObjectChange.bind(this);
  }

  updateCamera(camera) {
    this.camera = camera;
    if (this.transformControl) {
      this.transformControl.camera = camera;
    }
  }

  setResultUpdateCallback(callback) {
    this.onResultUpdate = callback;
  }

  enable(domElement) {
    this.domElement = domElement;
    if (domElement?.addEventListener) {
      domElement.addEventListener('mousedown', this.handleMouseDown);
    }
    this.initializeTransformControl();
  }

  disable(domElement = this.domElement) {
    if (domElement?.removeEventListener) {
      domElement.removeEventListener('mousedown', this.handleMouseDown);
    }
    if (this.transformControl) {
      this.transformControl.detach();
      this.transformControl.visible = false;
    }
  }

  setActive(isActive) {
    this.isActive = Boolean(isActive);
    if (!this.isActive) {
      this.clear();
    }
  }

  hasMeasurements() {
    return Boolean(this.pointValues.start || this.pointValues.end || this.pointValues.measure);
  }

  update() {
    this.updateLabelScale();
  }

  initializeTransformControl() {
    if (this.transformControl || !this.renderer?.domElement) return;
    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.size = THREE_POINT_MEASUREMENT_CONFIG.transformControl.size;
    this.transformControl.setMode('translate');
    this.transformControl.showX = true;
    this.transformControl.showY = false;
    this.transformControl.showZ = true;
    this.transformControl.visible = false;
    this.transformControl.enabled = false;
    this.transformControl.addEventListener('dragging-changed', this.handleTransformDraggingChanged);
    this.transformControl.addEventListener('objectChange', this.handleTransformObjectChange);
    this.scene.add(this.transformControl);
  }

  handleTransformDraggingChanged(event) {
    if (this.orbitControls) {
      this.orbitControls.enabled = !event.value;
    }
  }

  handleTransformObjectChange() {
    const target = this.transformControl?.object;
    if (!target) return;

    const lockedY = target.userData?.lockedY;
    if (Number.isFinite(lockedY)) {
      target.position.y = lockedY;
    }

    const pointKey = target.userData?.pointKey;
    if (!pointKey) return;

    this.pointValues[pointKey] = target.position.clone();
    this.updatePointLabel(pointKey);
    this.recalculateMeasurement();
  }

  handleMouseDown(event) {
    if (!this.isActive || event.button !== THREE_POINT_MEASUREMENT_CONFIG.input.mouseButton) return;
    if (!this.domElement || !this.camera || !this.raycaster) return;
    if (!this.domElement.contains(event.target)) return;

    event.preventDefault();
    event.stopPropagation();

    if (this.getDefinedPointCount() === THREE_POINT_MEASUREMENT_CONFIG.pointOrder.length) {
      const hitKey = this.pickPointKey(event);
      if (hitKey) {
        this.attachTransformToPoint(hitKey);
      }
      return;
    }

    const point = this.pickGroundPoint(event);
    if (!point) return;

    const key = THREE_POINT_MEASUREMENT_CONFIG.pointOrder[this.getDefinedPointCount()];
    this.createMeasurementPoint(key, point);

    if (this.getDefinedPointCount() === THREE_POINT_MEASUREMENT_CONFIG.pointOrder.length) {
      this.attachTransformToPoint('measure');
      this.recalculateMeasurement();
    }
  }

  getDefinedPointCount() {
    return THREE_POINT_MEASUREMENT_CONFIG.pointOrder.filter((key) => Boolean(this.pointValues[key])).length;
  }

  pickPointKey(event) {
    const pointMeshes = Object.values(this.pointMeshes).filter(Boolean);
    if (pointMeshes.length === 0) return null;

    const mouse = this.toNdc(event);
    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(pointMeshes, false);
    if (!intersects.length) return null;
    return intersects[0].object.userData?.pointKey || null;
  }

  attachTransformToPoint(pointKey) {
    const mesh = this.pointMeshes[pointKey];
    if (!mesh || !this.transformControl) return;
    this.transformControl.enabled = true;
    this.transformControl.visible = true;
    this.transformControl.attach(mesh);
  }

  pickGroundPoint(event) {
    const terrainMesh = this.getTerrainMesh?.();
    const floorMesh = this.getFloorMesh?.();

    const targets = [];
    if (THREE_POINT_MEASUREMENT_CONFIG.groundPick.preferTerrain) {
      if (terrainMesh?.visible) targets.push(terrainMesh);
      if (floorMesh?.visible) targets.push(floorMesh);
    } else {
      if (floorMesh?.visible) targets.push(floorMesh);
      if (terrainMesh?.visible) targets.push(terrainMesh);
    }
    if (targets.length === 0) return null;

    const mouse = this.toNdc(event);
    this.raycaster.setFromCamera(mouse, this.camera);
    const intersects = this.raycaster.intersectObjects(targets, false);
    if (!intersects.length) return null;
    return intersects[0].point.clone();
  }

  toNdc(event) {
    const rect = this.domElement.getBoundingClientRect();
    return new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
  }

  createMeasurementPoint(pointKey, point) {
    const geometry = new THREE.SphereGeometry(
      THREE_POINT_MEASUREMENT_CONFIG.point.radius,
      THREE_POINT_MEASUREMENT_CONFIG.point.widthSegments,
      THREE_POINT_MEASUREMENT_CONFIG.point.heightSegments
    );
    const material = new THREE.MeshBasicMaterial({
      color: THREE_POINT_MEASUREMENT_CONFIG.point.colors[pointKey],
      depthTest: false,
      transparent: true,
      opacity: THREE_POINT_MEASUREMENT_CONFIG.point.opacity,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(point);
    sphere.userData.pointKey = pointKey;
    sphere.userData.lockedY = point.y;
    this.scene.add(sphere);

    this.pointMeshes[pointKey] = sphere;
    this.pointValues[pointKey] = point.clone();
    this.updatePointLabel(pointKey);
  }

  updatePointLabel(pointKey) {
    const point = this.pointValues[pointKey];
    if (!point) return;

    const canvas = document.createElement('canvas');
    canvas.width = THREE_POINT_MEASUREMENT_CONFIG.label.canvasWidth;
    canvas.height = THREE_POINT_MEASUREMENT_CONFIG.label.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = THREE_POINT_MEASUREMENT_CONFIG.label.shadowColor;
    context.shadowBlur = THREE_POINT_MEASUREMENT_CONFIG.label.shadowBlur;
    context.shadowOffsetX = THREE_POINT_MEASUREMENT_CONFIG.label.shadowOffsetX;
    context.shadowOffsetY = THREE_POINT_MEASUREMENT_CONFIG.label.shadowOffsetY;
    context.fillStyle = THREE_POINT_MEASUREMENT_CONFIG.label.color;
    context.font = THREE_POINT_MEASUREMENT_CONFIG.label.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const prefix = THREE_POINT_MEASUREMENT_CONFIG.pointTextPrefix[pointKey];
    const text = `${prefix}: (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`;
    context.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    const position = point.clone().add(new THREE.Vector3(0, THREE_POINT_MEASUREMENT_CONFIG.label.offsetY, 0));
    sprite.position.copy(position);
    this.scene.add(sprite);

    const old = this.pointLabels[pointKey];
    if (old.sprite) {
      this.scene.remove(old.sprite);
      old.sprite.material?.dispose();
    }
    old.texture?.dispose();

    this.pointLabels[pointKey] = { sprite, texture, position };
  }

  recalculateMeasurement() {
    const start = this.pointValues.start;
    const end = this.pointValues.end;
    const measure = this.pointValues.measure;
    if (!start || !end || !measure) return;

    this.clearLineMeshes();

    const ab = end.clone().sub(start);
    const ap = measure.clone().sub(start);
    const baseLengthSq = ab.lengthSq();

    let closestPoint = start.clone();
    let rawClosestPoint = start.clone();
    let tRaw = 0;
    let isBaseTooShort = false;

    if (baseLengthSq <= THREE_POINT_MEASUREMENT_CONFIG.calculation.minBaseLengthSquared) {
      isBaseTooShort = true;
    } else {
      tRaw = ap.dot(ab) / baseLengthSq;
      const tClamped = THREE.MathUtils.clamp(tRaw, 0, 1);
      closestPoint = start.clone().add(ab.clone().multiplyScalar(tClamped));
      rawClosestPoint = start.clone().add(ab.clone().multiplyScalar(tRaw));
    }

    const isExtended = !isBaseTooShort && (tRaw < 0 || tRaw > 1);
    const projectionPoint = isExtended ? rawClosestPoint : closestPoint;

    const distance = measure.distanceTo(projectionPoint);
    const horizontalDistance = new THREE.Vector2(measure.x, measure.z)
      .distanceTo(new THREE.Vector2(projectionPoint.x, projectionPoint.z));
    const verticalDistance = Math.abs(measure.y - projectionPoint.y);

    this.baseLineMesh = this.createLineMesh(
      start,
      end,
      THREE_POINT_MEASUREMENT_CONFIG.line.colors.base
    );
    this.distanceLineMesh = this.createLineMesh(
      projectionPoint,
      measure,
      THREE_POINT_MEASUREMENT_CONFIG.line.colors.distance
    );

    if (isExtended) {
      // 最近接点が線分外の場合のみ、基準線を最近接点まで延長表示する
      const extensionStart = tRaw < 0 ? start : end;
      this.extensionLineMesh = this.createLineMesh(
        extensionStart,
        projectionPoint,
        THREE_POINT_MEASUREMENT_CONFIG.line.colors.extension
      );
    }

    const result = {
      startPoint: start.clone(),
      endPoint: end.clone(),
      measurePoint: measure.clone(),
      closestPoint: projectionPoint.clone(),
      distance,
      horizontalDistance,
      verticalDistance,
      isExtended,
      isBaseTooShort,
    };

    this.measurementResult = result;
    if (this.onResultUpdate) {
      this.onResultUpdate(result);
    }
  }

  createLineMesh(start, end, color) {
    const direction = end.clone().sub(start);
    const length = direction.length();
    if (length <= 1e-8) return null;

    const geometry = new THREE.CylinderGeometry(
      THREE_POINT_MEASUREMENT_CONFIG.line.radius,
      THREE_POINT_MEASUREMENT_CONFIG.line.radius,
      length,
      THREE_POINT_MEASUREMENT_CONFIG.line.radialSegments
    );
    const material = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: THREE_POINT_MEASUREMENT_CONFIG.line.opacity,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    const midPoint = start.clone().add(end).multiplyScalar(0.5);
    mesh.position.copy(midPoint);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    this.scene.add(mesh);
    return mesh;
  }

  clearLineMeshes() {
    [this.baseLineMesh, this.distanceLineMesh, this.extensionLineMesh].forEach((mesh) => {
      if (!mesh) return;
      this.scene.remove(mesh);
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
    this.baseLineMesh = null;
    this.distanceLineMesh = null;
    this.extensionLineMesh = null;
  }

  updateLabelScale() {
    if (!this.camera) return;

    const scaleConfig = THREE_POINT_MEASUREMENT_CONFIG.label.scale;
    THREE_POINT_MEASUREMENT_CONFIG.pointOrder.forEach((pointKey) => {
      const label = this.pointLabels[pointKey];
      if (!label?.sprite || !label?.position) return;
      const distance = this.camera.position.distanceTo(label.position);
      const scaleX = Math.max(
        scaleConfig.minScale,
        Math.min(scaleConfig.maxScale, (distance / scaleConfig.baseDistance) * scaleConfig.baseScale)
      );
      label.sprite.scale.set(scaleX, scaleX * scaleConfig.yRatio, 1);
    });
  }

  clear() {
    THREE_POINT_MEASUREMENT_CONFIG.pointOrder.forEach((pointKey) => {
      const mesh = this.pointMeshes[pointKey];
      if (mesh) {
        this.scene.remove(mesh);
        mesh.geometry?.dispose();
        mesh.material?.dispose();
      }
      this.pointMeshes[pointKey] = null;
      this.pointValues[pointKey] = null;

      const label = this.pointLabels[pointKey];
      if (label?.sprite) {
        this.scene.remove(label.sprite);
        label.sprite.material?.dispose();
      }
      label?.texture?.dispose();
      this.pointLabels[pointKey] = { sprite: null, texture: null, position: null };
    });

    this.clearLineMeshes();

    if (this.transformControl) {
      this.transformControl.detach();
      this.transformControl.visible = false;
      this.transformControl.enabled = false;
    }

    this.measurementResult = null;
    if (this.onResultUpdate) {
      this.onResultUpdate(null);
    }
  }

  dispose(domElement = this.domElement) {
    this.clear();
    this.disable(domElement);

    if (this.transformControl) {
      this.transformControl.removeEventListener('dragging-changed', this.handleTransformDraggingChanged);
      this.transformControl.removeEventListener('objectChange', this.handleTransformObjectChange);
      this.scene.remove(this.transformControl);
      this.transformControl.dispose?.();
      this.transformControl = null;
    }
  }
}

function ThreePointMeasurementDisplay({ measurementResult }) {
  if (!measurementResult) return null;

  return (
    <div className="three-point-measurement-display">
      <div className="three-point-measurement-title">3点計測結果 (線分AB - 点P)</div>
      <div className="three-point-measurement-row">
        <span className="label">距離:</span>
        <span className="value">{measurementResult.distance.toFixed(3)} m</span>
        <span className="label">水平:</span>
        <span className="value">{measurementResult.horizontalDistance.toFixed(3)} m</span>
        <span className="label">鉛直:</span>
        <span className="value">{measurementResult.verticalDistance.toFixed(3)} m</span>
      </div>
      <div className="three-point-measurement-row">
        <span className="label">最近接点Q:</span>
        <span className="value">
          ({measurementResult.closestPoint.x.toFixed(2)}, {measurementResult.closestPoint.y.toFixed(2)}, {measurementResult.closestPoint.z.toFixed(2)})
        </span>
      </div>
      {measurementResult.isBaseTooShort && (
        <div className="three-point-measurement-note">基準線分ABが短いため、最近接点は始点A基準で計算しています。</div>
      )}
      {!measurementResult.isBaseTooShort && measurementResult.isExtended && (
        <div className="three-point-measurement-note">最近接点が線分ABの外側のため、基準線を最近接点まで延長表示しています。</div>
      )}
    </div>
  );
}

export { ThreePointMeasurement, ThreePointMeasurementDisplay };
