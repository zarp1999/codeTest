import React from 'react';
import * as THREE from 'three';
import './DistanceMeasurement.css';

/**
 * 距離計測コンポーネント
 * - 左Shift + 左ドラッグで管路またはCSG断面間の距離を計測
 * - 近接点と指定点の両方を表示
 * - Escキーでクリア
 */
class DistanceMeasurement {
  constructor(scene, camera, renderer, objectsRef, raycasterRef, mouseRef, crossSectionRef = null, enableCrossSectionMode = false) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.objectsRef = objectsRef;
    this.raycasterRef = raycasterRef;
    this.mouseRef = mouseRef;
    this.crossSectionRef = crossSectionRef;  // CSG断面用のref
    this.enableCrossSectionMode = enableCrossSectionMode;  // 断面図生成画面かどうか

    // 計測状態
    this.isMeasuring = false;
    this.startPipe = null;
    this.endPipe = null;
    this.startPoint = null;  // 実際のクリック位置（始点）
    this.endPoint = null;    // 実際のクリック位置（終点）
    this.measurementLines = [];  // 指定距離の線（赤）の配列
    this.closestLines = [];      // 近接距離の線（青）の配列
    this.measurementTexts = [];  // 指定距離のテキストスプライトの配列
    this.closestTexts = [];      // 近接距離のテキストスプライトの配列
    this.measurementPoints = [];
    this.textMesh = null;
    this.previewLine = null; // プレビュー線

    // 線の方向ベクトル（カメラ向きの回転用）- 配列で管理
    this.lineDirections = [];
    this.lineMidPoints = [];
    this.closestLineDirections = [];
    this.closestLineMidPoints = [];

    // テキストの位置情報（スケール調整用）- 配列で管理
    this.measurementTextPositions = [];
    this.closestTextPositions = [];

    // 表示状態管理
    this.showClosest = true;   // 近接距離を表示
    this.showSpecified = false; // 指定距離を非表示

    // 計測結果データ
    this.measurementResult = null;

