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
    canvasHeight: 384,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    color: '#ff4db8',
    font: 'Bold 100px Arial',
    baseScaleX: 2.4,
    baseScaleY: 0.8,
    renderOrder: 9501,
    scale: {
      baseDistance: 20,
      baseScale: 2.4,
      minScale: 0.8,
      maxScale: 6.0,
      yRatio: 0.34,
    },
  },
  pointLabel: {
    canvasWidth: 1024,
    canvasHeight: 256,
    shadowColor: 'rgba(0, 0, 0, 0.9)',
    shadowBlur: 10,
    shadowOffsetX: 2,
    shadowOffsetY: 2,
    color: '#ffd166',
    font: 'Bold 84px Arial',
    baseScaleX: 2.0,
    baseScaleY: 0.45,
    yOffset: 0.2,
    renderOrder: 9502,
    scale: {
      baseDistance: 20,
      baseScale: 2.0,
      minScale: 0.7,
      maxScale: 5.0,
      yRatio: 0.22,
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
    this.segments = []; // { line, sprite, texture, sectionIndex, sectionDistance, cumulativeDistance, horizontalDistance, verticalDistance }
    this.pointLabels = []; // { sprite, texture, position }
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
    this.createPointCoordinateLabel(point);

    if (prevPoint) {
      const sectionIndex = this.points.length - 1;
      this.createSegment(prevPoint, point, sectionIndex);
    }
  }

  createPointCoordinateLabel(point) {
    const { pointLabel } = POLYLINE_MEASUREMENT_CONFIG;
    const canvas = document.createElement('canvas');
    canvas.width = pointLabel.canvasWidth;
    canvas.height = pointLabel.canvasHeight;
    const context = canvas.getContext('2d');

    if (!context) return;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.shadowColor = pointLabel.shadowColor;
    context.shadowBlur = pointLabel.shadowBlur;
    context.shadowOffsetX = pointLabel.shadowOffsetX;
    context.shadowOffsetY = pointLabel.shadowOffsetY;
    context.fillStyle = pointLabel.color;
    context.font = pointLabel.font;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(
      `(${point.x.toFixed(2)}, ${point.y.toFixed(2)}, ${point.z.toFixed(2)})`,
      canvas.width / 2,
      canvas.height / 2
    );

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(pointLabel.baseScaleX, pointLabel.baseScaleY, 1);
    sprite.position.copy(point.clone().add(new THREE.Vector3(0, pointLabel.yOffset, 0)));
    sprite.renderOrder = pointLabel.renderOrder;
    this.scene.add(sprite);

    this.pointLabels.push({
      sprite,
      texture,
      position: sprite.position.clone()
    });
  }

  createSegment(start, end, sectionIndex) {
    const distance = start.distanceTo(end);
    const horizontalDistance = new THREE.Vector2(start.x, start.z).distanceTo(new THREE.Vector2(end.x, end.z));
    const verticalDistance = Math.abs(end.y - start.y);
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

    const { sprite, texture } = this.createDistanceLabel(
      sectionIndex,
      distance,
      cumulativeDistance,
      horizontalDistance,
      verticalDistance
    );
    sprite.position.copy(midPoint);
    sprite.renderOrder = POLYLINE_MEASUREMENT_CONFIG.label.renderOrder;
    this.scene.add(sprite);

    this.segments.push({
      line,
      sprite,
      texture,
      sectionIndex,
      sectionDistance: distance,
      cumulativeDistance,
      horizontalDistance,
      verticalDistance
    });
  }

  formatDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance) {
    if (this.labelMode === 'cumulative') {
      return `(累計${sectionIndex}:${cumulativeDistance.toFixed(3)}[m])`;
    }
    return `(区間${sectionIndex}:${sectionDistance.toFixed(3)}[m])`;
  }

  createDistanceLabel(sectionIndex, sectionDistance, cumulativeDistance, horizontalDistance = null, verticalDistance = null) {
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
      sprite.userData.hasHorizontalVertical = horizontalDistance !== null && verticalDistance !== null;
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
    const hasHorizontalVertical = horizontalDistance !== null && verticalDistance !== null;

    if (hasHorizontalVertical) {
      const lineHeight = 120;
      const startY = canvas.height / 2 - lineHeight;
      context.fillText(labelText, canvas.width / 2, startY);
      context.font = 'Bold 88px Arial';
      context.fillText(`水平: ${horizontalDistance.toFixed(3)}[m]`, canvas.width / 2, startY + lineHeight);
      context.fillText(`鉛直: ${verticalDistance.toFixed(3)}[m]`, canvas.width / 2, startY + lineHeight * 2);
    } else {
      context.fillText(labelText, canvas.width / 2, canvas.height / 2);
    }

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
    sprite.userData.hasHorizontalVertical = hasHorizontalVertical;
    return { sprite, texture };
  }

  updateAllLabels() {
    this.segments.forEach((segment) => {
      const {
        sprite,
        texture,
        sectionIndex,
        sectionDistance,
        cumulativeDistance,
        horizontalDistance,
        verticalDistance
      } = segment;
      if (!sprite) return;
      const { texture: newTexture } = this.createDistanceLabel(
        sectionIndex,
        sectionDistance,
        cumulativeDistance,
        horizontalDistance,
        verticalDistance
      );
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
    if (!this.camera) return;

    const { baseDistance, baseScale, minScale, maxScale, yRatio } =
      POLYLINE_MEASUREMENT_CONFIG.label.scale;

    this.segments.forEach(({ sprite }) => {
      if (!sprite) return;
      const distance = this.camera.position.distanceTo(sprite.position);
      const scaleX = Math.max(minScale, Math.min(maxScale, (distance / baseDistance) * baseScale));
      sprite.scale.set(scaleX, scaleX * yRatio, 1);
    });

    const pointScale = POLYLINE_MEASUREMENT_CONFIG.pointLabel.scale;
    this.pointLabels.forEach(({ sprite, position }) => {
      if (!sprite || !position) return;
      const distance = this.camera.position.distanceTo(position);
      const scaleX = Math.max(
        pointScale.minScale,
        Math.min(pointScale.maxScale, (distance / pointScale.baseDistance) * pointScale.baseScale)
      );
      sprite.scale.set(scaleX, scaleX * pointScale.yRatio, 1);
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

    this.pointLabels.forEach(({ sprite, texture }) => {
      if (sprite) {
        this.scene.remove(sprite);
        sprite.material?.dispose();
      }
      texture?.dispose();
    });
    this.pointLabels = [];
  }

  dispose(domElement = this.domElement) {
    this.clear();
    this.disable(domElement);
  }
}

export default PolylineMeasurement;
