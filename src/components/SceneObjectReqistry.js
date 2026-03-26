import { message } from 'antd';
import * as THREE from 'three';
import { Rectangle, QuadtreeNode } from './3D/QuadTree.js';
// import { createDataAccessor } from '../../DataAccessor/Factory.js';

// SceneObjectRegistry.js
// シーンに配置されているオブジェクトのメタデータを管理する
export default class SceneObjectRegistry {
  accessor;

  /**
   * @param {DataAccessor} accessor - 外から渡されたDataAccessorインスタンス
   */
  constructor(accessor) {
    this.originalData = {};               // 元データ
    this.editedOrDeletedObjectsData = {}; // 編集または削除されたデータ
    this.addedObjectsData = {};           // 追加されたデータ
    this.objectsMeshRef = null;
    // this.accessor = createDataAccessor();
    this.accessor = accessor;
    this.quadTree = null;
    this.dbgCount = new Map();
  }

  // 初期データ登録
  register(key, obj) {
    // 元データを保存（ディープコピー）
    this.originalData[key] = JSON.parse(JSON.stringify(obj));
  }

  // メッシュ情報を注入
  attachObjectsMeshRef(objectsMeshRef) {
    this.objectsMeshRef = objectsMeshRef;
  }

  // 登録済オブジェクトのキー取得。
  getObjectKey(mesh) {
    const objectKey = Object.keys(this.objectsMeshRef).find(
      key => this.objectsMeshRef[key] === mesh
    );
    return objectKey;
  }

  // 初期データ取得。
  getOrginalData(objectKey) {

    if (!objectKey) {
      return null;
    }

    const obj = this.originalData[objectKey];
    if (!obj) {
      return null;
    }

    return obj;
  }

  // 初期データのキー群を取得
  getOrginalDataKeys() {
    return Object.keys(this.originalData);
  }

  // 復元用の基準データを取得
  // 既存オブジェクトは originalData、新規追加オブジェクトは addedObjectsData を返す
  getRestoreBaseData(objectKey) {
    if (!objectKey) {
      return null;
    }

    const originalObj = this.originalData[objectKey];
    if (originalObj) {
      return originalObj;
    }

    const addedObj = this.addedObjectsData[objectKey];
    if (addedObj) {
      return addedObj;
    }

    return null;
  }

  // シーンに配置されているオブジェクトのCityJsonDataを取得
  getObjectDataOnScene(objectKey) {

    if (!objectKey) {
      return null;
    }

    // 編集済みデータを最優先で返す（複製時に最新位置/属性を反映）
    const editedObj = this.editedOrDeletedObjectsData[objectKey];
    if (editedObj && editedObj.snapshot_id !== 3) {
      return editedObj;
    }

    const obj = this.originalData[objectKey];
    if (obj) {
      return obj;
    }

    const addedObj = this.addedObjectsData[objectKey];
    if (addedObj) {
      return addedObj;
    }

    return null;
  }

  // 配管オブジェクト追加。
  addPipeObject(templateData, vertices) {

    if (!Array.isArray(vertices) || vertices.length < 2) {
      throw new Error("vertices は少なくとも2点の配列が必要です。");
    }

    const newId = crypto.randomUUID();// 暫定
    const newKey = "pipe_" + newId;
    const newObjectData = this.createNewPipeObjectData(templateData, vertices);
    this.addedObjectsData[newKey] = newObjectData;
    return { key: newKey, object: newObjectData };
  }

  // Polyhedron追加（2点指定: 1点目=配置位置, 2点目=幅）
  addPolyhedronObject(templateData, startPoint, widthPoint) {
    const toNum = (v, fallback = 0) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fallback;
    };

    const p1 = Array.isArray(startPoint) ? startPoint : [0, 0, 0];
    const p2 = Array.isArray(widthPoint) ? widthPoint : p1;

    const targetWidth = Math.max(
      0.1,
      Math.hypot(
        toNum(p2[0]) - toNum(p1[0]),
        toNum(p2[2]) - toNum(p1[2])
      )
    );

    const newData = JSON.parse(JSON.stringify(templateData));
    const now = new Date().toISOString();
    const userId = 1;
    newData.created_at = now;
    newData.created_user = userId;
    newData.attributes = newData.attributes || {};
    newData.attributes.crt_user_no = userId;

    const geometry = newData.geometry?.[0] || {};
    const vertices = Array.isArray(geometry.vertices) ? geometry.vertices : [];
    if (vertices.length < 4) {
      throw new Error("Polyhedronの追加に必要な頂点数が不足しています。");
    }

    // Polyhedronのデータ座標 [x, y, z] -> Three.js (x, z, y)
    // よって平面幅は data(x, y) で扱う。data(z) は高さ（鉛直）。
    const xs = vertices.map((v) => toNum(v[0]));
    const ys = vertices.map((v) => toNum(v[1]));
    const zs = vertices.map((v) => toNum(v[2]));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const minZ = Math.min(...zs);
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const baseWidth = Math.max(0.1, Math.max(maxX - minX, maxY - minY));
    const scaleXY = targetWidth / baseWidth;

    const targetCenterX = toNum(p1[0], centerX);
    const targetCenterY = toNum(p1[2], centerY);

    geometry.vertices = vertices.map((v) => {
      const x = toNum(v[0]);
      const y = toNum(v[1]);
      const z = toNum(v[2]);
      return [
        targetCenterX + (x - centerX) * scaleXY,
        targetCenterY + (y - centerY) * scaleXY,
        z - minZ // 最低頂点を地表(=0)へ
      ];
    });

    const nextZs = geometry.vertices.map((v) => toNum(v[2]));
    const nextCenterZ = (Math.min(...nextZs) + Math.max(...nextZs)) / 2;
    geometry.center = [targetCenterX, targetCenterY, nextCenterZ];
    newData.geometry[0] = geometry;

    // 地表クリックで配置するため、depth系属性は0にリセット
    if (newData.attributes) {
      Object.keys(newData.attributes).forEach((key) => {
        if (/^(depth(?:_\d+)?|start_point_depth|end_point_depth)$/i.test(key)) {
          const current = Number(newData.attributes[key]);
          if (Number.isFinite(current)) {
            newData.attributes[key] = 0;
          }
        }
      });
    }