    // イベントハンドラーのバインド
    this.handleMouseDown = this.handleMouseDown.bind(this);
    this.handleMouseMove = this.handleMouseMove.bind(this);
    this.handleMouseUp = this.handleMouseUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);

    // 結果更新コールバック
    this.onResultUpdate = null;
  }

  /**
   * Unity方式: Y軸離隔（ギャップ）を計算
   * - AとBのY範囲が完全に分離している場合のみ、そのギャップを返す
   * - 重なっている場合は0
   */
  getYAxisGap(meshA, meshB) {
    const rangeA = this.getMeshYRange(meshA);
    const rangeB = this.getMeshYRange(meshB);
    if (!rangeA || !rangeB) return 0;

    if (rangeA.maxY < rangeB.minY) return rangeB.minY - rangeA.maxY;
    if (rangeB.maxY < rangeA.minY) return rangeA.minY - rangeB.maxY;
    return 0;
  }

  /**
   * メッシュのワールド座標Y範囲を取得
   */
  getMeshYRange(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
      mesh.localToWorld(v);
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
    }
    if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
    return { minY, maxY };
  }

  /**
   * Unity方式: 3D離隔計測（XZ投影→2D凸包→2D最短→逆投影）
   * @returns {{pointA: THREE.Vector3, pointB: THREE.Vector3, distance: number, horizontalDistance: number} | null}
   */
  getClosestPointsBetweenMeshesUnity(meshA, meshB) {
    const verticesA = this.getMeshWorldVertices(meshA);
    const verticesB = this.getMeshWorldVertices(meshB);
    if (!verticesA.length || !verticesB.length) return null;

    const points2DA = verticesA.map((v) => new THREE.Vector2(v.x, v.z));
    const points2DB = verticesB.map((v) => new THREE.Vector2(v.x, v.z));

    const hullIdxA = this.computeConvexHullIndices2D(points2DA);
    const hullIdxB = this.computeConvexHullIndices2D(points2DB);

    // 凸包が作れない（極端に点が少ない）場合は、全点同士の最短距離（2D）にフォールバック
    if (hullIdxA.length < 2 || hullIdxB.length < 2) {
      let best = null;
      let minD2 = Infinity;
      for (let i = 0; i < points2DA.length; i++) {
        for (let j = 0; j < points2DB.length; j++) {
          const d2 = points2DA[i].distanceToSquared(points2DB[j]);
          if (d2 < minD2) {
            minD2 = d2;
            best = {
              pointA2D: points2DA[i].clone(),
              pointB2D: points2DB[j].clone(),
              aRef: { type: 'vertex', index: i },
              bRef: { type: 'vertex', index: j },
            };
          }
        }
      }
      if (!best) return null;
      const pA3 = this.lift2DPointTo3D(best.pointA2D, best.aRef, verticesA);
      const pB3 = this.lift2DPointTo3D(best.pointB2D, best.bRef, verticesB);
      const d3 = pA3.distanceTo(pB3);
      const dxz = best.pointA2D.distanceTo(best.pointB2D);
      return { pointA: pA3, pointB: pB3, distance: d3, horizontalDistance: dxz };
    }

    const closest2D = this.findClosestBetweenPolylines2D(points2DA, hullIdxA, points2DB, hullIdxB);
    if (!closest2D) return null;

    const pointA3D = this.lift2DPointTo3D(closest2D.pointA2D, closest2D.aRef, verticesA);
    const pointB3D = this.lift2DPointTo3D(closest2D.pointB2D, closest2D.bRef, verticesB);
    const distance3D = pointA3D.distanceTo(pointB3D);
    const distanceXZ = closest2D.pointA2D.distanceTo(closest2D.pointB2D);

    return {
      pointA: pointA3D,
      pointB: pointB3D,
      distance: distance3D,
      horizontalDistance: distanceXZ,
    };
  }

  /**
   * メッシュの全頂点をワールド座標で取得
   * @returns {THREE.Vector3[]}
   */
  getMeshWorldVertices(mesh) {
    const geometry = mesh?.geometry;
    const position = geometry?.attributes?.position;
    if (!position) return [];

    const vertices = [];
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3(position.getX(i), position.getY(i), position.getZ(i));
      mesh.localToWorld(v);
      vertices.push(v);
    }
    return vertices;
  }

  /**
   * 2D凸包（Andrew monotone chain）: 凸包を構成する元頂点インデックスを返す
   * @param {THREE.Vector2[]} points
   * @returns {number[]} hullIndices
   */
  computeConvexHullIndices2D(points) {
    if (!points || points.length < 3) {
      return (points || []).map((_, i) => i);
    }

    // 重複点を潰す（epsilon丸め）
    const eps = 1e-6;
    const keyOf = (p) => `${Math.round(p.x / eps)}:${Math.round(p.y / eps)}`;
    const unique = new Map();
    for (let i = 0; i < points.length; i++) {
      const k = keyOf(points[i]);
      if (!unique.has(k)) unique.set(k, i);
    }
    const items = Array.from(unique.values()).map((idx) => ({ idx, p: points[idx] }));
    if (items.length < 3) return items.map((it) => it.idx);

    items.sort((a, b) => (a.p.x === b.p.x ? a.p.y - b.p.y : a.p.x - b.p.x));

    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

    const lower = [];
    for (const it of items) {
      while (lower.length >= 2) {
        const b = lower[lower.length - 1];
        const a = lower[lower.length - 2];
        if (cross(a.p, b.p, it.p) <= 0) lower.pop();
        else break;
      }
      lower.push(it);
    }

    const upper = [];
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      while (upper.length >= 2) {
        const b = upper[upper.length - 1];
        const a = upper[upper.length - 2];
        if (cross(a.p, b.p, it.p) <= 0) upper.pop();
        else break;
      }
      upper.push(it);
    }

    // 末尾重複を除去して結合
    upper.pop();
    lower.pop();
    const hull = lower.concat(upper);
    return hull.map((it) => it.idx);
  }

  /**
   * 2D上で「凸包（またはポリライン）」同士の最短距離を探索
   * - Unity側の「頂点-頂点」「頂点-辺」を再現
   * @param {THREE.Vector2[]} pointsA 全点
   * @param {number[]} polyAIndices 凸包（or ポリライン）インデックス（閉曲線想定）
   * @param {THREE.Vector2[]} pointsB 全点
   * @param {number[]} polyBIndices 凸包（or ポリライン）インデックス（閉曲線想定）
   * @returns {{pointA2D: THREE.Vector2, pointB2D: THREE.Vector2, aRef: Object, bRef: Object} | null}
   */
  findClosestBetweenPolylines2D(pointsA, polyAIndices, pointsB, polyBIndices) {
    if (!polyAIndices.length || !polyBIndices.length) return null;

    let best = null;
    let minD2 = Infinity;

    const update = (pA2, pB2, aRef, bRef) => {
      const d2 = pA2.distanceToSquared(pB2);
      if (d2 < minD2) {
        minD2 = d2;
        best = { pointA2D: pA2.clone(), pointB2D: pB2.clone(), aRef, bRef };
      }
    };

    // A頂点 -> B辺
    for (let ia = 0; ia < polyAIndices.length; ia++) {
      const aIdx = polyAIndices[ia];
      const pA = pointsA[aIdx];
      for (let jb = 0; jb < polyBIndices.length; jb++) {
        const b0Idx = polyBIndices[jb];
        const b1Idx = polyBIndices[(jb + 1) % polyBIndices.length];
        const seg = this.closestPointOnSegment2D(pA, pointsB[b0Idx], pointsB[b1Idx]);
        update(pA, seg.point, { type: 'vertex', index: aIdx }, { type: 'edge', startIndex: b0Idx, endIndex: b1Idx, t: seg.t });
      }
    }

    // B頂点 -> A辺
    for (let ib = 0; ib < polyBIndices.length; ib++) {
      const bIdx = polyBIndices[ib];
      const pB = pointsB[bIdx];
      for (let ja = 0; ja < polyAIndices.length; ja++) {
        const a0Idx = polyAIndices[ja];
        const a1Idx = polyAIndices[(ja + 1) % polyAIndices.length];
        const seg = this.closestPointOnSegment2D(pB, pointsA[a0Idx], pointsA[a1Idx]);
        update(seg.point, pB, { type: 'edge', startIndex: a0Idx, endIndex: a1Idx, t: seg.t }, { type: 'vertex', index: bIdx });
      }
    }

    return best;
  }

  /**
   * 2D線分上の最近接点（tも返す）
   * @returns {{point: THREE.Vector2, t: number}}
   */
  closestPointOnSegment2D(point, a, b) {
    const ab = new THREE.Vector2().subVectors(b, a);
    const abLen2 = ab.lengthSq();
    if (abLen2 < 1e-12) return { point: a.clone(), t: 0 };
    const ap = new THREE.Vector2().subVectors(point, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / abLen2));
    return { point: a.clone().add(ab.multiplyScalar(t)), t };
  }

  /**
   * 2D最近接点を3Dに戻す（頂点 or 辺）
   */
  lift2DPointTo3D(point2D, ref, worldVertices) {
    if (!ref || !worldVertices?.length) {
      return new THREE.Vector3(point2D.x, 0, point2D.y);
    }

    if (ref.type === 'vertex') {
      const v = worldVertices[ref.index] || new THREE.Vector3(0, 0, 0);
      return new THREE.Vector3(point2D.x, v.y, point2D.y);
    }

    if (ref.type === 'edge') {
      const a = worldVertices[ref.startIndex] || new THREE.Vector3(0, 0, 0);
      const b = worldVertices[ref.endIndex] || new THREE.Vector3(0, 0, 0);
      const t = Number.isFinite(ref.t) ? ref.t : 0;
      const y = THREE.MathUtils.lerp(a.y, b.y, t);
      return new THREE.Vector3(point2D.x, y, point2D.y);
    }

    return new THREE.Vector3(point2D.x, 0, point2D.y);
  }

  // カメラ切り替え時にScene3Dから差し替え可能にする
  updateCamera(camera) {
    this.camera = camera;
  }

  /**
   * イベントリスナーを追加
   */
  enable(domElement) {
    if (domElement && domElement.addEventListener) {
      try {
        domElement.addEventListener('mousedown', this.handleMouseDown);
        domElement.addEventListener('mousemove', this.handleMouseMove);
        domElement.addEventListener('mouseup', this.handleMouseUp);
      } catch (error) {
        console.error('DOMイベントリスナーの追加でエラー:', error);
      }
    }
    try {
      window.addEventListener('keydown', this.handleKeyDown);
    } catch (error) {
      console.error('windowイベントリスナーの追加でエラー:', error);
    }
  }

  /**
   * イベントリスナーを削除
   */
  disable(domElement) {
    if (domElement && domElement.removeEventListener) {
      try {
        domElement.removeEventListener('mousedown', this.handleMouseDown);
        domElement.removeEventListener('mousemove', this.handleMouseMove);
        domElement.removeEventListener('mouseup', this.handleMouseUp);
      } catch (error) {
        console.error('DOMイベントリスナーの削除でエラー:', error);
      }
    }
  }

  /**
   * 管路とCSG断面のオブジェクト配列を取得（visible: trueのみ）
   * @returns {Array} 計測対象のオブジェクト配列
   */
  getMeasurableObjects() {
    const objects = [];
    
    // 管路オブジェクトを追加（visible: trueのみ）
    if (this.objectsRef && this.objectsRef.current) {
      const visiblePipes = Object.values(this.objectsRef.current).filter(obj => obj.visible);
      objects.push(...visiblePipes);
    }
    
    // CSG断面オブジェクトを追加（visible: trueのみ）
    if (this.crossSectionRef && this.crossSectionRef.current && this.crossSectionRef.current.crossSections) {
      const visibleCrossSections = this.crossSectionRef.current.crossSections.filter(obj => obj.visible);
      objects.push(...visibleCrossSections);
    }
    
    return objects;
  }

  /**
   * マウスダウンハンドラー
   */
  handleMouseDown(event) {
    // 左Shiftキー + 左クリックのみ処理
    if (!event.shiftKey || event.button !== 0) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // Raycasterで管路またはCSG断面を検出
    this.raycasterRef.setFromCamera(this.mouseRef, this.camera);
    const intersects = this.raycasterRef.intersectObjects(
      this.getMeasurableObjects(),  // 管路 + CSG断面
      false
    );

    if (intersects.length > 0) {
      const clickedObject = intersects[0].object;
      const clickedPoint = intersects[0].point; // 実際の交点

      // 管路またはCSG断面の場合に計測を開始
      if (clickedObject.userData.objectData || clickedObject.type === 'Mesh') {
        this.isMeasuring = true;
        this.startPipe = clickedObject;
        this.startPoint = clickedPoint.clone(); // 実際のクリック位置を保存
      }
    }
  }

  /**
   * マウス移動ハンドラー
   */
  handleMouseMove(event) {
    if (!this.isMeasuring || !this.startPoint) {
      return;
    }

    // 現在のマウス位置で交点を計算
    this.raycasterRef.setFromCamera(this.mouseRef, this.camera);

    // まず管路またはCSG断面との交点を試みる
    const pipeIntersects = this.raycasterRef.intersectObjects(
      this.getMeasurableObjects(),  // 管路 + CSG断面
      false
    );

    // 既存のプレビュー線を削除
    this.clearPreviewLine();

    let currentPoint = null;

    if (pipeIntersects.length > 0) {
      // 管路との交点がある場合
      currentPoint = pipeIntersects[0].point;
    } else {
      // 管路との交点がない場合、始点の高さの平面との交点を使用
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -this.startPoint.y);
      const planeIntersect = new THREE.Vector3();
      this.raycasterRef.ray.intersectPlane(plane, planeIntersect);

      // 交点が始点から一定距離内の場合のみ使用（遠くに飛ばないように）
      if (planeIntersect) {
        const distance = this.startPoint.distanceTo(planeIntersect);
        if (distance < 1000) {  // 1000m以内のみ有効
          currentPoint = planeIntersect;
        }
      }
    }

    if (currentPoint) {
      // プレビュー線を描画（始点から現在のマウス位置まで）
      this.drawPreviewLine(this.startPoint, currentPoint);
    }
  }

  /**
   * マウスアップハンドラー
   */
  handleMouseUp(event) {
    if (!this.isMeasuring || !this.startPoint) {
      return;
    }

    // 左クリックのみ処理（Shiftキーは計測開始時にチェック済み）
    if (event.button !== 0) {
      this.isMeasuring = false;
      this.clearPreviewLine();
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    // 現在のマウス位置で交点を計算
    this.raycasterRef.setFromCamera(this.mouseRef, this.camera);

    // 管路またはCSG断面との交点を検出
    const pipeIntersects = this.raycasterRef.intersectObjects(
      this.getMeasurableObjects(),  // 管路 + CSG断面
      false
    );

    // 管路BまたはCSG断面が存在し、始点と異なる場合のみ計測を実行
    if (pipeIntersects.length > 0) {
      const clickedObject = pipeIntersects[0].object;
      const clickedPoint = pipeIntersects[0].point;

      // 終点も管路またはCSG断面で、始点とは異なるオブジェクトである必要がある
      if ((clickedObject.userData.objectData || clickedObject.type === 'Mesh') && clickedObject !== this.startPipe) {
        this.endPoint = clickedPoint.clone();
        this.endPipe = clickedObject;

        // 距離を計測
        this.calculateDistance();
      } else {
        // 同じオブジェクトをクリックした場合は何もしない
      }
    } else {
      // 管路以外をクリックした場合は何もしない
    }

    this.isMeasuring = false;
    this.clearPreviewLine();
  }

  /**
   * キーボードハンドラー（Escキーでクリア、5キーで表示切替）
   */
  handleKeyDown(event) {
    if (event.key === 'Escape') {
      this.clear();
    } else if (event.key === '5') {
      // 近接と指定の表示を切り替え
      this.toggleLineDisplay();
    }
  }

  /**
   * 近接と指定の表示を切り替え
   */
  toggleLineDisplay() {
    if (!this.measurementResult) return;

    // 表示状態を切り替え
    this.showClosest = !this.showClosest;
    this.showSpecified = !this.showSpecified;

    // すべての近接線の表示/非表示を更新
    for (const line of this.closestLines) {
      if (line) line.visible = this.showClosest;
    }

    // すべての指定線の表示/非表示を更新
    for (const line of this.measurementLines) {
      if (line) line.visible = this.showSpecified;
    }

    // すべての近接テキストの表示/非表示を更新
    for (const text of this.closestTexts) {
      if (text) text.visible = this.showClosest;
    }

    // すべての指定テキストの表示/非表示を更新
    for (const text of this.measurementTexts) {
      if (text) text.visible = this.showSpecified;
    }
  }

  /**
   * 管路をハイライト表示
   */
  highlightPipe(pipe, color) {
    if (pipe && pipe.material) {
      pipe.material.emissive.setHex(color);
      pipe.material.emissiveIntensity = 0.5;
    }
  }

  /**
   * ハイライトをクリア
   */
  clearHighlight(pipe) {
    if (pipe && pipe.material) {
      pipe.material.emissive.setHex(0x000000);
      pipe.material.emissiveIntensity = 0;
    }
  }

  /**
   * プレビュー線を描画（幅広い帯状の赤色半透明線）
   */
  drawPreviewLine(startPos, endPos) {
    // 2点間の距離と方向を計算
    const direction = new THREE.Vector3().subVectors(endPos, startPos);
    const length = direction.length();
    const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);

    // 幅広い平面ジオメトリを作成（1枚の板）
    const width = 0.15;  // 線の幅
    const geometry = new THREE.PlaneGeometry(length, width);

    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,  // 赤色
      transparent: true,
      opacity: 0.5,     // 透明度50%
      depthTest: false,
      side: THREE.DoubleSide  // 両面から見えるように
    });

    this.previewLine = new THREE.Mesh(geometry, material);
    this.previewLine.position.copy(midPoint);

    // 2点を結ぶ方向に回転
    this.previewLine.quaternion.setFromUnitVectors(
      new THREE.Vector3(1, 0, 0),
      direction.normalize()
    );

    this.scene.add(this.previewLine);
  }

  /**
   * プレビュー線をクリア
   */
  clearPreviewLine() {
    if (this.previewLine) {
      this.scene.remove(this.previewLine);
      this.previewLine.geometry.dispose();
      this.previewLine.material.dispose();
      this.previewLine = null;
    }
  }

  /**
   * 計測線を描画（幅広い帯状の線）
   * @param {THREE.Vector3} startPos - 開始位置
   * @param {THREE.Vector3} endPos - 終了位置
   * @param {number} distance - 距離
   * @param {string} color - 線の色（'red' or 'blue'）
   * @param {string} lineType - 線のタイプ（'specified' or 'closest'）
   * @param {number} horizontalDistance - 水平距離（オプション）
   * @param {number} verticalDistance - 鉛直距離（オプション）
   */
  drawMeasurementLine(startPos, endPos, distance, color = 'red', lineType = 'specified', horizontalDistance = null, verticalDistance = null) {
    // 2点間の距離と方向を計算
    const direction = new THREE.Vector3().subVectors(endPos, startPos);
    const length = direction.length();
    const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);

    // 幅広い平面ジオメトリを作成（1枚の板）
    const width = 0.15;  // 線の幅
    const geometry = new THREE.PlaneGeometry(length, width);

    // 単色のマテリアルを作成
    const colorValue = color === 'blue' ? 0x0000ff : 0xff0000;
    const material = new THREE.MeshBasicMaterial({
      color: colorValue,
      transparent: true,
      opacity: 0.8,
      depthTest: false,
      side: THREE.DoubleSide  // 両面から見えるように
    });

    const lineMesh = new THREE.Mesh(geometry, material);
    lineMesh.position.copy(midPoint);

    // 線のタイプに応じて配列に追加し、表示状態を設定
    if (lineType === 'closest') {
      this.closestLines.push(lineMesh);
      this.closestLineDirections.push(direction.normalize());
      this.closestLineMidPoints.push(midPoint.clone());
      lineMesh.visible = this.showClosest;  // 表示状態を反映
    } else {
      this.measurementLines.push(lineMesh);
      this.lineDirections.push(direction.normalize());
      this.lineMidPoints.push(midPoint.clone());
      lineMesh.visible = this.showSpecified;  // 表示状態を反映
    }

    // 初期回転を設定
    const index = lineType === 'closest' ? this.closestLines.length - 1 : this.measurementLines.length - 1;
    this.updateSingleLineRotation(lineType, index);

    this.scene.add(lineMesh);

    // 線の上にテキストを描画
    this.drawDistanceTextAboveLine(midPoint, distance, color, lineType, horizontalDistance, verticalDistance);
  }

  /**
   * 距離テキストを線の上に描画（スプライトで大きく表示）
   * @param {THREE.Vector3} position - テキスト位置（線の中点）
   * @param {number} distance - 距離
   * @param {string} color - 線の色（'red' or 'blue'）
   * @param {string} lineType - 線のタイプ（'specified' or 'closest'）
   * @param {number} horizontalDistance - 水平距離（オプション）
   * @param {number} verticalDistance - 鉛直距離（オプション）
   */
  drawDistanceTextAboveLine(position, distance, color, lineType, horizontalDistance = null, verticalDistance = null) {
    // テキストスプライトを作成
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    
    // 近接距離で水平・鉛直距離を表示する場合は、キャンバスを高くする
    // 断面図生成画面の場合のみ表示
    const hasHorizontalVertical = this.enableCrossSectionMode && lineType === 'closest' && horizontalDistance !== null && verticalDistance !== null;
    canvas.width = 1024;
    canvas.height = hasHorizontalVertical ? 384 : 256; // 水平・鉛直距離がある場合は高さを増やす

    // 背景を透明にする
    context.clearRect(0, 0, canvas.width, canvas.height);

    // テキストに影をつけて見やすくする
    context.shadowColor = 'rgba(0, 0, 0, 0.9)';
    context.shadowBlur = 12;
    context.shadowOffsetX = 3;
    context.shadowOffsetY = 3;

    // テキスト
    context.fillStyle = 'white';
    context.font = 'Bold 120px Arial';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    
    if (hasHorizontalVertical) {
      // 近接距離の場合：距離、水平距離、鉛直距離を3行で表示
      const lineHeight = 128;
      const startY = canvas.height / 2 - lineHeight / 2;
      
      // 距離
      context.fillText(`${distance.toFixed(3)}m`, canvas.width / 2, startY);
      // 水平距離
      context.font = 'Bold 100px Arial';
      context.fillText(`水平: ${horizontalDistance.toFixed(3)}m`, canvas.width / 2, startY + lineHeight);
      // 鉛直距離
      context.fillText(`鉛直: ${verticalDistance.toFixed(3)}m`, canvas.width / 2, startY + lineHeight * 2);
    } else {
      // 通常の場合：距離のみ表示
      context.fillText(`${distance.toFixed(3)}m`, canvas.width / 2, canvas.height / 2);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const spriteMaterial = new THREE.SpriteMaterial({
      map: texture,
      depthTest: false,
      transparent: true
    });

    const textSprite = new THREE.Sprite(spriteMaterial);
    // 線の中心に配置
    const textPosition = position.clone();
    textSprite.position.copy(textPosition);

    // 水平・鉛直距離を表示するかどうかのフラグを保存
    textSprite.userData.hasHorizontalVertical = hasHorizontalVertical;

    // 初期スケール（カメラ距離に応じて動的に調整される）
    // 水平・鉛直距離を表示する場合は、Yスケールを大きくする
    if (hasHorizontalVertical) {
      textSprite.scale.set(2, 0.75, 1); // 高さを増やす
    } else {
      textSprite.scale.set(2, 0.5, 1);
    }

    // 線のタイプに応じて配列に追加し、表示状態を設定
    if (lineType === 'closest') {
      this.closestTexts.push(textSprite);
      this.closestTextPositions.push(textPosition);
      textSprite.visible = this.showClosest;
    } else {
      this.measurementTexts.push(textSprite);
      this.measurementTextPositions.push(textPosition);
      textSprite.visible = this.showSpecified;
    }

    this.scene.add(textSprite);
  }

  /**
   * 計測点を描画
   */
  drawMeasurementPoint(position, color) {
    const geometry = new THREE.SphereGeometry(0.2, 16, 16);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      depthTest: false,
      transparent: true,
      opacity: 0.8
    });

    const sphere = new THREE.Mesh(geometry, material);
    sphere.position.copy(position);
    this.scene.add(sphere);
    this.measurementPoints.push(sphere);
  }

  /**
   * オブジェクト間の距離を計算（管路またはCSG断面）
   */
  calculateDistance() {
    // 両方のオブジェクトが存在することを確認
    if (!this.startPoint || !this.endPoint || !this.startPipe || !this.endPipe) {
      console.error('オブジェクトAとBの両方が必要です');
      return;
    }

    // オブジェクトデータを取得（管路の場合はuserData.objectData、CSG断面の場合はnull）
    const startData = this.startPipe.userData?.objectData;
    const endData = this.endPipe.userData?.objectData;

    // 指定点間の距離（実際のクリック位置）
    const specifiedPointA = this.startPoint.clone();
    const specifiedPointB = this.endPoint.clone();
    const specifiedDistance = specifiedPointA.distanceTo(specifiedPointB);

    // 計測結果のベース
    let measurementData = {
      pipeA: {
        id: startData?.feature_id || 'CSG断面',
        name: startData ? '管路A' : 'CSG断面A'
      },
      pipeB: {
        id: endData?.feature_id || 'CSG断面',
        name: endData ? '管路B' : 'CSG断面B'
      },
      specified: {
        pointA: specifiedPointA,
        pointB: specifiedPointB,
        distance: specifiedDistance
      }
    };

    // 近接点を計算
    // - 管路同士: Unity方式（XZ投影→2D凸包→2D最短→逆投影）
    // - 断面(CSG)メッシュ同士: 3D最近接（こちらの方がUnity結果(0.693)と一致）
    if (this.startPipe?.geometry && this.endPipe?.geometry) {
      const isCrossSectionA = !!this.startPipe?.userData?.isCrossSection;
      const isCrossSectionB = !!this.endPipe?.userData?.isCrossSection;

      const closest = (isCrossSectionA && isCrossSectionB)
        ? this.getClosestPointsBetweenMeshes(this.startPipe, this.endPipe)
        : this.getClosestPointsBetweenMeshesUnity(this.startPipe, this.endPipe);

      if (closest) {
        const horizontalDistance = (() => {
          // XZ平面での距離
          const a = closest.pointA;
          const b = closest.pointB;
          if (!a || !b) return null;
          return new THREE.Vector2(a.x, a.z).distanceTo(new THREE.Vector2(b.x, b.z));
        })();

        const verticalGap = this.getYAxisGap(this.startPipe, this.endPipe);

        measurementData.closest = {
          pointA: closest.pointA,
          pointB: closest.pointB,
          distance: closest.distance,
          horizontalDistance,
          verticalDistance: verticalGap,
        };
      }
    }

    // 計測結果を保存
    this.measurementResult = measurementData;

    // 指定距離の計測線を描画（赤色）
    this.drawMeasurementLine(specifiedPointA, specifiedPointB, specifiedDistance, 'red', 'specified');

    // 近接距離の計測線を描画（青色）
    if (measurementData.closest) {
      this.drawMeasurementLine(
        measurementData.closest.pointA,
        measurementData.closest.pointB,
        measurementData.closest.distance,
        'blue',
        'closest',
        measurementData.closest.horizontalDistance,
        measurementData.closest.verticalDistance
      );
    }

    // 結果更新コールバックを呼び出し
    if (this.onResultUpdate) {
      this.onResultUpdate(this.measurementResult);
    }
  }

  /**
   * 2つの線分間の最近接点を計算
   */
  getClosestPointsBetweenLineSegments(a1, a2, b1, b2) {
    const d1 = a2.clone().sub(a1);
    const d2 = b2.clone().sub(b1);
    const r = a1.clone().sub(b1);

    const a = d1.dot(d1);
    const e = d2.dot(d2);
    const f = d2.dot(r);

    let s = 0;
    let t = 0;

    if (a <= Number.EPSILON && e <= Number.EPSILON) {
      // 両方が点の場合
      s = 0;
      t = 0;
    } else if (a <= Number.EPSILON) {
      // 最初の線分が点の場合
      s = 0;
      t = Math.max(0, Math.min(1, f / e));
    } else {
      const c = d1.dot(r);
      if (e <= Number.EPSILON) {
        // 2番目の線分が点の場合
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else {
        // 一般的な場合
        const b = d1.dot(d2);
        const denom = a * e - b * b;

        if (denom !== 0) {
          s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
        } else {
          s = 0;
        }

        t = (b * s + f) / e;

        if (t < 0) {
          t = 0;
          s = Math.max(0, Math.min(1, -c / a));
        } else if (t > 1) {
          t = 1;
          s = Math.max(0, Math.min(1, (b - c) / a));
        }
      }
    }

    const pointA = a1.clone().add(d1.clone().multiplyScalar(s));
    const pointB = b1.clone().add(d2.clone().multiplyScalar(t));

    return { pointA, pointB };
  }

  /**
   * 2つのメッシュ間の最短距離を計算（頂点、辺、面すべてを含む）
   */
  getClosestPointsBetweenMeshes(meshA, meshB) {
    const geometryA = meshA.geometry;
    const geometryB = meshB.geometry;

    if (!geometryA || !geometryB) return null;

    const positionA = geometryA.attributes.position;
    const positionB = geometryB.attributes.position;
    const indexA = geometryA.index ?? { getX: (i) => i, count: positionA.count };
    const indexB = geometryB.index ?? { getX: (i) => i, count: positionB.count };

    if (!positionA || !positionB) return null;

    let minDistance = Infinity;
    let closestPointA = null;
    let closestPointB = null;

    // 管路Aの全頂点をワールド座標で取得
    const verticesA = [];
    for (let i = 0; i < positionA.count; i++) {
      const v = new THREE.Vector3(
        positionA.getX(i),
        positionA.getY(i),
        positionA.getZ(i)
      );
      meshA.localToWorld(v);
      verticesA.push(v);
    }

    // 管路Bの全頂点をワールド座標で取得
    const verticesB = [];
    for (let i = 0; i < positionB.count; i++) {
      const v = new THREE.Vector3(
        positionB.getX(i),
        positionB.getY(i),
        positionB.getZ(i)
      );
      meshB.localToWorld(v);
      verticesB.push(v);
    }

    // 1. 管路Aの各頂点 vs 管路Bの各面
    if (indexB) {
      for (let i = 0; i < verticesA.length; i++) {
        for (let j = 0; j < indexB.count; j += 3) {
          const v0 = verticesB[indexB.getX(j)];
          const v1 = verticesB[indexB.getX(j + 1)];
          const v2 = verticesB[indexB.getX(j + 2)];

          const result = this.getClosestPointToTriangle(verticesA[i], v0, v1, v2);
          if (result.distance < minDistance) {
            minDistance = result.distance;
            closestPointA = verticesA[i];
            closestPointB = result.closestPoint;
          }
        }
      }
    }

    // 2. 管路Bの各頂点 vs 管路Aの各面
    if (indexA) {
      for (let i = 0; i < verticesB.length; i++) {
        for (let j = 0; j < indexA.count; j += 3) {
          const v0 = verticesA[indexA.getX(j)];
          const v1 = verticesA[indexA.getX(j + 1)];
          const v2 = verticesA[indexA.getX(j + 2)];

          const result = this.getClosestPointToTriangle(verticesB[i], v0, v1, v2);
          if (result.distance < minDistance) {
            minDistance = result.distance;
            closestPointA = result.closestPoint;
            closestPointB = verticesB[i];
          }
        }
      }
    }

    // 3. 管路Aの各辺 vs 管路Bの各辺
    if (indexA && indexB) {
      for (let i = 0; i < indexA.count; i += 3) {
        const edgesA = [
          [indexA.getX(i), indexA.getX(i + 1)],
          [indexA.getX(i + 1), indexA.getX(i + 2)],
          [indexA.getX(i + 2), indexA.getX(i)]
        ];

        for (const [a0, a1] of edgesA) {
          for (let j = 0; j < indexB.count; j += 3) {
            const edgesB = [
              [indexB.getX(j), indexB.getX(j + 1)],
              [indexB.getX(j + 1), indexB.getX(j + 2)],
              [indexB.getX(j + 2), indexB.getX(j)]
            ];

            for (const [b0, b1] of edgesB) {
              const result = this.getClosestPointsBetweenLineSegments(
                verticesA[a0], verticesA[a1],
                verticesB[b0], verticesB[b1]
              );
              const distance = result.pointA.distanceTo(result.pointB);
              if (distance < minDistance) {
                minDistance = distance;
                closestPointA = result.pointA;
                closestPointB = result.pointB;
              }
            }
          }
        }
      }
    }

    if (closestPointA && closestPointB) {
      return {
        pointA: closestPointA,
        pointB: closestPointB,
        distance: minDistance
      };
    }

    return null;
  }

  /**
   * 点と三角形の最短距離を計算
   */
  getClosestPointToTriangle(point, v0, v1, v2) {
    const edge0 = new THREE.Vector3().subVectors(v1, v0);
    const edge1 = new THREE.Vector3().subVectors(v2, v0);
    const v0ToPoint = new THREE.Vector3().subVectors(point, v0);

    const a = edge0.dot(edge0);
    const b = edge0.dot(edge1);
    const c = edge1.dot(edge1);
    const d = edge0.dot(v0ToPoint);
    const e = edge1.dot(v0ToPoint);

    const det = a * c - b * b;
    let s = b * e - c * d;
    let t = b * d - a * e;

    if (s + t <= det) {
      if (s < 0) {
        if (t < 0) {
          // region 4
          s = 0;
          t = 0;
        } else {
          // region 3
          s = 0;
          t = Math.max(0, Math.min(1, e / c));
        }
      } else if (t < 0) {
        // region 5
        s = Math.max(0, Math.min(1, d / a));
        t = 0;
      } else {
        // region 0 (interior)
        const invDet = 1 / det;
        s *= invDet;
        t *= invDet;
      }
    } else {
      if (s < 0) {
        // region 2
        s = 0;
        t = 1;
      } else if (t < 0) {
        // region 6
        s = 1;
        t = 0;
      } else {
        // region 1
        const numer = c + e - b - d;
        const denom = a - 2 * b + c;
        s = Math.max(0, Math.min(1, numer / denom));
        t = 1 - s;
      }
    }

    const closestPoint = v0.clone()
      .add(edge0.clone().multiplyScalar(s))
      .add(edge1.clone().multiplyScalar(t));

    const distance = point.distanceTo(closestPoint);

    return { closestPoint, distance };
  }

  /**
   * 結果更新コールバックを設定
   */
  setResultUpdateCallback(callback) {
    this.onResultUpdate = callback;
  }

  /**
   * 計測結果を取得
   */
  getResult() {
    return this.measurementResult;
  }

  /**
   * 線の回転を更新（カメラの方向に向ける）
   */
  updateLineRotation() {
    // すべての指定距離の線を更新
    for (let i = 0; i < this.measurementLines.length; i++) {
      this.updateSingleLineRotation('specified', i);
    }

    // すべての近接距離の線を更新
    for (let i = 0; i < this.closestLines.length; i++) {
      this.updateSingleLineRotation('closest', i);
    }
  }

  /**
   * 単一の線の回転を更新
   * @param {string} lineType - 'specified' または 'closest'
   * @param {number} index - 配列内のインデックス
   */
  updateSingleLineRotation(lineType, index) {
    const line = lineType === 'closest' ? this.closestLines[index] : this.measurementLines[index];
    const lineDirection = lineType === 'closest' ? this.closestLineDirections[index] : this.lineDirections[index];
    const lineMidPoint = lineType === 'closest' ? this.closestLineMidPoints[index] : this.lineMidPoints[index];

    if (!line || !lineDirection || !lineMidPoint) {
      return;
    }

    // カメラから線の中心への方向ベクトル
    const cameraToLine = new THREE.Vector3()
      .subVectors(lineMidPoint, this.camera.position)
      .normalize();

    // 線の方向ベクトル（X軸）
    const lineDir = lineDirection.clone();

    // カメラ方向と線方向の外積でY軸（法線）を計算
    const normal = new THREE.Vector3().crossVectors(lineDir, cameraToLine).normalize();

    // もし外積がゼロベクトルに近い場合（線がカメラ方向と平行）、デフォルトの法線を使用
    if (normal.length() < 0.001) {
      normal.set(0, 1, 0);
    }

    // Z軸を計算
    const binormal = new THREE.Vector3().crossVectors(lineDir, normal).normalize();

    // 回転行列を作成
    const rotationMatrix = new THREE.Matrix4();
    rotationMatrix.makeBasis(lineDir, normal, binormal);

    // クォータニオンに変換
    line.quaternion.setFromRotationMatrix(rotationMatrix);
  }

  /**
   * 毎フレーム更新（カメラ移動時に線を回転とテキストスケール調整）
   */
  update() {
    this.updateLineRotation();
    this.updateTextScale();
  }

  /**
   * テキストのスケールをカメラ距離に応じて調整
   */
  updateTextScale() {
    const baseDistance = 20;
    const baseScale = 2;
    const minScale = 0.5;
    const maxScale = 5;

    // すべての指定距離のテキストスケール更新
    for (let i = 0; i < this.measurementTexts.length; i++) {
      const text = this.measurementTexts[i];
      const position = this.measurementTextPositions[i];
      if (text && position) {
        const distance = this.camera.position.distanceTo(position);
        const scaleFactor = Math.max(minScale, Math.min(maxScale, (distance / baseDistance) * baseScale));
        // 水平・鉛直距離を表示する場合は、Yスケールを大きくする
        const yScale = text.userData.hasHorizontalVertical ? scaleFactor * 0.375 : scaleFactor * 0.25;
        text.scale.set(scaleFactor, yScale, 1);
      }
    }

    // すべての近接距離のテキストスケール更新
    for (let i = 0; i < this.closestTexts.length; i++) {
      const text = this.closestTexts[i];
      const position = this.closestTextPositions[i];
      if (text && position) {
        const distance = this.camera.position.distanceTo(position);
        const scaleFactor = Math.max(minScale, Math.min(maxScale, (distance / baseDistance) * baseScale));
        // 水平・鉛直距離を表示する場合は、Yスケールを大きくする
        const yScale = text.userData.hasHorizontalVertical ? scaleFactor * 0.375 : scaleFactor * 0.25;
        text.scale.set(scaleFactor, yScale, 1);
      }
    }
  }

  /**
   * 計測をクリア
   */
  clear() {
    // 管路参照をクリア
    if (this.startPipe) {
      this.startPipe = null;
    }
    if (this.endPipe) {
      this.endPipe = null;
    }

    // すべての指定距離の計測線を削除（赤）
    this.measurementLines.forEach(line => {
      if (line) {
        this.scene.remove(line);
        line.geometry.dispose();
        if (line.material.map) {
          line.material.map.dispose();
        }
        line.material.dispose();
      }
    });
    this.measurementLines = [];

    // すべての指定距離のテキストを削除
    this.measurementTexts.forEach(text => {
      if (text) {
        this.scene.remove(text);
        if (text.material.map) {
          text.material.map.dispose();
        }
        text.material.dispose();
      }
    });
    this.measurementTexts = [];

    // すべての近接距離の計測線を削除（青）
    this.closestLines.forEach(line => {
      if (line) {
        this.scene.remove(line);
        line.geometry.dispose();
        if (line.material.map) {
          line.material.map.dispose();
        }
        line.material.dispose();
      }
    });
    this.closestLines = [];

    // すべての近接距離のテキストを削除
    this.closestTexts.forEach(text => {
      if (text) {
        this.scene.remove(text);
        if (text.material.map) {
          text.material.map.dispose();
        }
        text.material.dispose();
      }
    });
    this.closestTexts = [];

    // 旧テキストを削除（互換性のため）
    if (this.textMesh) {
      this.scene.remove(this.textMesh);
      this.textMesh.material.map.dispose();
      this.textMesh.material.dispose();
      this.textMesh = null;
    }

    // 計測点を削除
    this.measurementPoints.forEach(point => {
      this.scene.remove(point);
      point.geometry.dispose();
      point.material.dispose();
    });
    this.measurementPoints = [];

    // プレビュー線を削除
    this.clearPreviewLine();

    // 計測位置をクリア
    this.startPoint = null;
    this.endPoint = null;

    // 線の方向情報をクリア
    this.lineDirections = [];
    this.lineMidPoints = [];
    this.closestLineDirections = [];
    this.closestLineMidPoints = [];

    // テキストの位置情報をクリア
    this.measurementTextPositions = [];
    this.closestTextPositions = [];

    // 計測結果をクリア
    this.measurementResult = null;

    // 表示状態をリセット
    this.showClosest = true;   // 近接距離を表示
    this.showSpecified = false; // 指定距離を非表示

    // 結果更新コールバックを呼び出し
    if (this.onResultUpdate) {
      this.onResultUpdate(null);
    }

    this.isMeasuring = false;
  }

  /**
   * クリーンアップ
   */
  dispose(domElement) {
    this.clear();
    this.disable(domElement);
  }
}

