import React from 'react';
import * as THREE from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import './ThreePointMeasurement.css';

// 3点計測機能の見た目・挙動を一元管理する設定
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
      closest: 0xe91e63,
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
  closestPointLabel: {
    canvasWidth: 1200,
    canvasHeight: 300,
    offsetY: 0.42,
    font: 'Bold 74px Arial',
    color: '#ffb3d9',
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    scale: {
      baseDistance: 20,
      baseScale: 2.0,
      minScale: 0.7,
      maxScale: 5.0,
      yRatio: 0.26,
    },
  },
  closestDistanceLabel: {
    canvasWidth: 1200,
    canvasHeight: 420,
    offsetY: 0.2,
    color: '#ffffff',
    titleFont: 'Bold 86px Arial',
    valueFont: 'Bold 78px Arial',
    lineHeight: 120,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    scale: {
      baseDistance: 20,
      baseScale: 2.0,
      minScale: 0.7,
      maxScale: 5.0,
      yRatio: 0.34,
    },
  },
  transformControl: {
    size: 0.9,
    // HUDの軸定義（東=+X、北=-Z）とTransformControlsの表示方向を合わせる。
    // X軸は維持しつつZ軸だけ反転させるため、編集対象のローカル空間をX軸180度回転させる。
    localAxisRotation: new THREE.Euler(Math.PI, 0, 0),
  },
  terrainHeightSnap: {
    raycastMargin: 1000,
    defaultRaycastHeight: 10000,
  },
  calculation: {
    minBaseLengthSquared: 1e-8,
  },
  // pointOrder は「ユーザーがクリックで定義する入力点のみ」を並べる。
  // 最近接点Qは派生点（計算結果）なのでここには含めない。
  pointOrder: ['start', 'end', 'measure'],
  pointTextPrefix: {
    start: '始点(A)',
    end: '終点(B)',
    measure: '計測点(P)',
  },
});

