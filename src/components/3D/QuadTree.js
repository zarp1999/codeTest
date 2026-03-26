import * as THREE from 'three';
import SCENE3D_CONFIG from './Scene3DConfig.js';
import {isPipeObject} from './Geometry.js';
 
// Node生成
/**
 * CityJSONオブジェクトからNode配列を生成する。
 */
const createQuadTreeNodes = ( obj,
                            shapeTypeMap ) => {
 
  const geom = obj.geometry?.[0];
  if (!geom) return null;
 
  // shape_type名（無ければ CityJSON の geometry.type）
  const shapeTypeName = shapeTypeMap?.[String(obj.shape_type)] || geom.type;
 
  // ノード生成
  const nodes = isPipeShape(shapeTypeName, geom) ? createPipeNodes(geom, obj, shapeTypeName) : createNonePipeNodes(geom, obj, shapeTypeName);
 
  return nodes;
}
 
// Pipe状か
const isPipeShape = (shapeTypeName, geom) => {
  if( shapeTypeName === 'Cylinder' ){
    if( geom.type === 'LineString'){
      return true;
    }
  }
 
  if ( shapeTypeName === 'MultiCylinder' ){
    return true;
  }
 
  if( shapeTypeName === 'LineString' ){
    return true;
  }
 
  return false;
}
 
/**
 * 半径を計算
 */
const getRadius = (obj, shapeTypeName) => {
  let radius = 0;
  const geom = obj.geometry?.[0];
  if (isPipeShape(shapeTypeName, geom)) {
    // 属性に半径・直径が定義されていれば、半径 => 直径の順に優先する
    if (obj.attributes?.radius != null) {
      radius = Number(obj.attributes.radius);
    } else if (obj.attributes?.diameter != null) {
      radius = Number(obj.attributes.diameter) / 2;
    }
    if (radius > 5) radius /= 1000;
  }
  return Number.isFinite(radius) && radius > 0 ? radius : 0.05;
}
 
/**
 * 始点・終点座標を取得
 */
const getStartEndPoints = (geom, obj, radius) => {
  const start = geom.vertices[0];
  const end = geom.vertices[geom.vertices.length - 1];
  const hasDepthAttrs = obj.attributes?.start_point_depth != null &&
                        obj.attributes?.end_point_depth != null &&
                        Number.isFinite(Number(obj.attributes.start_point_depth)) &&
                        Number.isFinite(Number(obj.attributes.end_point_depth));
 
  if (hasDepthAttrs) {
    const startDepth = Number(obj.attributes.start_point_depth / 100);
    const endDepth = Number(obj.attributes.end_point_depth / 100);
    const startCenterY = startDepth > 0 ? -(startDepth + radius) : startDepth;
    const endCenterY = endDepth > 0 ? -(endDepth + radius) : endDepth;
    return [
      new THREE.Vector3(start[0], startCenterY, start[1]),
      new THREE.Vector3(end[0], endCenterY, end[1])
    ];
  }
  return [
    new THREE.Vector3(start[0], start[2] + radius, start[1]),
    new THREE.Vector3(end[0], end[2] + radius, end[1])
  ];
}
 
/**
 * Pipe状のNode生成
 */
const createPipeNodes = (geom, obj, shapeTypeName) => {
  if (!Array.isArray(geom.vertices) || geom.vertices.length < 2) {
    return null;
  }
  const radius = getRadius(obj, shapeTypeName);
  const [startPoint, endPoint] = getStartEndPoints(geom, obj, radius);
  const node = {
    start: { x: startPoint.x, z: startPoint.z },
    end: { x: endPoint.x, z: endPoint.z },
    width: radius * 2
  };
  return [node];
}
 
/**
 * Pipe状以外のNode生成
 */
