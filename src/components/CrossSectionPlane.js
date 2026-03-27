import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { CSG } from 'three-csg-ts';
import SceneObjectRegistry from './3D/SceneObjectRegistry';
import { Triangle, QuadtreeNodeTriangle } from './3D/QuadTreeTriangle.js';

const CROSS_SECTION_CONFIG = Object.freeze({
  /**
   * グリッド線（東西方向の水平線）描画設定。
   */
  grid: {
    /** グリッド線の基本色 */
    baseColor: 0x888888,
    /** グリッドを描画する最下層の深さ[m] */
    maxDepth: -50,
    /** グリッド線の縦方向間隔[m] */
    depthStep: 1,
    /** 中心から描画する水平線の長さ[m] */
    lineLength: 1000,
    /** 深さラベルを表示する間隔[m] */
    labelInterval: 10,
    /** ライン幅の設定（通常・ハイライト） */
    lineWidth: {
      default: 2,
      highlight: 5,
    },
    /** ラインの不透明度設定（通常・ハイライト） */
    opacity: {
      default: 0.6,
      highlight: 1.0,
    },
  },
  /**
   * 深さラベルの描画設定。
   */
  label: {
    /** ラベル用キャンバスの幅/高さ */
    canvasWidth: 1024,
    canvasHeight: 256,
    /** ラベル文字の塗りつぶし色 */
    color: 'white',
    /** ラベル文字のフォント設定 */
    font: 'Bold 120px Arial',
    /** ラベルに付与するシャドウ効果 */
    shadow: {
      color: 'rgba(0, 0, 0, 0.9)',
      blur: 12,
      offsetX: 3,
      offsetY: 3,
    },
    spriteScale: { x: 2, y: 0.5, z: 1 },
    renderOrder: 9999,
    /** ラベル表示位置のXオフセット（通常／断面回転時） */
    offsets: {
      default: -5,
      rotated: 0,
    },
  },
  attributeLabel: {
    canvasWidth: 1400,
    canvasHeight: 256,
    color: 'white',
    font: 'Bold 96px Arial',
    shadow: {
      color: 'rgba(0, 0, 0, 0.95)',
      blur: 12,
      offsetX: 3,
      offsetY: 3,
    },
    spriteScale: { x: 3.2, y: 0.62, z: 1 },
    overlap: {
      boxWidthPx: 220,
      boxHeightPx: 28,
      stepPx: 18,
      maxSteps: 7,
      groupThresholdPx: 240
    }
  },
  /**
   * 管路交差位置に描画する縦線設定。
   */
  verticalLine: {
    lineWidth: 3,
    opacity: 0.8,
  },
  /**
   * CSGで使用する断面平面のサイズ設定。
   */
  plane: {
    size: 1000,
    thickness: 0.01,
  },
  radius: {
    threshold: 1e-5,
    scale: 1000,
  },
});

/**
 * 断面平面コンポーネント
 * - 管路をクリックして各管路の深さ位置に水平線を表示
 * - CSGを使用して垂直面で切断した断面を表示
 */
class CrossSectionPlane {
  constructor(scene, camera, objectsRef, terrainVisible = true, mode = 'normal', verticalLineBaseY = {}) {
    this.scene = scene;
    this.camera = camera;
    this.objectsRef = objectsRef;

    // 描画オブジェクト
    this.depthLines = []; // 各管路の深さ位置の水平線
    this.gridLines = []; // -50mまで描画するグリッド線（水平線）のみ
    this.gridDepthLabels = []; // グリッド線に付随する深さテキストのみ
    this.crossSections = []; // 管路の断面（切り口）
    this.depthLabels = []; // 深さラベル
    this.depthLabelPositions = []; // 深さラベルの位置（スケール調整用）

    // 切り口の表示状態（デフォルトは非表示）
    this.showCrossSections = false;
    // グリッド線（水平線）の表示状態
    this.showGridLines = true;
    // 深さガイド（グリッド線・ラベル・縦線）の表示状態
    this.showDepthGuides = true;

    // 断面描画情報を一時的に保存する配列
    this.pendingCrossSections = []; // {center, radius, axisDirection, color, pipeObject, crossSectionZ}
    this.pendingVerticalLines = []; // {key, pipePosition, basePoint, color, fallbackTopY, attributeLabelText}
    this.attributeLabelEntries = []; // {sprite, anchorPosition}

    // 最後に生成した断面の「中心点」（4キー等で参照する用途）
    this.currentPlaneCenter = null;

    // グリッド線の角度（度、デフォルト: 0）
    this.gridAngle = 0;
    this.clampedGridAngle = 0;
    this.currentAxisDirection = new THREE.Vector3(1, 0, 0);
    this.currentPlaneNormal = new THREE.Vector3(1, 0, 0);
    this.currentGridDirection = new THREE.Vector3(0, 0, 1);
    this.autoModeEnabled = false;
    this.shouldAlignToAxis = false;
    this.dragGridDirection = null;

    // 地表と断面の交線
    this.line = null;
    // 地表の頂点
    // this.terrainVertices = [];
    // 地表の三角形（四分木）
    this.terrainTriangles = null;

    this.CrossSectionTerrainLineNum = 0;
    this.dbgNodeAxisLineNum = 0;
    this.dbgTerrainPolygonLineNum = 0;

    // 地表の表示状態
    this.terrainVisible = terrainVisible;
    
    // モード（'normal' または 'elevation'）
    this.mode = mode;
    this.verticalLineBaseY = verticalLineBaseY || {};
  }

  setMode(mode) {
    this.mode = mode || 'normal';
  }

  setVerticalLineBaseYConfig(verticalLineBaseY) {
    this.verticalLineBaseY = verticalLineBaseY || {};
  }

  getVerticalLineBaseY(configKey, fallback = 0) {
    const value = Number(this.verticalLineBaseY?.[configKey]);
    return Number.isFinite(value) ? value : fallback;
  }

  /**
   * CSG/交点計算が「ほぼ接する」状態で空になるのを避けるため、平面位置を法線方向に少しずらして再試行する。
   * @param {number} thickness - 断面平面（BoxGeometry）の厚み
   * @param {number} diag - 対象メッシュのAABB対角長（目安）
   * @returns {number} - 推奨ナッジ量[m]
   */
  getPlaneNudgeAmount(thickness, diag) {
    const safeThickness = Number.isFinite(thickness) ? thickness : 0.01;
    const safeDiag = Number.isFinite(diag) ? diag : 0;
    // 厚み基準 + スケール基準のうち大きい方を採用（過剰に動かさないよう上限も設定）
    return Math.min(0.05, Math.max(safeThickness * 5, safeDiag * 1e-4, 1e-3));
  }

  /**
   * 指定平面で交点が取れない場合に、平面を法線方向へ±εずらして交点を探す
   * @param {THREE.Object3D} obj
   * @param {THREE.Vector3} planeNormalUnit - 単位法線
   * @param {THREE.Vector3} planePoint - 基準点
   * @param {number} epsHit - 距離判定eps
   * @param {number} nudge - 平面スライド量
   * @returns {{points: THREE.Vector3[], usedPlanePoint: THREE.Vector3}}
   */
  getMeshPlaneIntersectionsWorldWithNudges(obj, planeNormalUnit, planePoint, epsHit, nudge) {
    const offsets = [0, nudge, -nudge, 2 * nudge, -2 * nudge];
    for (const offset of offsets) {
      const p = planePoint.clone().add(planeNormalUnit.clone().multiplyScalar(offset));
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(planeNormalUnit, p);
      const points = this.getMeshPlaneIntersectionsWorld(obj, plane, epsHit);
      if (points && points.length > 0) {
        return { points, usedPlanePoint: p };
      }
    }
    return { points: [], usedPlanePoint: planePoint.clone() };
  }

  /**
   * 線分と平面の交差点（および共面に近い端点）を収集する
   * @param {THREE.Vector3} p1
   * @param {THREE.Vector3} p2
   * @param {THREE.Plane} plane
   * @param {number} eps
   * @param {THREE.Vector3[]} out
   */
  collectSegmentPlaneHits(p1, p2, plane, eps, out) {
    const d1 = plane.distanceToPoint(p1);
    const d2 = plane.distanceToPoint(p2);

    const aOn = Math.abs(d1) <= eps;
    const bOn = Math.abs(d2) <= eps;

    // 共面（線分が平面上）: 端点を採用（後段で近い点を選ぶ）
    if (aOn && bOn) {
      out.push(p1.clone(), p2.clone());
      return;
    }

    // 端点が平面上（もしくはほぼ平面上）
    if (aOn) out.push(p1.clone());
    if (bOn) out.push(p2.clone());

    // 符号が異なる（または片方が0） -> 交差
    if (d1 * d2 < 0) {
      const denom = (d1 - d2);
      if (Math.abs(denom) > 1e-12) {
        const t = d1 / (d1 - d2); // p = p1 + (p2-p1)*t
        if (t >= -1e-6 && t <= 1.000001) {
          out.push(p1.clone().lerp(p2, t));
        }
      }
    }
  }

  /**
   * メッシュ（BufferGeometry）の三角形エッジと平面の交差点を収集（ワールド座標）
   * @param {THREE.Object3D} obj
   * @param {THREE.Plane} plane
   * @param {number} eps
   * @returns {THREE.Vector3[]}
   */
  getMeshPlaneIntersectionsWorld(obj, plane, eps = 1e-6) {
    if (!obj || !obj.geometry || !obj.geometry.attributes?.position) {
      return [];
    }

    obj.updateMatrixWorld(true);

    // 実メッシュの頂点を使う（objectData.geometry.vertices/boundaries に依存しない）
    let geom = obj.geometry;
    if (geom.index) {
      geom = geom.toNonIndexed();
    }

    const pos = geom.attributes.position;
    const hits = [];

    // 三角形ごとにエッジを評価（重複は後段で「近い点を選ぶ」ので許容）
    for (let i = 0; i < pos.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(obj.matrixWorld);
      const c = new THREE.Vector3().fromBufferAttribute(pos, i + 2).applyMatrix4(obj.matrixWorld);

      this.collectSegmentPlaneHits(a, b, plane, eps, hits);
      this.collectSegmentPlaneHits(b, c, plane, eps, hits);
      this.collectSegmentPlaneHits(c, a, plane, eps, hits);
    }

    return hits;
  }

  /**
   * 地形データが利用可能かどうか
   * @param {THREE.BufferGeometry|null} geo
   * @returns {boolean}
   */
  hasTerrainData(geo) {
    if (!geo || !geo.boundingBox || !geo.boundingBox.max) {
      return false;
    }
    if (!Number.isFinite(geo.boundingBox.max.y)) {
      return false;
    }
    if (Array.isArray(this.terrainTriangles)) {
      return this.terrainTriangles.length > 0;
    }
    return !!(this.terrainTriangles && this.terrainTriangles.hasObject === true);
  }

  setCamera(camera) {
    this.camera = camera;
  }

  /**
   * 地表の表示状態を設定
   * @param {boolean} visible - 地表の表示状態
   */
  setTerrainVisible(visible) {
    this.terrainVisible = visible;
  }

  /**
   * 現在の断面平面の法線ベクトルを取得
   * @returns {THREE.Vector3}
   */
  getCurrentPlaneNormal() {
    return this.currentPlaneNormal ? this.currentPlaneNormal.clone() : new THREE.Vector3(0, 0, 1);
  }

  /**
   * 現在の断面平面の中心点を取得
   * @returns {THREE.Vector3|null}
   */
  getCurrentPlaneCenter() {
    return this.currentPlaneCenter ? this.currentPlaneCenter.clone() : null;
  }

  /**
   * 断面と縦線の対応付け用キーを生成
   * @param {THREE.Object3D} pipeObject
   * @param {number} crossSectionZ
   * @returns {string}
   */
  getCrossSectionKey(pipeObject, crossSectionZ) {
    const id = pipeObject?.id ?? pipeObject?.uuid ?? 'unknown';
    return `${id}_${crossSectionZ}`;
  }

