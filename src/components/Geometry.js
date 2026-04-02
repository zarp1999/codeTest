import * as THREE from 'three';
import SCENE3D_CONFIG from './Scene3DConfig.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
 
// 3Dオブジェクトの作成（shape/color対応）
/**
 * CityJSONオブジェクトからThree.jsメッシュを生成する。
 */
const createCityObjects = (obj,
  shapeTypeMap,
  hideBackground) => {
 
  const geom = obj.geometry?.[0];
  if (!geom) return null;
 
  // shape_type名（無ければ CityJSON の geometry.type）
  const shapeTypeName = shapeTypeMap?.[String(obj.shape_type)] || geom.type;
 
  // ジオメトリ生成
  const geometry = isPipeShape(shapeTypeName, geom) ? createPipeGeometry(geom, obj, shapeTypeName) : createNonePipeGeometry(shapeTypeName, geom, obj);
 
  const material = createMaterial(hideBackground, shapeTypeName);
 
  const mesh = new THREE.Mesh(geometry, material);
 
  // 位置・角度設定
  if (isPipeShape(shapeTypeName, geom)) {
    if (Array.isArray(geom.vertices) && geom.vertices.length >= 2) {
      const radius = getRadius_m(obj, shapeTypeName);
      const [startPoint, endPoint] = getStartEndPoints(geom, obj, radius);
      const direction = endPoint.clone().sub(startPoint).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
      mesh.setRotationFromQuaternion(quaternion);
      mesh.position.copy(startPoint.clone().add(endPoint).multiplyScalar(0.5));
    }
  } else if (shapeTypeName === 'Box') {
    if (Array.isArray(geom.vertices) && geom.vertices.length >= 2) {
      const radius = Number(obj.attributes.height) / 2;
      const [startPoint, endPoint] = getStartEndPoints(geom, obj, radius);
      const direction = endPoint.clone().sub(startPoint).normalize();
      const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), direction);
      mesh.setRotationFromQuaternion(quaternion);
      mesh.position.copy(startPoint.clone().add(endPoint).multiplyScalar(0.5));
    }
  } else if (shapeTypeName === 'Polyhedron' || geom.type === 'Polyhedron') {
    const localCenter = geometry?.userData?.polyhedronLocalCenter;
    if (localCenter) {
      mesh.position.set(localCenter.x, localCenter.y, localCenter.z);
    } else if (geom.vertices && Array.isArray(geom.vertices) && geom.vertices.length > 0) {
      const vertices3D = geom.vertices.map(vertex => {
        const [x, y, z] = vertex;
        return new THREE.Vector3(x, z, -y);
      });
      const boundingBox = new THREE.Box3().setFromPoints(vertices3D);
      const center = boundingBox.getCenter(new THREE.Vector3());
      mesh.position.copy(center);
    } else {
      let center = geom.center || geom.position || geom.start || geom.vertices?.[0] || [0, 0, 0];
      mesh.position.set(center[0], center[2], -center[1]);
    }
  } else {
    let center = geom.center || geom.position || geom.start || geom.vertices?.[0] || [0, 0, 0];
    mesh.position.set(center[0], center[2], -center[1]);
 
    // 回転（デフォルトで水平になるように回転補正
    const baseRot = geom.rotation ? new THREE.Quaternion().fromArray(geom.rotation) : new THREE.Quaternion();
    const rot90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    mesh.quaternion.copy(rot90).multiply(baseRot);
 
  }
 
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // NOTE:
  // mesh.userData.objectData が objectRegistry.originalData 等と参照共有してしまうと、
  // 入力編集(editPipeObject)が「元データ」まで破壊的に書き換えてしまい、
  // 復元が効かない／2回目以降復元できない等の不整合が起きる。
  // そのため、メッシュに持たせる objectData は常にディープコピーとする。
  mesh.userData = { objectData: JSON.parse(JSON.stringify(obj)), originalColor: '#888888' };
  mesh.visible = true;
 
  return mesh;
};
 
// Pipe状か
const isPipeShape = (shapeTypeName, geom) => {
  if (shapeTypeName === 'Cylinder') {
    if (geom.type === 'LineString') {
      return true;
    }
  }
 
  if (shapeTypeName === 'MultiCylinder') {
    return true;
  }
 
  if (shapeTypeName === 'LineString') {
    return true;
  }
  return false;
}
 
