import * as THREE from 'three';
import { Potree, PointCloudOctree } from 'potree-core';

/**
 * Potreeポイントクラウドビューアコンポーネント
 * Scene3D.jsに影響を与えない独立したコンポーネント
 * 
 * @param {THREE.Scene} scene - Three.jsシーン
 * @param {THREE.WebGLRenderer} renderer - Three.jsレンダラー
 * @param {THREE.Camera} camera - Three.jsカメラ
 * @param {Object} options - オプション設定
 * @returns {Object} ポイントクラウドビューアの制御オブジェクト
 */
class PotreePointCloudViewer {
  constructor(scene, renderer, camera, options = {}) {
    this.scene = scene;
    this.renderer = renderer;
    this.camera = camera;
    this.pointCloudRef = null;
    this.viewer = null;
    this.visible = options.visible !== false; // デフォルト: true
    this.pointBudget = options.pointBudget || 1_000_000; // デフォルト: 100万点
  }

  /**
   * Potree形式のポイントクラウドを読み込む
   * @param {string} metadataUrl - metadata.jsonのURL
   * @returns {Promise<Object>} ポイントクラウド情報
   */
  async loadPointCloud(metadataUrl) {
    try {
      console.log('Potreeポイントクラウドを読み込み中...', metadataUrl);

      // まずmetadata.jsonが正しく読み込めるか確認
      try {
        const response = await fetch(metadataUrl);
        if (!response.ok) {
          throw new Error(`metadata.jsonの読み込みに失敗しました: ${response.status} ${response.statusText}`);
        }
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
          const text = await response.text();
          if (text.trim().startsWith('<!DOCTYPE')) {
            throw new Error(`metadata.jsonが見つかりません。HTMLページが返されました。パスを確認してください: ${metadataUrl}`);
          }
          throw new Error(`metadata.jsonがJSON形式ではありません。Content-Type: ${contentType}`);
        }
        const metadata = await response.json();
        console.log('metadata.jsonの読み込み確認完了:', metadata);
      } catch (fetchError) {
        console.error('metadata.jsonの読み込み確認エラー:', fetchError);
        throw new Error(`metadata.jsonの読み込みに失敗しました: ${fetchError.message}`);
      }

      // Potreeインスタンスを作成
      if (!this.viewer) {
        this.viewer = new Potree();
        this.viewer.pointBudget = this.pointBudget;
      }

      // baseUrlを計算（metadata.jsonのディレクトリパス）
      const baseUrl = metadataUrl.substring(0, metadataUrl.lastIndexOf('/'));
      console.log('Potree loadPointCloud呼び出し:', { metadataUrl, baseUrl });

      // カスタムRequestManagerを作成して、正しいパスでファイルを読み込む
      const customRequestManager = {
        fetch: async (input, init) => {
          let url = typeof input === 'string' ? input : input.url;
          
          // 相対パスの場合はbaseUrlを結合
          if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
            url = `${baseUrl}/${url}`;
          } else if (url && !url.startsWith('http://') && !url.startsWith('https://') && url.startsWith('/')) {
            // 既に絶対パスの場合はそのまま使用
            // ただし、baseUrlが相対パスの場合は結合が必要
          }
          
          console.log('RequestManager fetch:', url);
          return fetch(url, init);
        },
        getUrl: async (url) => {
          // 相対パスの場合はbaseUrlを結合
          if (url && !url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
            return `${baseUrl}/${url}`;
          }
          return url;
        }
      };

      // PotreeのloadPointCloudにRequestManagerを渡す
      const pointcloud = await this.viewer.loadPointCloud(metadataUrl, customRequestManager);

      if (!pointcloud) {
        throw new Error('ポイントクラウドの読み込みに失敗しました');
      }

      // ポイントクラウドの位置情報をログに出力
      console.log('ポイントクラウドの位置情報:');
      console.log('  position:', pointcloud.position);
      console.log('  boundingBox:', pointcloud.boundingBox);

      // 一旦、シーンの中心（原点）に移動するために、boundingBoxの中心を計算
      if (pointcloud.boundingBox) {
        const center = new THREE.Vector3();
        pointcloud.boundingBox.getCenter(center);
        
        console.log('  boundingBox中心:', center);
        
        // X軸とZ軸のレンジを計算
        const min = pointcloud.boundingBox.min;
        const max = pointcloud.boundingBox.max;
        const xRange = {
          min: min.x,
          max: max.x,
          range: max.x - min.x
        };
        const zRange = {
          min: min.z,
          max: max.z,
          range: max.z - min.z
        };
        
        console.log('  X軸のレンジ:', xRange);
        console.log('  Z軸のレンジ:', zRange);
        
        // 中心を原点に移動するように、positionを負の値に設定
        pointcloud.position.set(-center.x, -center.y, -center.z);
        
        console.log('  設定後のposition:', pointcloud.position);
        console.log('  ポイントクラウドをシーンの中心に移動しました');
      }

      this.pointCloudRef = pointcloud;
      pointcloud.visible = this.visible;
      
      // シーンに追加
      this.scene.add(pointcloud);

      console.log('Potreeポイントクラウドの読み込み完了');

      const info = {
        type: 'pointcloud',
        pointcloud: pointcloud,
        boundingBox: pointcloud.boundingBox,
        numPoints: pointcloud.numPoints || 0
      };

      return info;
    } catch (error) {
      console.error('Potreeポイントクラウドの読み込みエラー:', error);
      // より詳細なエラー情報を表示
      if (error.message) {
        console.error('エラーメッセージ:', error.message);
      }
      if (error.stack) {
        console.error('エラースタック:', error.stack);
      }
      throw error;
    }
  }

  /**
   * ポイントクラウドの表示/非表示を設定
   * @param {boolean} visible
   */
  setVisible(visible) {
    this.visible = visible;
    if (this.pointCloudRef) {
      this.pointCloudRef.visible = visible;
    }
  }

  /**
   * ポイントクラウドの更新（レンダリングループで呼び出す）
   * @param {THREE.Camera} camera - カメラ
   */
  update(camera) {
    if (this.viewer && this.pointCloudRef && this.pointCloudRef.visible) {
      // PotreeのupdatePointCloudsを使用してLODを更新
      this.viewer.updatePointClouds([this.pointCloudRef], camera, this.renderer);
    }
  }

  /**
   * ポイントクラウドを削除
   */
  dispose() {
    if (this.pointCloudRef) {
      this.scene.remove(this.pointCloudRef);
      
      // ジオメトリとマテリアルを破棄
      if (this.pointCloudRef.geometry) {
        this.pointCloudRef.geometry.dispose();
      }
      if (this.pointCloudRef.material) {
        if (Array.isArray(this.pointCloudRef.material)) {
          this.pointCloudRef.material.forEach(m => m.dispose());
        } else {
          this.pointCloudRef.material.dispose();
        }
      }
      
      this.pointCloudRef = null;
    }
  }

  /**
   * ポイントクラウドの境界ボックスを取得
   * @returns {THREE.Box3|null}
   */
  getBoundingBox() {
    if (this.pointCloudRef && this.pointCloudRef.boundingBox) {
      return this.pointCloudRef.boundingBox;
    }
    return null;
  }
}

export default PotreePointCloudViewer;