// React統合用のコンポーネント
function DistanceMeasurementDisplay({ measurementResult }) {
  if (!measurementResult) {
    return null;
  }

  const { pipeA, pipeB, closest, specified } = measurementResult;

  return (
    <div className="distance-measurement-display">
      <div className="measurement-title">
        {pipeA.name}/{pipeB.name}間の離隔結果 (ESC クリア)
      </div>
      <div className="measurement-details">
        <div className="measurement-row">
          <span className="label">{pipeA.name}:</span>
          <span className="value">{pipeA.id}</span>
          <span className="label">{pipeB.name}:</span>
          <span className="value">{pipeB.id}</span>
        </div>
        {closest && (
          <div className="measurement-row">
            <span className="label">近接</span>
            <span className="point">
              A点: ({closest.pointA.x.toFixed(2)}, {closest.pointA.y.toFixed(2)}, {closest.pointA.z.toFixed(2)})
            </span>
            <span className="point">
              B点: ({closest.pointB.x.toFixed(2)}, {closest.pointB.y.toFixed(2)}, {closest.pointB.z.toFixed(2)})
            </span>
            <span className="distance">距離: {closest.distance.toFixed(3)}[m]</span>
          </div>
        )}
        <div className="measurement-row">
          <span className="label">指定</span>
          <span className="point">
            A点: ({specified.pointA.x.toFixed(2)}, {specified.pointA.y.toFixed(2)}, {specified.pointA.z.toFixed(2)})
          </span>
          <span className="point">
            B点: ({specified.pointB.x.toFixed(2)}, {specified.pointB.y.toFixed(2)}, {specified.pointB.z.toFixed(2)})
          </span>
          <span className="distance">距離: {specified.distance.toFixed(3)}[m]</span>
        </div>
      </div>
    </div>
  );
}

export { DistanceMeasurement, DistanceMeasurementDisplay };
