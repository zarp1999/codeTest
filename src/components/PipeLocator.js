import * as THREE from 'three';
import { message } from 'antd';
 
/**
 * 配管オブジェクト連続配置モジュール
 */
 
const raycaster = new THREE.Raycaster();
const mouseNDC = new THREE.Vector2();
 
let isAddMode = false;
let verticesOnGround = [];
let previewLine = null;
let pathLine = null;
let lastMouseHitOnGround = null;
let vertexMarkers = [];
 
function setListeners(listeners) {
  enterAddMode._listeners = listeners;
}
 
function getListeners() {
  return enterAddMode._listeners;
}
enterAddMode._listeners = undefined;
 
// マウスクリック地点（クリックポイントから伸ばしたRayと、地面との交差点)を取得
function pickGroundPoint(e, renderer, camera, ground) {
  const rect = renderer.domElement.getBoundingClientRect();
  const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  mouseNDC.set(x, y);
 
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(ground, true);
  return hits.length > 0 ? hits[0] : null;
}
 
// プレビュー線（直近点⇒マウス位置）
function updatePreviewLine(scene, from, to) {
  const yLift = 0.01;
  const p0 = new THREE.Vector3(from.x, yLift, from.z);
  const p1 = new THREE.Vector3(to.x, yLift, to.z);
 
  const points = [p0, p1];
  const geom = new THREE.BufferGeometry().setFromPoints(points);
 
  if (!previewLine) {
    const material = new THREE.LineBasicMaterial({
      color: 0x0077ff, // 濃い青
    });
    previewLine = new THREE.Line(geom, material);
    scene.add(previewLine);
  } else {
    previewLine.geometry.dispose();
    previewLine.geometry = geom;
  }
}
 
// プレビュー線の消去
function clearPreviewLine(scene) {
  if (!previewLine) return;
  scene.remove(previewLine);
  previewLine.geometry.dispose();
  previewLine.material.dispose();
  previewLine = null;
}
 
// 頂点マーカー（球体）
function addVertexMarker(scene, pos) {
  const radius = 0.30;
  const geom = new THREE.SphereGeometry(radius, 16, 12);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffcc00,
    emissive: 0x332200,
    metalness: 0.1,
    roughness: 0.6,
  });
  const m = new THREE.Mesh(geom, mat);
  m.position.set(pos.x, 0.01, pos.z);
  scene.add(m);
  vertexMarkers.push(m);
}
 
// マーカー削除
function clearVertexMarkers(scene) {
  for (const m of vertexMarkers) {
    scene.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  vertexMarkers = [];
}
 
// パス線（確定済み頂点を結ぶ）
function updatePathLine(scene) {
  const yLift = 0.01;
  const points = verticesOnGround.map(v => new THREE.Vector3(v.x, yLift, v.z));
  if (points.length < 2) {
    clearPathLine(scene);
    return;
  }
  const geom = new THREE.BufferGeometry().setFromPoints(points);
 
  if (!pathLine) {
    const material = new THREE.LineBasicMaterial({
      color: 0x0077ff,
    });
    pathLine = new THREE.Line(geom, material);
    scene.add(pathLine);
  } else {
    pathLine.geometry.dispose();
    pathLine.geometry = geom;
  }
}
 
// パス線削除
function clearPathLine(scene) {
  if (!pathLine) return;
  scene.remove(pathLine);
  pathLine.geometry.dispose();
  pathLine.material.dispose();
  pathLine = null;
}
 
// 追加モード開始
export default function enterAddMode(scene, renderer, camera, ground, onPipeVerticesConfirmed) {
  if (isAddMode) return;
  if (!ground) {
    message.error('地面の Mesh が未準備です', 3);
    return;
  }
 
  isAddMode = true;
  verticesOnGround = [];
  clearPreviewLine(scene);
  clearPathLine(scene);
  clearVertexMarkers(scene);
  lastMouseHitOnGround = null;
 
  message.info('地面をクリックして、1点目を追加してください', 2.5);
 
  const onMouseMove = (e) => {
    if (!isAddMode) return;
    const hit = pickGroundPoint(e, renderer, camera, ground);
    if (hit) {
      lastMouseHitOnGround = hit.point;
      if (verticesOnGround.length > 0) {
        const last = verticesOnGround[verticesOnGround.length - 1];
        updatePreviewLine(scene, last, hit.point);
      } else {
        clearPreviewLine(scene);
      }
    } else {
      clearPreviewLine(scene);
      lastMouseHitOnGround = null;
    }
  };
 
  const onMouseDown = (e) => {
    if (!isAddMode) return;
    const hit = pickGroundPoint(e, renderer, camera, ground);
    if (!hit) {
      message.warning('地面以外が選択されました。地面をクリックしてください。', 2.5);
      return;
    }
 
    verticesOnGround.push({ x: hit.point.x, z: hit.point.z });
    addVertexMarker(scene, hit.point);
    updatePathLine(scene);
 
    const n = verticesOnGround.length + 1;
    message.success(`地面をクリックして、${n}点目を追加してください（Enterで確定 / Escでキャンセル）`, 2.5);
 
    lastMouseHitOnGround = hit.point;
    updatePreviewLine(scene, hit.point, hit.point);
  };
 
  const onKeyDown = (e) => {
    if (!isAddMode) return;
 
    if (e.key === 'Enter') {
      if (verticesOnGround.length < 2) {
        message.warning('2点以上必要です。続けて地面をクリックしてください。', 2.5);
        return;
      }
 
      const vertices = verticesOnGround.map(v => [v.x, 0, v.z]);
      const result = { vertices };
 
      console.log('確定した頂点:', result);
 
      if (typeof onPipeVerticesConfirmed === 'function') {
        onPipeVerticesConfirmed(result);
      }
 
      message.success('配管の頂点配列が確定しました。', 2.5);
 
      clearPreviewLine(scene);
      clearPathLine(scene);
      clearVertexMarkers(scene);
      exitAddMode(scene);
    } else if (e.key === 'Escape') {
      message.info('キャンセルしました。最初からやり直してください。', 2.5);
      verticesOnGround = [];
      clearPreviewLine(scene);
      clearPathLine(scene);
      clearVertexMarkers(scene);
      exitAddMode(scene);
    }
  };
 
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mousedown', onMouseDown);
  window.addEventListener('keydown', onKeyDown);
  setListeners({ onMouseMove, onMouseDown, onKeyDown });
}
 
// 追加モード終了
export function exitAddMode(scene) {
  if (!isAddMode) return;
  isAddMode = false;
  lastMouseHitOnGround = null;
 
  clearPreviewLine(scene);
  clearPathLine(scene);
  clearVertexMarkers(scene);
 
  const listeners = getListeners();
  if (listeners) {
    window.removeEventListener('mousemove', listeners.onMouseMove);
    window.removeEventListener('mousedown', listeners.onMouseDown);
    window.removeEventListener('keydown', listeners.onKeyDown);
    setListeners(undefined);
  }
}
 