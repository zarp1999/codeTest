import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

/**
 * STLファイルビューアコンポーネント
 * Scene3D.jsに影響を与えない独立したコンポーネント
 * 
 * @param {THREE.Scene} scene - Three.jsシーン
 * @param {Object} options - オプション設定
 * @param {THREE.Material} options.material - マテリアル（デフォルト: MeshPhongMaterial）
 * @param {number} options.color - 色（マテリアルが指定されていない場合、デフォルト: 0x00ff00）
 * @returns {Object} STLビューアの制御オブジェクト
 */
class STLViewer {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.stlMeshRef = null;
    this.visible = true;
    
    // マテリアルの設定
    if (options.material) {
      this.material = options.material;
    } else {
      this.material = new THREE.MeshPhongMaterial({
        color: options.color || 0x00ff00,
        specular: 0x111111,
        shininess: 200
      });
    }
  }

  /**
   * STLファイルを読み込んで3Dモデルを表示
   * @param {File|string} source - STLファイル（FileまたはURL）
   * @returns {Promise<Object>} モデル情報
   */
  async loadSTL(source) {
    try {
      console.log('STLファイルを読み込み中...');

      let url;
      let shouldRevokeURL = false;
      
      if (source instanceof File) {
        url = URL.createObjectURL(source);
        shouldRevokeURL = true;
      } else if (typeof source === 'string') {
        url = source;
      } else {
        throw new Error('サポートされていないソース形式です');
      }

      const loader = new STLLoader();
      
      return new Promise((resolve, reject) => {
        loader.load(
          url,
          (geometry) => {
            console.log('STLファイルの読み込み完了');
            
            // 既存のメッシュを削除
            if (this.stlMeshRef) {
              this.scene.remove(this.stlMeshRef);
              if (this.stlMeshRef.geometry) this.stlMeshRef.geometry.dispose();
            }

            // ジオメトリの境界を計算
            geometry.computeBoundingBox();
            geometry.computeBoundingSphere();
            geometry.computeVertexNormals();

            // メッシュを作成
            const mesh = new THREE.Mesh(geometry, this.material);
            mesh.visible = this.visible;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            
            this.stlMeshRef = mesh;
            this.scene.add(mesh);

            // Fileオブジェクトの場合はURLを解放
            if (shouldRevokeURL) {
              URL.revokeObjectURL(url);
            }

            const info = {
              type: 'stl',
              geometry: geometry,
              mesh: mesh,
              boundingBox: geometry.boundingBox,
              center: geometry.boundingBox.getCenter(new THREE.Vector3()),
              radius: geometry.boundingSphere.radius
            };

            console.log(`STLモデル表示完了: 中心(${info.center.x.toFixed(2)}, ${info.center.y.toFixed(2)}, ${info.center.z.toFixed(2)})`);

            resolve(info);
          },
          undefined,
          (error) => {
            console.error('STLファイル読み込みエラー:', error);
            if (shouldRevokeURL) {
              URL.revokeObjectURL(url);
            }
            reject(new Error('STLファイルの読み込みに失敗しました: ' + error.message));
          }
        );
      });
    } catch (error) {
      console.error('STLファイル読み込みエラー:', error);
      throw new Error('STLファイルの読み込みに失敗しました: ' + error.message);
    }
  }

  /**
   * モデルの表示/非表示を切り替え
   * @param {boolean} visible - 表示状態
   */
  setVisible(visible) {
    this.visible = visible;
    if (this.stlMeshRef) {
      this.stlMeshRef.visible = visible;
    }
  }

  /**
   * クリーンアップ
   */
  dispose() {
    if (this.stlMeshRef) {
      this.scene.remove(this.stlMeshRef);
      if (this.stlMeshRef.geometry) this.stlMeshRef.geometry.dispose();
      if (this.stlMeshRef.material) this.stlMeshRef.material.dispose();
      this.stlMeshRef = null;
    }
  }
}

export default STLViewer;