  /**
   * 管路をクリックして断面を生成
   * @param {THREE.Object3D} pipeObject - クリックされた管路オブジェクト
   * @param {THREE.Vector3} clickPoint - クリックした位置の3D座標
   * @param {SceneObjectRegistry} reg - 登録済みオブジェクトの管理
   * @param {THREE.PlaneGeometry} geometry - 地表
   * @param {number} gridAngle - グリッド線の方向を変える角度（度、デフォルト: 0）
   * @param {boolean} autoModeEnabled - 自動生成モードかどうか（デフォルト: false）
   * @param {THREE.Vector3|null} dragGridDirection - ドラッグ由来のグリッド方向（任意）
   */
  createCrossSection(pipeObject, clickPoint, reg, geometry = null, gridAngle = 0, autoModeEnabled = false, dragGridDirection = null) {
    // objectReqistry
    console.log('req:', reg);

    // 生成前に既存の地表と断面の交線をクリア
    this.clearCrossSectionTerrainLine();

    // 生成前に既存の表示を全クリア
    this.clear();

    this.pendingCrossSections = [];
    this.pendingVerticalLines = [];
    const providedAngle = Number.isFinite(gridAngle) ? gridAngle : 0;
    const normalizedAngle = this.normalizeAngle360(providedAngle);
    this.gridAngle = providedAngle; // 入力値そのもの（UI表示用）
    this.clampedGridAngle = normalizedAngle;
    this.autoModeEnabled = autoModeEnabled;
    this.shouldAlignToAxis = false;
    if (dragGridDirection && dragGridDirection.lengthSq() > 1e-8) {
      this.dragGridDirection = new THREE.Vector3(dragGridDirection.x, 0, dragGridDirection.z).normalize();
    } else {
      this.dragGridDirection = null;
    }

    if (!pipeObject || !pipeObject.userData || !pipeObject.userData.objectData) {
      return;
    }

    if (geometry) {
      // triangles,verticesを取得
      // if (!this.terrainVertices || !this.terrainTriangles || (this.terrainVertices.length === 0) || !(this.terrainTriangles.length === 0)) {
      if (!this.terrainTriangles || !this.terrainTriangles.hasObject) {
        let minX = 0;
        let minY = 0;
        let minZ = 0;
        let maxX = 0;
        let maxY = 0;
        let maxZ = 0;
        const positionAttr = geometry.attributes.position;
        const indexAttr = geometry.index;
        const vertices = [];
        for (let i = 0; i < positionAttr.count; i++) {
          const point = new THREE.Vector3().fromBufferAttribute(positionAttr, i);
          vertices.push(point);
          // 初期値に最初の点を設定
          if (i == 0) {
            minX = point.x;
            minY = point.y
            minZ = point.z;
            maxX = point.x;
            maxY = point.y;
            maxZ = point.z;
          } else {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            minZ = Math.min(minZ, point.z);
            maxX = Math.max(maxY, point.x);
            maxY = Math.max(maxY, point.y);
            maxZ = Math.max(maxZ, point.z);
          }
        }
        let minBox = new THREE.Vector3(minX, minY, minZ);
        let maxBox = new THREE.Vector3(maxX, maxY, maxZ);

        const box = new THREE.Box3(minBox, maxBox);

        const factor = 2;

        //1. 中心点を取得
        const center = box.getCenter(new THREE.Vector3());

        //2. サイズ（辺の長さ）を取得
        const boxSize = new THREE.Vector3();
        box.getSize(boxSize); // boxSize.x, boxSize.y, boxSize.z

        //3. 新しいサイズを計算（2倍）
        const newSize = boxSize.multiplyScalar(factor);

        //4. 新しいminとmaxを計算
        const halfSize = newSize.multiplyScalar(0.5); // 中心からの半分のサイズ

        const boxMin = new THREE.Vector3(
          center.x - halfSize.x,
          center.y - halfSize.y,
          center.z - halfSize.z
        );
        const boxMax = new THREE.Vector3(
          center.x + halfSize.x,
          center.y + halfSize.y,
          center.z + halfSize.z
        );

        //5. 新しいBox3を作る
        const enlargedBox = new THREE.Box3(boxMin, boxMax);

        const triangles = [];
        for (let i = 0; i < indexAttr.count; i += 3) {
          const aIdx = indexAttr.getX(i);
          const bIdx = indexAttr.getX(i + 1);
          const cIdx = indexAttr.getX(i + 2);
          triangles.push([vertices[aIdx], vertices[bIdx], vertices[cIdx]]);
        }

        const maxDepth = 5;
        const maxObjects = 1000;
        this.rootQuadTreeTriangle(enlargedBox, maxDepth, maxObjects);
        // データを四分木に登録
        this.registerQuadTreeTriangle(triangles);
      }
    }

    // クリックした管路を基準に断面生成フローを開始
    this.drawClickedPipeCrossSection(pipeObject, clickPoint, reg, geometry);
  }

  /**
   * クリックした管路に東西方向の線を描画
   * 線の位置は断面平面と管路中心線の交点を通り、縦線は管路の最も高い位置まで描画
   * @param {THREE.Object3D} pipeObject - クリックされた管路オブジェクト
   * @param {THREE.Vector3} clickPoint - クリックした位置の3D座標（Z座標から断面平面を定義）
   * @param {SceneObjectRegistry} reg - 登録済みオブジェクトの管理
   * @param {THREE.PlaneGeometry} geo - 地表
   */
  drawClickedPipeCrossSection(pipeObject, clickPoint, reg, geo = null) {
    // クリック対象の管路情報を取得
    const objectData = pipeObject.userData.objectData;
    if (this.shouldSkipVerticalAndCrossSection(objectData)) {
      return;
    }
    const geometry = objectData.geometry?.[0];
    const shapeTypeName = objectData.shapeTypeName || geometry.type;
    const radius = this.getPipeRadius(objectData);
    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, 0);
    let polyhedronClickProjection = null;

    if (geometry.type === "ExtrudeGeometry") {
      if (!geometry || !geometry.extrudePath || geometry.extrudePath.length < 2) {
        return;
      } else {
        // DBG:　パスを端点にしてみる
        // geometry.vertices = geometry.extrudePath;
        // DBG:　パス上の点で、クリック座標に最短距離の点を含む線分の２端点を求める
        const pathPoints = this.convPoints(geometry.extrudePath);
        const closestSegment = this.getClosestStartEnd(pathPoints, clickPoint);
        start.x = closestSegment.start.x;
        start.y = closestSegment.start.y;
        start.z = closestSegment.start.z;
        end.x = closestSegment.end.x;
        end.y = closestSegment.end.y;
        end.z = closestSegment.end.z;
      }
    } else if (
      shapeTypeName === 'Polyhedron' ||
      geometry.type === 'Polyhedron' ||
      objectData?.shape_type === 14
    ) {

      pipeObject.updateMatrixWorld(true);

      const boundingBox = new THREE.Box3().setFromObject(pipeObject);
      if (!Number.isFinite(boundingBox.min.x) || !Number.isFinite(boundingBox.max.x)) {
        return;
      }

      const size = new THREE.Vector3();
      boundingBox.getSize(size);

      // 最も長い軸方向を決定
      let maxAxis = 'x';
      let maxLength = size.x;
      if (size.y > maxLength) {
        maxAxis = 'y';
        maxLength = size.y;
      }
      if (size.z > maxLength) {
        maxAxis = 'z';
        maxLength = size.z;
      }

      // 軸方向のベクトルを計算
      const axisDirection = new THREE.Vector3(
        maxAxis === 'x' ? 1 : 0,
        maxAxis === 'y' ? 1 : 0,
        maxAxis === 'z' ? 1 : 0
      );

      // 境界ボックスの中心を通る主軸方向の直線に、クリック位置を投影
      const center = boundingBox.getCenter(new THREE.Vector3());
      const clickToCenter = clickPoint.clone().sub(center);
      const distanceAlongAxis = clickToCenter.dot(axisDirection);
      // 投影点を計算（境界ボックスの中心を通る主軸方向の直線上）
      polyhedronClickProjection = center.clone().add(axisDirection.clone().multiplyScalar(distanceAlongAxis));

      // 投影点を中心として、主軸方向に沿った線分を設定
      const halfLength = maxLength / 2;
      start.copy(polyhedronClickProjection).sub(axisDirection.clone().multiplyScalar(halfLength));
      end.copy(polyhedronClickProjection).add(axisDirection.clone().multiplyScalar(halfLength));
    } else {
      if (!geometry || !geometry.vertices || geometry.vertices.length < 2) {
        return;
      } else {
        const vertices = geometry.vertices;
        const { start: startP, end: endP } = this.getPipeStartEnd(vertices[0], vertices[vertices.length - 1], objectData, radius);
        start.x = startP.x;
        start.y = startP.y;
        start.z = startP.z;
        end.x = endP.x;
        end.y = endP.y;
        end.z = endP.z;
      }
    }

    const direction = new THREE.Vector3().subVectors(end, start);
    const pipeLength = direction.length();
    const axisDirection = pipeLength > 1e-6
      ? direction.clone().normalize()
      : new THREE.Vector3(1, 0, 0); // 管路の軸方向
    if (this.autoModeEnabled) {
      this.shouldAlignToAxis = false;
      if (this.dragGridDirection && this.dragGridDirection.lengthSq() > 1e-8) {
        this.currentAxisDirection = axisDirection.clone();
        this.currentGridDirection.copy(this.dragGridDirection);
        const fallbackNormal = this.getPerpendicularVector(axisDirection);
        this.currentPlaneNormal = this.getVerticalPlaneNormalFromGrid(this.currentGridDirection, fallbackNormal);
      } else {
        this.updatePlaneOrientation(axisDirection);
      }
    } else {
      this.shouldAlignToAxis = true;
      // 管路軸に対して90度（管路軸に垂直な平面）で切断
      this.currentAxisDirection = axisDirection.clone();
      this.currentPlaneNormal.copy(axisDirection);

      // 管路軸のXZ成分（ax, 0, az）に垂直な方向を計算
      const axisXZ = new THREE.Vector3(axisDirection.x, 0, axisDirection.z);
      const axisXZLength = axisXZ.length();

      if (axisXZLength > 1e-6) {
        // 管路軸のXZ成分に垂直な方向（-az, 0, ax）を正規化
        const gridDir = new THREE.Vector3(-axisDirection.z, 0, axisDirection.x).normalize();
        this.currentGridDirection.copy(gridDir);
      } else {
        // 管路軸がZ軸と平行な場合（垂直な管路）、X軸方向を使用
        this.currentGridDirection.set(1, 0, 0);
      }
    }

    // 管路中心線上でクリック位置に最も近い点を取得し、断面中心とする
    const intersectionPoint = polyhedronClickProjection
      ? polyhedronClickProjection.clone()
      : this.getAxisAlignedIntersectionPoint(
        start,
        axisDirection,
        pipeLength,
        clickPoint
      );
    const centerForPlane = intersectionPoint || clickPoint;

    // 直近の断面中心として保持
    this.currentPlaneCenter = centerForPlane ? centerForPlane.clone() : null;

    const { maxDepth, depthStep, baseColor } = CROSS_SECTION_CONFIG.grid;
    let linePosition;
    const rotatedPlaneActive = this.isRotatedPlaneActive();
    if (rotatedPlaneActive) {
      const planeNormal3D = (this.currentPlaneNormal && this.currentPlaneNormal.lengthSq() > 1e-6)
        ? this.currentPlaneNormal.clone()
        : this.getPerpendicularVector(this.currentAxisDirection);
      // const planeNormalXZ = new THREE.Vector3(planeNormal3D.x, 0, planeNormal3D.z);
      const planeNormalXZ = this.getVerticalPlaneNormalFromGrid(this.currentGridDirection, planeNormal3D);
      linePosition = this.getGroundIntersectionPoint(
        centerForPlane,
        planeNormalXZ,
        this.currentGridDirection
      );
    } else {
      linePosition = new THREE.Vector3(centerForPlane.x, 0, centerForPlane.z);
    }

    // 地表の最も高い位置から、管路の一番深い位置までを、Y軸方向の描画範囲とする
    let startDepth = 0;
    if (this.hasTerrainData(geo)) {
      startDepth = Math.ceil(geo.boundingBox.max.y);
    }
    for (let depth = startDepth; depth >= maxDepth; depth -= depthStep) {
      if (depth === 0) {
        // 0mは基準線として赤で常時表示（3キーでは非表示にしない）
        this.drawEastWestLine(depth, linePosition, 0xff0000, true, false, false);
      } else {
        this.drawEastWestLine(depth, linePosition, baseColor, false, true, true);
      }
    }

    // 断面平面で交差するすべての管路に縦線を描画
    if (rotatedPlaneActive) {
      this.drawVerticalLinesAtRotatedPlane(centerForPlane, reg, null, geo);
      if (geo) {
        // 交線を求める
        const fallbackNormal = (this.currentPlaneNormal && this.currentPlaneNormal.lengthSq() > 1e-6)
          ? this.currentPlaneNormal.clone()
          : this.getPerpendicularVector(this.currentAxisDirection);
        const planeNormal3D = this.getVerticalPlaneNormalFromGrid(this.currentGridDirection, fallbackNormal);
        const planeNormal = new THREE.Vector3(planeNormal3D.x, planeNormal3D.z * (-1), 0);
        let line = this.getIntersectionLine(geo, linePosition, planeNormal);
        // 交線を描画
        if (line) {
          line.name = 'CrossSectionTerrainLine0';
          this.scene.add(line);
          this.CrossSectionTerrainLineNum = 1;
        }
      }
    } else {
      this.drawVerticalLinesAtCrossSectionPlane(clickPoint.z, null, geo);
    }

    // 後段の一括描画用に断面情報を登録
    this.pendingCrossSections.push({
      center: centerForPlane,
      radius: radius,
      axisDirection: axisDirection,
      color: pipeObject.material.color,
      pipeObject: pipeObject,
      crossSectionZ: centerForPlane.z
    });

