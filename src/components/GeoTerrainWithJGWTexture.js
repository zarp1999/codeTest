import * as THREE from 'three';
import { fromArrayBuffer } from 'geotiff';

const JGW_TEXTURE_CONFIG = Object.freeze({
  /** テクスチャ生成に使用するCanvasの最大ピクセル数（長辺） */
  maxCanvasSize: 4096,
  /** 小さな領域でも過剰に拡大しないようにするピクセル密度の上限 */
  maxPixelsPerUnit: 8,
  /** 数値誤差で0にならないようにする下限 */
  minPixelsPerUnit: 1e-3,
});

/**
 * GeoTIFF地形にJGW画像をテクスチャとして貼り付けるコンポーネント
 * GeoTerrainViewer.jsとJGWImageLoader.jsを参考に作成
 * 
 * @param {THREE.Scene} scene - Three.jsシーン
 * @param {Object} options - オプション設定
 * @param {number} options.heightScale - 標高のスケール係数（デフォルト: 1.0）
 * @param {boolean} options.autoFitCamera - カメラを自動調整するか（デフォルト: false）
 * @param {Object} options.coordinateOffset - 座標オフセット { x: number, z: number }
 * @param {boolean} options.applyVerticalExaggeration - 垂直強調を適用するか（デフォルト: true）
 * @returns {Object} 地形ビューアの制御オブジェクト
 */