const createNonePipeNodes = (geom, obj, shapeTypeName) => {
  // return null;
 
  switch (shapeTypeName) {
    // 点
    case 'Point':
    case 'MultiPoint':
      return null;
 
    // 円,球
    case 'Circle':
    case 'Sphere':
      return null;
   
    // 直方体
    case 'Box':
    case 'Rectangle':
    case 'Cube': {
      if (!Array.isArray(geom.vertices) || geom.vertices.length === 0) {
        // registerQuadTreeはNode配列前提のため、Geometryは返さない
        return null;
      }
      const bounds = computeVertexBounds2D(geom.vertices);
      if (!bounds) {
        return null;
      }
      return createAabbStripeNodes(bounds);
    }

    // ポリヘドロン
    case 'Polyhedron': {
      if (!Array.isArray(geom.vertices) || geom.vertices.length === 0) {
        return null;
      }
      const bounds = computeVertexBounds2D(geom.vertices);
      if (!bounds) {
        return null;
      }
      // PolyhedronもBox同様に、XZ-AABBを覆うノードで登録する
      return createAabbStripeNodes(bounds);
    }
 
    // 円弧
    case 'Arc': {
      const startAngle = Math.PI * geom.startAngle / 180;
      const endAngle = Math.PI * geom.endAngle / 180;
 
      return new THREE.RingGeometry( geom.innerRadius, geom.outerRadius, 32, 1, startAngle, (endAngle - startAngle));
    }
 
    // スプライン曲線
    case 'Spline': {      
      // 制御点をTHREE.Vector3に変換
      const points = geom.vertices.map(v => new THREE.Vector3(v[0], v[1], -v[2]));
      const nodes = createLineNodes(points, 0.01);
      return nodes;
    }
 
    // 多角形
    case 'Polygon': {  
      //const shape = toShape( geom.vertices2D );
      return null;
    }
 
    // 押し出し
    case 'Extrusion': {  
      // const shape = toShape( geom.vertices2D );
      const pathPoints = geom.extrudePath.map(v => new THREE.Vector3(v[0], v[1], -v[2]));
      const extrudePath = new THREE.CatmullRomCurve3(pathPoints);
      const maxSize = getMaxSize( geom.vertices2D );
 
      const nodes = createLineNodes(pathPoints, maxSize.distance);
      // console.log('nodes: ', nodes);
      return nodes;
    }
    case 'Cone':
      return null;
    case 'Torus':
      return null;
    default:
      return null;
  }
}

function computeVertexBounds2D(vertices) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < vertices.length; i++) {
    const v = vertices[i];
    if (!Array.isArray(v) || v.length < 2) {
      continue;
    }
    const x = Number(v[0]);
    const z = Number(v[1]);
    if (!Number.isFinite(x) || !Number.isFinite(z)) {
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }

  if (!Number.isFinite(minX) || !Number.isFinite(minZ) || !Number.isFinite(maxX) || !Number.isFinite(maxZ)) {
    return null;
  }
  return { minX, minZ, maxX, maxZ };
}

function createAabbStripeNodes(bounds, minWidth = 0.05) {
  const spanX = Math.max(0, bounds.maxX - bounds.minX);
  const spanZ = Math.max(0, bounds.maxZ - bounds.minZ);
  if (spanX < 1e-8 && spanZ < 1e-8) {
    return null;
  }

  if (spanX >= spanZ) {
    const centerZ = (bounds.minZ + bounds.maxZ) / 2;
    return [{
      start: { x: bounds.minX, z: centerZ },
      end: { x: bounds.maxX, z: centerZ },
      width: Math.max(spanZ, minWidth)
    }];
  }

  const centerX = (bounds.minX + bounds.maxX) / 2;
  return [{
    start: { x: centerX, z: bounds.minZ },
    end: { x: centerX, z: bounds.maxZ },
    width: Math.max(spanX, minWidth)
  }];
}
 
function getMaxSize(points) {
  let maxDist = 0;
  let pointA = null;
  let pointB = null;
 
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i][0] - points[j][0];
      const dy = points[i][1] - points[j][1];
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) {
        maxDist = dist;
        pointA = points[i];
        pointB = points[j];
      }
    }
  }
 
  return {
    distance: maxDist,
    point1: pointA,
    point2: pointB
  };
}
 
function createLineNodes(points, width) {
  const nodes = [];
 
  for (let i = 0; i < points.length - 1; i++) {
    const startVec = points[i];
    const endVec = points[i + 1];
 
    // startとendの座標をオブジェクトに
    const start = { x: startVec.x, y: -startVec.y };
    const end = { x: endVec.x, y: -endVec.y };
 
    nodes.push({ start: start, end: end, width: width });
  }
 
  return nodes;
}
 
function computeAABB(points) {
  if (points.length === 0) {
    // 空配列の場合は null または適切な値を返す
    return null;
  }
 
  // 初期値に最初の点を設定
  const min = points[0].clone();
  const max = points[0].clone();
 
  // すべての点を走査
  for (let i = 1; i < points.length; i++) {
    min.x = Math.min(min.x, points[i].x);
    min.y = Math.min(min.y, points[i].y);
    min.z = Math.min(min.z, points[i].z);
 
    max.x = Math.max(max.x, points[i].x);
    max.y = Math.max(max.y, points[i].y);
    max.z = Math.max(max.z, points[i].z);
  }
 
  // THREE.Box3を作成
  const box = new THREE.Box3(min, max);
  return box;
}
 
export class QuadtreeNode {
  constructor(boundary, depth=0, maxDepth=8, maxObjects=10) {
    this.boundary = boundary; // {min: {x,y}, max: {x,y}}
    this.children = []; // 4つの子ノード
    this.objects = []; // このノードに格納される矩形
    this.hasObject = false; // 矩形が存在するか
    this.depth = depth;
    this.maxDepth = maxDepth;
    this.maxObjects = maxObjects;
  }
 