// Pipe状か(オブジェクト指定)
export function isPipeObject(obj) {
  if (!obj) {
    return false;
  }
 
  const type = obj.geometry?.[0]?.type;
 
  // Cylinder
  if (obj.shape_type === 16) {
    if (type === 'LineString') {
      return true;
    }
  }
 
  // LineString
  if (obj.shape_type === 3) {
    return true;
  }
 
  // MultiCylinder
  if (obj.shape_type === 24) {
    return true;
  }
 
  // Extrusion
  if (obj.shape_type === 21) {
    return true;
  }
 
  // Box
  if (obj.shape_type === 14) {
    return true;
  }
 
  // Circle
  if (obj.shape_type === 11) {
    return true;
  }
 
  // Polyhedron（管路として編集対象に含める）
  if (obj.shape_type === 25) {
    return true;
  }
 
  return false;
}
 
/**
 * 半径を計算
 */
const getRadius_m = (obj, shapeTypeName) => {
  let radius_m = 0.05;
  const geom = obj.geometry?.[0];
  if (isPipeShape(shapeTypeName, geom)) {
    // 属性に半径・直径が定義されていれば、半径 => 直径の順に優先する
    let radiusRaw = null;
    if (obj.attributes?.radius != null) {
      radiusRaw = Number(obj.attributes.radius);
    } else if (obj.attributes?.diameter != null) {
      radiusRaw = Number(obj.attributes.diameter) / 2;
    }
 
    if (Number.isFinite(radiusRaw) && radiusRaw > 0) {
      // 5を超える値はmmとみなしてmへ換算。それ以下はmとして扱う。
      radius_m = radiusRaw > 5 ? radiusRaw / 1000 : radiusRaw;
    }
  }
  return radius_m;
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
    // depthは「地表から下向き正」。常に同じ規則でワールドYへ変換する。
    // これにより、depthを減算したとき（浅くしたとき）は必ず上方向へ移動する。
    const startCenterY = -(startDepth + radius);
    const endCenterY = -(endDepth + radius);
    return [
      new THREE.Vector3(start[0], startCenterY, -start[1]),
      new THREE.Vector3(end[0], endCenterY, -end[1])
    ];
  }
  return [
    new THREE.Vector3(start[0], start[2] + radius, -start[1]),
    new THREE.Vector3(end[0], end[2] + radius, -end[1])
  ];
}
 
//2D形状か
const is2dShape = (shapeTypeName) => {
  if (shapeTypeName === 'Circle') {
    return true;
  }
  if (shapeTypeName === 'Arc') {
    return true;
  }
  if (shapeTypeName === 'Polygon') {
    return true;
  }
  if (shapeTypeName === 'Polyhedron') {
    return true;
  }
  return false;
}
 
/**
 * マテリアル生成
 * MeshStandardMaterialを使用し、roughnessを最大に設定して反射を減らし、角が目立ちにくくする
 */
const createMaterial = (hideBackground, shapeTypeName) => {
  const colorHex = '#888888';
  const opacity = 1;
  const materials = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.0,  // 金属性を0に（非金属）
    roughness: 1.0,  // 粗さを最大に（マットな見た目、反射を減らして角が目立ちにくくする）
    transparent: opacity < 1,
    opacity,
  });

  if (is2dShape(shapeTypeName)) {
    materials.side = THREE.DoubleSide
  }
  return materials;
}
 
/**
 * Pipe状のgeometry生成
 */
