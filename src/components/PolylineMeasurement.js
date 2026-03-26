import * as THREE from 'three';

const POLYLINE_MEASUREMENT_CONFIG = {
  input: {
    mouseButton: 1,
  },
  line: {
    radius: 0.08,
    radialSegments: 12,
    color: 0xff4db8,
    opacity: 0.95,
    renderOrder: 9500,
  },
  label: {
    canvasWidth: 1024,
    canvasHeight: 256,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    color: '#ff4db8',
    font: 'Bold 100px Arial',
    baseScaleX: 2.4,
    baseScaleY: 0.6,
    renderOrder: 9501,
    scale: {
      baseDistance: 20,
      baseScale: 2.4,
      minScale: 0.8,
      maxScale: 6.0,
      yRatio: 0.25,
    },
  },
};

/**
 * 中クリックによる地表面折れ線計測
 * - 1回目: 始点
 * - 2回目以降: 直前点との区間を追加
 * - Escで全クリア（呼び出し側で実行）
 */
class PolylineMeasurement {
  constructor(scene, camera, raycaster, getFloorMesh, getTerrainMesh) {
    this.scene = scene;
    this.camera = camera;
    this.raycaster = raycaster;
    this.getFloorMesh = getFloorMesh;
    this.getTerrainMesh = getTerrainMesh;

    this.domElement = null;
    this.points = [];
    this.segments = []; // { line, sprite, texture, sectionIndex, sectionDistance, cumulativeDistance }
    this.labelMode = 'section'; // 'section' | 'cumulative'

    this.handleMouseDown = this.handleMouseDown.bind(this);
  }

  updateCamera(camera) {
    this.camera = camera;
  }

  update() {
    this.updateLabelScale();
  }

  enable(domElement) {
    if (!domElement?.addEventListener) return;
    this.domElement = domElement;
    domElement.addEventListener('mousedown', this.handleMouseDown);
  }

  disable(domElement = this.domElement) {
    if (!domElement?.removeEventListener) return;
    domElement.removeEventListener('mousedown', this.handleMouseDown);
  }

  hasMeasurements() {
    return this.points.length > 0 || this.segments.length > 0;
  }

  toggleDistanceLabelMode() {
    this.labelMode = this.labelMode === 'section' ? 'cumulative' : 'section';
    this.updateAllLabels();
  }

  handleMouseDown(event) {
    if (event.button !== POLYLINE_MEASUREMENT_CONFIG.input.mouseButton) return; // 中クリックのみ
    if (!this.domElement || !this.domElement.contains(event.target)) return;

    event.preventDefault();
    event.stopPropagation();

    const point = this.pickGroundPoint(event);
    if (!point) return;

    this.addPoint(point);
  }

  pickGroundPoint(event) {
    if (!this.domElement || !this.camera || !this.raycaster) return null;

    const rect = this.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    this.raycaster.setFromCamera(mouse, this.camera);

    const targets = [];
    const terrainMesh = this.getTerrainMesh?.();
    const floorMesh = this.getFloorMesh?.();

    if (terrainMesh?.visible) targets.push(terrainMesh);
    if (floorMesh?.visible) targets.push(floorMesh);
    if (targets.length === 0) return null;

    const intersects = this.raycaster.intersectObjects(targets, false);
    if (!intersects || intersects.length === 0) return null;

    return intersects[0].point.clone();
  }

  addPoint(point) {
    const prevPoint = this.points[this.points.length - 1];
    this.points.push(point.clone());

    if (prevPoint) {
      const sectionIndex = this.points.length - 1;
      this.createSegment(prevPoint, point, sectionIndex);
    }
  }

