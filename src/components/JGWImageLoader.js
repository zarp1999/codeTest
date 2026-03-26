import * as THREE from 'three';
import { TextureLoader } from 'three';

/**
 * JGW付き地表画像を3D空間に描画するクラス
 * 
 * @param {THREE.Scene} scene - Three.jsシーン
 * @param {Object} options - オプション設定
 * @param {Object} options.coordinateOffset - 座標オフセット { x: number, z: number }
 * @returns {Object} JGW画像ローダーの制御オブジェクト
 */
class JGWImageLoader {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.imageMeshes = []; // 複数の画像メッシュを管理
    this.coordinateOffset = options.coordinateOffset || { x: 0, z: 0 };
  }

  /**
   * JGWファイルを読み込む
   * @param {string|File} jgwFile - JGWファイルのパスまたはFileオブジェクト
   * @returns {Promise<Object>} JGWパラメータ
   */
  async loadJGW(jgwFile) {
    let text;
    if (jgwFile instanceof File) {
      text = await jgwFile.text();
    } else if (typeof jgwFile === 'string') {
      const response = await fetch(jgwFile);
      if (!response.ok) {
        throw new Error(`JGWファイルの読み込みに失敗しました: ${response.status}`);
      }
      text = await response.text();
    } else {
      throw new Error('サポートされていないソース形式です');
    }

    const lines = text.trim().split(/\s+/);
    if (lines.length < 6) {
      throw new Error('JGWファイルの形式が正しくありません（6つのパラメータが必要です）');
    }

    return {
      pixelSizeX: parseFloat(lines[0]),      // X方向のピクセルサイズ
      rotationY: parseFloat(lines[1]),      // Y方向の回転
      rotationX: parseFloat(lines[2]),      // X方向の回転
      pixelSizeY: parseFloat(lines[3]),     // Y方向のピクセルサイズ（通常負）
      topLeftX: parseFloat(lines[4]),        // 左上隅のX座標（経度）
      topLeftY: parseFloat(lines[5])        // 左上隅のY座標（緯度）
    };
  }

  /**
   * JGW付き画像を読み込んで3D空間に描画
   * @param {string|File} imageUrl - 画像ファイルのパスまたはFileオブジェクト
   * @param {string|File} jgwUrl - JGWファイルのパスまたはFileオブジェクト
   * @returns {Promise<Object>} 画像情報
   */
  async loadJGWImage(imageUrl, jgwUrl) {
    try {
      console.log('JGW付き画像を読み込み中...');

      // JGWファイルを読み込む
      const jgwParams = await this.loadJGW(jgwUrl);
      console.log('JGWパラメータ:', jgwParams);

      // 画像を読み込む
      const textureLoader = new TextureLoader();
      let texture;
      
      if (imageUrl instanceof File) {
        const url = URL.createObjectURL(imageUrl);
        texture = await new Promise((resolve, reject) => {
          textureLoader.load(url, resolve, undefined, reject);
        });
        URL.revokeObjectURL(url);
      } else {
        texture = await new Promise((resolve, reject) => {
          textureLoader.load(imageUrl, resolve, undefined, reject);
        });
      }

      // 画像サイズを取得
      const imageWidth = texture.image.width;
      const imageHeight = texture.image.height;

      // 地理座標での実際のサイズを計算
      const geoWidth = Math.abs(jgwParams.pixelSizeX * imageWidth);
      const geoHeight = Math.abs(jgwParams.pixelSizeY * imageHeight);

      console.log(`画像サイズ: ${imageWidth} x ${imageHeight}`);
      console.log(`地理サイズ: ${geoWidth} x ${geoHeight}`);

      // 左上隅の座標（JGWの座標系）
      const topLeftX = jgwParams.topLeftX;
      const topLeftY = jgwParams.topLeftY;

      // 中心座標を計算
      const centerX = topLeftX + (geoWidth / 2);
      const centerY = topLeftY - (geoHeight / 2); // Yは通常負の方向

      // 3D座標に変換（座標オフセットを適用）
      // X軸 = 経度、Z軸 = -緯度（反転）
      // const worldX = centerX + this.coordinateOffset.x;
      // const worldZ = -centerY + this.coordinateOffset.z;

      // PlaneGeometryを作成（xz平面に配置）
      const geometry = new THREE.PlaneGeometry(geoWidth, geoHeight);
      
      // テクスチャを設定
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      // texture.flipY = false; // JGWは通常Y軸が反転しているため

      const material = new THREE.MeshBasicMaterial({
        map: texture,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 1.0
      });

      // メッシュを作成
      const mesh = new THREE.Mesh(geometry, material);
      
      // xz平面に配置（Y軸を回転）
      mesh.rotation.x = -Math.PI / 2;
      mesh.position.set(centerX, 0, centerY);
      mesh.receiveShadow = true;

      // 回転パラメータが0でない場合は適用
      if (Math.abs(jgwParams.rotationX) > 1e-6 || Math.abs(jgwParams.rotationY) > 1e-6) {
        // 回転を適用（ラジアンに変換）
        mesh.rotation.z = Math.atan2(jgwParams.rotationY, jgwParams.pixelSizeX);
        console.log(`回転を適用: rotationZ = ${mesh.rotation.z}`);
      }

      // メッシュを配列に追加（既存のメッシュは削除しない）
      this.imageMeshes.push(mesh);
      this.scene.add(mesh);

      console.log(`JGW画像を読み込みました: 位置(${centerX.toFixed(2)}, 0, ${centerY.toFixed(2)})`);

      return {
        type: 'jgw-image',
        mesh: mesh,
        jgwParams: jgwParams,
        worldPosition: { x: centerX, y: 0, z: centerY },
        geoSize: { width: geoWidth, height: geoHeight }
      };
    } catch (error) {
      console.error('JGW画像の読み込みエラー:', error);
      throw error;
    }
  }

  /**
   * 画像の表示/非表示を切り替え
   * @param {boolean} visible - 表示するかどうか
   */
  setVisible(visible) {
    this.imageMeshes.forEach(mesh => {
      if (mesh) {
        mesh.visible = visible;
      }
    });
  }

  /**
   * 画像を削除
   */
  dispose() {
    this.imageMeshes.forEach(mesh => {
      if (mesh) {
        this.scene.remove(mesh);
        if (mesh.geometry) mesh.geometry.dispose();
        if (mesh.material) {
          if (mesh.material.map) {
            mesh.material.map.dispose();
          }
          mesh.material.dispose();
        }
      }
    });
    this.imageMeshes = [];
  }
}

export default JGWImageLoader;