const createPipeGeometry = (geom, obj, shapeTypeName) => {
  if (!Array.isArray(geom.vertices) || geom.vertices.length < 2) {
    return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
  const radius_m = getRadius_m(obj, shapeTypeName);
  const [startPoint, endPoint] = getStartEndPoints(geom, obj, radius_m);
  const height = startPoint.distanceTo(endPoint);
  return new THREE.CylinderGeometry(
    radius_m,
    radius_m,
    height,
    SCENE3D_CONFIG.geometry.cylinderSegments
  );
}
 
/**
 * Pipe状以外のgeometry生成
 */
const createNonePipeGeometry = (shapeTypeName, geom, obj) => {
  switch (shapeTypeName) {
    // 点
    case 'Point':
    case 'MultiPoint':
      return new THREE.SphereGeometry(geom.radius || 0.2, 16, 16);
 
    // 円
    case 'Circle':
      return new THREE.CircleGeometry(geom.radius || 0.5, 32, 32);
 
    // 球
    case 'Sphere':
      return new THREE.SphereGeometry(geom.radius || 0.5, 32, 32);
 
    // 直方体
    case 'Box':
    case 'Rectangle':
    case 'Cube': {
      let w, h, d;
      if (Array.isArray(geom.vertices) && geom.vertices.length >= 2) {
        // attributesからwidthとheightを取得
        w = obj.attributes?.width ? Number(obj.attributes.width) : 1;
        h = obj.attributes?.height ? Number(obj.attributes.height) : 1;
 
        // 深さ（奥行き）を計算
        // NOTE:
        // - Boxのvertices[2]はデータによってcm（例: 100）で来ることがあり、そのまま距離計算すると
        //   端点深さ編集で「異常に長い直方体」になってしまう。
        // - Boxの回転/配置は getStartEndPoints(= start_point_depth/end_point_depth を /100 したm座標) を使っているため、
        //   奥行きも同じ基準（Three.jsワールド座標）で算出する。
        const radius = (Number.isFinite(h) ? h : 1) / 2;
        const [startPoint, endPoint] = getStartEndPoints(geom, obj, radius);
        d = startPoint.distanceTo(endPoint);
      } else {
        w = geom.width || obj.attributes?.width || geom.size || 1;
        h = geom.height || obj.attributes?.height || geom.size || 1;
        d = geom.depth || obj.attributes?.depth || geom.size || 1;
      }
      return new THREE.BoxGeometry(w, h, d);
    }
 
    // 円弧
    case 'Arc': {
      const startAngle = Math.PI * geom.startAngle / 180;
      const endAngle = Math.PI * geom.endAngle / 180;
 
      return new THREE.RingGeometry(geom.innerRadius, geom.outerRadius, 32, 1, startAngle, (endAngle - startAngle));
    }
 
    // スプライン曲線
    case 'Spline': {
      // 制御点をTHREE.Vector3に変換
      const points = geom.vertices.map(v => new THREE.Vector3(v[0], v[2], -v[1]));
      const curve = new THREE.CatmullRomCurve3(points);
      return new THREE.TubeGeometry(curve, 32, geom.radius, 8, false);
    }
 
    // 多角形
    case 'Polygon': {
      const shape = toShape(geom.vertices2D);
      return new THREE.ShapeGeometry(shape);
    }
 
    // 押し出し
    case 'Extrusion': {
      const shape = toShape(geom.vertices2D);
      // const pathPoints = geom.extrudePath.map(v => new THREE.Vector3(v[0], v[2], -v[1]));
      const pathPoints = geom.extrudePath.map(v => new THREE.Vector3(v[0], v[1], v[2]));
      const extrudePath = new THREE.CatmullRomCurve3(pathPoints);
 
      const excludeOptions = {
        bevelEnabled: false,
        steps: geom.pathSteps || 100,
        extrudePath: extrudePath,
      };
      return new THREE.ExtrudeGeometry(shape, excludeOptions);
    }
    case 'Cone':
      return new THREE.ConeGeometry(geom.base_radius || 0.5, 1, 32);
    case 'Torus':
      return new THREE.TorusGeometry(geom.major_radius || 0.6, geom.minor_radius || 0.2, 16, 100);
    case 'Polyhedron': {
      let geometry;
      if (!geom.vertices || !Array.isArray(geom.vertices) || geom.vertices.length < 4) {
        // 頂点が不足している場合は簡易表示
        return new THREE.BoxGeometry(0.5, 0.5, 0.5);
      }
 
      // boundariesは使わず、頂点群の凸包（QuickHull相当）
      const vertices3D = geom.vertices.map(vertex => {
        const [x, y, z] = vertex;
        return new THREE.Vector3(x, z, -y);
      });
 
      const boundingBox = new THREE.Box3().setFromPoints(vertices3D);
      const center = boundingBox.getCenter(new THREE.Vector3());
      // 頂点をローカル化してから mesh.position に中心を持たせる
      // （ワールド座標の二重適用を防ぐ）
      const localVertices3D = vertices3D.map(v => v.clone().sub(center));

      geometry = new ConvexGeometry(localVertices3D);
      geometry.userData = {
        ...(geometry.userData || {}),
        polyhedronLocalCenter: center.clone()
      };
      geometry.computeVertexNormals();
      return geometry;
    }
    default:
      return new THREE.BoxGeometry(0.5, 0.5, 0.5);
  }
}
 
const toShape = (vertices2D) => {
  const shape = new THREE.Shape();
  if (!Array.isArray(vertices2D) || vertices2D.length < 3) {
    // 断面情報欠損時のフォールバック（描画不能を回避）
    shape.moveTo(0, 0);
    shape.lineTo(0.05, 0);
    shape.lineTo(0, 0.05);
    shape.closePath();
    return shape;
  }
  vertices2D.forEach((v, i) => {
    if (i === 0) {
      shape.moveTo(v[0], v[1]);
    } else {
      shape.lineTo(v[0], v[1]);
    }
  });
  shape.closePath();
  return shape;
}
 
export default createCityObjects;