/**
 * 地表面上の3点（A始点 / B終点 / P計測点）から、
 * 線分ABと点Pの距離を計測する独立コンポーネント。
 */
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
    this.isTerrainHeightSnapAllowed = false;
    this.canSnapToTerrainHeight = false;
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
    this.closestPointMesh = null;
    this.closestPointLabel = { sprite: null, texture: null, position: null };
    this.closestDistanceLabel = { sprite: null, texture: null, position: null };

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

  setTerrainHeightSnapAllowed(isAllowed) {
    this.isTerrainHeightSnapAllowed = Boolean(isAllowed);
    this.syncTerrainHeightSnapState();
  }

  hasMeasurements() {
    return Boolean(this.pointValues.start || this.pointValues.end || this.pointValues.measure);
  }

  update() {
    this.syncTerrainHeightSnapState();
    this.updateLabelScale();
  }

  syncTerrainHeightSnapState() {
    const terrainMesh = this.getTerrainMesh?.();
    const nextCanSnapToTerrainHeight = this.isTerrainHeightSnapAllowed && Boolean(terrainMesh?.visible);

    if (this.canSnapToTerrainHeight === nextCanSnapToTerrainHeight) return;
    this.canSnapToTerrainHeight = nextCanSnapToTerrainHeight;

    if (this.transformControl) {
      // elevationでもYハンドルは出さず、X/Z移動後に地表高へ自動追従させる。
      this.transformControl.showY = false;
    }

    // 地表高追従を無効化する時は、現在位置を新しい固定高さとして扱う。
    THREE_POINT_MEASUREMENT_CONFIG.pointOrder.forEach((pointKey) => {
      const mesh = this.pointMeshes[pointKey];
      if (mesh) {
        mesh.userData.lockedY = mesh.position.y;
      }
    });
  }

  initializeTransformControl() {
    if (this.transformControl || !this.renderer?.domElement) return;
    this.transformControl = new TransformControls(this.camera, this.renderer.domElement);
    this.transformControl.size = THREE_POINT_MEASUREMENT_CONFIG.transformControl.size;
    this.transformControl.setMode('translate');
    this.transformControl.setSpace('local');
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

    // 通常画面ではY固定。elevation画面かつ地形が有効な時は、X/Z移動に合わせてYを地表高へ更新する。
    const lockedY = target.userData?.lockedY;
    if (this.canSnapToTerrainHeight) {
      const terrainY = this.getTerrainHeightAtXZ(target.position.x, target.position.z);
      if (Number.isFinite(terrainY)) {
        target.position.y = terrainY;
        target.userData.lockedY = terrainY;
      } else if (Number.isFinite(lockedY)) {
        target.position.y = lockedY;
      }
    } else if (Number.isFinite(lockedY)) {
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

    // 3点確定後は追加せず、既存点クリックで編集ハンドルを付け替える
    if (this.getDefinedPointCount() === THREE_POINT_MEASUREMENT_CONFIG.pointOrder.length) {
      const hitKey = this.pickPointKey(event);
      if (hitKey) {
        this.attachTransformToPoint(hitKey);
      }
      return;
    }

    const point = this.pickGroundPoint(event);
    if (!point) return;

    // 未定義の次の点（start -> end -> measure）の順で配置する
    const key = THREE_POINT_MEASUREMENT_CONFIG.pointOrder[this.getDefinedPointCount()];
    this.createMeasurementPoint(key, point);

    if (this.getDefinedPointCount() === THREE_POINT_MEASUREMENT_CONFIG.pointOrder.length) {
      // 3点そろった直後は計測点(P)を編集対象にして作業しやすくする
      this.attachTransformToPoint('measure');
      this.recalculateMeasurement();
    }
  }

  getDefinedPointCount() {
    // 入力点の定義進行を判定する用途（A/B/Pの3点のみ）
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

  getTerrainHeightAtXZ(x, z) {
    const terrainMesh = this.getTerrainMesh?.();
    if (!terrainMesh?.visible) return null;

    terrainMesh.updateWorldMatrix?.(true, false);
    const box = new THREE.Box3().setFromObject(terrainMesh);
    const { raycastMargin, defaultRaycastHeight } = THREE_POINT_MEASUREMENT_CONFIG.terrainHeightSnap;
    const originY = Number.isFinite(box.max.y) ? box.max.y + raycastMargin : defaultRaycastHeight;
    const far = Number.isFinite(box.max.y) && Number.isFinite(box.min.y)
      ? Math.max(raycastMargin * 2, box.max.y - box.min.y + raycastMargin * 2)
      : defaultRaycastHeight * 2;

    this.raycaster.set(
      new THREE.Vector3(x, originY, z),
      new THREE.Vector3(0, -1, 0)
    );
    this.raycaster.far = far;
    const intersects = this.raycaster.intersectObject(terrainMesh, false);
    this.raycaster.far = Infinity;

    return intersects.length > 0 ? intersects[0].point.y : null;
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
    sphere.rotation.copy(THREE_POINT_MEASUREMENT_CONFIG.transformControl.localAxisRotation);
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

    // ベクトル投影で、点Pから線分ABへの最近接点Qを算出する
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

    // tRawが[0,1]の外に出る場合、最近接点は線分外（延長線上）になる
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
    // 最近接点Qは入力点ではなく、毎回再計算して描画し直す派生点。
    this.updateClosestPointMesh(projectionPoint);
    this.updateClosestPointCoordinateLabel(projectionPoint);
    // 最近接線(Q-P)の中点に、最近接/水平/鉛直距離を表示する。
    this.updateClosestDistanceLabel(projectionPoint, measure, distance, horizontalDistance, verticalDistance);

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

  updateClosestPointMesh(point) {
    // 派生点Qは都度更新されるため、毎回作り直して古いメッシュを破棄する。
    if (this.closestPointMesh) {
      this.scene.remove(this.closestPointMesh);
      this.closestPointMesh.geometry?.dispose();
      this.closestPointMesh.material?.dispose();
      this.closestPointMesh = null;
    }

    const geometry = new THREE.SphereGeometry(
      THREE_POINT_MEASUREMENT_CONFIG.point.radius,
      THREE_POINT_MEASUREMENT_CONFIG.point.widthSegments,
      THREE_POINT_MEASUREMENT_CONFIG.point.heightSegments
    );
    const material = new THREE.MeshBasicMaterial({
      color: THREE_POINT_MEASUREMENT_CONFIG.point.colors.closest,
      depthTest: false,
      transparent: true,
      opacity: THREE_POINT_MEASUREMENT_CONFIG.point.opacity,
    });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(point);
    this.scene.add(sphere);
    this.closestPointMesh = sphere;
  }

  updateClosestPointCoordinateLabel(point) {
    // 最近接点Qの座標ラベル。Qの位置に追従して毎回更新する。
    const config = THREE_POINT_MEASUREMENT_CONFIG.closestPointLabel;
    const canvas = document.createElement('canvas');
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = config.shadowColor;
    context.shadowBlur = config.shadowBlur;
    context.shadowOffsetX = config.shadowOffsetX;
    context.shadowOffsetY = config.shadowOffsetY;
    context.fillStyle = config.color;
    context.font = config.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      `最近接点(Q): (${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`,
      canvas.width / 2,
      canvas.height / 2
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);
    const position = point.clone().add(new THREE.Vector3(0, config.offsetY, 0));
    sprite.position.copy(position);
    this.scene.add(sprite);

    if (this.closestPointLabel.sprite) {
      this.scene.remove(this.closestPointLabel.sprite);
      this.closestPointLabel.sprite.material?.dispose();
    }
    this.closestPointLabel.texture?.dispose();
    this.closestPointLabel = {
      sprite,
      texture,
      position,
    };
  }

  updateClosestDistanceLabel(startPoint, endPoint, distance, horizontalDistance, verticalDistance) {
    // 距離ラベルは最近接線(Q-P)の中点へ配置し、線と値の対応を視覚的に明確化する。
    const config = THREE_POINT_MEASUREMENT_CONFIG.closestDistanceLabel;
    const canvas = document.createElement('canvas');
    canvas.width = config.canvasWidth;
    canvas.height = config.canvasHeight;
    const context = canvas.getContext('2d');
    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = config.shadowColor;
    context.shadowBlur = config.shadowBlur;
    context.shadowOffsetX = config.shadowOffsetX;
    context.shadowOffsetY = config.shadowOffsetY;
    context.fillStyle = config.color;
    context.textAlign = 'center';
    context.textBaseline = 'middle';

    const startY = canvas.height / 2 - config.lineHeight;
    context.font = config.titleFont;
    context.fillText(`最近接: ${distance.toFixed(3)} m`, canvas.width / 2, startY);
    context.font = config.valueFont;
    context.fillText(`水平: ${horizontalDistance.toFixed(3)} m`, canvas.width / 2, startY + config.lineHeight);
    context.fillText(`鉛直: ${verticalDistance.toFixed(3)} m`, canvas.width / 2, startY + config.lineHeight * 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(material);

    const midpoint = startPoint.clone().add(endPoint).multiplyScalar(0.5);
    midpoint.y += config.offsetY;
    sprite.position.copy(midpoint);
    this.scene.add(sprite);

    if (this.closestDistanceLabel.sprite) {
      this.scene.remove(this.closestDistanceLabel.sprite);
      this.closestDistanceLabel.sprite.material?.dispose();
    }
    this.closestDistanceLabel.texture?.dispose();
    this.closestDistanceLabel = {
      sprite,
      texture,
      position: midpoint.clone(),
    };
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

    const closestDistanceLabelConfig = THREE_POINT_MEASUREMENT_CONFIG.closestDistanceLabel.scale;
    const closestLabel = this.closestDistanceLabel;
    if (closestLabel?.sprite && closestLabel?.position) {
      const distance = this.camera.position.distanceTo(closestLabel.position);
      const scaleX = Math.max(
        closestDistanceLabelConfig.minScale,
        Math.min(
          closestDistanceLabelConfig.maxScale,
          (distance / closestDistanceLabelConfig.baseDistance) * closestDistanceLabelConfig.baseScale
        )
      );
      closestLabel.sprite.scale.set(scaleX, scaleX * closestDistanceLabelConfig.yRatio, 1);
    }

    const closestPointLabelConfig = THREE_POINT_MEASUREMENT_CONFIG.closestPointLabel.scale;
    const closestPointLabel = this.closestPointLabel;
    if (closestPointLabel?.sprite && closestPointLabel?.position) {
      const distance = this.camera.position.distanceTo(closestPointLabel.position);
      const scaleX = Math.max(
        closestPointLabelConfig.minScale,
        Math.min(
          closestPointLabelConfig.maxScale,
          (distance / closestPointLabelConfig.baseDistance) * closestPointLabelConfig.baseScale
        )
      );
      closestPointLabel.sprite.scale.set(scaleX, scaleX * closestPointLabelConfig.yRatio, 1);
    }
  }

  clear() {
    // 点・ラベル・線・結果コールバックをまとめて初期状態へ戻す
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
    if (this.closestPointMesh) {
      this.scene.remove(this.closestPointMesh);
      this.closestPointMesh.geometry?.dispose();
      this.closestPointMesh.material?.dispose();
      this.closestPointMesh = null;
    }
    if (this.closestDistanceLabel.sprite) {
      this.scene.remove(this.closestDistanceLabel.sprite);
      this.closestDistanceLabel.sprite.material?.dispose();
    }
    this.closestDistanceLabel.texture?.dispose();
    this.closestDistanceLabel = { sprite: null, texture: null, position: null };
    if (this.closestPointLabel.sprite) {
      this.scene.remove(this.closestPointLabel.sprite);
      this.closestPointLabel.sprite.material?.dispose();
    }
    this.closestPointLabel.texture?.dispose();
    this.closestPointLabel = { sprite: null, texture: null, position: null };

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