  createSegment(start, end, sectionIndex) {
    const distance = start.distanceTo(end);
    const midPoint = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    const cumulativeDistance = (this.segments[this.segments.length - 1]?.cumulativeDistance || 0) + distance;

    // LineBasicMaterial の linewidth は環境依存で効かないため、
    // 太さを持つ円柱メッシュで線分を表現する
    const lineGeometry = new THREE.CylinderGeometry(
      POLYLINE_MEASUREMENT_CONFIG.line.radius,
      POLYLINE_MEASUREMENT_CONFIG.line.radius,
      distance,
      POLYLINE_MEASUREMENT_CONFIG.line.radialSegments
    );
    const lineMaterial = new THREE.MeshBasicMaterial({
      color: POLYLINE_MEASUREMENT_CONFIG.line.color,
      transparent: true,
      opacity: POLYLINE_MEASUREMENT_CONFIG.line.opacity,
      depthTest: false,
      depthWrite: false
    });
    const line = new THREE.Mesh(lineGeometry, lineMaterial);
    const direction = new THREE.Vector3().subVectors(end, start).normalize();
    line.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    line.position.copy(midPoint);
    line.renderOrder = POLYLINE_MEASUREMENT_CONFIG.line.renderOrder;
    this.scene.add(line);

    const { sprite, texture } = this.createDistanceLabel(sectionIndex, distance, cumulativeDistance);
    sprite.position.copy(midPoint);
    sprite.renderOrder = POLYLINE_MEASUREMENT_CONFIG.label.renderOrder;
    this.scene.add(sprite);

    this.segments.push({ line, sprite, texture, sectionIndex, sectionDistance: distance, cumulativeDistance });
  }

  formatDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance) {
    if (this.labelMode === 'cumulative') {
      return `(累計${sectionIndex}:${cumulativeDistance.toFixed(3)}[m])`;
    }
    return `(区間${sectionIndex}:${sectionDistance.toFixed(3)}[m])`;
  }

  createDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance) {
    const canvas = document.createElement('canvas');
    canvas.width = POLYLINE_MEASUREMENT_CONFIG.label.canvasWidth;
    canvas.height = POLYLINE_MEASUREMENT_CONFIG.label.canvasHeight;
    const context = canvas.getContext('2d');

    if (!context) {
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
      const sprite = new THREE.Sprite(material);
      sprite.scale.set(
        POLYLINE_MEASUREMENT_CONFIG.label.baseScaleX,
        POLYLINE_MEASUREMENT_CONFIG.label.baseScaleY,
        1
      );
      return { sprite, texture };
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = POLYLINE_MEASUREMENT_CONFIG.label.shadowColor;
    context.shadowBlur = POLYLINE_MEASUREMENT_CONFIG.label.shadowBlur;
    context.shadowOffsetX = POLYLINE_MEASUREMENT_CONFIG.label.shadowOffsetX;
    context.shadowOffsetY = POLYLINE_MEASUREMENT_CONFIG.label.shadowOffsetY;
    context.fillStyle = POLYLINE_MEASUREMENT_CONFIG.label.color;
    context.font = POLYLINE_MEASUREMENT_CONFIG.label.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    const labelText = this.formatDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance);
    context.fillText(labelText, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(
      POLYLINE_MEASUREMENT_CONFIG.label.baseScaleX,
      POLYLINE_MEASUREMENT_CONFIG.label.baseScaleY,
      1
    );
    return { sprite, texture };
  }

  updateAllLabels() {
    this.segments.forEach((segment) => {
      const { sprite, texture, sectionIndex, sectionDistance, cumulativeDistance } = segment;
      if (!sprite) return;
      const { texture: newTexture } = this.createDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance);
      if (sprite.material?.map) {
        sprite.material.map.dispose();
      }
      sprite.material.map = newTexture;
      sprite.material.needsUpdate = true;
      segment.texture = newTexture;
      texture?.dispose();
    });
  }

  updateLabelScale() {
    if (!this.camera || this.segments.length === 0) return;

    const { baseDistance, baseScale, minScale, maxScale, yRatio } =
      POLYLINE_MEASUREMENT_CONFIG.label.scale;

    this.segments.forEach(({ sprite }) => {
      if (!sprite) return;
      const distance = this.camera.position.distanceTo(sprite.position);
      const scaleX = Math.max(minScale, Math.min(maxScale, (distance / baseDistance) * baseScale));
      sprite.scale.set(scaleX, scaleX * yRatio, 1);
    });
  }

  clear() {
    this.points = [];
    this.segments.forEach(({ line, sprite, texture }) => {
      if (line) {
        this.scene.remove(line);
        line.geometry?.dispose();
        line.material?.dispose();
      }
      if (sprite) {
        this.scene.remove(sprite);
        sprite.material?.dispose();
      }
      texture?.dispose();
    });
    this.segments = [];
  }

  dispose(domElement = this.domElement) {
    this.clear();
    this.disable(domElement);
  }
}

export default PolylineMeasurement;