    const newId = crypto.randomUUID();
    const newKey = "polyhedron_" + newId;
    this.addedObjectsData[newKey] = newData;
    return { key: newKey, object: newData };
  }

  // 配管オブジェクトデータ新規作成
  createNewPipeObjectData(templateData, vertices) {

    const newData = JSON.parse(JSON.stringify(templateData));

    // ISO文字列の現在日時
    const now = new Date().toISOString();
    const userId = 1;

    newData.created_at = now;
    newData.created_user = userId;

    newData.attributes = newData.attributes || {};
    newData.attributes.crt_user_no = userId;

    const geometry = newData.geometry[0] || {};
    const isExtrusion =
      newData.shape_type === 21 ||
      geometry.type === 'Extrusion' ||
      geometry.type === 'ExtrudeGeometry' ||
      (Array.isArray(geometry.extrudePath) && geometry.extrudePath.length >= 2);

    if (isExtrusion) {
      // Extrusionはクリックした経路を extrudePath として使用
      // enterAddMode からの頂点は [x, y, z]（地面上は y=0）
      geometry.extrudePath = vertices.map(v => [v[0], -v[2], v[1]]);

      // テンプレートに断面情報が無い場合でも描画できるよう、円形断面を生成
      if (!Array.isArray(geometry.vertices2D) || geometry.vertices2D.length < 3) {
        const radius = this.getRadiusInMeters(newData.attributes);
        const segments = 24;
        geometry.vertices2D = [];
        for (let i = 0; i < segments; i++) {
          const angle = (i / segments) * Math.PI * 2;
          geometry.vertices2D.push([
            Math.cos(angle) * radius,
            Math.sin(angle) * radius
          ]);
        }
      }

      // centerは始点と終点の中点で更新（center依存処理との整合用）
      //if (geometry.extrudePath.length >= 2) {
        //const a = geometry.extrudePath[0];
        // const b = geometry.extrudePath[geometry.extrudePath.length - 1];
        // geometry.center = [
          // ((Number(a[0]) || 0) + (Number(b[0]) || 0)) / 2,
          // ((Number(a[1]) || 0) + (Number(b[1]) || 0)) / 2,
          // ((Number(a[2]) || 0) + (Number(b[2]) || 0)) / 2
        // ];
      // }
    } else {
      // z-up変換（既存LineString系）
      geometry.vertices = vertices.map(v => [v[0], -v[2], v[1]]);

      // boundaries は [0, 最終インデックス] を1要素として持つ配列にします
      const lastIndex = Math.max(1, geometry.vertices.length - 1);
      geometry.boundaries = [[0, lastIndex]];
    }

    newData.geometry[0] = geometry;

    return newData;
  }

  // オブジェクト編集
  editObject(mesh) {
    console.log("編集");
    const key = this.getObjectKey(mesh);
    const editedData = mesh.userData.objectData;
    if (!editedData) {
      console.log("編集対象のデータが有りません");
      return;
    }

    // z-up変換
    const verts = editedData.geometry[0]?.vertices?.map(v => [v[0], v[1], v[2]]);
    editedData.geometry[0].vertices = verts;
    editedData.updated_user = 2; // 暫定
    editedData.updated_at = (new Date()).toISOString();
    this.editedOrDeletedObjectsData[key] = editedData;
  }

  // 配管オブジェクト編集
  editPipeObject(mesh, changedValues) {

    const objectKey = this.getObjectKey(mesh);
    if (!objectKey) {
      console.log("編集対象のデータが見つかりません");
      return;
    }

    const targetObjectData = mesh.userData.objectData;

    if (!targetObjectData) {
      console.log("編集対象のデータが有りません");
      return;
    }

    const editedData = targetObjectData;
    const editedGeometry = editedData.geometry[0];
    const editedAttributes = editedData.attributes;

    const radiusInMeters = this.getRadiusInMeters(editedAttributes);
    const parseFiniteNumber = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    // 既存データの符号規約（正値/負値）を維持して、土被り[m]をZ[cm]へ変換する
    const calcDepthZByCurrentSign = (coverDepth, offset, currentZ) => {
      const current = Number(currentZ);
      const zPosRule = (coverDepth - offset) * 100;
      const zNegRule = -(coverDepth + offset) * 100;
      if (Number.isFinite(current)) {
        return current < 0 ? zNegRule : zPosRule;
      }
      // 既存値が読めない場合は現行互換（正値規約）を採用
      return zPosRule;
    };
    // 表示側の式（coverDepth = -depthAxis + offset）と同じ規約で現在土被り[m]を復元
    const calcCurrentCoverDepthFromZ = (currentZ, offsetM) => {
      const z = parseFiniteNumber(currentZ);
      if (z == null) return null;
      return -z + offsetM;
    };
    // Extrusion用: 新旧土被り差分[m]をZ差分[m]へ変換（cover増加で下方向=Z減少）
    const calcExtrudeDeltaZFromCoverDepth = (newCoverDepthM, offsetM, currentZ) => {
      const targetCover = parseFiniteNumber(newCoverDepthM);
      const currentCover = calcCurrentCoverDepthFromZ(currentZ, offsetM);
      if (targetCover == null || currentCover == null) return 0;
      const deltaCover = targetCover - currentCover;
      return -deltaCover;
    };

    // ExtrudeGeometryかどうかを判定
    const isExtrude = Array.isArray(editedGeometry?.extrudePath) && editedGeometry.extrudePath.length >= 2;

    // Polyhedronは「形状頂点の集合」であり、vertices[0] 等を書き換えると "移動" ではなく "変形" になる。
    // 管路情報表示側はAABB中心等を表示しているため、位置系入力は「AABB中心を指定した平行移動」として解釈する。
    // NOTE: 現状のPolyhedronメッシュ生成は「geometry(頂点) + mesh.position(頂点中心)」の形になっているため、
    // AABB中心をΔ動かすには頂点を Δ/2 だけ平行移動する（そうしないと 2倍動く）
    const isPolyhedron =
      targetObjectData?.shape_type === 25 ||
      editedGeometry?.type === 'Polyhedron' ||
      mesh?.geometry?.type === 'ConvexGeometry';

    if (isPolyhedron) {
      const toNum = (v) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };

      // AABB（ワールド）から、表示項目と同じ「中心/端点相当」を算出
      mesh.updateMatrixWorld?.(true);
      const bbox = new THREE.Box3().setFromObject(mesh);
      if (!Number.isFinite(bbox.min.x) || !Number.isFinite(bbox.max.x)) {
        message.warning("PolyhedronのAABB取得に失敗しました。");
        return;
      }
      const size = new THREE.Vector3();
      bbox.getSize(size);
      const centerWorld = bbox.getCenter(new THREE.Vector3());

      // 最長軸（ワールド軸）
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

      let startWorld, endWorld;
      if (maxAxis === 'x') {
        startWorld = new THREE.Vector3(bbox.min.x, centerWorld.y, centerWorld.z);
        endWorld = new THREE.Vector3(bbox.max.x, centerWorld.y, centerWorld.z);
      } else if (maxAxis === 'y') {
        startWorld = new THREE.Vector3(centerWorld.x, bbox.min.y, centerWorld.z);
        endWorld = new THREE.Vector3(centerWorld.x, bbox.max.y, centerWorld.z);
      } else {
        startWorld = new THREE.Vector3(centerWorld.x, centerWorld.y, bbox.min.z);
        endWorld = new THREE.Vector3(centerWorld.x, centerWorld.y, bbox.max.z);
      }

      // 表示系: 東西=X, 南北=-Z, 鉛直=Y（PipelineInfoDisplay と同じ）
      // ※入力されていない軸は「現在値を維持」する
      const worldFromDisplay = (baseWorldVec3, east, north, vertical) => {
        const v = baseWorldVec3.clone();
        if (east != null) v.x = east;
        if (vertical != null) v.y = vertical;
        if (north != null) v.z = -north;
        return v;
      };

      const centerKeys = {
        east: toNum(changedValues["東西[m]"]),
        north: toNum(changedValues["南北[m]"])
      };

      // 土被り深さ[m]は「地面から下への距離（正の値）」なので、Three.js Y（上向き正）へ変換
      // Polyhedron: centerY = -coverDepth（オフセット不要、AABB中心Yを直接使用）
      // その他: 従来通り offset を使う（天端基準）
      const coverDepth = toNum(changedValues["土被り深さ[m]"]);
      const desiredCenterY = coverDepth != null
        ? -coverDepth  // Polyhedron: 直接符号反転のみ（オフセット不要）
        : null;

      // まず中心移動（東西/南北/土被り）を優先
      let desiredWorld = centerWorld.clone();
      if (centerKeys.east != null) desiredWorld.x = centerKeys.east;
      if (centerKeys.north != null) desiredWorld.z = -centerKeys.north;
      if (desiredCenterY != null) desiredWorld.y = desiredCenterY;

      // Polyhedronの場合は端点編集処理をスキップ（端点情報は表示・編集しない）
      // その他の形状の場合は、中心指定が無い場合に端点指定を「平行移動」として扱う
      const anyCenterKey = (centerKeys.east != null) || (centerKeys.north != null) || (desiredCenterY != null);
      if (!anyCenterKey && !isPolyhedron) {
        const p1 = {
          east: toNum(changedValues["端点1東西[m]"]),
          north: toNum(changedValues["端点1南北[m]"])
        };
        const p2 = {
          east: toNum(changedValues["端点2東西[m]"]),
          north: toNum(changedValues["端点2南北[m]"])
        };
        const cd1 = toNum(changedValues["端点1土被り深さ[m]"]);
        const cd2 = toNum(changedValues["端点2土被り深さ[m]"]);
        const offset = radiusInMeters;
        const desiredP1Y = cd1 != null ? -(cd1 - offset) : null;
        const desiredP2Y = cd2 != null ? -(cd2 - offset) : null;

        // 端点1の指定があれば端点1に合わせて平行移動、無ければ端点2で合わせる
        if (p1.east != null || p1.north != null || desiredP1Y != null) {
          const desiredP1World = worldFromDisplay(startWorld, p1.east, p1.north, desiredP1Y);
          const currentP1World = startWorld; // 端点1= startWorld として表示している
          const delta = desiredP1World.sub(currentP1World);
          desiredWorld.add(delta);
        } else if (p2.east != null || p2.north != null || desiredP2Y != null) {
          const desiredP2World = worldFromDisplay(endWorld, p2.east, p2.north, desiredP2Y);
          const currentP2World = endWorld; // 端点2= endWorld
          const delta = desiredP2World.sub(currentP2World);
          desiredWorld.add(delta);
        } else {
          // 位置系が何も無い場合は何もしない（材質/種別などは下の通常処理で更新したい）
          // → fallthrough させる
        }
      }

      const deltaWorld = desiredWorld.clone().sub(centerWorld);
      const hasDelta = deltaWorld.lengthSq() > 1e-12;

      if (hasDelta) {
        // 2倍移動を避けるため Δ/2 を頂点へ適用
        const s = deltaWorld.multiplyScalar(0.5);

        // Polyhedronデータ頂点 -> Three.js頂点は [x,y,z] -> (x,z,y) なので、
        // world Δ(x,y,z) を data Δ(x, y, z) へ: [dx, dz, dy]
        const dxData = s.x;
        const dyData = s.z;
        const dzData = s.y;

        if (Array.isArray(editedGeometry?.vertices)) {
          editedGeometry.vertices = editedGeometry.vertices.map((v) => {
            if (!Array.isArray(v) || v.length < 3) return v;
            return [
              (Number(v[0]) || 0) + dxData,
              (Number(v[1]) || 0) + dyData,
              (Number(v[2]) || 0) + dzData
            ];
          });
        }

        if (Array.isArray(editedGeometry?.center) && editedGeometry.center.length >= 3) {
          editedGeometry.center[0] = (Number(editedGeometry.center[0]) || 0) + dxData;
          editedGeometry.center[1] = (Number(editedGeometry.center[1]) || 0) + dyData;
          editedGeometry.center[2] = (Number(editedGeometry.center[2]) || 0) + dzData;
        }
      }

      // 位置系以外（材質/種別など）も変更されている可能性があるため、ここでは return せずに継続する。
      // ただし、以下の通常処理が position系キーを誤って「変形」させないよう、position系キーは除外する。
      const filteredChangedValues = { ...changedValues };
      delete filteredChangedValues["東西[m]"];
      delete filteredChangedValues["南北[m]"];
      delete filteredChangedValues["土被り深さ[m]"];
      delete filteredChangedValues["端点1東西[m]"];
      delete filteredChangedValues["端点1南北[m]"];
      delete filteredChangedValues["端点1土被り深さ[m]"];
      delete filteredChangedValues["端点2東西[m]"];
      delete filteredChangedValues["端点2南北[m]"];
      delete filteredChangedValues["端点2土被り深さ[m]"];

      changedValues = filteredChangedValues;
    }

    // 元データを保存（端点変更時に使用 - Unityの実装に合わせる）
    let originalStartPoint, originalEndPoint;
    if (isExtrude) {
      originalStartPoint = editedGeometry.extrudePath[0] ? [...editedGeometry.extrudePath[0]] : null;
      const lastIdx = editedGeometry.extrudePath.length - 1;
      originalEndPoint = editedGeometry.extrudePath[lastIdx] ? [...editedGeometry.extrudePath[lastIdx]] : null;
    } else {
      originalStartPoint = editedGeometry.vertices[0] ? [...editedGeometry.vertices[0]] : null;
      originalEndPoint = editedGeometry.vertices[1] ? [...editedGeometry.vertices[1]] : null;
    }

    // HACK: キー名が日本語のハードコーディング ( キー設定元：PipelineInfoDisplay.js )
    Object.entries(changedValues).forEach(([key, value]) => {

      console.log(key + " : " + value);

      if (key === "東西[m]") {
        if (isExtrude) {
          // ExtrudeGeometryの場合、centerとextrudePathのすべての点のX座標を更新
          if (editedGeometry.center) {
            editedGeometry.center[0] = Number(value) || editedGeometry.center[0];
          }
          editedGeometry.extrudePath = editedGeometry.extrudePath.map(point => [
            Number(value) || point[0],
            point[1],
            point[2]
          ]);
        } else {
          console.log(editedGeometry.vertices);
          editedGeometry.vertices[0][0] = Number(value) || editedGeometry.vertices[0][0];
        }
        return;
      }

      if (key === "土被り深さ[m]") {
        const coverDepth = Number(value) || 0;
        // 土被り深さは地面から天端までの深さ（正の値）
        // 表示側と揃えるため、半径(height/2, radius) は考慮しない（管頂そのものを基準にする）
        const offset = 0;
        const currentZ = isExtrude
          ? (editedGeometry.center?.[2] ?? editedGeometry.extrudePath?.[0]?.[2])
          : editedGeometry.vertices?.[0]?.[2];

        if (isExtrude) {
          // Extrusion で depth 属性がある場合は、表示と同じく depth 属性ベースで土被り差分を解釈する
          const hasDepthAttrs =
            editedAttributes?.start_point_depth != null &&
            editedAttributes?.end_point_depth != null &&
            Number.isFinite(Number(editedAttributes.start_point_depth)) &&
            Number.isFinite(Number(editedAttributes.end_point_depth));

          if (hasDepthAttrs) {
            const startDepthM = Number(editedAttributes.start_point_depth) / 100; // cm → m
            const endDepthM = Number(editedAttributes.end_point_depth) / 100;     // cm → m
            const currentCenterCoverM = (startDepthM + endDepthM) / 2;
            const deltaCoverM = coverDepth - currentCenterCoverM; // cover増加(正) = 下方向へ移動

            if (deltaCoverM !== 0) {
              // cover増加(正) → Z(鉛直m)は減少させる
              const deltaZ = -deltaCoverM;

              if (editedGeometry.center) {
                editedGeometry.center[2] = (Number(editedGeometry.center[2]) || 0) + deltaZ;
              }
              editedGeometry.extrudePath = editedGeometry.extrudePath.map(point => [
                point[0],
                point[1],
                (Number(point[2]) || 0) + deltaZ
              ]);

              // depth属性(cm)も新しい中央土被りに追従させる
              const deltaDepthCm = deltaCoverM * 100;
              if (editedAttributes.start_point_depth != null) {
                editedAttributes.start_point_depth =
                  Number(editedAttributes.start_point_depth) + deltaDepthCm;
              }
              if (editedAttributes.end_point_depth != null) {
                editedAttributes.end_point_depth =
                  Number(editedAttributes.end_point_depth) + deltaDepthCm;
              }
            }
          } else {
            // depth属性が無い Extrusion は、従来通り geometry ベースで処理
            const deltaZ = calcExtrudeDeltaZFromCoverDepth(coverDepth, offset, currentZ);
            if (deltaZ !== 0) {
              if (editedGeometry.center) {
                editedGeometry.center[2] = (Number(editedGeometry.center[2]) || 0) + deltaZ;
              }
              editedGeometry.extrudePath = editedGeometry.extrudePath.map(point => [
                point[0],
                point[1],
                (Number(point[2]) || 0) + deltaZ
              ]);
            }
          }
        } else {
          const newZ = calcDepthZByCurrentSign(coverDepth, offset, currentZ);
          editedGeometry.vertices[0][2] = newZ;
          editedGeometry.vertices[1][2] = newZ;
          editedAttributes.end_point_depth = newZ;
          editedAttributes.start_point_depth = newZ;
        }
        return;
      }

      if (key === "南北[m]") {
        if (isExtrude) {
          // ExtrudeGeometryの場合、centerとextrudePathのすべての点のY座標を更新
          if (editedGeometry.center) {
            editedGeometry.center[1] = Number(value) || editedGeometry.center[1];
          }
          editedGeometry.extrudePath = editedGeometry.extrudePath.map(point => [
            point[0],
            Number(value) || point[1],
            point[2]
          ]);
        } else {
          editedGeometry.vertices[0][1] = Number(value) || editedGeometry.vertices[0][1];
        }
        return;
      }

      if (key === "直径[mm]") {
        const newDiameter = Number(value);
        if (isNaN(newDiameter)) return;

        const newRadius = newDiameter / 2;

        if (editedAttributes.radius) {
          editedAttributes.radius = newRadius;
        }

        if (editedAttributes.diameter) {
          editedAttributes.diameter = newDiameter;
        }

        // ExtrudeGeometryの場合、vertices2Dを再生成
        if (isExtrude && editedGeometry.vertices2D) {
          // 半径をメートル単位に変換（mm単位の場合は1000で割る）
          const radiusInMeters = newRadius > 5 ? newRadius / 1000 : newRadius;
          // 元のセグメント数を維持（デフォルトは32）
          const segments = editedGeometry.vertices2D.length || 32;
          const newVertices2D = [];
          for (let i = 0; i < segments; i++) {
            const angle = (i / segments) * Math.PI * 2;
            newVertices2D.push([
              Math.cos(angle) * radiusInMeters,
              Math.sin(angle) * radiusInMeters
            ]);
          }
          editedGeometry.vertices2D = newVertices2D;
        }

        return;
      }

      if (key === "幅[m]") {
        if (isPolyhedron) {
          // Polyhedronの場合: AABBのX方向（東西）のサイズを変更
          mesh.updateMatrixWorld?.(true);
          const bbox = new THREE.Box3().setFromObject(mesh);
          const currentSize = new THREE.Vector3();
          bbox.getSize(currentSize);
          const centerWorld = bbox.getCenter(new THREE.Vector3());

          const targetWidth = Number(value);
          if (Number.isFinite(targetWidth) && currentSize.x > 0) {
            const scaleX = targetWidth / currentSize.x;

            // 中心を基準にX方向にスケール変換
            // データ座標系 [x, y, z] → Three.js (x, z, y)
            // データの v[0] がThree.jsの x (東西) に対応
            if (Array.isArray(editedGeometry?.vertices)) {
              editedGeometry.vertices = editedGeometry.vertices.map((v) => {
                if (!Array.isArray(v) || v.length < 3) return v;
                const offsetX = (Number(v[0]) || 0) - centerWorld.x;
                return [
                  centerWorld.x + offsetX * scaleX,
                  Number(v[1]) || 0,
                  Number(v[2]) || 0
                ];
              });
            }
          }
          return;
        }

        if (editedAttributes.width) {
          editedAttributes.width = Number(value) || editedAttributes.width;
        }
        return;
      }

      if (key === "高さ[m]") {
        if (isPolyhedron) {
          // Polyhedronの場合: AABBのY方向（鉛直）のサイズを変更
          mesh.updateMatrixWorld?.(true);
          const bbox = new THREE.Box3().setFromObject(mesh);
          const currentSize = new THREE.Vector3();
          bbox.getSize(currentSize);
          const centerWorld = bbox.getCenter(new THREE.Vector3());

          const targetHeight = Number(value);
          if (Number.isFinite(targetHeight) && currentSize.y > 0) {
            const scaleY = targetHeight / currentSize.y;

            // 中心を基準にY方向にスケール変換
            // データ座標系 [x, y, z] → Three.js (x, z, y)
            // データの v[2] がThree.jsの y (鉛直) に対応
            if (Array.isArray(editedGeometry?.vertices)) {
              editedGeometry.vertices = editedGeometry.vertices.map((v) => {
                if (!Array.isArray(v) || v.length < 3) return v;
                const offsetY = (Number(v[2]) || 0) - centerWorld.y;
                return [
                  Number(v[0]) || 0,
                  Number(v[1]) || 0,
                  centerWorld.y + offsetY * scaleY
                ];
              });
            }
          }
          return;
        }

        if (editedAttributes.height) {
          editedAttributes.height = Number(value) || editedAttributes.height;
        }
        return;
      }

      if (key === "長さ[m]") {
        if (isPolyhedron) {
          // Polyhedronの場合: AABBの最長軸方向のサイズを変更
          mesh.updateMatrixWorld?.(true);
          const bbox = new THREE.Box3().setFromObject(mesh);
          const currentSize = new THREE.Vector3();
          bbox.getSize(currentSize);
          const centerWorld = bbox.getCenter(new THREE.Vector3());

          // 最長軸を特定
          let maxAxis = 'x';
          let maxLength = currentSize.x;
          if (currentSize.y > maxLength) {
            maxAxis = 'y';
            maxLength = currentSize.y;
          }
          if (currentSize.z > maxLength) {
            maxAxis = 'z';
            maxLength = currentSize.z;
          }

          const targetLength = Number(value);
          if (Number.isFinite(targetLength) && maxLength > 0) {
            const scale = targetLength / maxLength;

            // 中心を基準に最長軸方向にスケール変換
            // データ座標系 [x, y, z] → Three.js (x, z, y)
            if (Array.isArray(editedGeometry?.vertices)) {
              editedGeometry.vertices = editedGeometry.vertices.map((v) => {
                if (!Array.isArray(v) || v.length < 3) return v;
                const result = [...v];

                if (maxAxis === 'x') {
                  // X方向（東西）: データの v[0] がThree.jsの x
                  const offsetX = (Number(v[0]) || 0) - centerWorld.x;
                  result[0] = centerWorld.x + offsetX * scale;
                } else if (maxAxis === 'y') {
                  // Y方向（鉛直）: データの v[2] がThree.jsの y
                  const offsetY = (Number(v[2]) || 0) - centerWorld.y;
                  result[2] = centerWorld.y + offsetY * scale;
                } else {
                  // Z方向（南北）: データの v[1] がThree.jsの z
                  const offsetZ = (Number(v[1]) || 0) - centerWorld.z;
                  result[1] = centerWorld.z + offsetZ * scale;
                }

                return result;
              });
            }
          }
          return;
        }

        if (isExtrude) {
          // ExtrudeGeometryの場合、extrudePathの長さを調整
          const targetLength = Number(value) || 0;
          if (editedGeometry.extrudePath.length >= 2) {
            const start = editedGeometry.extrudePath[0];
            const end = editedGeometry.extrudePath[editedGeometry.extrudePath.length - 1];
            const currentLength = Math.sqrt(
              Math.pow(end[0] - start[0], 2) +
              Math.pow(end[1] - start[1], 2) +
              Math.pow(end[2] - start[2], 2)
            );
            if (currentLength > 0) {
              const scale = targetLength / currentLength;
              const direction = [
                end[0] - start[0],
                end[1] - start[1],
                end[2] - start[2]
              ];
              editedGeometry.extrudePath[editedGeometry.extrudePath.length - 1] = [
                start[0] + direction[0] * scale,
                start[1] + direction[1] * scale,
                start[2] + direction[2] * scale
              ];
            }
          }
        } else {
          const newStartEndPoint = this.adjustPipeLength(editedGeometry.vertices[0], editedGeometry.vertices[1], Number(value));
          console.log(newStartEndPoint.start);
          console.log(newStartEndPoint.end);
          editedGeometry.vertices[0] = newStartEndPoint.start;
          editedGeometry.vertices[1] = newStartEndPoint.end;
        }
        return;
      }

      if (key === "端点1東西[m]") {
        const newX = Number(value);
        if (isNaN(newX)) return;

        if (isExtrude) {
          const lastIdx = editedGeometry.extrudePath.length - 1;
          const oldPath = editedGeometry.extrudePath.map((p) => [
            Number(p[0]) || 0,
            Number(p[1]) || 0,
            Number(p[2]) || 0
          ]);
          const oldStart = oldPath[0];
          const oldEnd = oldPath[lastIdx];

          // 端点1を更新（端点2は固定）
          editedGeometry.extrudePath[0][0] = newX;

          // 中間点のXを、元パス上の距離比で補間更新（Y/Zは維持）
          if (lastIdx >= 2) {
            const cumulative = [0];
            let totalLength = 0;
            for (let i = 1; i <= lastIdx; i++) {
              const a = oldPath[i - 1];
              const b = oldPath[i];
              totalLength += Math.sqrt(
                Math.pow(b[0] - a[0], 2) +
                Math.pow(b[1] - a[1], 2) +
                Math.pow(b[2] - a[2], 2)
              );
              cumulative[i] = totalLength;
            }

            for (let i = 1; i < lastIdx; i++) {
              const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
              editedGeometry.extrudePath[i][0] = newX + (oldEnd[0] - newX) * t;
            }
          }

          if (editedGeometry.center && lastIdx >= 0) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.extrudePath[0][0]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.extrudePath[0][1]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.extrudePath[0][2]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
          }
        } else {
          editedGeometry.vertices[0][0] = newX;
          if (editedGeometry.center && editedGeometry.vertices?.length >= 2) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.vertices[0][0]) || 0) +
               (Number(editedGeometry.vertices[1][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.vertices[0][1]) || 0) +
               (Number(editedGeometry.vertices[1][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.vertices[0][2]) || 0) +
               (Number(editedGeometry.vertices[1][2]) || 0)) / 2;
          }
        }
        return;
      }

      if (key === "端点1土被り深さ[m]") {
        const coverDepth = Number(value) || 0;
        // 端点の土被りも表示と同様に、半径(height/2, radius) は考慮しない
        const offset = 0;
        const currentZ = isExtrude
          ? editedGeometry.extrudePath?.[0]?.[2]
          : editedGeometry.vertices?.[0]?.[2];
        if (isExtrude) {
          // Extrusion で depth 属性がある場合は、表示と同じく depth 属性ベースで土被り差分を解釈する
          const hasDepthAttrs =
            editedAttributes?.start_point_depth != null &&
            Number.isFinite(Number(editedAttributes.start_point_depth));

          if (hasDepthAttrs) {
            const currentDepthM = Number(editedAttributes.start_point_depth) / 100; // cm → m
            const deltaCoverM = coverDepth - currentDepthM;

            if (deltaCoverM !== 0) {
              const deltaZ = -deltaCoverM; // cover増加(正) → Z減少
              const lastIdx = editedGeometry.extrudePath.length - 1;
              const oldPath = editedGeometry.extrudePath.map((p) => [
                Number(p[0]) || 0,
                Number(p[1]) || 0,
                Number(p[2]) || 0
              ]);
              const oldStartZ = Number(editedGeometry.extrudePath[0][2]) || 0;
              const oldEndZ = Number(editedGeometry.extrudePath[lastIdx][2]) || 0;
              
              // 始点のZ座標を更新
              editedGeometry.extrudePath[0][2] = oldStartZ + deltaZ;

              // 中間点を更新（片端固定 + 元パス距離比で補間）
              if (lastIdx >= 2) {
                const cumulative = [0];
                let totalLength = 0;
                for (let i = 1; i <= lastIdx; i++) {
                  const a = oldPath[i - 1];
                  const b = oldPath[i];
                  totalLength += Math.sqrt(
                    Math.pow(b[0] - a[0], 2) +
                    Math.pow(b[1] - a[1], 2) +
                    Math.pow(b[2] - a[2], 2)
                  );
                  cumulative[i] = totalLength;
                }

                const newStartZ = editedGeometry.extrudePath[0][2];
                for (let i = 1; i < lastIdx; i++) {
                  const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
                  const oldBaseZ = oldStartZ + (oldEndZ - oldStartZ) * t;
                  const oldOffsetZ = oldPath[i][2] - oldBaseZ;
                  const newBaseZ = newStartZ + (oldEndZ - newStartZ) * t;
                  editedGeometry.extrudePath[i][2] = newBaseZ + oldOffsetZ;
                }
              }

              if (editedGeometry.center && lastIdx >= 0) {
                editedGeometry.center[2] =
                  ((Number(editedGeometry.extrudePath[0][2]) || 0) +
                   (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
              }

              const deltaDepthCm = deltaCoverM * 100;
              if (editedAttributes.start_point_depth != null) {
                editedAttributes.start_point_depth =
                  Number(editedAttributes.start_point_depth) + deltaDepthCm;
              }
            }
          } else {
            const deltaZ = calcExtrudeDeltaZFromCoverDepth(coverDepth, offset, currentZ);
            const lastIdx = editedGeometry.extrudePath.length - 1;
            const oldPath = editedGeometry.extrudePath.map((p) => [
              Number(p[0]) || 0,
              Number(p[1]) || 0,
              Number(p[2]) || 0
            ]);
            const oldStartZ = Number(editedGeometry.extrudePath[0][2]) || 0;
            const oldEndZ = Number(editedGeometry.extrudePath[lastIdx][2]) || 0;
            
            // 始点のZ座標を更新
            editedGeometry.extrudePath[0][2] = oldStartZ + deltaZ;

            // 中間点を更新（片端固定 + 元パス距離比で補間）
            if (lastIdx >= 2) {
              const cumulative = [0];
              let totalLength = 0;
              for (let i = 1; i <= lastIdx; i++) {
                const a = oldPath[i - 1];
                const b = oldPath[i];
                totalLength += Math.sqrt(
                  Math.pow(b[0] - a[0], 2) +
                  Math.pow(b[1] - a[1], 2) +
                  Math.pow(b[2] - a[2], 2)
                );
                cumulative[i] = totalLength;
              }

              const newStartZ = editedGeometry.extrudePath[0][2];
              for (let i = 1; i < lastIdx; i++) {
                const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
                const oldBaseZ = oldStartZ + (oldEndZ - oldStartZ) * t;
                const oldOffsetZ = oldPath[i][2] - oldBaseZ;
                const newBaseZ = newStartZ + (oldEndZ - newStartZ) * t;
                editedGeometry.extrudePath[i][2] = newBaseZ + oldOffsetZ;
              }
            }
            
            if (editedGeometry.center && lastIdx >= 0) {
              editedGeometry.center[2] =
                ((Number(editedGeometry.extrudePath[0][2]) || 0) +
                 (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
            }
          }
        } else {
          const newZ = calcDepthZByCurrentSign(coverDepth, offset, currentZ);
          editedGeometry.vertices[0][2] = newZ;
          editedAttributes.start_point_depth = newZ;
        }
        return;
      }

      if (key === "端点1南北[m]") {
        const newY = Number(value);
        if (isNaN(newY)) return;

        if (isExtrude) {
          const lastIdx = editedGeometry.extrudePath.length - 1;
          const oldPath = editedGeometry.extrudePath.map((p) => [
            Number(p[0]) || 0,
            Number(p[1]) || 0,
            Number(p[2]) || 0
          ]);
          const oldStart = oldPath[0];
          const oldEnd = oldPath[lastIdx];

          // 端点1を更新（端点2は固定）
          editedGeometry.extrudePath[0][1] = newY;

          // 中間点のYを、元パス上の距離比で補間更新（X/Zは維持）
          if (lastIdx >= 2) {
            const cumulative = [0];
            let totalLength = 0;
            for (let i = 1; i <= lastIdx; i++) {
              const a = oldPath[i - 1];
              const b = oldPath[i];
              totalLength += Math.sqrt(
                Math.pow(b[0] - a[0], 2) +
                Math.pow(b[1] - a[1], 2) +
                Math.pow(b[2] - a[2], 2)
              );
              cumulative[i] = totalLength;
            }

            for (let i = 1; i < lastIdx; i++) {
              const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
              editedGeometry.extrudePath[i][1] = newY + (oldEnd[1] - newY) * t;
            }
          }

          if (editedGeometry.center && lastIdx >= 0) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.extrudePath[0][0]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.extrudePath[0][1]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.extrudePath[0][2]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
          }
        } else {
          editedGeometry.vertices[0][1] = newY;
          if (editedGeometry.center && editedGeometry.vertices?.length >= 2) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.vertices[0][0]) || 0) +
               (Number(editedGeometry.vertices[1][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.vertices[0][1]) || 0) +
               (Number(editedGeometry.vertices[1][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.vertices[0][2]) || 0) +
               (Number(editedGeometry.vertices[1][2]) || 0)) / 2;
          }
        }
        return;
      }

      if (key === "端点2東西[m]") {
        const newX = Number(value);
        if (isNaN(newX)) return;

        if (isExtrude) {
          const lastIdx = editedGeometry.extrudePath.length - 1;
          const oldPath = editedGeometry.extrudePath.map((p) => [
            Number(p[0]) || 0,
            Number(p[1]) || 0,
            Number(p[2]) || 0
          ]);
          const oldStart = oldPath[0];

          // 端点2を更新（端点1は固定）
          editedGeometry.extrudePath[lastIdx][0] = newX;

          // 中間点のXを、元パス上の距離比で補間更新（Y/Zは維持）
          if (lastIdx >= 2) {
            const cumulative = [0];
            let totalLength = 0;
            for (let i = 1; i <= lastIdx; i++) {
              const a = oldPath[i - 1];
              const b = oldPath[i];
              totalLength += Math.sqrt(
                Math.pow(b[0] - a[0], 2) +
                Math.pow(b[1] - a[1], 2) +
                Math.pow(b[2] - a[2], 2)
              );
              cumulative[i] = totalLength;
            }

            for (let i = 1; i < lastIdx; i++) {
              const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
              editedGeometry.extrudePath[i][0] = oldStart[0] + (newX - oldStart[0]) * t;
            }
          }

          if (editedGeometry.center && lastIdx >= 0) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.extrudePath[0][0]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.extrudePath[0][1]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.extrudePath[0][2]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
          }
        } else {
          editedGeometry.vertices[1][0] = newX;
          if (editedGeometry.center && editedGeometry.vertices?.length >= 2) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.vertices[0][0]) || 0) +
               (Number(editedGeometry.vertices[1][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.vertices[0][1]) || 0) +
               (Number(editedGeometry.vertices[1][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.vertices[0][2]) || 0) +
               (Number(editedGeometry.vertices[1][2]) || 0)) / 2;
          }
        }
        return;
      }

      if (key === "端点2土被り深さ[m]") {
        const coverDepth = Number(value) || 0;
        // 端点の土被りも表示と同様に、半径(height/2, radius) は考慮しない
        const offset = 0;
        const lastIdx = isExtrude ? editedGeometry.extrudePath.length - 1 : -1;
        const currentZ = isExtrude
          ? editedGeometry.extrudePath?.[lastIdx]?.[2]
          : editedGeometry.vertices?.[1]?.[2];
        if (isExtrude) {
          // Extrusion で depth 属性がある場合は、表示と同じく depth 属性ベースで土被り差分を解釈する
          const hasDepthAttrs =
            editedAttributes?.end_point_depth != null &&
            Number.isFinite(Number(editedAttributes.end_point_depth));

          if (hasDepthAttrs) {
            const currentDepthM = Number(editedAttributes.end_point_depth) / 100; // cm → m
            const deltaCoverM = coverDepth - currentDepthM;

            if (deltaCoverM !== 0) {
              const deltaZ = -deltaCoverM; // cover増加(正) → Z減少
              const oldPath = editedGeometry.extrudePath.map((p) => [
                Number(p[0]) || 0,
                Number(p[1]) || 0,
                Number(p[2]) || 0
              ]);
              const oldStartZ = Number(editedGeometry.extrudePath[0][2]) || 0;
              const oldEndZ = Number(editedGeometry.extrudePath[lastIdx][2]) || 0;
              
              // 終点のZ座標を更新
              editedGeometry.extrudePath[lastIdx][2] = oldEndZ + deltaZ;

              // 中間点を更新（片端固定 + 元パス距離比で補間）
              if (lastIdx >= 2) {
                const cumulative = [0];
                let totalLength = 0;
                for (let i = 1; i <= lastIdx; i++) {
                  const a = oldPath[i - 1];
                  const b = oldPath[i];
                  totalLength += Math.sqrt(
                    Math.pow(b[0] - a[0], 2) +
                    Math.pow(b[1] - a[1], 2) +
                    Math.pow(b[2] - a[2], 2)
                  );
                  cumulative[i] = totalLength;
                }

                const newEndZ = editedGeometry.extrudePath[lastIdx][2];
                for (let i = 1; i < lastIdx; i++) {
                  const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
                  const oldBaseZ = oldStartZ + (oldEndZ - oldStartZ) * t;
                  const oldOffsetZ = oldPath[i][2] - oldBaseZ;
                  const newBaseZ = oldStartZ + (newEndZ - oldStartZ) * t;
                  editedGeometry.extrudePath[i][2] = newBaseZ + oldOffsetZ;
                }
              }

              if (editedGeometry.center && lastIdx >= 0) {
                editedGeometry.center[2] =
                  ((Number(editedGeometry.extrudePath[0][2]) || 0) +
                   (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
              }

              const deltaDepthCm = deltaCoverM * 100;
              if (editedAttributes.end_point_depth != null) {
                editedAttributes.end_point_depth =
                  Number(editedAttributes.end_point_depth) + deltaDepthCm;
              }
            }
          } else {
            const deltaZ = calcExtrudeDeltaZFromCoverDepth(coverDepth, offset, currentZ);
            const oldPath = editedGeometry.extrudePath.map((p) => [
              Number(p[0]) || 0,
              Number(p[1]) || 0,
              Number(p[2]) || 0
            ]);
            const oldStartZ = Number(editedGeometry.extrudePath[0][2]) || 0;
            const oldEndZ = Number(editedGeometry.extrudePath[lastIdx][2]) || 0;
            
            // 終点のZ座標を更新
            editedGeometry.extrudePath[lastIdx][2] = oldEndZ + deltaZ;

            // 中間点を更新（片端固定 + 元パス距離比で補間）
            if (lastIdx >= 2) {
              const cumulative = [0];
              let totalLength = 0;
              for (let i = 1; i <= lastIdx; i++) {
                const a = oldPath[i - 1];
                const b = oldPath[i];
                totalLength += Math.sqrt(
                  Math.pow(b[0] - a[0], 2) +
                  Math.pow(b[1] - a[1], 2) +
                  Math.pow(b[2] - a[2], 2)
                );
                cumulative[i] = totalLength;
              }

              const newEndZ = editedGeometry.extrudePath[lastIdx][2];
              for (let i = 1; i < lastIdx; i++) {
                const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
                const oldBaseZ = oldStartZ + (oldEndZ - oldStartZ) * t;
                const oldOffsetZ = oldPath[i][2] - oldBaseZ;
                const newBaseZ = oldStartZ + (newEndZ - oldStartZ) * t;
                editedGeometry.extrudePath[i][2] = newBaseZ + oldOffsetZ;
              }
            }
            
            if (editedGeometry.center && lastIdx >= 0) {
              editedGeometry.center[2] =
                ((Number(editedGeometry.extrudePath[0][2]) || 0) +
                 (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
            }
          }
        } else {
          const newZ = calcDepthZByCurrentSign(coverDepth, offset, currentZ);
          editedGeometry.vertices[1][2] = newZ;
          editedAttributes.end_point_depth = newZ;
        }
        return;
      }

      if (key === "端点2南北[m]") {
        const newY = Number(value);
        if (isNaN(newY)) return;

        if (isExtrude) {
          const lastIdx = editedGeometry.extrudePath.length - 1;
          const oldPath = editedGeometry.extrudePath.map((p) => [
            Number(p[0]) || 0,
            Number(p[1]) || 0,
            Number(p[2]) || 0
          ]);
          const oldStart = oldPath[0];

          // 端点2を更新（端点1は固定）
          editedGeometry.extrudePath[lastIdx][1] = newY;

          // 中間点のYを、元パス上の距離比で補間更新（X/Zは維持）
          if (lastIdx >= 2) {
            const cumulative = [0];
            let totalLength = 0;
            for (let i = 1; i <= lastIdx; i++) {
              const a = oldPath[i - 1];
              const b = oldPath[i];
              totalLength += Math.sqrt(
                Math.pow(b[0] - a[0], 2) +
                Math.pow(b[1] - a[1], 2) +
                Math.pow(b[2] - a[2], 2)
              );
              cumulative[i] = totalLength;
            }

            for (let i = 1; i < lastIdx; i++) {
              const t = totalLength > 0.000001 ? cumulative[i] / totalLength : i / lastIdx;
              editedGeometry.extrudePath[i][1] = oldStart[1] + (newY - oldStart[1]) * t;
            }
          }

          if (editedGeometry.center && lastIdx >= 0) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.extrudePath[0][0]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.extrudePath[0][1]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.extrudePath[0][2]) || 0) +
               (Number(editedGeometry.extrudePath[lastIdx][2]) || 0)) / 2;
          }
        } else {
          editedGeometry.vertices[1][1] = newY;
          if (editedGeometry.center && editedGeometry.vertices?.length >= 2) {
            editedGeometry.center[0] =
              ((Number(editedGeometry.vertices[0][0]) || 0) +
               (Number(editedGeometry.vertices[1][0]) || 0)) / 2;
            editedGeometry.center[1] =
              ((Number(editedGeometry.vertices[0][1]) || 0) +
               (Number(editedGeometry.vertices[1][1]) || 0)) / 2;
            editedGeometry.center[2] =
              ((Number(editedGeometry.vertices[0][2]) || 0) +
               (Number(editedGeometry.vertices[1][2]) || 0)) / 2;
          }
        }
        return;
      }

      if (key === "種別") {
        editedAttributes.pipe_kind = value;
        return;
      }

      if (key === "材質") {
        editedAttributes.material = value;
        return;
      }

      console.log(key + " の値は変更できません。");

    });

    editedData.geometry[0] = editedGeometry;
    editedData.attributes = editedAttributes;
    editedData.updated_user = 2; // 暫定
    editedData.updated_at = (new Date()).toISOString();

    this.editedOrDeletedObjectsData[objectKey] = editedData;

    return { key: objectKey, object: editedData };
  }


  // オブジェクト削除
  deleteObject(mesh) {
    console.log("削除");
    const key = this.getObjectKey(mesh);
    if (!key) {
      console.log("削除対象のキーが見つかりません");
      return null;
    }
    const deletedData = this.getOrginalData(key);

    if (!deletedData) {
      console.log("削除対象のデータが見つかりません");
      return null;
    }

    deletedData.updated_user = 2; // 暫定
    deletedData.updated_at = (new Date()).toISOString();
    deletedData.snapshot_id = 3;  // snapshotId に削除マークを付ける
    this.editedOrDeletedObjectsData[key] = deletedData;
    return key;
  }

  // 追加オブジェクトかどうか判定
  isAddedObject(objectKey) {
    if (!objectKey) return false;
    return !!this.addedObjectsData?.[objectKey];
  }

  // 追加オブジェクトを管理対象から削除（DB未登録のためAPI送信しない）
  removeAddedObject(objectKey) {
    if (!objectKey || !this.addedObjectsData?.[objectKey]) {
      return false;
    }

    delete this.addedObjectsData[objectKey];
    // 追加オブジェクトを編集中に削除した場合、編集キャッシュも消して整合させる
    delete this.editedOrDeletedObjectsData[objectKey];
    return true;
  }

  // オブジェクト複製。
  duplicateObject(templateData, offset) {

    const newId = crypto.randomUUID();// 暫定
    const newKey = newId;

    const duplicatedData = JSON.parse(JSON.stringify(templateData));

    const geometry = duplicatedData?.geometry?.[0];
    const offsetCm = offset * 100;
    if (!geometry) {
      this.addedObjectsData[newKey] = duplicatedData;
      return { key: newKey, object: duplicatedData };
    }

    if (geometry.position) {
      geometry.position[2] -= offset;
    }

    if (geometry.center) {
      geometry.center[2] -= offset;
    }

    if (geometry.vertices && geometry.vertices.length > 0) {
      if (duplicatedData.shape_type === 25) {
        geometry.vertices = geometry.vertices.map(v => [v[0], v[1], v[2] + offset]);
      } else {
        geometry.vertices = geometry.vertices.map(v => [v[0], v[1], v[2] - offsetCm]);
      }
    }

    // Extrusionは extrudePath が実際の形状位置に使われるため、こちらもオフセット
    if (geometry.extrudePath && geometry.extrudePath.length > 0) {
      geometry.extrudePath = geometry.extrudePath.map(v => [v[0], v[1], v[2] + offset]);
    }

    // 管路は start/end_point_depth を優先して表示位置を決めるため、属性も更新する
    // depthは「地表から下向き正」のため、上に3m動かすには depth を減算する
    if (duplicatedData?.attributes) {
      if (duplicatedData.attributes.start_point_depth != null) {
        duplicatedData.attributes.start_point_depth -= offsetCm;
      }
      if (duplicatedData.attributes.end_point_depth != null) {
        duplicatedData.attributes.end_point_depth -= offsetCm;
      }

      // Polyhedronのdepth系属性（depth, depth_1, depth_2 ...）も複製時に同量移動する
      // NOTE: 現状データは start/end_point_depth と同様に cm 前提で扱う
      if (duplicatedData.shape_type === 25) {
        Object.keys(duplicatedData.attributes).forEach((key) => {
          if (/^depth(?:_\d+)?$/i.test(key)) {
            const depth = Number(duplicatedData.attributes[key]);
            if (Number.isFinite(depth)) {
              duplicatedData.attributes[key] = depth + offset;
            }
          }
        });
      }
    }

    duplicatedData.geometry[0] = geometry;

    this.addedObjectsData[newKey] = duplicatedData;
    return { key: newKey, object: duplicatedData };
  }

  // コミット(APIサーバーにデータを送信)
  async commit() {

    if (!this.hasChanged()) {
      message.success("登録可能なデータはありません。");
      return;
    }

    try {
      // 追加／複製。
      await this.accessor.addCityJsonData(this.addedObjectsData);

      // 更新／削除。
      await this.accessor.updateCityJsonData(this.editedOrDeletedObjectsData);

      // オリジナルデータを更新。
      this.updateOriginalData();

      // コミット完了したデータを削除。
      this.clearChangedData();

      message.success("オブジェクトを登録しました。");

    } catch (err) {
      if (err.response) {
        console.error('APIサーバーエラー応答:', err.response.status, err.response.data);
      }
      console.error(err.message);
      message.error("オブジェクトの登録に失敗しました。コンソールログを確認してください。");
    }
  }

  // 削除のみをコミット(APIサーバーにデータを送信)
  async commitDeleteByKey(objectKey) {
    const target = this.editedOrDeletedObjectsData?.[objectKey];
    if (!target || target.snapshot_id !== 3) {
      message.warning("削除対象データが見つかりません。");
      return false;
    }

    try {
      await this.accessor.updateCityJsonData({ [objectKey]: target });

      // 削除コミットが成功したら管理対象から除外
      delete this.originalData[objectKey];
      delete this.editedOrDeletedObjectsData[objectKey];

      message.success("オブジェクトを削除しました。");
      return true;
    } catch (err) {
      if (err.response) {
        console.error('APIサーバーエラー応答:', err.response.status, err.response.data);
      }
      console.error(err.message);
      message.error("オブジェクトの削除に失敗しました。コンソールログを確認してください。");
      return false;
    }
  }

  // 変更が有ったか
  hasChanged() {
    if (this.addedObjectsData && Object.entries(this.addedObjectsData).length > 0) {
      return true;
    }

    if (this.editedOrDeletedObjectsData && Object.entries(this.editedOrDeletedObjectsData).length > 0) {
      return true;
    }

    return false;
  }

  // 変更対象のキー一覧を取得（編集・削除・追加）
  getChangedObjectKeys() {
    const editedOrDeletedKeys = Object.keys(this.editedOrDeletedObjectsData || {});
    const addedKeys = Object.keys(this.addedObjectsData || {});
    return Array.from(new Set([...editedOrDeletedKeys, ...addedKeys]));
  }

  // 削除対象のオブジェクトを取得
  getDeletedObjectsData() {
    return Object.fromEntries(
      Object.entries(this.editedOrDeletedObjectsData).filter(([, v]) => v.snapshot_id === 3)
    );
  }

  // スナップショットIDを書き換える
  updateSnapshotId(data, new_snapshot_id) {
    return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, { ...v, snapshot_id: new_snapshot_id }]));
  }

  clear() {
    this.originalData = {};
    this.clearChangedData();
  }

  rollback(objectKey) {
    delete this.editedOrDeletedObjectsData[objectKey];
  }

  rollbackAll() {
    this.clearChangedData();
  }

  // オリジナルデータを更新。
  updateOriginalData() {
    const next = { ...this.originalData };

    // オブジェクト追加分を反映。
    for (const [key, obj] of Object.entries(this.addedObjectsData)) {
      next[key] = obj;
    }

    // オブジェクト編集／削除分を反映。
    for (const [key, editObj] of Object.entries(this.editedOrDeletedObjectsData)) {
      const existing = next[key];

      if (existing) {
        // snapshot_idは既存の値を使用する
        const { snapshot_id: _ignore, ...rest } = editObj || {};
        next[key] = { ...existing, ...rest, snapshot_id: existing.snapshot_id };
      } else {
        next[key] = editObj;
      }
    }

    this.originalData = next;
  }

  // データ変更をリセット。
  clearChangedData() {
    this.editedOrDeletedObjectsData = {};
    this.addedObjectsData = {};
  }

  // 配管の長さを変更し、中心を固定したまま start/end 座標を再計算
  adjustPipeLength(startPoint, endPoint, newLength) {
    // 中心座標
    const center = [
      (startPoint[0] + endPoint[0]) / 2,
      (startPoint[1] + endPoint[1]) / 2,
      (startPoint[2] + endPoint[2]) / 2
    ];

    // 差分ベクトル
    const dx = endPoint[0] - startPoint[0];
    const dy = endPoint[1] - startPoint[1];
    const dz = endPoint[2] - startPoint[2];

    // 現在の長さ
    const currentLength = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // 長さがゼロなら、X軸方向に配置（デフォルト処理）
    if (currentLength === 0) {
      const halfLength = newLength / 2;
      return {
        start: [center[0] - halfLength, center[1], center[2]],
        end: [center[0] + halfLength, center[1], center[2]]
      };
    }

    // 正規化方向ベクトル
    const ux = dx / currentLength;
    const uy = dy / currentLength;
    const uz = dz / currentLength;

    // 新しい半分の長さ
    const halfLength = newLength / 2;

    // 新しい座標
    const newStart = [
      center[0] - ux * halfLength,
      center[1] - uy * halfLength,
      center[2] - uz * halfLength
    ];

    const newEnd = [
      center[0] + ux * halfLength,
      center[1] + uy * halfLength,
      center[2] + uz * halfLength
    ];

    return { start: newStart, end: newEnd };
  }


  // 半径取得
  // HACK : PipelineInfoDisplay.js の処理と冗長
  getRadiusInMeters = (attributes) => {

    const threshold = 5;
    const scale = 1000;
    const min = 0.05;

    if (attributes?.radius != null) {
      let radius = Number(attributes.radius);
      // radiusが大きい場合はmm単位と判断してm単位に変換
      if (radius > threshold) radius = radius / scale;
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
    } else if (attributes?.diameter != null) {
      let diameter = Number(attributes.diameter);
      // diameterが大きい場合はmm単位と判断してm単位に変換
      if (diameter > threshold) diameter = diameter / scale;
      const radius = diameter / 2;
      if (Number.isFinite(radius) && radius > 0) {
        return radius;
      }
    }
    return min;
  };


  // デバッグ用：ファイル出力
  dumpAll() {
    this.accessor.download_as_Json(this.originalData, "originalData.json");
    this.accessor.download_as_Json(this.addedObjectsData, "addedObjectsData.json");
    this.accessor.download_as_Json(this.editedOrDeletedObjectsData, "editedOrDeletedObjectsData.json");
  }
  // 四分木

  rootQuadTree(box, maxDepth = 8, maxObjects = 10) {

    // 2D用にzは無視

    const boundary = {

      min: { x: box.min.x, y: box.min.z },

      max: { x: box.max.x, y: box.max.z }

    };

    this.quadTree = new QuadtreeNode(boundary, 0, maxDepth, maxObjects);

  }

  registerQuadTree(key, nodes) {

    for (let i = 0; i < nodes.length; i++) {

      const node = nodes[i];

      // データを四分木に登録

      const rect = new Rectangle(key, { x: node.start.x, y: node.start.y }, { x: node.end.x, y: node.end.y }, node.width);

      this.quadTree.insert(rect);

    }

  }

  searchNodes(theta, rho) {

    const result = [];

    this.searchIntersectingRectangles(this.quadTree, theta, rho, result);

    return result

  }

  searchIntersectingRectangles(node, theta, rho, result = []) {

    // ノードのAABBと直線のρ範囲の交差判定

    if (!this.lineIntersectsAABBWithRho(node.boundary, theta, rho)) {

      return result; // 交差しなければ探索終了

    }

    // ノードに矩形があれば

    if (node.hasObject) {

      for (const rect of node.objects) {

        if (this.rectIntersectsLineHough(rect, theta, rho)) {

          result.push(rect);

        }

      }

    }

    // 子ノードがあれば再帰

    if (node.children.length > 0) {

      for (const child of node.children) {

        this.searchIntersectingRectangles(child, theta, rho, result);

      }

    }

    return result;

  }

  // AABBとρの範囲の交差判定

  lineIntersectsAABBWithRho(boundary, theta, rho) {

    // boundary: {min: {x,y}, max: {x,y}}

    // boundaryの4点のρ値

    const vertices = [

      { x: boundary.min.x, y: boundary.min.y },

      { x: boundary.max.x, y: boundary.min.y },

      { x: boundary.min.x, y: boundary.max.y },

      { x: boundary.max.x, y: boundary.max.y }

    ];

    const rhos = vertices.map(p => p.x * Math.cos(theta) + p.y * Math.sin(theta));

    const minRho = Math.min(...rhos);

    const maxRho = Math.max(...rhos);

    // ρの範囲の重なり

    return !(rho < minRho || rho > maxRho);

  }

  rectIntersectsLineHough(rect, theta, rho) {

    const rhoRange = rect.getRhoRange(theta);

    // 直線のρの値と矩形のρ範囲の重なり

    return !(rho < rhoRange.min || rho > rhoRange.max);

  }

  logQuadtree() {

    if (this.quadTree) {

      this.logQuadtreeDetails(this.quadTree, 0);

    }

  }

  logQuadtreeDetails(node, depth) {

    const header = '>> ';

    const indent = '  '.repeat(depth);

    const objCount = node.objects ? node.objects.length : 0;

    // console.log(`${header} ${indent}Node Level ${depth}:`);

    // console.log(`${header} ${indent}  Boundary: min(${node.boundary.min.x}, ${node.boundary.min.y}), max(${node.boundary.max.x}, ${node.boundary.max.y})`);

    // console.log(`${header} ${indent}  Object count: ${objCount}`);

    if (node.objects && node.objects.length > 0) {

      for (const rect of node.objects) {

        // console.log(`${header} ${indent}    Rect ID: ${rect.id}`); // もしrectにidがあれば

        if (this.dbgCount.has(rect.id)) {

          const current = this.dbgCount.get(rect.id);

          this.dbgCount.set(rect.id, current + 1);

        } else {

          this.dbgCount.set(rect.id, 1);

        }

      }

    }

    if (node.children && node.children.length > 0) {

      for (let i = 0; i < node.children.length; i++) {

        this.logQuadtreeDetails(node.children[i], depth + 1);

      }

    }

  }

  logCount() {

    const countMap = this.countMapValues(this.dbgCount);

    // Map の Key を降順にソート

    const sortedMap = new Map(

      [...countMap.entries()].sort((a, b) => b[0] - a[0])

    );

    // 結果をログ表示

    console.log("=== 出現回数 (Key降順) ===");

    for (const [key, count] of sortedMap) {

      console.log(`値: ${key}, 出現回数: ${count}`);

    }

  }

  // 出現回数をカウントする関数

  countMapValues(map) {

    if (!(map instanceof Map)) {

      throw new TypeError('引数は Map オブジェクトである必要があります');

    }

    const counts = new Map(); // 値 → 出現回数

    for (const value of map.values()) {

      counts.set(value, (counts.get(value) || 0) + 1);

    }

    return counts;

  }
}