class GeoTerrainWithJGWTexture {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.heightScale = options.heightScale || 1.0;
    this.autoFitCamera = options.autoFitCamera || false;
    this.terrainMeshRef = null;
    this.terrainVisible = true;
    // 座標変換オプション（常に適用）
    this.coordinateOffset = options.coordinateOffset || { x: -36708.8427, z: 8088.7211 };
    this.applyVerticalExaggeration = options.applyVerticalExaggeration !== false; // デフォルト: true
    this.worldBbox3D = null; // 3D世界座標bbox（JGWテクスチャ生成時に使用）
  }

  /**
   * GeoTIFFファイルとJGW画像を読み込んで3D地形を表示
   * @param {File|ArrayBuffer|string} geoTiffSource - GeoTIFFファイル（File、ArrayBuffer、またはURL）
   * @param {Array<Object>} jgwImageList - JGW画像のリスト [{ imageUrl: string, jgwUrl: string }, ...]
   * @returns {Promise<Object>} 地形情報
   */
  async loadGeoTIFFWithJGWTexture(geoTiffSource, jgwImageList = []) {
    try {
      console.log('GeoTIFFファイルとJGW画像を読み込み中...');

      // GeoTIFFファイルを読み込む
      const terrainInfo = await this.loadGeoTIFF(geoTiffSource);
      
      // JGW画像を読み込んでテクスチャとして適用
      if (jgwImageList && jgwImageList.length > 0) {
        const texture = await this.createJGWTexture(
          terrainInfo.bbox,
          terrainInfo.geometry,
          jgwImageList
        );
        if (texture) {
          console.log('JGWテクスチャが正常に作成されました');
          // テクスチャを地形メッシュに適用
          this.applyTextureToTerrain(texture);
        } else {
          console.warn('JGWテクスチャの作成に失敗しました（地形はテクスチャなしで表示されます）');
        }
      } else {
        console.warn('JGW画像リストが空です。テクスチャなしで地形を表示します。');
      }

      return terrainInfo;
    } catch (error) {
      console.error('GeoTIFFファイルとJGW画像の読み込みエラー:', error);
      throw new Error('GeoTIFFファイルとJGW画像の読み込みに失敗しました: ' + error.message);
    }
  }

  /**
   * GeoTIFFファイルを読み込んで3D地形を生成
   * @param {File|ArrayBuffer|string} source - GeoTIFFファイル（File、ArrayBuffer、またはURL）
   * @returns {Promise<Object>} 地形情報（geometryとbboxを含む）
   */
  async loadGeoTIFF(source) {
    try {
      console.log('GeoTIFFファイルを読み込み中...');

      let arrayBuffer;
      if (source instanceof File) {
        arrayBuffer = await source.arrayBuffer();
      } else if (source instanceof ArrayBuffer) {
        arrayBuffer = source;
      } else if (typeof source === 'string') {
        // URLの場合
        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`GeoTIFFファイルの読み込みに失敗しました: ${response.status}`);
        }
        arrayBuffer = await response.arrayBuffer();
      } else {
        throw new Error('サポートされていないソース形式です');
      }

      const tiff = await fromArrayBuffer(arrayBuffer);
      const image = await tiff.getImage();
      
      // 画像のサイズを取得
      const width = image.getWidth();
      const height = image.getHeight();
      
      console.log(`GeoTIFF画像サイズ: ${width} x ${height}`);
      
      // 標高データを読み込み
      const elevationData = await image.readRasters();
      const elevationArray = elevationData[0]; // 最初のバンド（標高データ）
      
      // 地理情報を取得
      const bbox = image.getBoundingBox();
      
      console.log('GeoTIFF境界:', bbox);
      
      // 標高データの統計を計算
      let minElevation = null;
      let maxElevation = null;
      
      for (let i = 0; i < elevationArray.length; i++) {
        const elevation = elevationArray[i];
        if (elevation !== null && elevation !== undefined && !isNaN(elevation) && isFinite(elevation)) {
          if (minElevation === null) {
            minElevation = elevation;
            maxElevation = elevation;
          } else {
            if (elevation < minElevation) minElevation = elevation;
            if (elevation > maxElevation) maxElevation = elevation;
          }
        }
      }
      
      if (minElevation === null || maxElevation === null) {
        minElevation = 0;
        maxElevation = 100;
        console.warn('有効な標高データが見つかりません。デフォルト値を使用します。');
      }
      
      console.log(`標高範囲: ${minElevation.toFixed(2)}m - ${maxElevation.toFixed(2)}m`);
      
      // 大きなファイルの場合は解像度を下げる
      let step = 1;
      if (width * height > 1000000) {
        step = Math.ceil(Math.sqrt((width * height) / 1000000));
        console.log(`大きなファイルのため解像度を下げます (step: ${step})`);
      }
      
      // 3D地形メッシュを生成
      const geometry = this.createTerrainMesh(elevationArray, width, height, bbox, step, minElevation, maxElevation);
      
      // 地形を表示（テクスチャなしで初期表示）
      const info = this.createTerrainSurface(geometry, minElevation, maxElevation, null);
      
      // geometryとbboxを返す（後でテクスチャを適用するため）
      return {
        ...info,
        geometry: geometry,
        bbox: bbox
      };
    } catch (error) {
      console.error('GeoTIFFファイル読み込みエラー:', error);
      throw new Error('GeoTIFFファイルの読み込みに失敗しました: ' + error.message);
    }
  }

  /**
   * 標高データから3D地形メッシュを生成
   * @param {Array} elevationData - 標高データ配列
   * @param {number} width - 画像幅
   * @param {number} height - 画像高さ
   * @param {Array} bbox - 地理的境界 [minX, minY, maxX, maxY]
   * @param {number} step - サンプリングステップ
   * @param {number} minElevation - 最小標高
   * @param {number} maxElevation - 最大標高
   * @returns {THREE.BufferGeometry} 地形メッシュのジオメトリ
   */
  createTerrainMesh(elevationData, width, height, bbox, step, minElevation, maxElevation) {
    const minX = bbox[0];
    const minY = bbox[1];
    const maxX = bbox[2];
    const maxY = bbox[3];
    
    const elevationRange = maxElevation - minElevation;
    
    // サンプリング後のサイズを計算
    const newWidth = Math.ceil(width / step);
    const newHeight = Math.ceil(height / step);
    
    // 地理座標でのサイズを計算
    const geoWidth = (maxX - minX);
    const geoHeight = (maxY - minY);
    
    // PlaneGeometryを作成（XZ平面に配置、Y軸が高さ）
    const geometry = new THREE.PlaneGeometry(
      geoWidth, 
      geoHeight, 
      newWidth - 1, 
      newHeight - 1
    );
    
    // 頂点座標を更新
    const vertices = geometry.attributes.position.array;
    const uvs = []; // UV座標を追加
    
    let vertexIndex = 0;
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        const dataIndex = Math.floor(y * step) * width + Math.floor(x * step);
        const elevation = elevationData[dataIndex];
        
        // 無効な標高値の場合は最小値を使用
        const validElevation = (elevation !== null && elevation !== undefined && !isNaN(elevation) && isFinite(elevation)) 
          ? elevation 
          : minElevation;
        
        // 3D座標を計算
        let worldY; // Y座標が高さ
        
        if (this.applyVerticalExaggeration) {
          // 標高差が小さい場合はピクセル座標を使用
          if (elevationRange < 1000) {
            worldY = validElevation;
          } else {
            // 地理座標モード（垂直強調を適用）
            worldY = validElevation * this.getVerticalExaggeration(elevationRange);
          }
        } else {
          worldY = validElevation * this.heightScale;
        }
        
        // PlaneGeometryの座標を地理座標に変換
        const planeX = vertices[vertexIndex];     // PlaneGeometryのX座標
        const planeZ = vertices[vertexIndex + 1]; // PlaneGeometryのZ座標
        
        // 地理座標に変換（0.0 ～ 1.0 の正規化座標に変換してから地理座標にマッピング）
        const normalizedX = (planeX + geoWidth / 2) / geoWidth;   // 0.0 ～ 1.0
        const normalizedZ = (planeZ + geoHeight / 2) / geoHeight; // 0.0 ～ 1.0
        
        const geoX = minX + normalizedX * geoWidth;   // 地理座標X（minX ～ maxX）
        const geoY = minY + normalizedZ * geoHeight;  // 地理座標Y（minY ～ maxY）
        
        // 座標変換を適用
        vertices[vertexIndex] = -geoY;            // X軸 = -geoY
        vertices[vertexIndex + 2] = worldY;       // Y軸（高さ）= 標高
        vertices[vertexIndex + 1] = geoX;         // Z軸 = geoX
        
        // 座標オフセットを適用
        vertices[vertexIndex] += this.coordinateOffset.x;     // X座標にオフセットを適用
        vertices[vertexIndex + 1] += this.coordinateOffset.z; // Z座標にオフセットを適用

        vertices[vertexIndex] *= -1;
        vertices[vertexIndex + 1] *= -1;
        
        // UV座標を計算（地理座標を正規化）
        const u = normalizedX;
        const v = 1.0 - normalizedZ; // Y軸を反転（Three.jsのUV座標系に合わせる）
        uvs.push(u, v);
        
        vertexIndex += 3;
      }
    }
    
    // UV座標を設定
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    console.log(`UV座標を設定: ${uvs.length / 2}個の頂点`);
    
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(+Math.PI / 2);
    
    // 法線を再計算
    geometry.attributes.position.needsUpdate = true;
    geometry.computeVertexNormals();
    
    // 座標変換を適用した場合、底面が原点0になるようにジオメトリを下げる
    const minValue = minElevation;
    geometry.translate(0, -minValue, 0);
    
    // 境界を計算
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    
    // === 3D座標ベースのbboxを事前計算（座標変換適用後・回転前）===
    // 変換式:
    //   X3D = -(-geoY + offset.x) = geoY - offset.x
    //   Z3D = -(geoX + offset.z) = -geoX - offset.z
    const minX3d = minY - this.coordinateOffset.x; // geoYの最小値 → X3Dの最小値
    const maxX3d = maxY - this.coordinateOffset.x; // geoYの最大値 → X3Dの最大値
    const minZ3d = -maxX - this.coordinateOffset.z; // geoXの最大値 → Z3Dの最小値（符号反転）
    const maxZ3d = -minX - this.coordinateOffset.z; // geoXの最小値 → Z3Dの最大値（符号反転）

    const worldWidthX = maxX3d - minX3d;   // X方向の3D幅（緯度方向）
    const worldWidthZ = maxZ3d - minZ3d;   // Z方向の3D幅（経度方向）
    
    // 3D座標ベースの世界座標bboxを保存（JGWテクスチャ生成時に使用）
    this.worldBbox3D = {
      minX: minX3d,
      maxX: maxX3d,
      minZ: minZ3d,
      maxZ: maxZ3d,
    };
    console.log('3D世界座標bbox (from GeoTIFF):', this.worldBbox3D);
    
    // === UV座標を再計算（3D座標ベース） ===
    // オフセット適用後の3D座標ベースでUV座標を計算する
    // これにより、Canvasと地形メッシュの座標系が一致する
    const newUvs = [];
    vertexIndex = 0;
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        // 地理座標を取得
        const normalizedX = (x / (newWidth - 1));   // 0.0 ～ 1.0
        const normalizedZ = (y / (newHeight - 1)); // 0.0 ～ 1.0
        
        const geoX = minX + normalizedX * geoWidth;   // 地理座標X
        const geoY = minY + normalizedZ * geoHeight;  // 地理座標Y

        // 地理座標を3D座標に変換（地形メッシュと同じ変換式、オフセット適用）
        // 変換式:
        //   X3D = -(-geoY + offset.x) = geoY - offset.x
        //   Z3D = -(geoX + offset.z) = -geoX - offset.z
        const x3d = geoY - this.coordinateOffset.x;
        const z3d = -geoX - this.coordinateOffset.z;

        // UV座標を計算（3D座標を正規化）
        // U: Z軸方向（経度方向 0.0 ～ 1.0）、V: X軸方向（緯度方向 1.0 ～ 0.0）
        const u = (z3d - minZ3d) / worldWidthZ;
        const v = 1.0 - (x3d - minX3d) / worldWidthX; // Y軸を反転（Three.jsのUV座標系に合わせる）
        newUvs.push(u, v);

        vertexIndex += 3;
      }
    }
    
    // UV座標を更新
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(newUvs, 2));
    
    console.log(`地形メッシュ生成完了: ${vertices.length / 3} 頂点`);
    console.log(`座標変換を適用: Xオフセット=${this.coordinateOffset.x}, Zオフセット=${this.coordinateOffset.z}`);
    
    return geometry;
  }

  /**
   * 垂直強調係数を取得
   * @param {number} elevationRange - 標高範囲
   * @returns {number} 垂直強調係数
   */
  getVerticalExaggeration(elevationRange) {
    // 標高範囲に基づいて適切な垂直強調係数を計算
    if (elevationRange < 10) {
      return 10; // 平坦な地形は10倍強調
    } else if (elevationRange < 100) {
      return 5;  // 丘陵地は5倍強調
    } else if (elevationRange < 500) {
      return 2;  // 山地は2倍強調
    } else {
      return 1;  // 高山地は強調なし
    }
  }

  /**
   * 3D地形表面を作成して表示
   * @param {THREE.BufferGeometry} geometry - 地形メッシュのジオメトリ
   * @param {number} minElevation - 最小標高
   * @param {number} maxElevation - 最大標高
   * @param {THREE.Texture} texture - テクスチャ（オプション）
   * @returns {Object} 地形情報
   */
  createTerrainSurface(geometry, minElevation, maxElevation, texture = null) {
    // 既存の地形を削除
    if (this.terrainMeshRef) {
      this.scene.remove(this.terrainMeshRef);
      if (this.terrainMeshRef.geometry) this.terrainMeshRef.geometry.dispose();
      if (this.terrainMeshRef.material) {
        if (this.terrainMeshRef.material.map) {
          this.terrainMeshRef.material.map.dispose();
        }
        this.terrainMeshRef.material.dispose();
      }
    }

    // マテリアルを作成（テクスチャ対応）
    const materialOptions = {
      side: THREE.DoubleSide,
      shininess: 10,
      specular: 0x000000,
      emissive: 0x000000,
      transparent: false,
      opacity: 1.0
    };
    
    // テクスチャが存在する場合は適用
    if (texture) {
      materialOptions.map = texture;
      console.log('テクスチャをマテリアルに適用しました');
      console.log(`テクスチャ情報: width=${texture.image?.width || 'N/A'}, height=${texture.image?.height || 'N/A'}`);
    } else {
      // テクスチャがない場合はデフォルトの色を設定
      materialOptions.color = 0x888888;
      console.warn('テクスチャがないため、デフォルトの色を使用します');
    }
    
    const material = new THREE.MeshPhongMaterial(materialOptions);

    // 地形メッシュを作成
    const terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.visible = this.terrainVisible;
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    
    this.terrainMeshRef = terrainMesh;
    this.scene.add(terrainMesh);

    const info = {
      type: 'terrain',
      count: geometry.attributes.position.count,
      bounds: geometry.boundingBox,
      center: geometry.boundingSphere.center,
      radius: geometry.boundingSphere.radius,
      elevationRange: { min: minElevation, max: maxElevation }
    };

    console.log(`地形表示完了: 中心(${info.center.x.toFixed(2)}, ${info.center.y.toFixed(2)}, ${info.center.z.toFixed(2)})`);

    return info;
  }

  /**
   * テクスチャを地形メッシュに適用
   * @param {THREE.Texture} texture - 適用するテクスチャ
   */
  applyTextureToTerrain(texture) {
    if (this.terrainMeshRef && this.terrainMeshRef.material) {
      // 既存のテクスチャを破棄
      if (this.terrainMeshRef.material.map) {
        this.terrainMeshRef.material.map.dispose();
      }
      
      // 新しいテクスチャを適用
      this.terrainMeshRef.material.map = texture;
      this.terrainMeshRef.material.needsUpdate = true;
      console.log('テクスチャを地形メッシュに適用しました');
    }
  }

  /**
   * JGW画像を読み込んでCanvasに合成し、テクスチャとして返す
   * @param {Array} bbox - GeoTIFFの地理的境界 [minX, minY, maxX, maxY]
   * @param {THREE.BufferGeometry} geometry - 地形メッシュのジオメトリ（サイズ比較用）
   * @param {Array<Object>} jgwImageList - JGW画像のリスト [{ imageUrl: string, jgwUrl: string }, ...]
   * @returns {Promise<THREE.Texture>} 合成されたテクスチャ
   */
  async createJGWTexture(bbox, geometry = null, jgwImageList = []) {
    const [minX, minY, maxX, maxY] = bbox;
    
    console.log('GeoTIFF範囲:', { minX, minY, maxX, maxY });

    // === 3D座標ベースでCanvasを構築する ===
    // 地形メッシュ生成時に保存した3D世界座標bboxを使用
    // UV座標が3D座標ベースで計算されているため、Canvasも3D座標ベースで作成する必要がある
    const worldBbox = this.worldBbox3D;
    if (!worldBbox) {
      console.warn('worldBbox3D が未定義のため、GeoTIFFのbboxを使用してCanvasを作成します');
    }

    const minX3d = worldBbox ? worldBbox.minX : bbox[0];
    const maxX3d = worldBbox ? worldBbox.maxX : bbox[3]; // 緯度方向（Y）
    const minZ3d = worldBbox ? worldBbox.minZ : bbox[1];
    const maxZ3d = worldBbox ? worldBbox.maxZ : bbox[2];

    const worldWidthX = maxX3d - minX3d; // X方向（緯度方向）の3D幅
    const worldWidthZ = maxZ3d - minZ3d; // Z方向（経度方向）の3D幅

    // Canvasは Z方向を横（U軸）、X方向を縦（V軸）として使用する
    const worldWidth = worldWidthZ;  // 横幅（U方向）
    const worldHeight = worldWidthX; // 高さ（V方向）

    // Canvasサイズを決定（3D世界座標範囲に比例）
    const longestSide = Math.max(worldWidth, worldHeight, 1);
    const baseScale = JGW_TEXTURE_CONFIG.maxCanvasSize / longestSide;
    const pixelPerUnit = THREE.MathUtils.clamp(
      baseScale,
      JGW_TEXTURE_CONFIG.minPixelsPerUnit,
      JGW_TEXTURE_CONFIG.maxPixelsPerUnit
    );

    const canvasWidth = Math.max(1, Math.round(worldWidth * pixelPerUnit));   // Z方向
    const canvasHeight = Math.max(1, Math.round(worldHeight * pixelPerUnit)); // X方向
    
    // Canvasを作成
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    // 背景を白で塗りつぶし
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 3D座標 (X3D, Z3D) からCanvas座標への変換スケール
    // 横方向: Z3D (経度方向) → Canvas X
    // 縦方向: X3D (緯度方向) → Canvas Y
    const scaleX = canvasWidth / worldWidth;   // Z方向のスケール
    const scaleY = canvasHeight / worldHeight; // X方向のスケール

    // すべてのJGW画像を読み込む
    const textureLoader = new THREE.TextureLoader();
    const loadedImages = [];

    for (const jgwImage of jgwImageList) {
      try {
        const { imageUrl, jgwUrl } = jgwImage;

        // JGWファイルを読み込む
        const response = await fetch(jgwUrl);
        if (!response.ok) {
          console.warn(`JGWファイルが見つかりません: ${jgwUrl}`);
          continue;
        }
        const jgwText = await response.text();
        
        if (!jgwText || typeof jgwText !== 'string') {
          continue;
        }
        
        const lines = jgwText.trim().split(/\s+/);
        if (lines.length < 6) {
          console.warn(`JGWファイルの形式が正しくありません: ${jgwUrl}`);
          continue;
        }

        const jgwParams = {
          pixelSizeX: parseFloat(lines[0]),
          pixelSizeY: parseFloat(lines[3]),
          topLeftX: parseFloat(lines[4]),
          topLeftY: parseFloat(lines[5])
        };

        // 画像を読み込む
        const texture = await new Promise((resolve, reject) => {
          textureLoader.load(imageUrl, resolve, undefined, reject);
        });

        loadedImages.push({
          texture: texture,
          jgwParams: jgwParams,
          imageUrl: imageUrl
        });

        console.log(`JGW画像を読み込み: ${imageUrl}`, {
          topLeftX: jgwParams.topLeftX,
          topLeftY: jgwParams.topLeftY,
          pixelSizeX: jgwParams.pixelSizeX,
          pixelSizeY: jgwParams.pixelSizeY
        });
      } catch (error) {
        console.error(`JGW画像の読み込みエラー (${jgwImage.imageUrl}):`, error);
      }
    }

    if (loadedImages.length === 0) {
      console.warn('JGW画像が見つかりませんでした');
      return null;
    }
    
    console.log(`${loadedImages.length}個のJGW画像を読み込みました`);

    // 各JGW画像をCanvasに描画
    for (const jgwImage of loadedImages) {
      const { texture, jgwParams } = jgwImage;
      const img = texture.image;

      if (!img || !img.width || !img.height) {
        texture.dispose();
        continue;
      }

      const { pixelSizeX, pixelSizeY, topLeftX, topLeftY } = jgwParams;

      // JGW画像の地理座標でのサイズ
      const geoImgWidth = Math.abs(pixelSizeX * img.width);
      const geoImgHeight = Math.abs(pixelSizeY * img.height);

      // === JGW画像の左上座標を3D世界座標に変換（オフセットなし） ===
      // JGW画像の座標は正しいので、オフセットは適用しない
      // 変換式（オフセットなし）:
      //   X3D = geoY（オフセットなし）
      //   Z3D = -geoX（符号反転のみ）
      const x3dTopLeft = topLeftY; // オフセットなし
      const z3dTopLeft = -topLeftX; // 符号反転のみ

      // 3D空間での画像サイズ
      // 幅（Z方向）: geoX方向の長さ → Z3Dでは符号反転のみなので、絶対値は同じ
      const imgWidth3d = Math.abs(geoImgWidth);
      // 高さ（X方向）: geoY方向の長さ → X3Dではオフセットなしなので、絶対値は同じ
      const imgHeight3d = Math.abs(geoImgHeight);

      // 3D座標からCanvas座標への変換
      // 横方向: Z3D (経度方向) → Canvas X
      // 縦方向: X3D (緯度方向) → Canvas Y（上が小さいX3Dになるように反転）
      const canvasX = (z3dTopLeft - minZ3d) * scaleX;
      const canvasY = (maxX3d - x3dTopLeft) * scaleY; // Y軸はX3D方向を反転

      // Canvas座標での画像サイズ
      const canvasImgWidth = imgWidth3d * scaleX;
      const canvasImgHeight = imgHeight3d * scaleY;

      // 座標変換のログ出力
      console.log(`JGW画像 ${jgwImage.imageUrl} の座標変換:`, {
        original: { topLeftX: topLeftX.toFixed(2), topLeftY: topLeftY.toFixed(2) },
        x3d: { x3dTopLeft: x3dTopLeft.toFixed(2), z3dTopLeft: z3dTopLeft.toFixed(2) },
        canvas: { canvasX: canvasX.toFixed(2), canvasY: canvasY.toFixed(2) },
        canvasSize: { canvasWidth, canvasHeight },
        worldBbox: { minX: minX3d.toFixed(2), minZ: minZ3d.toFixed(2), maxX: maxX3d.toFixed(2), maxZ: maxZ3d.toFixed(2) }
      });

      // Canvas範囲内かチェック
      if (canvasX + canvasImgWidth < 0 || canvasX > canvasWidth ||
          canvasY + canvasImgHeight < 0 || canvasY > canvasHeight) {
        console.warn(`JGW画像 ${jgwImage.imageUrl} はCanvas範囲外です`, {
          canvasX: canvasX.toFixed(2),
          canvasY: canvasY.toFixed(2),
          canvasImgWidth: canvasImgWidth.toFixed(2),
          canvasImgHeight: canvasImgHeight.toFixed(2),
          canvasSize: { canvasWidth, canvasHeight }
        });
        texture.dispose();
        continue;
      }

      // 画像をCanvasに描画
      try {
        ctx.drawImage(img, canvasX, canvasY, canvasImgWidth, canvasImgHeight);
        console.log(`JGW画像を描画: ${jgwImage.imageUrl}`, {
          canvasPos: { x: canvasX.toFixed(2), y: canvasY.toFixed(2) },
          canvasSize: { w: canvasImgWidth.toFixed(2), h: canvasImgHeight.toFixed(2) }
        });
      } catch (error) {
        console.error(`描画エラー (${jgwImage.imageUrl}):`, error);
      } finally {
        texture.dispose();
      }
    }

    // Canvasからテクスチャを作成
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = false;
    texture.needsUpdate = true;

    console.log(`テクスチャ作成完了: ${canvasWidth} x ${canvasHeight}`);

    return texture;
  }

  /**
   * 地形の表示/非表示を切り替え
   * @param {boolean} visible - 表示状態
   */
  setVisible(visible) {
    this.terrainVisible = visible;
    if (this.terrainMeshRef) {
      this.terrainMeshRef.visible = visible;
    }
  }

  /**
   * 地形の表示状態を取得
   * @returns {boolean} 表示状態
   */
  getVisible() {
    return this.terrainVisible;
  }

  /**
   * クリーンアップ
   */
  dispose() {
    if (this.terrainMeshRef) {
      this.scene.remove(this.terrainMeshRef);
      if (this.terrainMeshRef.geometry) this.terrainMeshRef.geometry.dispose();
      if (this.terrainMeshRef.material) {
        if (this.terrainMeshRef.material.map) {
          this.terrainMeshRef.material.map.dispose();
        }
        this.terrainMeshRef.material.dispose();
      }
      this.terrainMeshRef = null;
    }
  }
}

export default GeoTerrainWithJGWTexture;