    this.drawAllPendingCrossSections();
  }

  /**
   * 管路の軸方向に基づいて断面平面の向きを更新
   * @param {THREE.Vector3} axisDirection - 管路中心線の単位ベクトル
   */
  updatePlaneOrientation(axisDirection) {
    const safeAxis = axisDirection && axisDirection.lengthSq() > 1e-6
      ? axisDirection.clone().normalize()
      : new THREE.Vector3(1, 0, 0);

    const { planeNormal, gridDirection } = this.computePlaneOrientation(this.clampedGridAngle, safeAxis);
    const verticalPlaneNormal = this.getVerticalPlaneNormalFromGrid(gridDirection, planeNormal);

    this.currentAxisDirection = safeAxis;
    // this.currentPlaneNormal = planeNormal;
    this.currentPlaneNormal = verticalPlaneNormal;
    this.currentGridDirection = gridDirection;
  }

  /**
   * 角度に応じて断面平面の法線とグリッド方向を計算
   * @param {number} angleDegrees - 入力角度（0〜360°）
   * @param {THREE.Vector3} axisDirection - 管路中心線の単位ベクトル
   * @returns {{planeNormal: THREE.Vector3, gridDirection: THREE.Vector3}}
   */
  computePlaneOrientation(angleDegrees, axisDirection) {
    const axis = axisDirection.clone().normalize();
    const axisXZ = new THREE.Vector3(axis.x, 0, axis.z);
    if (axisXZ.lengthSq() < 1e-8) {
      // 軸がほぼ鉛直の場合は、安定な水平軸を採用（ワールドX）
      axisXZ.set(1, 0, 0);
    } else {
      axisXZ.normalize();
    }

    const rectNormal = new THREE.Vector3(-axisXZ.z, 0, axisXZ.x); // axisXZに直交する水平法線
    if (rectNormal.lengthSq() < 1e-8) {
      rectNormal.set(0, 0, 1);
    } else {
      rectNormal.normalize();
    }
    const circleNormal = axisXZ.clone(); // 管路方向（水平成分）

    // 0〜360の範囲に収める
    let angle = angleDegrees % 360;
    if (angle < 0) angle += 360;

    let planeNormal = new THREE.Vector3();

    if (angle <= 90) {
      // rectNormal → circleNormal
      const t = angle / 90;
      planeNormal.lerpVectors(rectNormal, circleNormal, t);
    } else if (angle <= 180) {
      // circleNormal → -rectNormal
      const t = (angle - 90) / 90;
      planeNormal.lerpVectors(circleNormal, rectNormal.clone().negate(), t);
    } else if (angle <= 270) {
      // -rectNormal → -circleNormal
      const t = (angle - 180) / 90;
      planeNormal.lerpVectors(rectNormal.clone().negate(), circleNormal.clone().negate(), t);
    } else {
      // -circleNormal → rectNormal
      const t = (angle - 270) / 90;
      planeNormal.lerpVectors(circleNormal.clone().negate(), rectNormal, t);
    }
    planeNormal.normalize();

    const gridDirection = this.getGridDirectionFromPlane(planeNormal, axis);

    return { planeNormal, gridDirection };
  }

  /**
   * 角度を0〜360°に正規化
   * @param {number} angleDegrees
   * @returns {number}
   */
  normalizeAngle360(angleDegrees) {
    const normalized = angleDegrees % 360;
    return (normalized + 360) % 360;
  }

  /**
   * 断面平面の法線からグリッド線の方向ベクトルを算出
   * @param {THREE.Vector3} planeNormal - 断面平面の法線ベクトル
   * @param {THREE.Vector3} axisDirection - 管路中心線の単位ベクトル
   * @returns {THREE.Vector3}
   */
  getGridDirectionFromPlane(planeNormal, axisDirection = null) {
    const up = new THREE.Vector3(0, 1, 0);
    const gridDirection = new THREE.Vector3().crossVectors(planeNormal, up);

    if (gridDirection.lengthSq() > 1e-6) {
      return gridDirection.normalize();
    }

    if (axisDirection && axisDirection.lengthSq() > 1e-6) {
      const alternative = new THREE.Vector3().crossVectors(planeNormal, axisDirection);
      if (alternative.lengthSq() > 1e-6) {
        return alternative.normalize();
      }
    }

    return this.getPerpendicularVector(planeNormal.clone().normalize());
  }

  /**
   * グリッド方向から「グリッド線を含む鉛直平面」の法線を取得
   * @param {THREE.Vector3} gridDirection - 平面のグリッド線方向
   * @param {THREE.Vector3} fallbackNormal - 退避用法線
   * @returns {THREE.Vector3}
   */
  getVerticalPlaneNormalFromGrid(gridDirection, fallbackNormal = null) {
    const dir = gridDirection && gridDirection.lengthSq() > 1e-8
      ? new THREE.Vector3(gridDirection.x, 0, gridDirection.z).normalize()
      : null;
    if (dir && dir.lengthSq() > 1e-8) {
      const up = new THREE.Vector3(0, 1, 0);
      const normal = new THREE.Vector3().crossVectors(up, dir);
      if (normal.lengthSq() > 1e-8) {
        normal.y = 0;
        return normal.normalize();
      }
    }

    if (fallbackNormal && fallbackNormal.lengthSq() > 1e-8) {
      const safe = new THREE.Vector3(fallbackNormal.x, 0, fallbackNormal.z);
      if (safe.lengthSq() > 1e-8) {
        return safe.normalize();
      }
    }
    return new THREE.Vector3(1, 0, 0);
  }

  /**
   * 断面平面と地面(Y=0)の交線上の一点を求める
   * @param {THREE.Vector3} planePoint - 平面上の既知の点
   * @param {THREE.Vector3} planeNormal - 平面の法線ベクトル
   * @param {THREE.Vector3} gridDirection - 平面内の基準方向ベクトル
   * @returns {THREE.Vector3}
   */
  getGroundIntersectionPoint(planePoint, planeNormal, gridDirection) {
    const safeNormal = planeNormal && planeNormal.lengthSq() > 1e-6
      ? planeNormal.clone().normalize()
      : new THREE.Vector3(1, 0, 0);
    const safeDirection = gridDirection && gridDirection.lengthSq() > 1e-6
      ? gridDirection.clone().normalize()
      : this.getGridDirectionFromPlane(safeNormal);

    // 平面が地面と平行の場合は単純にXZ座標を流用
    if (Math.abs(safeNormal.y) < 1e-6) {
      return new THREE.Vector3(planePoint.x, 0, planePoint.z);
    }

    const denominator = safeNormal.x * safeDirection.x + safeNormal.z * safeDirection.z;
    if (Math.abs(denominator) < 1e-6) {
      return new THREE.Vector3(planePoint.x, 0, planePoint.z);
    }

    const t = (safeNormal.y * planePoint.y) / denominator;
    const x = planePoint.x + safeDirection.x * t;
    const z = planePoint.z + safeDirection.z * t;

    return new THREE.Vector3(x, 0, z);
  }

  /**
   * 管路中心線上で指定点に最も近い位置を取得
   * @param {THREE.Vector3} start - 管路始点
   * @param {THREE.Vector3} axisDirection - 管路軸方向（単位ベクトル）
   * @param {number} pipeLength - 管路の長さ
   * @param {THREE.Vector3} point - 投影したい点
   * @returns {THREE.Vector3}
   */
  getAxisAlignedIntersectionPoint(start, axisDirection, pipeLength, point) {
    if (!point || pipeLength <= 1e-6 || !axisDirection || axisDirection.lengthSq() <= 1e-6) {
      return start.clone();
    }

    const startToPoint = point.clone().sub(start);
    const distanceAlongAxis = startToPoint.dot(axisDirection);
    const clampedDistance = THREE.MathUtils.clamp(distanceAlongAxis, 0, pipeLength);

    return start.clone().add(axisDirection.clone().multiplyScalar(clampedDistance));
  }

  /**
   * 指定ベクトルに対して直交する単位ベクトルを取得
   * @param {THREE.Vector3} axisDirection - 基準ベクトル
   * @returns {THREE.Vector3}
   */
  getPerpendicularVector(axisDirection) {
    const candidates = [
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(1, 0, 0),
      new THREE.Vector3(0, 0, 1)
    ];

    for (const candidate of candidates) {
      const perp = new THREE.Vector3().crossVectors(axisDirection, candidate);
      if (perp.lengthSq() > 1e-6) {
        return perp.normalize();
      }
    }

    return new THREE.Vector3(1, 0, 0);
  }

  /**
   * 回転した断面平面を使用するかどうかを判定
   * @returns {boolean}
   */
  isRotatedPlaneActive() {
    return this.autoModeEnabled || this.clampedGridAngle !== 0 || this.shouldAlignToAxis;
  }

  /**
   * 回転した断面平面（グリッド線に垂直な平面）が管路を切っている位置に縦線を描画
   * @param {THREE.Vector3} clickPoint - 断面平面を通る点
   * @param {SceneObjectRegistry} reg - 登録済みオブジェクトの管理
   * @param {THREE.Object3D} excludePipeObject - スキップする管路（クリックした管路）
   * @param {THREE.BufferGeometry|null} geo - 地表
   */
  drawVerticalLinesAtRotatedPlane(clickPoint, reg, excludePipeObject = null, geo = null) {
    if (!this.objectsRef || !this.objectsRef.current) return;

    const planeNormal3D = (this.currentPlaneNormal && this.currentPlaneNormal.lengthSq() > 0)
      ? this.currentPlaneNormal.clone()
      : this.getPerpendicularVector(this.currentAxisDirection);
    // const planeNormal = new THREE.Vector3(planeNormal3D.x, 0, planeNormal3D.z);
    const planeNormal = this.getVerticalPlaneNormalFromGrid(this.currentGridDirection, planeNormal3D);
    const planeNormalUnit = planeNormal.clone().normalize();
    const planePoint = clickPoint.clone();

    const allObjects = Object.values(this.objectsRef.current);

    // Hough変換と四分木を使用した最適化処理
    let nearObjects = allObjects;
    let terrainTriangles = null;

    const startDbgTime1 = performance.now();

    if (reg && typeof reg.searchNodes === 'function') {
      // Hough変換を使用して断面の直線を計算
      const line2d = this.computeHoughLineFrom3D(planeNormal, planePoint);

      // SceneObjectRegistryからノードを検索
      const nodes = reg.searchNodes(line2d.theta, line2d.rho);

      // 四分木から地形三角形を検索
      if (QuadtreeNodeTriangle && this.terrainTriangles && typeof this.terrainTriangles.insert === 'function') {
        terrainTriangles = this.searchTriangles(-line2d.theta, line2d.rho);
      }

      // ノードに含まれるオブジェクトだけを抽出
      nearObjects = this.filterNodes(allObjects, nodes);
    } else {
      // 四分木が利用可能な場合は地形三角形を検索
      if (QuadtreeNodeTriangle && this.terrainTriangles && typeof this.terrainTriangles.insert === 'function') {
        const line2d = this.computeHoughLineFrom3D(planeNormal, planePoint);
        terrainTriangles = this.searchTriangles(-line2d.theta, line2d.rho);
      }
    }

    const endDbgTime1 = performance.now();
    if (reg && typeof reg.searchNodes === 'function') {
      console.log('Search Time: ', endDbgTime1 - startDbgTime1, ', Size: ', allObjects.length, ' -> ', nearObjects.length, ', Ratio: ', (endDbgTime1 - startDbgTime1) / nearObjects.length);
    }

    let count = [];
    let c = 0;

    let dbgTimeA = 0;
    let dbgCountA = 0;
    let dbgTimeB = 0;
    let dbgCountB = 0;
    let dbgTimeC = 0;
    let dbgCountC = 0;
    let dbgTimeD = 0;
    let dbgCountD = 0;
    let dbgTimeE = 0;
    let dbgCountE = 0;
    let dbgCountF = 0;
    let dbgCountG = 0;
    let dbgCountH = 0;

    const startDbgTime = performance.now();

    nearObjects.forEach(obj => {
      if (excludePipeObject && obj === excludePipeObject) return;

      // 可視性チェック
      if (obj.userData && obj.userData.materialVisible === false) {
        return;
      }

      if (obj && obj.userData && obj.userData.objectData) {
        const startDbgTimeA = performance.now();

        const objectData = obj.userData.objectData;
        if (this.shouldSkipVerticalAndCrossSection(objectData)) {
          return;
        }
        const geometry = objectData.geometry?.[0];

        const radius = this.getPipeRadius(objectData);
        const start = new THREE.Vector3(0, 0, 0);
        const end = new THREE.Vector3(0, 0, 0);

        const endDbgTimeA = performance.now();
        dbgTimeA += (endDbgTimeA - startDbgTimeA);
        dbgCountA++;

        const startDbgTimeB = performance.now();

        if (geometry.type === "ExtrudeGeometry") {
          if (!geometry || !geometry.extrudePath || geometry.extrudePath.length < 2) {
            return;
          } else {
            // パス上の点で、クリック座標に最短距離の点を含む線分の２端点を求める
            const pathPoints = this.convPoints(geometry.extrudePath);
            const closestSegment = this.getClosestStartEnd(pathPoints, clickPoint);
            start.x = closestSegment.start.x;
            start.y = closestSegment.start.y;
            start.z = closestSegment.start.z;
            end.x = closestSegment.end.x;
            end.y = closestSegment.end.y;
            end.z = closestSegment.end.z;
          }
        } else {
          const shapeTypeName = objectData.shapeTypeName || geometry.type;
          if (
            shapeTypeName === 'Polyhedron' ||
            geometry.type === 'Polyhedron' ||
            objectData?.shape_type === 14
          ) {
            const bbox = new THREE.Box3().setFromObject(obj);
            const size = new THREE.Vector3();
            bbox.getSize(size);
            const nudge = this.getPlaneNudgeAmount(CROSS_SECTION_CONFIG.plane.thickness, size.length());
            const { points: intersectionPoints, usedPlanePoint } =
              this.getMeshPlaneIntersectionsWorldWithNudges(obj, planeNormalUnit, planePoint, 1e-5, nudge);
            if (intersectionPoints.length === 0) {
              return;
            }

            // planePointに最も近い交点を選択
            let closestPoint = intersectionPoints[0];
            let minDistance = usedPlanePoint.distanceTo(closestPoint);
            intersectionPoints.forEach(p => {
              const dist = usedPlanePoint.distanceTo(p);
              if (dist < minDistance) {
                minDistance = dist;
                closestPoint = p;
              }
            });

            const pipeTopY = closestPoint.y;
            const intersectionPoint = new THREE.Vector3(closestPoint.x, pipeTopY, closestPoint.z);
            const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);
            const basePoint = this.hasTerrainData(geo)
              ? this.findFirstLinePlaneIntersectionIfInsideXZ(intersectionPoint, terrainTriangles)
              : null;

            const basePointForLine = (basePoint == null || basePoint.length == 0)
              ? 0
              : basePoint[0];
            const fallbackTopY = pipeTopY + radius;
            this.pendingVerticalLines.push({
              key: this.getCrossSectionKey(obj, intersectionPoint.z),
              pipePosition,
              basePoint: basePointForLine,
              color: obj.material.color,
              fallbackTopY,
              attributeLabelText: this.formatPipeAttributeLabel(objectData)
            });

            this.pendingCrossSections.push({
              center: intersectionPoint,
              radius: radius,
              axisDirection: this.currentAxisDirection ? this.currentAxisDirection.clone() : new THREE.Vector3(0, 0, 1),
              color: obj.material.color,
              pipeObject: obj,
              crossSectionZ: intersectionPoint.z
            });
            return;
          } else {
            if (!geometry || !geometry.vertices || geometry.vertices.length < 2) {
              return;
            } else {
              const vertices = geometry.vertices;
              const { start: startP, end: endP } = this.getPipeStartEnd(vertices[0], vertices[vertices.length - 1], objectData, radius);
              start.x = startP.x;
              start.y = startP.y;
              start.z = startP.z;
              end.x = endP.x;
              end.y = endP.y;
              end.z = endP.z;
            }
          }
        }

        const endDbgTimeB = performance.now();
        dbgTimeB += (endDbgTimeB - startDbgTimeB);
        dbgCountB++;

        const startDbgTimeC = performance.now();

        // findCapsuleSectionを使用した交点計算
        const centerPoint = this.findCapsuleSection(planeNormal, planePoint, start, end, radius, false);

        if (centerPoint) {
          const startDbgTimeD = performance.now();

          const basePoint1 = this.findFirstLinePlaneIntersectionIfInsideXZ(centerPoint, terrainTriangles);

          const endDbgTimeD = performance.now();
          dbgTimeD += (endDbgTimeD - startDbgTimeD);
          dbgCountD++;

          let basePointForLine = 0;
          if (basePoint1 == null) {
            dbgCountF++;
          } else if (basePoint1.length == 0) {
            dbgCountG++;
          } else {
            basePointForLine = basePoint1[0];
          }
          const direction = end.clone().sub(start);
          const intersectionPoint = centerPoint;
          const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);
          const startDbgTimeE = performance.now();

          const crossSectionTopY = intersectionPoint.y + radius;

          this.pendingVerticalLines.push({
            key: this.getCrossSectionKey(obj, intersectionPoint.z),
            pipePosition,
            basePoint: basePointForLine,
            color: obj.material.color,
            fallbackTopY: crossSectionTopY,
            attributeLabelText: this.formatPipeAttributeLabel(objectData)
          });

          const endDbgTimeE = performance.now();
          dbgTimeE += (endDbgTimeE - startDbgTimeE);
          dbgCountE++;

          this.pendingCrossSections.push({
            center: intersectionPoint,
            radius: radius,
            axisDirection: direction.clone().normalize(),
            color: obj.material.color,
            pipeObject: obj,
            crossSectionZ: intersectionPoint.z
          });
        } else {
          // 従来の線分と平面の交点計算
          const direction = end.clone().sub(start);

          const numberator = planeNormal.dot(planePoint.clone().sub(start));
          const denominator = planeNormal.dot(direction);
          if (Math.abs(denominator) > 1e-6) {
            const t = numberator / denominator;
            if (t >= 0 && t <= 1) {
              const intersectionPoint = start.clone().add(direction.clone().multiplyScalar(t));
              const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);

              const crossSectionTopY = intersectionPoint.y + radius;

              const startDbgTimeD = performance.now();

              const basePoint = this.hasTerrainData(geo)
                ? this.findFirstLinePlaneIntersectionIfInsideXZ(intersectionPoint, terrainTriangles)
                : null;

              const endDbgTimeD = performance.now();
              dbgTimeD += (endDbgTimeD - startDbgTimeD);
              dbgCountD++;

              const basePointForLine = (basePoint == null || basePoint.length == 0)
                ? 0
                : basePoint[0];

              this.pendingVerticalLines.push({
                key: this.getCrossSectionKey(obj, intersectionPoint.z),
                pipePosition,
                basePoint: basePointForLine,
                color: obj.material.color,
                fallbackTopY: crossSectionTopY,
                attributeLabelText: this.formatPipeAttributeLabel(objectData)
              });

              if (basePoint == null) {
                dbgCountF++;
              } else if (basePoint.length == 0) {
                count[c++] = intersectionPoint;
                dbgCountG++;
              }

              this.pendingCrossSections.push({
                center: intersectionPoint,
                radius: radius,
                axisDirection: direction.clone().normalize(),
                color: obj.material.color,
                pipeObject: obj,
                crossSectionZ: intersectionPoint.z
              });
            } else {
              dbgCountH++;
            }
          } else {
            // 線分が平面と平行、または平面上にある場合（角度0で発生しやすい）
            const distToPlane = Math.abs(numberator);
            if (distToPlane < 1e-6) {
              const dirLenSq = direction.lengthSq();
              const tProj = dirLenSq > 1e-6
                ? planePoint.clone().sub(start).dot(direction) / dirLenSq
                : 0;
              const tClamped = THREE.MathUtils.clamp(tProj, 0, 1);
              const intersectionPoint = start.clone().add(direction.clone().multiplyScalar(tClamped));
              const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);

              const crossSectionTopY = intersectionPoint.y + radius;

              const startDbgTimeD = performance.now();

              const basePoint = this.hasTerrainData(geo)
                ? this.findFirstLinePlaneIntersectionIfInsideXZ(intersectionPoint, terrainTriangles)
                : null;

              const endDbgTimeD = performance.now();
              dbgTimeD += (endDbgTimeD - startDbgTimeD);
              dbgCountD++;

              const basePointForLine = (basePoint == null || basePoint.length == 0)
                ? 0
                : basePoint[0];

              this.pendingVerticalLines.push({
                key: this.getCrossSectionKey(obj, intersectionPoint.z),
                pipePosition,
                basePoint: basePointForLine,
                color: obj.material.color,
                fallbackTopY: crossSectionTopY,
                attributeLabelText: this.formatPipeAttributeLabel(objectData)
              });

              if (basePoint == null) {
                dbgCountF++;
              } else if (basePoint.length == 0) {
                count[c++] = intersectionPoint;
                dbgCountG++;
              }

              this.pendingCrossSections.push({
                center: intersectionPoint,
                radius: radius,
                axisDirection: direction.clone().normalize(),
                color: obj.material.color,
                pipeObject: obj,
                crossSectionZ: intersectionPoint.z
              });
            } else {
              dbgCountH++;
            }
          }
        }

        const endDbgTimeC = performance.now();
        dbgTimeC += (endDbgTimeC - startDbgTimeC);
        dbgCountC++;
      }
    });

    const endDbgTime = performance.now();
    console.log('Select2 Time: ', endDbgTime - startDbgTime, ', Size: ', nearObjects.length, ', Ratio: ', (endDbgTime - startDbgTime) / nearObjects.length);

    let logString = 'basePoint.length === 0: ';
    for (let i = 0; i < count.length; i++) {
      logString = logString + '[' + count[i].x.toString() + ', ' + count[i].y.toString() + ', ' + count[i].z.toString() + '], ';
    }
    console.log(logString + c.toString());

    if (dbgCountA > 0 || dbgCountB > 0 || dbgCountC > 0 || dbgCountD > 0 || dbgCountE > 0) {
      console.log('Select2 Detail \nTime: dbgTimeA: ', dbgTimeA.toFixed(4), ', dbgTimeB: ', dbgTimeB.toFixed(4), ', dbgTimeC: ', dbgTimeC.toFixed(4), ', dbgTimeD: ', dbgTimeD.toFixed(4), ', dbgTimeE: ', dbgTimeE.toFixed(4), ' \nCount: dbgCountA: ', dbgCountA, ', dbgCountB: ', dbgCountB, ', dbgCountC: ', dbgCountC, ', dbgCountD: ', dbgCountD, ', dbgCountE: ', dbgCountE, ' \nRatio: A: ', (dbgCountA > 0 ? (dbgTimeA / dbgCountA).toFixed(4) : '0'), ', B: ', (dbgCountB > 0 ? (dbgTimeB / dbgCountB).toFixed(4) : '0'), ', C: ', (dbgCountC > 0 ? (dbgTimeC / dbgCountC).toFixed(4) : '0'), ', D: ', (dbgCountD > 0 ? (dbgTimeD / dbgCountD).toFixed(4) : '0'), ', E: ', (dbgCountE > 0 ? (dbgTimeE / dbgCountE).toFixed(4) : '0'));
      console.log('Select2 Counts: ', ' \ndbgCountA: ', dbgCountA, ', dbgCountB: ', dbgCountB, ', dbgCountC: ', dbgCountC, ', dbgCountD: ', dbgCountD, ', dbgCountE: ', dbgCountE, ', dbgCountF: ', dbgCountF, ', dbgCountG: ', dbgCountG, ', dbgCountH: ', dbgCountH);
    }
  }

  /**
   * 断面平面（Z座標固定）が管路を切っている位置に縦線を描画
   * @param {number} crossSectionZ - 断面平面のZ座標
   * @param {THREE.Object3D} excludePipeObject - スキップする管路（クリックした管路）
   */
  drawVerticalLinesAtCrossSectionPlane(crossSectionZ, excludePipeObject = null, geo) {
    // 断面平面Zで各管路の中心線と交差する位置を探し、縦線を描画
    if (!this.objectsRef || !this.objectsRef.current) {
      return;
    }

    const allObjects = Object.values(this.objectsRef.current);

    const startDbgTime = performance.now();
    allObjects.forEach(obj => {
      if (excludePipeObject && obj === excludePipeObject) {
        return;
      }

      // 可視性チェック
      if (obj.userData && obj.userData.materialVisible === false) {
        return;
      }

      if (obj && obj.userData && obj.userData.objectData) {
        const objectData = obj.userData.objectData;
        if (this.shouldSkipVerticalAndCrossSection(objectData)) {
          return;
        }
        const geometry = objectData.geometry?.[0];
        const shapeTypeName = objectData.shapeTypeName || geometry.type;

        const radius = this.getPipeRadius(objectData);

        // Polyhedronは「中心線のZ方向成分がある」前提が成立しないため、
        // ワールドAABB（Box3）とZ平面の交差で縦線位置を決める。
        if (
          shapeTypeName === 'Polyhedron' ||
          geometry.type === 'Polyhedron' ||
          objectData?.shape_type === 14
        ) {
          // 断面平面（Z = crossSectionZ）をPlaneとして扱い、共面も拾う
          const zPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
            new THREE.Vector3(0, 0, 1),
            new THREE.Vector3(0, 0, crossSectionZ)
          );
          const intersectionPoints = this.getMeshPlaneIntersectionsWorld(obj, zPlane, 1e-5);
          if (intersectionPoints.length === 0) {
            return;
          }

          // 交点の中心を計算
          const intersectionCenter = new THREE.Vector3();
          intersectionPoints.forEach(p => intersectionCenter.add(p));
          intersectionCenter.divideScalar(intersectionPoints.length);

          // 交点の平均高さを縦線の上端に使う（Box3の高さは使わない）
          const pipeTopY = intersectionCenter.y;
          const intersectionPoint = new THREE.Vector3(intersectionCenter.x, pipeTopY, crossSectionZ);
          const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);

          const triangles = this.terrainTriangles; // dummy
          const basePoint = this.hasTerrainData(geo)
            ? this.findFirstLinePlaneIntersectionIfInsideXZ(intersectionPoint, triangles)
            : null;

          const basePointForLine = (basePoint == null || basePoint.length == 0)
            ? 0
            : basePoint[0];
          const fallbackTopY = pipeTopY + radius;
          this.pendingVerticalLines.push({
            key: this.getCrossSectionKey(obj, intersectionPoint.z),
            pipePosition,
            basePoint: basePointForLine,
            color: obj.material.color,
            fallbackTopY,
            attributeLabelText: this.formatPipeAttributeLabel(objectData)
          });

          this.pendingCrossSections.push({
            center: intersectionPoint,
            radius: radius,
            axisDirection: this.currentAxisDirection ? this.currentAxisDirection.clone() : new THREE.Vector3(0, 0, 1),
            color: obj.material.color,
            pipeObject: obj,
            crossSectionZ: crossSectionZ
          });

          return;
        }
        if (!geometry || !geometry.vertices || geometry.vertices.length < 2) {
          return;
        }
        const vertices = geometry.vertices;
        const { start, end } = this.getPipeStartEnd(vertices[0], vertices[vertices.length - 1], objectData, radius);

        const minZ = Math.min(start.z, end.z) - radius;
        const maxZ = Math.max(start.z, end.z) + radius;

        if (crossSectionZ >= minZ && crossSectionZ <= maxZ) {
          const direction = new THREE.Vector3().subVectors(end, start);

          if (Math.abs(direction.z) > 0.001) {
            const t = (crossSectionZ - start.z) / direction.z;

            if (t >= 0 && t <= 1) {
              const intersectionPoint = start.clone().add(direction.clone().multiplyScalar(t));
              const pipePosition = new THREE.Vector3(intersectionPoint.x, 0, intersectionPoint.z);

              const crossSectionTopY = intersectionPoint.y + radius;
              const triangles = this.terrainTriangles; // dummy
              const basePoint = this.hasTerrainData(geo)
                ? this.findFirstLinePlaneIntersectionIfInsideXZ(intersectionPoint, triangles)
                : null;

              const basePointForLine = (basePoint == null || basePoint.length == 0)
                ? 0
                : basePoint[0];
              this.pendingVerticalLines.push({
                key: this.getCrossSectionKey(obj, intersectionPoint.z),
                pipePosition,
                basePoint: basePointForLine,
                color: obj.material.color,
                fallbackTopY: crossSectionTopY,
                attributeLabelText: this.formatPipeAttributeLabel(objectData)
              });

              this.pendingCrossSections.push({
                center: intersectionPoint,
                radius: radius,
                axisDirection: direction.clone().normalize(),
                color: obj.material.color,
                pipeObject: obj,
                crossSectionZ: crossSectionZ
              });
            }
          }
        }
      }
    });
    const endDbgTime = performance.now();
    console.log('Select Time: ', endDbgTime - startDbgTime, ', Size: ', allObjects.length, ', Ratio: ', (endDbgTime - startDbgTime) / allObjects.length);
  }

  /**
   * 東西方向（X軸方向）の線を描画
   * @param {number} depth - 深さ（Y座標）
   * @param {THREE.Vector3} center - 中心位置
   * @param {number} color - 線の色（16進数）
   * @param {boolean} highlight - 強調表示するか
   * @param {boolean} showLabel - ラベルを表示するか
   */
  drawEastWestLine(
    depth,
    center,
    color = CROSS_SECTION_CONFIG.grid.baseColor,
    highlight = false,
    showLabel = true,
    hideWithGridToggle = true
  ) {
    // 水平方向(X軸)の基準グリッド線
    const { lineLength, lineWidth, opacity, labelInterval } = CROSS_SECTION_CONFIG.grid;
    const { default: defaultLineWidth, highlight: highlightLineWidth } = lineWidth;
    const { default: defaultOpacity, highlight: highlightOpacity } = opacity;
    const direction = (this.currentGridDirection && this.currentGridDirection.lengthSq() > 1e-6)
      ? this.currentGridDirection.clone().normalize()
      : new THREE.Vector3(1, 0, 0);

    // 中心点から両方向に線を延ばす
    const halfLength = lineLength / 2;
    const startPoint = center.clone().add(direction.clone().multiplyScalar(-halfLength));
    const endPoint = center.clone().add(direction.clone().multiplyScalar(halfLength));

    // Y座標をdepthに設定（gridAngle追加時に失われた処理を復元）
    startPoint.y = depth;
    endPoint.y = depth;

    const lineGeometry = new LineGeometry();
    lineGeometry.setPositions([
      startPoint.x, startPoint.y, startPoint.z,
      endPoint.x, endPoint.y, endPoint.z
    ]);

    const lineMaterial = new LineMaterial({
      color: color,
      linewidth: highlight ? highlightLineWidth : defaultLineWidth,
      transparent: !highlight,
      opacity: highlight ? highlightOpacity : defaultOpacity,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      worldUnits: false,
      vertexColors: false,
      dashed: false
    });

    const line = new Line2(lineGeometry, lineMaterial);
    line.computeLineDistances();
    line.visible = hideWithGridToggle ? this.showGridLines : true;
    this.depthLines.push(line);
    if (hideWithGridToggle) {
      this.gridLines.push(line);
    }
    this.scene.add(line);

    const shouldShowLabel = showLabel && (highlight || (Math.abs(depth) % labelInterval === 0));
    if (shouldShowLabel) {
      const labelPosition = new THREE.Vector3(center.x, depth, center.z);
      const { offsets } = CROSS_SECTION_CONFIG.label;
      const xOffset = (this.autoModeEnabled && this.gridAngle !== 0)
        ? offsets.rotated
        : offsets.default;
      this.drawDepthLabel(
        depth,
        labelPosition,
        highlight ? color : 0xffffff,
        xOffset,
        hideWithGridToggle
      );
    }
  }

  /**
   * 縦線を描画（床から管路の上端まで）+ ラベルをグループ化
   * @param {THREE.Vector3} position - 線の位置（X,Z座標）
   * @param {number} pipeDepth - 管路の中心深さ（Y座標）
   * @param {THREE.Vector3} basePosition - 基準座標（地表）
   * @param {THREE.Color} color - 線の色（管路の色）
   * @param {number} radius - 管路の半径
   * @returns {THREE.Group} - 縦線とラベルを含むグループ
   */
  drawVerticalLine(position, pipeDepth, basePosition, color, radius = 0, attributeLabelText = '') {
    // 単一の縦線(床→管路上端)と深さラベルをまとめて描画
    const lineGroup = new THREE.Group();
    lineGroup.position.set(position.x, 0, position.z);

    const pipeTopY = pipeDepth + radius;
    const baseY = typeof basePosition === 'number' ? basePosition : basePosition.y
    const startPoint = new THREE.Vector3(0, baseY, 0);
    const endPoint = new THREE.Vector3(0, pipeTopY, 0);

    const lineGeometry = new LineGeometry();
    lineGeometry.setPositions([
      startPoint.x, startPoint.y, startPoint.z,
      endPoint.x, endPoint.y, endPoint.z
    ]);

    const lineMaterial = new LineMaterial({
      color: color,
      linewidth: CROSS_SECTION_CONFIG.verticalLine.lineWidth,
      transparent: true,
      opacity: CROSS_SECTION_CONFIG.verticalLine.opacity,
      resolution: new THREE.Vector2(window.innerWidth, window.innerHeight),
      worldUnits: false,
      vertexColors: false,
      dashed: false
    });

    const line = new Line2(lineGeometry, lineMaterial);
    line.computeLineDistances();
    lineGroup.add(line);

    const labelY = (pipeTopY + baseY) / 2;
    const depthValue = baseY - pipeTopY;
    const labelSprite = this.createDepthLabelSprite(depthValue, 'verticalLine');
    labelSprite.position.set(0, labelY, 0);
    labelSprite.visible = this.showDepthGuides;
    lineGroup.add(labelSprite);

    const labelWorldPosition = new THREE.Vector3(position.x, labelY, position.z);

    lineGroup.visible = this.showDepthGuides;
    this.depthLines.push(lineGroup);
    this.depthLabels.push(labelSprite);
    this.depthLabelPositions.push(labelWorldPosition);
    this.scene.add(lineGroup);

    if (attributeLabelText) {
      // 断面位置の少し下に属性ラベルを配置（重なりは後段で調整）
      const attributeAnchorY = pipeTopY - 0.45;
      const attributeAnchor = new THREE.Vector3(position.x, attributeAnchorY, position.z);
      const attributeSprite = this.createTextLabelSprite(attributeLabelText);
      attributeSprite.position.copy(attributeAnchor);
      attributeSprite.visible = this.showDepthGuides;
      this.scene.add(attributeSprite);

      this.depthLabels.push(attributeSprite);
      this.depthLabelPositions.push(attributeAnchor.clone());
      this.attributeLabelEntries.push({
        sprite: attributeSprite,
        anchorPosition: attributeAnchor.clone()
      });
    }

    return lineGroup;
  }

  /**
   * 深さラベルのSpriteを作成（シーンに追加しない）
   * @param {number} depth - 深さ（Y座標）
   * @returns {THREE.Sprite} - 作成されたSprite
   */
  createDepthLabelSprite(depth, line) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const {
      canvasWidth,
      canvasHeight,
      color,
      font,
      shadow,
      spriteScale,
      renderOrder
    } = CROSS_SECTION_CONFIG.label;
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
    if (line === 'dedpthLabel') {
      context.fillText(`<${Math.abs(depth).toFixed(1)}>`, canvas.width / 2, canvas.height / 2);
    } else {
      context.fillText(`${Math.abs(depth).toFixed(3)}`, canvas.width / 2, canvas.height / 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      depthWrite: false,
      transparent: true
    });
    const sprite = new THREE.Sprite(spriteMaterial);
    sprite.scale.set(spriteScale.x, spriteScale.y, spriteScale.z);
    sprite.renderOrder = renderOrder;
    return sprite;
  }

  /**
   * 任意テキスト用ラベルSpriteを作成（シーンに追加しない）
   * @param {string} text
   * @returns {THREE.Sprite}
   */
  createTextLabelSprite(text) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    const {
      canvasWidth,
      canvasHeight,
      color,
      font,
      shadow,
      spriteScale
    } = CROSS_SECTION_CONFIG.attributeLabel;
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
    sprite.renderOrder = CROSS_SECTION_CONFIG.label.renderOrder;
    return sprite;
  }

  /**
   * 深さラベルを描画
   * @param {number} depth - 深さ（Y座標）
   * @param {THREE.Vector3} position - ラベル位置
   * @param {number} color - ラベルの色
   * @param {number} xOffset - X座標のオフセット（デフォルトは-5）
   */
  drawDepthLabel(
    depth,
    position,
    color = 0xffffff,
    xOffset = CROSS_SECTION_CONFIG.label.offsets.default,
    hideWithGridToggle = true
  ) {
    const sprite = this.createDepthLabelSprite(depth, 'depthLabel');
    const labelPosition = new THREE.Vector3(position.x, position.y, position.z);
    sprite.position.copy(labelPosition);
    sprite.visible = hideWithGridToggle ? this.showGridLines : true;

    this.depthLabels.push(sprite);
    if (hideWithGridToggle) {
      this.gridDepthLabels.push(sprite);
    }
    this.depthLabelPositions.push(labelPosition);
    this.scene.add(sprite);
  }

  /**
   * 管路ID{feature_id}を描画
   * @param {number} id - 深さ（Y座標）
   * @param {THREE.Vector3} position - ラベル位置
   * @param {number} color - ラベルの色
   * @param {number} xOffset - X座標のオフィス（デフォルトは-5）
  */
  drawIdLabel(id, position, color = 0xffffff, xOffset = CROSS_SECTION_CONFIG.label.offsets.default) {
    const sprite = this.createDepthLabelSprite(id, 'featureIdLabel');
    const labelPosition = new THREE.Vector3(position.x, position.y, position.z);
    sprite.position.copy(labelPosition);
    sprite.visible = this.showDepthGuides;

    this.depthLabels.push(sprite);
    this.depthLabelPositions.push(labelPosition);
    this.scene.add(sprite);
  }

  /**
   * 収集したすべての断面情報を一度に描画
   */
  drawAllPendingCrossSections() {
    // 収集済みの断面リクエストを重複除去して一括描画
    const uniqueSections = new Map();
    this.pendingCrossSections.forEach(section => {
      const key = this.getCrossSectionKey(section.pipeObject, section.crossSectionZ);
      if (!uniqueSections.has(key)) {
        uniqueSections.set(key, section);
      }
    });

    const startDbgTime = performance.now();
    const sectionMeshes = new Map();
    uniqueSections.forEach((section, key) => {
      const mesh = this.drawCrossSectionCircle(
        section.center,
        section.radius,
        section.axisDirection,
        section.color,
        section.pipeObject,
        section.crossSectionZ
      );
      if (mesh) {
        sectionMeshes.set(key, mesh);
      }
    });

    // 実際の断面メッシュが生成された管路に対してのみ、縦線を描画
    this.pendingVerticalLines.forEach(line => {
      const mesh = sectionMeshes.get(line.key);

      // CSG断面が1つも作られていない管路は、縦線も描画しない
      if (!mesh || !mesh.geometry) {
        return;
      }

      let topY = line.fallbackTopY;
      let linePosition = line.pipePosition;

      const position = mesh.geometry.attributes?.position;
      if (position && position.count > 0) {
        let maxY = -Infinity;
        let maxPoint = null;
        for (let i = 0; i < position.count; i++) {
          const y = position.getY(i);
          if (y > maxY) {
            maxY = y;
            maxPoint = new THREE.Vector3(
              position.getX(i),
              y,
              position.getZ(i)
            );
          }
        }
        if (Number.isFinite(maxY)) {
          topY = maxY;
          if (maxPoint) {
            linePosition = new THREE.Vector3(maxPoint.x, 0, maxPoint.z);
          }
        }
      } else {
        if (!mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }
        const maxY = mesh.geometry.boundingBox?.max?.y;
        if (Number.isFinite(maxY)) {
          topY = maxY;
        }
      }

      let basePoint = line.basePoint;

      // Normalモード: configで指定した高さから
      // Elevationモード: 地形データがある場合は地形から計算（無ければconfigのfallback）
      if (this.mode === 'normal') {
        basePoint = this.getVerticalLineBaseY('normal', 0);
      } else if (this.mode === 'elevation') {
        const fallbackBaseY = this.getVerticalLineBaseY('elevationNoTerrain', 0);
        basePoint = Number.isFinite(line.basePoint.y) ? line.basePoint : fallbackBaseY;
      } else {
        basePoint = this.getVerticalLineBaseY('normal', 0);
      }
      this.drawVerticalLine(linePosition, topY, basePoint, line.color, 0, line.attributeLabelText);
    });

    this.resolveAttributeLabelOverlaps();

    const endDbgTime = performance.now();
    console.log('Draw Time: ', endDbgTime - startDbgTime, ', Size: ', uniqueSections.size, ', Ratio: ', (endDbgTime - startDbgTime) / uniqueSections.size);
    this.pendingCrossSections = [];
    this.pendingVerticalLines = [];
  }

  /**
   * 管路の断面（円形）を描画
   * CSGを使用して垂直面で切断した断面を表示
   */
  drawCrossSectionCircle(center, radius, axisDirection, color, pipeObject, crossSectionZ) {
    // CSGにより断面形状(交差部分)のみを生成
    if (isNaN(center.x) || isNaN(center.y) || isNaN(center.z) || isNaN(radius)) {
      console.log('drawCrossSectionCircle ' + isNaN(radius).toString());
      return null;
    }
    const radiusRequiredTypes = new Set([
      16, // Cylinder
      11, // Circle
      3, // LineString
      4 // MultiLineString
    ])
    if (pipeObject && pipeObject.userData && pipeObject.userData.objectData.geometry && pipeObject.userData.objectData.geometry.length > 0) {
      if (radius <= 0 && radiusRequiredTypes.has(pipeObject.userData.objectData.shape_type)) {
        console.log('drawCrossSectionCircle radius <= 0 ');
        return;
      }
    } else {
      console.log('pipeObject && pipeObject.userData && pipeObject.userData.geometry && pipeObject.userData.geometry.length > 0 ');
      return;
    }

    // Polyhedronの場合は直接ポリゴン計算を使用
    const objectData = pipeObject?.userData?.objectData;
    if (this.shouldSkipVerticalAndCrossSection(objectData)) {
      return null;
    }
    const geometry = objectData?.geometry?.[0];
    const shapeTypeName = objectData?.shapeTypeName || geometry?.type;

    if (
      shapeTypeName === 'Polyhedron' ||
      geometry?.type === 'Polyhedron' ||
      objectData?.shape_type === 14
    ) {
      try {
        if (this.isRotatedPlaneActive()) {
          return this.drawCSGCrossSectionRotated(pipeObject, center, color);
        } else if (crossSectionZ != null) {
          return this.drawCSGCrossSection(pipeObject, crossSectionZ, color);
        }
      } catch (error) {
        console.error('CSGでPolyhedron断面の作成に失敗しました:', error);
      }
      return null;
    }

    if (crossSectionZ != null) {
      try {
        if (this.isRotatedPlaneActive()) {
          return this.drawCSGCrossSectionRotated(pipeObject, center, color);
        } else {
          return this.drawCSGCrossSection(pipeObject, crossSectionZ, color);
        }
      } catch (error) {
        console.error('CSG断面の作成に失敗しました:', error);
      }
    }
    return null;
  }

  /**
   * CSG用にメッシュを安定化（ワールド変換のベイク、法線再計算、非インデックス化）
   * @param {THREE.Object3D} pipeObject
   * @param {THREE.Color} color
   * @returns {THREE.Mesh|null}
   */
  buildStableCSGMesh(pipeObject, color) {
    if (!pipeObject || !pipeObject.geometry) {
      return null;
    }

    pipeObject.updateMatrixWorld(true);

    let geometry = pipeObject.geometry.clone();
    if (geometry.index) {
      geometry = geometry.toNonIndexed();
    }
    geometry.computeVertexNormals();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.applyMatrix4(pipeObject.matrixWorld);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide })
    );
    mesh.updateMatrix();
    return mesh;
  }

  /**
   * CSGを使用して垂直面で切断した断面を描画
   * @param {THREE.Object3D} pipeObject - 管路オブジェクト
   * @param {number} crossSectionZ - 断面平面のZ座標
   * @param {THREE.Color} color - 断面の色
   */
  drawCSGCrossSection(pipeObject, crossSectionZ, color) {
    // 元メッシュを複製し、薄いボックスとの交差(Intersect)で断面メッシュを得る
    const pipeMesh = this.buildStableCSGMesh(pipeObject, color);
    if (!pipeMesh) {
      return null;
    }

    const { size, thickness } = CROSS_SECTION_CONFIG.plane;
    const planeGeometry = new THREE.BoxGeometry(size, size, thickness);
    const planeMesh = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({ color: 0xff0000 }));
    planeMesh.position.set(0, 0, crossSectionZ);
    planeMesh.updateMatrix();

    const intersectionMesh = CSG.intersect(pipeMesh, planeMesh);
    if (!intersectionMesh?.geometry || intersectionMesh.geometry.attributes?.position?.count === 0) {
      return null;
    }
    intersectionMesh.material = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    intersectionMesh.visible = this.showCrossSections;
    if (pipeObject?.userData?.objectData) {
      intersectionMesh.userData = intersectionMesh.userData || {};
      intersectionMesh.userData.objectData = pipeObject.userData.objectData;
      intersectionMesh.userData.isCrossSection = true;
    }

    this.crossSections.push(intersectionMesh);
    this.scene.add(intersectionMesh);
    return intersectionMesh;
  }

  /**
   * CSGを使用して回転した垂直面で切断した断面を描画（回転した断面平面用）
   * @param {THREE.Object3D} pipeObject - 管路オブジェクト
   * @param {THREE.Vector3} planePoint - 断面平面を通る点（グリッド線上の点）
   * @param {THREE.Color} color - 断面の色
   */
  drawCSGCrossSectionRotated(pipeObject, planePoint, color) {
    // 元メッシュを複製し、薄いボックスとの交差(Intersect)で断面メッシュを得る
    const pipeMesh = this.buildStableCSGMesh(pipeObject, color);
    if (!pipeMesh) {
      return null;
    }

    // 断面平面の法線ベクトル（管路軸と入力角度から算出）
    const planeNormal3D = (this.currentPlaneNormal && this.currentPlaneNormal.lengthSq() > 0)
      ? this.currentPlaneNormal.clone()
      : this.getPerpendicularVector(this.currentAxisDirection);
    // const planeNormal = new THREE.Vector3(planeNormal3D.x, 0, planeNormal3D.z)
    const planeNormal = this.getVerticalPlaneNormalFromGrid(this.currentGridDirection, planeNormal3D);
    const planeNormalUnit = planeNormal.clone().normalize();
    const { size, thickness } = CROSS_SECTION_CONFIG.plane;
    const planeGeometry = new THREE.BoxGeometry(size, size, thickness);
    const planeMesh = new THREE.Mesh(planeGeometry, new THREE.MeshBasicMaterial({ color: 0xff0000 }));

    planeMesh.position.set(planePoint.x, planePoint.y, planePoint.z);

    const defaultNormal = new THREE.Vector3(0, 0, 1);
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(defaultNormal, planeNormal);
    planeMesh.quaternion.copy(quaternion);

    planeMesh.updateMatrix();

    let intersectionMesh = CSG.intersect(pipeMesh, planeMesh);
    if (!intersectionMesh?.geometry || intersectionMesh.geometry.attributes?.position?.count === 0) {
      const bbox = new THREE.Box3().setFromObject(pipeObject);
      const sz = new THREE.Vector3();
      bbox.getSize(sz);
      const nudge = this.getPlaneNudgeAmount(thickness, sz.length());
      const offsets = [nudge, -nudge, 2 * nudge, -2 * nudge];
      for (const off of offsets) {
        planeMesh.position.set(
          planePoint.x + planeNormalUnit.x * off,
          planePoint.y + planeNormalUnit.y * off,
          planePoint.z + planeNormalUnit.z * off
        );
        planeMesh.updateMatrix();
        intersectionMesh = CSG.intersect(pipeMesh, planeMesh);
        if (intersectionMesh?.geometry && intersectionMesh.geometry.attributes?.position?.count > 0) {
          break;
        }
      }
      if (!intersectionMesh?.geometry || intersectionMesh.geometry.attributes?.position?.count === 0) {
        return null;
      }
    }
    intersectionMesh.material = new THREE.MeshBasicMaterial({
      color: color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8
    });
    intersectionMesh.visible = this.showCrossSections;
    if (pipeObject?.userData?.objectData) {
      intersectionMesh.userData = intersectionMesh.userData || {};
      intersectionMesh.userData.objectData = pipeObject.userData.objectData;
      intersectionMesh.userData.isCrossSection = true;
    }

    this.crossSections.push(intersectionMesh);
    this.scene.add(intersectionMesh);
    return intersectionMesh;
  }

  /**
   * 断面をクリア
   */
  clear() {
    // 表示済みの線・ラベル・断面メッシュをすべて破棄
    this.depthLines.forEach(line => {
      this.scene.remove(line);
      if (line.geometry) line.geometry.dispose();
      if (line.material) line.material.dispose();
    });
    this.depthLines = [];
    this.gridLines = [];

    this.depthLabels.forEach(sprite => {
      this.scene.remove(sprite);
      if (sprite.material) {
        if (sprite.material.map) sprite.material.map.dispose();
        sprite.material.dispose();
      }
    });
    this.depthLabels = [];
    this.gridDepthLabels = [];
    this.depthLabelPositions = [];
    this.attributeLabelEntries = [];

    this.crossSections.forEach(mesh => {
      this.scene.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) mesh.material.dispose();
      mesh.traverse(child => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    });
    this.crossSections = [];

    this.line = null;
    // this.terrainVertices = [];
    this.terrainTriangles = null;
  }

  /**
   * 切り口の表示/非表示を切り替え
   * @param {boolean} show - 表示するかどうか
   */
  toggleCrossSections(show) {
    // 生成済みの断面メッシュの可視/不可視を切り替え
    this.showCrossSections = show;
    this.crossSections.forEach(crossSection => {
      crossSection.visible = show;
    });
  }

  /**
   * グリッド線（-50mまでの水平線）の表示/非表示を切り替え
   * @param {boolean} show - 表示するかどうか
   */
  toggleGridLines(show) {
    this.showGridLines = show;
    this.gridLines.forEach((line) => {
      line.visible = show;
    });
    this.gridDepthLabels.forEach((label) => {
      label.visible = show;
    });
  }

  /**
   * 深さガイド（グリッド線・縦線・ラベル）の表示/非表示を切り替え
   * @param {boolean} show - 表示するかどうか
   */
  toggleDepthGuides(show) {
    this.showDepthGuides = show;
    this.depthLines.forEach((line) => {
      line.visible = show;
    });
    this.depthLabels.forEach((label) => {
      label.visible = show;
    });
  }

  /**
   * 深さラベルのスケールをカメラからの距離に応じて更新
   */
  update() {
    // カメラ距離に応じて深さラベルのスケールを調整
    if (!this.camera || this.depthLabels.length === 0) {
      return;
    }

    const baseDistance = 20;
    const baseScale = 2;
    const minScale = 0.5;
    const maxScale = 5;

    for (let i = 0; i < this.depthLabels.length; i++) {
      const sprite = this.depthLabels[i];
      const position = this.depthLabelPositions[i];

      if (sprite && position) {
        const distance = this.camera.position.distanceTo(position);
        const scaleFactor = Math.max(minScale, Math.min(maxScale, (distance / baseDistance) * baseScale));
        sprite.scale.set(scaleFactor, scaleFactor * 0.25, 1);
      }
    }

    this.resolveAttributeLabelOverlaps();
  }

  /**
   * 属性表示ラベルの重なりを画面上で検出して、下方向に段差オフセットする
   */
  resolveAttributeLabelOverlaps() {
    if (!this.camera || !this.attributeLabelEntries || this.attributeLabelEntries.length <= 1) {
      return;
    }

    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);
    const {
      boxWidthPx,
      boxHeightPx,
      stepPx,
      maxSteps,
      groupThresholdPx
    } = CROSS_SECTION_CONFIG.attributeLabel.overlap;

    const items = this.attributeLabelEntries
      .map((entry) => {
        if (!entry?.sprite || !entry?.anchorPosition) return null;
        const projected = entry.anchorPosition.clone().project(this.camera);
        // 画面外は重なり判定対象外（元位置を維持）
        if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y) || !Number.isFinite(projected.z)) {
          return null;
        }
        if (projected.z < -1 || projected.z > 1) {
          entry.sprite.position.copy(entry.anchorPosition);
          return null;
        }
        const sx = (projected.x * 0.5 + 0.5) * width;
        const sy = (-projected.y * 0.5 + 0.5) * height;
        return { entry, sx, sy };
      })
      .filter(Boolean)
      .sort((a, b) => {
        if (Math.abs(a.sx - b.sx) < groupThresholdPx) return a.sy - b.sy;
        return a.sx - b.sx;
      });

    const placedRects = [];
    for (const item of items) {
      let step = 0;
      let rect = this.getOverlapRect(item.sx, item.sy + (step * stepPx), boxWidthPx, boxHeightPx);
      while (step < maxSteps && this.isOverlappingAnyRect(rect, placedRects)) {
        step += 1;
        rect = this.getOverlapRect(item.sx, item.sy + (step * stepPx), boxWidthPx, boxHeightPx);
      }
      placedRects.push(rect);

      const worldPerPixel = this.getWorldUnitsPerPixelAt(item.entry.anchorPosition);
      const worldOffset = this.camera.up.clone().normalize().multiplyScalar(-step * stepPx * worldPerPixel);
      item.entry.sprite.position.copy(item.entry.anchorPosition.clone().add(worldOffset));
    }
  }

  getOverlapRect(screenX, screenY, widthPx, heightPx) {
    return {
      left: screenX - widthPx / 2,
      right: screenX + widthPx / 2,
      top: screenY - heightPx / 2,
      bottom: screenY + heightPx / 2
    };
  }

  isOverlappingAnyRect(rect, placedRects) {
    return placedRects.some((other) => {
      const noOverlap =
        rect.right < other.left ||
        rect.left > other.right ||
        rect.bottom < other.top ||
        rect.top > other.bottom;
      return !noOverlap;
    });
  }

  getWorldUnitsPerPixelAt(worldPosition) {
    const viewportHeight = Math.max(window.innerHeight || 1, 1);
    if (this.camera.isOrthographicCamera) {
      const worldHeight = (this.camera.top - this.camera.bottom) / Math.max(this.camera.zoom || 1, 1e-6);
      return worldHeight / viewportHeight;
    }
    const distance = this.camera.position.distanceTo(worldPosition);
    const fovRad = THREE.MathUtils.degToRad(this.camera.fov || 50);
    const visibleHeight = 2 * Math.tan(fovRad / 2) * Math.max(distance, 1e-6);
    return visibleHeight / viewportHeight;
  }

  /**
   * 属性表示文字列を作成
   * 表示形式: (pipe_kind material diameter)
   * @param {Object} objectData
   * @returns {string}
   */
  formatPipeAttributeLabel(objectData) {
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

  /**
   * ウィンドウリサイズ時に呼び出される
   * Line2のLineMaterialのresolutionを更新
   */
  handleResize(width, height) {
    this.depthLines.forEach(line => {
      if (line.material && line.material.resolution) {
        line.material.resolution.set(width, height);
      }
      if (line.children) {
        line.children.forEach(child => {
          if (child.material && child.material.resolution) {
            child.material.resolution.set(width, height);
          }
        });
      }
    });
  }

  /**
   * クリーンアップ
   */
  dispose() {
    this.clear();
  }

  /**
   * 縦線/断面の生成対象から除外するshape_typeか
   * @param {Object} objectData
   * @returns {boolean}
   */
  shouldSkipVerticalAndCrossSection(objectData) {
    const shapeType = Number(objectData?.shape_type);
    return shapeType === 3 || shapeType === 11;
  }

  /**
   * 管路の半径を取得
   * @param {Object} objectData - 管路オブジェクトのデータ
   * @returns {number} - 管路の半径
   */
  getPipeRadius(objectData) {
    let radius = 0;
    if (objectData.attributes?.radius != null) {
      radius = Number(objectData.attributes.radius);
    } else if (objectData.attributes?.diameter != null) {
      radius = Number(objectData.attributes.diameter) / 2;
    }
    const { threshold, scale } = CROSS_SECTION_CONFIG.radius;
    if (radius > threshold) radius = radius / scale;
    if (objectData.shape_type === 3 || objectData.shape_type === 11) {
      return radius;
    } else {
      return radius;
    }
  }

  /**
   * 管路の始点と終点を計算
   * @param {Array} startVertex - 始点の頂点データ
   * @param {Array} endVertex - 終点の頂点データ
   * @param {Object} objectData - 管路オブジェクトのデータ
   * @param {number} radius - 管路の半径
   * @returns {Object} - {start, end} 始点と終点のVector3
   */
  getPipeStartEnd(startVertex, endVertex, objectData, radius) {
    const hasDepthAttrs = (
      objectData.attributes &&
      objectData.attributes.start_point_depth != null &&
      objectData.attributes.end_point_depth != null &&
      Number.isFinite(Number(objectData.attributes.start_point_depth)) &&
      Number.isFinite(Number(objectData.attributes.end_point_depth))
    );

    let start, end;
    if (hasDepthAttrs) {
      const startDepth = Number(objectData.attributes.start_point_depth / 100);
      const endDepth = Number(objectData.attributes.end_point_depth / 100);
      const startCenterY = startDepth > 0 ? -(startDepth + radius) : startDepth;
      const endCenterY = endDepth > 0 ? -(endDepth + radius) : endDepth;
      start = new THREE.Vector3(startVertex[0], startCenterY, -startVertex[1]);
      end = new THREE.Vector3(endVertex[0], endCenterY, -endVertex[1]);
    } else {
      start = new THREE.Vector3(startVertex[0], startVertex[2] - radius, -startVertex[1]);
      end = new THREE.Vector3(endVertex[0], endVertex[2] - radius, -endVertex[1]);
    }

    return { start, end };
  }

  /**
   * パス上の点のうち、指定した点と最も近い点が含まれる線分の端点を求める
   * @param {Array[]} path - パスの座標の配列
   * @param {THREE.Vector3} point - 指定した点
   * @returns {Object} - { start: Vector3, end: Vector3 } 線分の端点
   */
  getClosestStartEnd(path, point) {
    let minDist = Infinity;
    let closestPoint = null;
    let closestSegment = { start: null, end: null };

    // 関数：線分上の点までの最短距離とその点を計算
    function getClosestPointOnLineSegment(p1a, p2a, p) {
      const p1 = new THREE.Vector3(p1a[0], p1a[1], p1a[2]);
      const p2 = new THREE.Vector3(p2a[0], p2a[1], p2a[2]);

      const v = new THREE.Vector3();
      const w = new THREE.Vector3();
      v.subVectors(p2, p1);
      w.subVectors(p, p1);

      const c1 = v.dot(w);
      if (c1 <= 0) {
        // pの最近点はp1
        return p1;
      }

      const c2 = v.dot(v);
      if (c2 <= c1) {
        // pの最近点はp2
        return p2;
      }

      const b = c1 / c2;
      return new THREE.Vector3().addVectors(p1, v.multiplyScalar(b));
    }

    for (let i = 0; i < path.length - 1; i++) {
      const startPt = path[i];
      const endPt = path[i + 1];

      const closestPtOnSegment = getClosestPointOnLineSegment(startPt, endPt, point);
      const dist = closestPtOnSegment.distanceTo(point);

      if (dist < minDist) {
        minDist = dist;
        closestPoint = closestPtOnSegment;
        const startV = new THREE.Vector3(startPt[0], startPt[1], startPt[2]);
        const endV = new THREE.Vector3(endPt[0], endPt[1], endPt[2]);
        closestSegment = { start: startV, end: endV };
      }
    }

    return closestSegment;
  }

  /**
   * パス上の点を、指定の変換を適用して変換する
   * @param {Array<Array<number>>} points - パスの座標の配列（例: [ [x, y, z], [x, y, z], ... ]）
   * @returns {Array<Array<number>>} - 変換後の座標の配列
   */
  convPoints(points) {
    const convertedPoints = [];

    for (let i = 0; i < points.length; i++) {
      const [x, y, z] = points[i];

      // 変換後の座標を作成
      const newX = x;
      const newY = z;
      const newZ = y * (-1);

      // 配列として格納
      convertedPoints.push([newX, newY, newZ]);
    }

    return convertedPoints;
  }

  /**
   * 指定したジオメトリと点Aを通るY軸平行な直線の交点リスト（点Aが三角形内にある場合のみ）
   * 1つでも条件を満たしたら即終了
   * @param {THREE.Vector3} pointA
   * @returns {THREE.Vector3[]}
   */
  findFirstLinePlaneIntersectionIfInsideXZ(pointA, triangles) {
    const intersections = [];

    if (!triangles) {
      return intersections;
    }

    if (triangles.length === 0) {
      return intersections;
    }

    const lineDir = new THREE.Vector3(0, 1, 0); // Y軸

    for (let k = 0; k < triangles.length; k++) {
      const v0 = triangles[k].p1;
      const v1 = triangles[k].p2;
      const v2 = triangles[k].p3;
      // 1. XYZ平面に投影（XZ平面）
      const v0_2d = new THREE.Vector2(v0.x, v0.z);
      const v1_2d = new THREE.Vector2(v1.x, v1.z);
      const v2_2d = new THREE.Vector2(v2.x, v2.z);
      const pointA_2d = new THREE.Vector2(pointA.x, pointA.z);

      // 2. 点Aが三角形内か判定
      if (this.isPointInTriangle2D(pointA_2d, v0_2d, v1_2d, v2_2d)) {
        // 条件を満たすので、交点計算
        const faceNormal = new THREE.Vector3().crossVectors(
          new THREE.Vector3().subVectors(v1, v0),
          new THREE.Vector3().subVectors(v2, v0)
        ).normalize();

        const denom = faceNormal.dot(lineDir);
        if (Math.abs(denom) > 1e-6) {
          const numerator = faceNormal.dot(new THREE.Vector3().subVectors(v0, pointA));
          const t = numerator / denom;
          const intersection = new THREE.Vector3().addVectors(
            pointA,
            new THREE.Vector3().copy(lineDir).multiplyScalar(t)
          );
          intersections.push(intersection);

          // 1つ見つけたらループ中止
          return intersections;
        }
        if (Math.abs(denom) == 0) {
          console.log('findFirsLinePlaneIntersectionIfInsideXZ: denom == 0');
        }
      }
    }

    return intersections;
  }


  /**
   * 2D点が三角形に含まれるか判定（点A,B,Cは2D座標）
   */
  isPointInTriangle2D(p, a, b, c) {
    const d0 = b.clone().sub(a);
    const d1 = c.clone().sub(a);
    const d2 = p.clone().sub(a);

    const dot00 = d0.dot(d0);
    const dot01 = d0.dot(d1);
    const dot02 = d0.dot(d2);
    const dot11 = d1.dot(d1);
    const dot12 = d1.dot(d2);

    const denom = (dot00 * dot11 - dot01 * dot01);
    if (denom === 0) return false;

    const u = (dot11 * dot02 - dot01 * dot12) / denom;
    const v = (dot00 * dot12 - dot01 * dot02) / denom;

    if ((u == 0) && (v == 0) && (u + v == 1)) {
      console.log('isPointInTriangle2D: on line');
    }

    return (u >= 0) && (v >= 0) && (u + v <= 1);
  }

  // 座標系変換用関数
  convertToCustomCoordinate(vec) {
    return new THREE.Vector3(
      vec.x,
      -vec.z,
      vec.y
    );
  }

  // 逆変換（必要なら）
  convertToStandardCoordinate(vec) {
    return new THREE.Vector3(
      vec.x,
      vec.z,
      -vec.y
    );
  }

  /**
   * 地表と断面の交線
   * @param {THREE.BufferGeometry} geometry - 交差判定したいMeshのGeometry
   * @param {THREE.Vector3} planePoint - 平面上の点A
   * @param {THREE.Vector3} planeNormal - 平面の法線V（正規化済み）
   * @returns {THREE.Line|null} 交線のLineオブジェクトまたはnull
   */
  getIntersectionLine(geometry, planePoint, planeNormal) {
    const positions = geometry.attributes.position.array;
    const vertexCount = geometry.attributes.position.count;

    planePoint = this.convertToCustomCoordinate(planePoint);

    // 頂点を変換し格納
    const vertices = [];
    for (let i = 0; i < vertexCount; i++) {
      const v = new THREE.Vector3(
        positions[i * 3],
        positions[i * 3 + 1],
        positions[i * 3 + 2]
      );
      vertices.push(this.convertToCustomCoordinate(v));
    }

    const intersectionPoints = [];

    // 辺の交点計算
    if (geometry.index) {
      const indices = geometry.index.array;
      for (let i = 0; i < indices.length; i += 3) {
        const idxs = [indices[i], indices[i + 1], indices[i + 2]];

        for (let j = 0; j < 3; j++) {
          const p1 = vertices[idxs[j]];
          const p2 = vertices[idxs[(j + 1) % 3]];

          const intersection = this.getLinePlaneIntersection(p1, p2, planePoint, planeNormal);
          if (intersection) {
            intersectionPoints.push(intersection);
          }
        }
      }
    } else {
      // インデックスなし（非Indexed）
      for (let i = 0; i < vertexCount; i += 3) {
        const p1 = vertices[i];
        const p2 = vertices[i + 1];
        const p3 = vertices[i + 2];

        const edges = [
          [p1, p2],
          [p2, p3],
          [p3, p1]
        ];

        for (const [start, end] of edges) {
          const intersection = this.getLinePlaneIntersection(start, end, planePoint, planeNormal);
          if (intersection) {
            intersectionPoints.push(intersection);
          }
        }
      }
    }

    if (intersectionPoints.length === 0) return null;

    // 交点をラインとしてつなぐ
    const lineGeom = new THREE.BufferGeometry().setFromPoints(intersectionPoints);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xff0000 });
    const line = new THREE.Line(lineGeom, lineMaterial);
    return line;
  }

  /**
   * 線分と平面の交点を計算
   * @param {THREE.Vector3} p1 - 線分端点1
   * @param {THREE.Vector3} p2 - 線分端点2
   * @param {THREE.Vector3} planePoint - 平面上の点A
   * @param {THREE.Vector3} planeNormal - 平面の法線V（正規化済み）
   * @returns {THREE.Vector3|null} 交点またはnull
   */
  getLinePlaneIntersection(p1, p2, planePoint, planeNormal) {
    const lineDir = new THREE.Vector3().subVectors(p2, p1);
    const denom = planeNormal.dot(lineDir);

    if (Math.abs(denom) < 1e-6) {
      return null; // 平行
    }

    const t = planeNormal.dot(new THREE.Vector3().subVectors(planePoint, p1)) / denom;
    if (t >= 0 && t <= 1) {
      const intersection = new THREE.Vector3().addVectors(p1, lineDir.multiplyScalar(t));
      // 変換後の座標を再び標準座標系に
      return this.convertToStandardCoordinate(intersection);
    }
    return null;
  }

  /**
   * 地表と断面の交線を削除
   */
  clearCrossSectionTerrainLine() {
    const names = ['CrossSectionTerrainLine', 'dbgNodeAxisLine', 'dbgTerrainPolygonLineA', 'dbgTerrainPolygonLineB', 'dbgTerrainPolygonLineC'];
    const nums = [this.CrossSectionTerrainLineNum, this.dbgNodeAxisLineNum, this.dbgTerrainPolygonLineNum, this.dbgTerrainPolygonLineNum, this.dbgTerrainPolygonLineNum];
    for (let i = 0; i < names.length; i++) {
      const name = names[i];
      const num = nums[i];
      for (let j = 0; j < num; j++) {
        const obj = this.scene.getObjectByName(name + j.toString());
        if (obj) {
          this.scene.remove(obj);
          // オブジェクトのジオメトリとマテリアルも解放
          if (obj.geometry) obj.geometry.dispose();
          if (obj.material) obj.material.dispose();
          // console.log(`${name} が削除されました`);
        } else {
          console.log(`${name + j.toString()} はシーンに存在しません`);
        }
      }
    }

    this.CrossSectionTerrainLineNum = 0;
    this.dbgNodeAxisLineNum = 0;
    this.dbgTerrainPolygonLineNum = 0;
  }

  /**
   * 断面のY=0平面上の直線を生成（シータ、ローを取得）
   */
  computeHoughLineFrom3D(normalVec, point3D) {
    // 1. 直線の方向ベクトル（法線に垂直なベクトル）を見つける
    // 例：法線に垂直なベクトルを求める
    const normal = normalVec.clone().normalize();

    // 2. 直線の方向ベクトル（例：法線に垂直なベクトル）
    // ここでは、法線に垂直な任意のベクトルを見つける
    let dir2D;
    if (Math.abs(normal.x) < 1e-6) {
      // normalがz軸に平行な場合
      dir2D = { x: 1, y: 0 };
    } else {
      // normalに垂直なベクトル（xz平面内）
      dir2D = { x: -normal.z, y: normal.x };
    }
    // 方向ベクトルの角度
    const thetaDir = Math.atan2(dir2D.y, dir2D.x);

    // 3. 直線の法線角度（θ）
    const theta = thetaDir + Math.PI / 2; // 垂直な方向の角度

    // 4. 直線上の点の投影
    const p2d = { x: point3D.x, y: point3D.z };

    // 5. ρの計算（符号付き距離）
    const rho = p2d.x * Math.cos(theta) + p2d.y * Math.sin(theta);

    return { theta: theta, rho: rho };
  }

  filterNodes(objects, nodes) {
    // return objects;

    const nodeIdSet = new Set(
      nodes
        .map(node => node?.id)
        .filter(id => id != null)
        .map(id => String(id))
    );

    const keyByMesh = new Map();
    if (this.objectsRef?.current) {
      Object.entries(this.objectsRef.current).forEach(([key, mesh]) => {
        if (mesh) keyByMesh.set(mesh, String(key));
      });
    }

    const filtered = [];
    const added = new Set();

    for (let i = 0; i < objects.length; i++) {
      const mesh = objects[i];
      const objectData = mesh?.userData?.objectData;
      if (!objectData) continue;

      const featureId = objectData.feature_id != null ? String(objectData.feature_id) : null;
      const objectKey = keyByMesh.get(mesh) || null;

      const matched = (featureId && nodeIdSet.has(featureId));
      if (!matched) continue;
      const dedupeKey = featureId || objectKey || `idx-${i}`;
      if (added.has(dedupeKey)) continue;
      added.add(dedupeKey);
      filtered.push(mesh);
    }
    // const filtered = [];
    // const ids = [];
    // for (let j = 0; j < nodes.length; j++) {
    // if (ids.includes(nodes[j].id)) {
    // continue;
    // } else {
    // for (let i = 0; i < objects.length; i++) {
    // if (objects[i].userData.objectData.feature_id.toString() == nodes[j].id) {
    // filtered.push(objects[i]);
    // ids.push(nodes[j].id);
    // break;
    // }
    // }
    // }
    // }

    return filtered;
  }

  // 四分木
  rootQuadTreeTriangle(box, maxDepth = 8, maxObjects = 10) {
    // 2D用にzは無視
    const boundary = {
      min: { x: box.min.x, y: box.min.z },
      max: { x: box.max.x, y: box.max.z }
    };
    this.terrainTriangles = new QuadtreeNodeTriangle(boundary, 0, maxDepth, maxObjects);
  }

  registerQuadTreeTriangle(triangles) {
    for (let i = 0; i < triangles.length; i++) {
      const p1 = this.convertToCustomCoordinate(triangles[i][0]);
      const p2 = this.convertToCustomCoordinate(triangles[i][1]);
      const p3 = this.convertToCustomCoordinate(triangles[i][2]);
      // データを四分木に登録
      const tri = new Triangle(i, { x: p1.x, y: p1.y, z: p1.z }, { x: p2.x, y: p2.y, z: p2.z }, { x: p3.x, y: p3.y, z: p3.z });
      this.terrainTriangles.insert(tri);
    }
  }

  searchTriangles(theta, rho) {
    const result = [];
    this.searchIntersectingTriangles(this.terrainTriangles, theta, rho, result);
    return result
  }

  searchIntersectingTriangles(node, theta, rho, result = []) {
    // ノードのAABBと直線のρ範囲の交差判定
    if (!this.lineIntersectsAABBWithRhoTriangle(node.boundary, theta, rho)) {
      return result; // 交差しなければ探索終了
    }

    // ノードに三角形があれば
    if (node.hasObject) {
      for (const tri of node.objects) {
        if (this.rectIntersectsLineHoughTriangle(tri, theta, rho)) {
          const p1 = this.convertToStandardCoordinate(tri.p1);
          const p2 = this.convertToStandardCoordinate(tri.p2);
          const p3 = this.convertToStandardCoordinate(tri.p3);
          const triConv = { id: tri.id, p1: p1, p2: p2, p3: p3 };
          result.push(triConv);
        }
      }
    }

    // 子ノードがあれば再帰
    if (node.children.length > 0) {
      for (const child of node.children) {
        this.searchIntersectingTriangles(child, theta, rho, result);
      }
    }

    return result;
  }

  // AABBとρの範囲の交差判定
  lineIntersectsAABBWithRhoTriangle(boundary, theta, rho) {
    // boundary: {min: {x,y}, max: {x,y}}
    // boundaryの4点のρ値
    const vertices = [
      { x: boundary.min.x, y: boundary.min.z },
      { x: boundary.max.x, y: boundary.min.z },
      { x: boundary.min.x, y: boundary.max.z },
      { x: boundary.max.x, y: boundary.max.z }
    ];
    const rhos = vertices.map(p => p.x * Math.cos(theta) + p.y * Math.sin(theta));
    const minRho = Math.min(...rhos);
    const maxRho = Math.max(...rhos);
    // ρの範囲の重なり
    return !(rho < minRho || rho > maxRho);
  }

  rectIntersectsLineHoughTriangle(tri, theta, rho) {
    const rhoRange = tri.getRhoRange(theta);
    // 直線のρの値と矩形のρ範囲の重なり
    return !(rho < rhoRange.min || rho > rhoRange.max);
  }

  // 例：平面の交線を描画する関数
  createIntersectionLineXY(planeNormal, planePoint, rangeX, rangeZ, segmentCount = 50) {
    const linePoints = [];
    // XとZの範囲内で点をサンプリング
    for (let i = 0; i <= segmentCount; i++) {
      const t = i / segmentCount;
      const x = rangeX[0] + t * (rangeX[1] - rangeX[0]);
      const z = rangeZ[0] + t * (rangeZ[1] - rangeZ[0]);

      // planeの式から y=0 のときの zを解く
      // planeNormal.x * (x - x0) + planeNormal.y * (0 - y0) + planeNormal.z * (z - z0) = 0
      // z = z0 - (planeNormal.x*(x - x0) + planeNormal.y*(- y0))/planeNormal.z
      // ただし、planeNormal.z != 0 の場合だけ計算
      if (Math.abs(planeNormal.z) > 1e-8) {
        const zOnPlane = planePoint.z - (
          (planeNormal.x * (x - planePoint.x) + planeNormal.y * (0 - planePoint.y))
        ) / planeNormal.z;
        linePoints.push(new THREE.Vector3(x, 0, zOnPlane));
        this.createSphere(new THREE.Vector3(x, 0, zOnPlane), 0.1, 0x0000ff);
      } else if (Math.abs(planeNormal.x) > 1e-8) {
        // planeNormal.zが0, planeNormal.xが0でない場合
        const xOnPlane = planePoint.x - (
          (planeNormal.y * (0 - planePoint.y) + planeNormal.z * (z - planePoint.z))
        ) / planeNormal.x;
        linePoints.push(new THREE.Vector3(xOnPlane, 0, z));
        this.createSphere(new THREE.Vector3(xOnPlane, 0, z), 0.1, 0x0000ff);
      } else {
        // この場合は平面のxとzの関係が固定、もしくは線分の範囲外
        // 例外ケース
      }
    }

    // 線分として描画
    const geometry = new THREE.BufferGeometry().setFromPoints(linePoints);
    const material = new THREE.LineBasicMaterial({ color: 0x0000ff });
    const line = new THREE.Line(geometry, material);
    return line;
  }

  /**
   * カプセルと平面の交点または端点を返す関数
   * @param {THREE.Vector3} planeNormal - 平面の法線ベクトル
   * @param {THREE.Vector3} planePoint - 平面上の点
   * @param {THREE.Vector3} start - カプセル軸端点start
   * @param {THREE.Vector3} end - カプセル軸端点end
   * @param {number} radius - カプセルの半径
   * @returns {THREE.Vector3|null} 交点または条件を満たす点、交差しなければnull
   */
  findCapsuleSection(planeNormal, planePoint, start, end, radius, flag = false) {
    const EPS = 1e-8;

    // 直交線分の定義（平面と直交、平面と平行）
    // lineStartはstartを通り、平面と直交
    // lineEndはendを通り、平面と直交
    // ただし、具体的な線分座標は不明なので、以下は仮のとして。
    // 例: lineStartとlineEndは平面と直交した線分の端点であると仮定。

    // 例として：
    // ただし、問題の詳細から、「lineStartとlineEndは平面と直交」、
    // かつ「startとendを通る平面と直交する線分」
    // なので、これらの点は以下のように計算できる。

    // まず、startとendから平面に直交する直線の端点を求める。
    // これらの点は、startおよびendから平面法線に沿った距離だけずらした位置。

    // ただし、実際にはlineStartとlineEndは平面と平行（平面と直交）な線分の端点、
    // それがstart, endを通るという条件を満たす点を計算。

    // 例として：  
    // ① startを通り、平面と直交した直線の点（lineStartの端点）
    //const lineStart = new THREE.Vector3().copy(start);
    // ② endを通り、平面と直交した直線の点（lineEndの端点）
    //const lineEnd = new THREE.Vector3().copy(end);

    // これらの点は、平面と直交：  
    // そのため、lineStartとlineEndは平面の法線に沿った線分長さ分だけずれる。

    // 実用例として、lineStartとlineEndを平面上に投影し、  
    // startとendの位置を考慮しながら計算します。

    // 以下は、一つの例：  
    // 1. start点から平面に垂直な線を引いた交点を pointStart とする  
    const planeLineDirection = planeNormal.clone().normalize(); // 平面と直交する線は法線方向
    const tStart = (planePoint.clone().sub(start)).dot(planeNormal) / planeNormal.dot(planeNormal);
    const pointStart = new THREE.Vector3().copy(start).addScaledVector(planeNormal, tStart);

    // 2. end点から平面に垂直な線を引いた交点を pointEnd とする  
    const tEnd = (planePoint.clone().sub(end)).dot(planeNormal) / planeNormal.dot(planeNormal);
    const pointEnd = new THREE.Vector3().copy(end).addScaledVector(planeNormal, tEnd);

    // これらは、startとendから平面に向かう垂線の交点。

    if (flag) {
      this.createSphere(planePoint, 0.1, 0xffff00);
      this.createSphere(pointStart, 0.1, 0xff00ff);
      this.createSphere(pointEnd, 0.1, 0x00ffff);
    }

    // 交点の距離
    const distStart = pointStart.distanceTo(start);
    const distEnd = pointEnd.distanceTo(end);

    // 直線（lineStart, lineEnd）と平面の交点
    // これらの点はすでに計算済
    // ただし、lineStartとlineEndは、上下の点として
    // それぞれの交点と仮定し、交点をconsider

    // 次に、「pointStartからstartまでのベクトル」と
    // 「pointEndからendまでのベクトル」の向きが同じか判定
    const vecStartToPointStart = new THREE.Vector3().subVectors(pointStart, start);
    const vecEndToPointEnd = new THREE.Vector3().subVectors(pointEnd, end);

    // 逆方向なら反対向き
    const sameDirection = vecStartToPointStart.dot(vecEndToPointEnd) >= 0;

    // 判断：
    // 1. sameDirection == false => 交差と判定
    // 2. sameDirection == true の場合、距離の大小を比較
    if (!sameDirection) {
      const crossPoint = this.intersectLineSegmentWithPlane(planeNormal, planePoint, start, end);

      if (flag) {
        this.createSphere(crossPoint, 0.1, 0xffffff);
      }

      return crossPoint;
    } else {
      // distancesを比較し、小さい方の点を返す
      if (distStart < distEnd) {
        return distStart <= radius + EPS ? new THREE.Vector3().copy(pointStart) : null;
      } else {
        return distEnd <= radius + EPS ? new THREE.Vector3().copy(pointEnd) : null;
      }
    }
  }

  /**
   * 線分start-endと平面の交点を求める関数
   * @param {THREE.Vector3} planeNormal  平面の法線ベクトル
   * @param {THREE.Vector3} planePoint   通る点
   * @param {THREE.Vector3} start        線分の端点1
   * @param {THREE.Vector3} end          線分の端点2
   * @returns {THREE.Vector3|null} 交点、なければnull
   */
  intersectLineSegmentWithPlane(planeNormal, planePoint, start, end) {
    const EPS = 1e-8;

    const lineDir = new THREE.Vector3().subVectors(end, start);
    const denom = planeNormal.dot(lineDir);

    if (Math.abs(denom) < EPS) {
      // 直線と平面が平行（交差しないか、重なる）
      // もし startが平面上にあれば、その範囲に含まれる
      const distance = planeNormal.dot(start) - planePoint.dot(planeNormal);
      if (Math.abs(distance) < EPS) {
        // 線分全体が平面上（無限交差）
        // 例として start を返すか、範囲任意
        return start.clone();
      } else {
        // 平行で交差しない
        return null;
      }
    } else {
      // tパラメータを計算
      const t = (planePoint.clone().sub(start)).dot(planeNormal) / denom;

      // tが0から1の範囲内なら線分上
      if (t >= -EPS && t <= 1 + EPS) {
        const intersectionPoint = new THREE.Vector3().copy(start).addScaledVector(lineDir, t);
        return intersectionPoint;
      } else {
        // 交点は線分外
        return null;
      }
    }
  }

  // 補助関数：サンプリングと極値探索
  sampleCirclePoints(centerPoint, circleNormal, radius, dbgFlag = false) {
    const numSamples = 36;
    const basisVec1 = new THREE.Vector3(1, 0, 0);
    if (Math.abs(circleNormal.dot(basisVec1)) > 0.99) {
      basisVec1.set(0, 0, 1);
    }
    const basisVec2 = new THREE.Vector3().crossVectors(circleNormal, basisVec1).normalize();
    basisVec1.crossVectors(circleNormal, basisVec2).normalize();

    let maxPoint = null;
    let minPoint = null;
    let maxY = -Infinity;
    let minY = Infinity;

    for (let i = 0; i < numSamples; i++) {
      const angle = (i / numSamples) * Math.PI * 2;
      const x = Math.cos(angle);
      const y = Math.sin(angle);
      const point = new THREE.Vector3()
        .copy(centerPoint)
        .addScaledVector(basisVec1, x * radius)
        .addScaledVector(basisVec2, y * radius);

      if (dbgFlag) {
        this.createSphere(point, 0.01, 0x00ff00);
      }

      if (point.y > maxY) {
        maxY = point.y;
        maxPoint = point.clone();
      }
      if (point.y < minY) {
        minY = point.y;
        minPoint = point.clone();
      }
    }
    return {
      highestPoint: maxPoint,
      lowestPoint: minPoint,
      centerPoint: centerPoint
    };
  }

  computeExtremes(centerPoint, circleNormal, start, end, radius) {
    // 軸線上の点が平面上にある場合
    return this.sampleCirclePoints(centerPoint, circleNormal, radius);
  }

  // 球の作成関数
  createSphere(centerPoint, radius, color) {
    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshStandardMaterial({ color: color });
    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(centerPoint);
    this.scene.add(sphere);
  }
}

// 3Dベクトルの基本操作
class Vector3 {
  constructor(x, y, z) {
    this.x = x; this.y = y; this.z = z;
  }

  clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  add(v) {
    this.x += v.x; this.y += v.y; this.z += v.z;
    return this;
  }

  subtract(v) {
    this.x -= v.x; this.y -= v.y; this.z -= v.z;
    return this;
  }

  multiplyScalar(s) {
    this.x *= s; this.y *= s; this.z *= s;
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  normalize() {
    const len = this.length();
    if (len > 0) {
      this.multiplyScalar(1 / len);
    }
    return this;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
}

export default CrossSectionPlane;