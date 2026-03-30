import * as THREE from 'three';

export const ATTRIBUTE_LABEL_CONFIG = Object.freeze({
  canvasWidth: 1400,
  canvasHeight: 256,
  color: 'white',
  font: 'Bold 96px Arial',
  shadow: {
    color: 'rgba(0, 0, 0, 0.95)',
    blur: 12,
    offsetX: 3,
    offsetY: 3
  },
  spriteScale: { x: 3.2, y: 0.62, z: 1 },
  overlap: {
    boxWidthPx: 320,
    boxHeightPx: 44,
    paddingXPx: 24,
    paddingYPx: 12,
    minOffsetPx: 10,
    stepPx: 18,
    maxSteps: 7,
    maxSearchSteps: 24,
    groupThresholdPx: 240
  }
});

export function formatPipeAttributeLabel(objectData) {
  const attrs = objectData?.attributes || {};
  const pipeKind = attrs.pipe_kind ?? '-';
  const material = attrs.material ?? '-';

  let diameterMm = null;
  if (attrs.diameter != null && Number.isFinite(Number(attrs.diameter))) {
    diameterMm = Number(attrs.diameter);
  } else if (attrs.radius != null && Number.isFinite(Number(attrs.radius))) {
    diameterMm = Number(attrs.radius) * 2;
  }

  // 既存規約に合わせて、値が小さい場合はm由来とみなしてmm換算
  if (diameterMm != null && diameterMm <= 5) {
    diameterMm = diameterMm * 1000;
  }
  const diameterText = diameterMm != null ? `${Math.round(diameterMm)}mm` : '-';

  return `(${pipeKind} ${material} ${diameterText})`;
}

export function createTextLabelSprite(text, config = ATTRIBUTE_LABEL_CONFIG, renderOrder = 9999) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const { canvasWidth, canvasHeight, color, font, shadow, spriteScale } = config;
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;

  context.clearRect(0, 0, canvas.width, canvas.height);
  context.shadowColor = shadow.color;
  context.shadowBlur = shadow.blur;
  context.shadowOffsetX = shadow.offsetX;
  context.shadowOffsetY = shadow.offsetY;
  context.fillStyle = color;
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(String(text), canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    depthTest: false,
    depthWrite: false,
    transparent: true
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(spriteScale.x, spriteScale.y, spriteScale.z);
  sprite.renderOrder = renderOrder;
  return sprite;
}

export function resolveAttributeLabelOverlaps({
  camera,
  entries,
  config = ATTRIBUTE_LABEL_CONFIG,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight
}) {
  if (!camera || !entries || entries.length === 0) {
    return;
  }

  const width = Math.max(viewportWidth || 1, 1);
  const height = Math.max(viewportHeight || 1, 1);
  const {
    boxWidthPx: minBoxWidthPx,
    boxHeightPx: minBoxHeightPx,
    paddingXPx = 0,
    paddingYPx = 0,
    minOffsetPx,
    stepPx,
    maxSteps,
    maxSearchSteps = maxSteps,
    groupThresholdPx
  } = config.overlap;

  const items = entries
    .map((entry) => {
      if (!entry?.sprite || !entry?.anchorPosition) return null;
      const projected = entry.anchorPosition.clone().project(camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
        return null;
      }
      if (projected.z < -1 || projected.z > 1) {
        entry.sprite.position.copy(entry.anchorPosition);
        return null;
      }
      const sx = (projected.x * 0.5 + 0.5) * width;
      const sy = (-projected.y * 0.5 + 0.5) * height;
      const worldPerPixel = getWorldUnitsPerPixelAt(camera, entry.anchorPosition, height);
      const safeWorldPerPixel = Math.max(worldPerPixel, 1e-6);
      const projectedLabelWidthPx = Math.abs(entry.sprite.scale.x) / safeWorldPerPixel;
      const projectedLabelHeightPx = Math.abs(entry.sprite.scale.y) / safeWorldPerPixel;
      const boxWidthPx = Math.max(minBoxWidthPx, projectedLabelWidthPx + paddingXPx);
      const boxHeightPx = Math.max(minBoxHeightPx, projectedLabelHeightPx + paddingYPx);
      return { entry, sx, sy, worldPerPixel: safeWorldPerPixel, boxWidthPx, boxHeightPx };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (Math.abs(a.sx - b.sx) < groupThresholdPx) return a.sy - b.sy;
      return a.sx - b.sx;
    });

  const placedRects = [];
  for (const item of items) {
    const verticalStepPx = Math.max(stepPx, item.boxHeightPx * 0.7);
    const maxStepCount = Math.max(maxSteps, maxSearchSteps);
    let step = 0;
    let rect = getOverlapRect(item.sx, item.sy + (step * verticalStepPx), item.boxWidthPx, item.boxHeightPx);
    while (step < maxStepCount && isOverlappingAnyRect(rect, placedRects)) {
      step += 1;
      rect = getOverlapRect(item.sx, item.sy + (step * verticalStepPx), item.boxWidthPx, item.boxHeightPx);
    }
    placedRects.push(rect);

    const totalOffsetPx = minOffsetPx + (step * verticalStepPx);
    const worldOffset = camera.up.clone().normalize().multiplyScalar(-totalOffsetPx * item.worldPerPixel);
    item.entry.sprite.position.copy(item.entry.anchorPosition.clone().add(worldOffset));
  }
}

function getOverlapRect(screenX, screenY, widthPx, heightPx) {
  return {
    left: screenX - widthPx / 2,
    right: screenX + widthPx / 2,
    top: screenY - heightPx / 2,
    bottom: screenY + heightPx / 2
  };
}

function isOverlappingAnyRect(rect, placedRects) {
  return placedRects.some((other) => {
    const noOverlap =
      rect.right < other.left ||
      rect.left > other.right ||
      rect.bottom < other.top ||
      rect.top > other.bottom;
    return !noOverlap;
  });
}

function getWorldUnitsPerPixelAt(camera, worldPosition, viewportHeight) {
  if (camera.isOrthographicCamera) {
    const worldHeight = (camera.top - camera.bottom) / Math.max(camera.zoom || 1, 1e-6);
    return worldHeight / viewportHeight;
  }
  const distance = camera.position.distanceTo(worldPosition);
  const fovRad = THREE.MathUtils.degToRad(camera.fov || 50);
  const visibleHeight = 2 * Math.tan(fovRad / 2) * Math.max(distance, 1e-6);
  return visibleHeight / viewportHeight;
}