  // 矩形を追加
  insert(rect) {
    const rectBox = rect.getBoundingBox();
 
    // このノードの境界と矩形のAABBの重なり判定
    if (!this.intersects(this.boundary, rectBox)) {
      return false; // このノードには属さない
    }
 
    // 子ノードがあれば、子に登録
    if (this.children.length > 0) {
      // 完全に収まる子が1つだけある場合のみ、その子に登録。
      // 複数子にまたがる矩形は親ノードに保持して重複登録を防ぐ。
      const childIndex = this.getContainingChildIndex(rectBox);
      if (childIndex >= 0) {
        this.children[childIndex].insert(rect);
      } else {
        this.objects.push(rect);
      }
      this.hasObject = true;
      return true;
    }
 
    // 子に分割していない場合
    // まず、矩形をこのノードに登録
    this.objects.push(rect);
    this.hasObject = true;
 
    // 分割条件
    if (this.objects.length > this.maxObjects && this.depth < this.maxDepth) {
      this.subdivide();
 
      // 既存の矩形も子に再登録
      const oldObjects = this.objects;
      this.objects = [];
      for (let obj of oldObjects) {
        const objBox = obj.getBoundingBox();
        const childIndex = this.getContainingChildIndex(objBox);
        if (childIndex >= 0) {
          this.children[childIndex].insert(obj);
        } else {
          this.objects.push(obj);
        }
      }
    }
    return true;
  }
 
  // 領域の分割
  subdivide() {
    const {min, max} = this.boundary;
    const midX = (min.x + max.x) / 2;
    const midY = (min.y + max.y) / 2;
 
    // 4つの子ノードの境界
    this.children.push(new QuadtreeNode({min: {x: min.x, y: min.y}, max: {x: midX, y: midY}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNode({min: {x: midX, y: min.y}, max: {x: max.x, y: midY}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNode({min: {x: min.x, y: midY}, max: {x: midX, y: max.y}}, this.depth+1, this.maxDepth, this.maxObjects));
    this.children.push(new QuadtreeNode({min: {x: midX, y: midY}, max: {x: max.x, y: max.y}}, this.depth+1, this.maxDepth, this.maxObjects));
  }
 
  // 領域と矩形の交差判定（AABB）
  intersects(a, b) {
    return !(a.max.x < b.min.x || a.min.x > b.max.x || a.max.y < b.min.y || a.min.y > b.max.y);
  }

  // b が a に完全包含されるか
  contains(a, b) {
    return (
      a.min.x <= b.min.x &&
      a.max.x >= b.max.x &&
      a.min.y <= b.min.y &&
      a.max.y >= b.max.y
    );
  }

  // 完全包含する子ノードのindex。なければ -1
  getContainingChildIndex(box) {
    for (let i = 0; i < this.children.length; i++) {
      if (this.contains(this.children[i].boundary, box)) {
        return i;
      }
    }
    return -1;
  }
}
 
export class Rectangle {
  constructor(id, p1, p2, w) {
    this.id = id; // 一意の識別子
    this.p1 = p1; // {x, y}
    this.p2 = p2; // {x, y}
    this.w = w;   // 矩形の幅
  }
 
  getBoundingBox() {
    const xs = [this.p1.x, this.p2.x];
    const ys = [this.p1.y, this.p2.y];
    return {
      min: {x: Math.min(...xs), y: Math.min(...ys)},
      max: {x: Math.max(...xs), y: Math.max(...ys)}
    };
  }
 
  getVertices() {
    // 長辺の方向を計算
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const length = Math.hypot(dx, dy);
    const ux = dx / length;
    const uy = dy / length;
 
    // 垂直方向の単位ベクトル
    const vx = -uy;
    const vy = ux;
 
    const halfW = this.w / 2;
 
    // 4つの角点
    const p1a = { x: this.p1.x + vx * halfW, y: this.p1.y + vy * halfW };
    const p1b = { x: this.p1.x - vx * halfW, y: this.p1.y - vy * halfW };
    const p2a = { x: this.p2.x + vx * halfW, y: this.p2.y + vy * halfW };
    const p2b = { x: this.p2.x - vx * halfW, y: this.p2.y - vy * halfW };
    return [p1a, p1b, p2a, p2b];
  }
 
  getRhoRange(theta) {
    const vertices = this.getVertices();
    const rhos = vertices.map(p => p.x * Math.cos(theta) + p.y * Math.sin(theta));
    return { min: Math.min(...rhos), max: Math.max(...rhos) };
  }
}
 
export default createQuadTreeNodes;