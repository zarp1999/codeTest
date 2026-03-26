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
 * GeoTIFF地形ビューアコンポーネント
 * Scene3D.jsに影響を与えない独立したコンポーネント
 * 
 * @param {THREE.Scene} scene - Three.jsシーン
 * @param {Object} options - オプション設定
 * @param {number} options.heightScale - 標高のスケール係数（デフォルト: 1.0）
 * @param {boolean} options.autoFitCamera - カメラを自動調整するか（デフォルト: false）
 * @returns {Object} 地形ビューアの制御オブジェクト
 */
class GeoTerrainViewer {
  constructor(scene, options = {}) {
    this.scene = scene;
    this.heightScale = options.heightScale || 1.0;
    this.autoFitCamera = options.autoFitCamera || false;
    this.terrainMeshRef = null;
    this.terrainVisible = true;
    this.terrainOpacity = Number.isFinite(options.opacity) ? options.opacity : 1.0;
    // 座標変換オプション（常に適用）
    this.coordinateOffset = options.coordinateOffset || { x: -36708.8427, z: 8088.7211 };
    this.applyVerticalExaggeration = options.applyVerticalExaggeration !== false; // デフォルト: true
    this.worldBbox3D = null; // 3D世界座標bbox（JGWテクスチャ生成時に使用）
  }

  /**
   * GeoTIFFファイルを読み込んで3D地形を表示
   * @param {File|ArrayBuffer|string} source - GeoTIFFファイル（File、ArrayBuffer、またはURL）
   * @returns {Promise<Object>} 地形情報
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
      
      // JGW画像を読み込んでテクスチャとして適用（geometryを渡してサイズ比較に使用）
      const texture = await this.createJGWTexture(bbox, geometry);
      if (texture) {
        console.log('JGWテクスチャが正常に作成されました');
      } else {
        console.warn('JGWテクスチャの作成に失敗しました（地形はテクスチャなしで表示されます）');
      }
      
      // 地形を表示
      const info = this.createTerrainSurface(geometry, minElevation, maxElevation, texture);
      
      return info;
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
        // PlaneGeometryは中心が原点なので、-geoWidth/2 ～ +geoWidth/2 の範囲
        // これを地理座標 minX ～ maxX に変換
        // 注意: rotateX(-Math.PI / 2)後の座標系では
        // vertices[vertexIndex] = X軸、vertices[vertexIndex + 2] = Y軸（高さ）、vertices[vertexIndex + 1] = Z軸
        const planeX = vertices[vertexIndex];     // PlaneGeometryのX座標（-geoWidth/2 ～ +geoWidth/2）
        const planeZ = vertices[vertexIndex + 1]; // PlaneGeometryのZ座標（-geoHeight/2 ～ +geoHeight/2）
        
        // 地理座標に変換（0.0 ～ 1.0 の正規化座標に変換してから地理座標にマッピング）
        const normalizedX = (planeX + geoWidth / 2) / geoWidth;   // 0.0 ～ 1.0
        const normalizedZ = (planeZ + geoHeight / 2) / geoHeight; // 0.0 ～ 1.0
        
        const geoX = minX + normalizedX * geoWidth;   // 地理座標X（minX ～ maxX）
        const geoY = minY + normalizedZ * geoHeight;  // 地理座標Y（minY ～ maxY）
        
        // 座標変換を適用（PointCloudViewer.jsと同じ処理）
        // rotateX(-Math.PI / 2)後の座標系: X軸、Y軸（高さ）、Z軸
        // 座標変換: 経度をX軸に、緯度をZ軸（反転）に
        // 変換後: 新しいX = geoX（経度）, 新しいY = worldY（標高）, 新しいZ = -geoY（緯度、反転）
        vertices[vertexIndex] = -geoY;            // X軸 = geoX（経度）
        vertices[vertexIndex + 2] = worldY;     // Y軸（高さ）= 標高
        vertices[vertexIndex + 1] = geoX;      // Z軸 = geoY（緯度）
        
        // 座標オフセットを適用
        vertices[vertexIndex] += this.coordinateOffset.x;     // X座標にオフセットを適用
        vertices[vertexIndex + 1] += this.coordinateOffset.z;  // Z座標にオフセットを適用

        vertices[vertexIndex] *= -1;
        vertices[vertexIndex + 1] *= -1;
        
        // UV座標を計算（地理座標を正規化）
        // U: 経度方向（0.0 ～ 1.0）、V: 緯度方向（1.0 ～ 0.0、Y軸を反転）
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
    
    // === UV座標を再計算（地理座標ベース） ===
    // JGWImageLoaderと同じように地理座標をそのまま使用するため、
    // UV座標も地理座標ベースで計算する
    // geoWidthとgeoHeightは既に定義されているため、それを使用
    const newUvs = [];
    vertexIndex = 0;
    for (let y = 0; y < newHeight; y++) {
      for (let x = 0; x < newWidth; x++) {
        // 地理座標を取得（元の計算から）
        const normalizedX = (x / (newWidth - 1));   // 0.0 ～ 1.0
        const normalizedZ = (y / (newHeight - 1)); // 0.0 ～ 1.0
        
        const geoX = minX + normalizedX * geoWidth;   // 地理座標X
        const geoY = minY + normalizedZ * geoHeight;  // 地理座標Y

        // UV座標を計算（地理座標を正規化）
        // U: 経度方向（0.0 ～ 1.0）、V: 緯度方向（1.0 ～ 0.0、Y軸を反転）
        const u = (geoX - minX) / geoWidth;
        const v = 1.0 - (geoY - minY) / geoHeight; // Y軸を反転（Three.jsのUV座標系に合わせる）
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
   * 標高に基づく地形色を取得
   * @param {number} normalizedElevation - 正規化された標高 (0-1)
   * @returns {Object} RGB色オブジェクト
   */
  getTerrainColor(normalizedElevation) {
    if (normalizedElevation < 0.1) {
      // 海・湖（青）
      return { r: 0.1, g: 0.3, b: 1.0 };
    } else if (normalizedElevation < 0.3) {
      // 平地・草原（緑）
      return { r: 0.2, g: 0.8, b: 0.2 };
    } else if (normalizedElevation < 0.6) {
      // 丘陵（黄緑）
      return { r: 0.7, g: 1.0, b: 0.3 };
    } else if (normalizedElevation < 0.8) {
      // 山地（茶色）
      return { r: 0.8, g: 0.5, b: 0.2 };
    } else {
      // 高山（白）
      return { r: 1.0, g: 1.0, b: 1.0 };
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
    const opacity = Number.isFinite(this.terrainOpacity) ? Math.min(1, Math.max(0, this.terrainOpacity)) : 1.0;
    const materialOptions = {
      side: THREE.DoubleSide,
      shininess: 10,
      specular: 0x000000,
      emissive: 0x000000,
      transparent: opacity < 1,
      opacity: opacity,
      depthWrite: opacity >= 1
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
    
    // マテリアルの状態を確認
    if (material.map) {
      console.log('マテリアルにテクスチャが設定されています');
    } else {
      console.warn('マテリアルにテクスチャが設定されていません');
    }

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
   * 地形の透明度を設定（0〜1）
   * @param {number} opacity
   */
  setOpacity(opacity) {
    const next = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1.0;
    this.terrainOpacity = next;

    if (this.terrainMeshRef && this.terrainMeshRef.material) {
      const mat = this.terrainMeshRef.material;
      mat.transparent = next < 1;
      mat.opacity = next;
      // 透明時はdepthWriteを切る方が破綻しにくい
      mat.depthWrite = next >= 1;
      mat.needsUpdate = true;
    }
  }

  /**
   * JGW画像を読み込んでCanvasに合成し、テクスチャとして返す
   * @param {Array} bbox - GeoTIFFの地理的境界 [minX, minY, maxX, maxY]
   * @param {THREE.BufferGeometry} geometry - 地形メッシュのジオメトリ（サイズ比較用）
   * @returns {Promise<THREE.Texture>} 合成されたテクスチャ
   */
  async createJGWTexture(bbox, geometry = null) {
    const [minX, minY, maxX, maxY] = bbox;
    const geoWidth = maxX - minX;
    const geoHeight = maxY - minY;

    console.log('GeoTIFF範囲:', { minX, minY, maxX, maxY, geoWidth, geoHeight });

    // === 地理座標ベースでCanvasを構築する ===
    // JGWImageLoaderと同じように地理座標をそのまま使用するため、
    // Canvasも地理座標ベースで作成する

    // すべてのJGW画像を読み込む
    const jgwImages = [];
    const textureLoader = new THREE.TextureLoader();

    for (let i = 1; i <= 6; i++) {
      try {
        const imageUrl = `/${i}.jpg`;
        const jgwUrl = `/${i}.jgw`;

        // JGWファイルを読み込む
        const response = await fetch(jgwUrl);
        if (!response.ok) {
          continue; // ファイルが見つからない場合はスキップ
        }
        const jgwText = await response.text();
        
        if (!jgwText || typeof jgwText !== 'string') {
          continue;
        }
        
        const lines = jgwText.trim().split(/\s+/);
        if (lines.length < 6) {
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

        jgwImages.push({
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
        // エラーは無視して続行
      }
    }

    if (jgwImages.length === 0) {
      console.warn('JGW画像が見つかりませんでした');
      return null;
    }
    
    console.log(`${jgwImages.length}個のJGW画像を読み込みました`);

    // Canvasサイズを決定（地理座標範囲に比例）
    const longestSide = Math.max(geoWidth, geoHeight, 1);
    const baseScale = JGW_TEXTURE_CONFIG.maxCanvasSize / longestSide;
    const pixelPerUnit = THREE.MathUtils.clamp(
      baseScale,
      JGW_TEXTURE_CONFIG.minPixelsPerUnit,
      JGW_TEXTURE_CONFIG.maxPixelsPerUnit
    );

    const canvasWidth = Math.max(1, Math.round(geoWidth * pixelPerUnit));
    const canvasHeight = Math.max(1, Math.round(geoHeight * pixelPerUnit));
    
    // Canvasを作成
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    // 背景を白で塗りつぶし
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 地理座標からCanvas座標への変換スケール
    const scaleX = canvasWidth / geoWidth;
    const scaleY = canvasHeight / geoHeight;

    // 各JGW画像をCanvasに描画
    for (const jgwImage of jgwImages) {
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

      // === JGW画像の座標を地理座標のまま使用 ===
      // JGWImageLoaderと同じように地理座標をそのまま使用
      // 左上座標: (topLeftX, topLeftY) → Canvas座標
      const canvasX = (topLeftX - minX) * scaleX;
      const canvasY = (maxY - topLeftY) * scaleY; // Y軸は反転（Canvas座標系に合わせる）

      // Canvas座標での画像サイズ
      const canvasImgWidth = geoImgWidth * scaleX;
      const canvasImgHeight = geoImgHeight * scaleY;

      // 座標変換のログ出力
      console.log(`JGW画像 ${jgwImage.imageUrl} の座標変換:`, {
        original: { topLeftX: topLeftX.toFixed(2), topLeftY: topLeftY.toFixed(2) },
        canvas: { canvasX: canvasX.toFixed(2), canvasY: canvasY.toFixed(2) },
        canvasSize: { canvasWidth, canvasHeight },
        geoTiffBbox: { minX: minX.toFixed(2), minY: minY.toFixed(2), maxX: maxX.toFixed(2), maxY: maxY.toFixed(2) }
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

    // === Canvasと3D地形のサイズと中心を比較（実際の3D空間での値） ===
    // Canvasの地理座標でのサイズと中心
    const canvasGeoWidth = geoWidth;
    const canvasGeoHeight = geoHeight;
    const canvasCenterGeoX = (minX + maxX) / 2;
    const canvasCenterGeoY = (minY + maxY) / 2;

    // 3D地形メッシュの実際の3D空間でのサイズと中心を取得
    // geometry.boundingBoxは回転・平行移動後の3D座標
    // 注意: rotateX(-Math.PI/2)とrotateY(+Math.PI/2)が適用されているため、
    // boundingBoxの軸の対応を確認する必要がある
    let terrainBbox3D = null;
    if (geometry) {
      geometry.computeBoundingBox();
      terrainBbox3D = geometry.boundingBox;
    } else if (this.terrainMeshRef && this.terrainMeshRef.geometry) {
      this.terrainMeshRef.geometry.computeBoundingBox();
      terrainBbox3D = this.terrainMeshRef.geometry.boundingBox;
    }

    if (terrainBbox3D) {
      // 3D座標から地理座標に逆変換
      // 座標変換: X3D = geoY - offset.x, Z3D = -geoX - offset.z
      // 逆変換: geoX = -(Z3D + offset.z), geoY = X3D + offset.x
      // ただし、回転が適用されているため、軸の対応を確認
      // rotateX(-Math.PI/2)とrotateY(+Math.PI/2)後:
      // - boundingBox.min.x, max.x → 元のZ軸方向（経度方向）
      // - boundingBox.min.z, max.z → 元のX軸方向（緯度方向）
      
      // 3D座標の各角を地理座標に逆変換
      const corners3D = [
        { x: terrainBbox3D.min.x, z: terrainBbox3D.min.z }, // 左下
        { x: terrainBbox3D.max.x, z: terrainBbox3D.min.z }, // 右下
        { x: terrainBbox3D.min.x, z: terrainBbox3D.max.z }, // 左上
        { x: terrainBbox3D.max.x, z: terrainBbox3D.max.z }  // 右上
      ];

      const geoCorners = corners3D.map(corner => {
        // 3D座標から地理座標に逆変換
        // 回転後の軸: X → 元のZ（経度）、Z → 元のX（緯度）
        const geoX = -(corner.x + this.coordinateOffset.z); // Z3D → geoX
        const geoY = corner.z + this.coordinateOffset.x;     // X3D → geoY
        return { x: geoX, y: geoY };
      });

      const terrainGeoX = geoCorners.map(c => c.x);
      const terrainGeoY = geoCorners.map(c => c.y);
      const terrainMinX = Math.min(...terrainGeoX);
      const terrainMaxX = Math.max(...terrainGeoX);
      const terrainMinY = Math.min(...terrainGeoY);
      const terrainMaxY = Math.max(...terrainGeoY);

      const terrainGeoWidth = terrainMaxX - terrainMinX;
      const terrainGeoHeight = terrainMaxY - terrainMinY;
      const terrainCenterGeoX = (terrainMinX + terrainMaxX) / 2;
      const terrainCenterGeoY = (terrainMinY + terrainMaxY) / 2;

      console.log('========================================');
      console.log('=== Canvasと3D地形のサイズと中心の比較 ===');
      console.log('Canvas:', {
        サイズ_ピクセル: {
          width: canvasWidth,
          height: canvasHeight
        },
        サイズ_地理座標: {
          width: canvasGeoWidth.toFixed(6),
          height: canvasGeoHeight.toFixed(6)
        },
        中心_地理座標: {
          centerX: canvasCenterGeoX.toFixed(6),
          centerY: canvasCenterGeoY.toFixed(6)
        },
        bbox: {
          minX: minX.toFixed(6),
          minY: minY.toFixed(6),
          maxX: maxX.toFixed(6),
          maxY: maxY.toFixed(6)
        }
      });
      console.log('3D地形メッシュ（座標変換後）:', {
        サイズ_3D空間: {
          widthX: (terrainBbox3D.max.x - terrainBbox3D.min.x).toFixed(6),
          widthZ: (terrainBbox3D.max.z - terrainBbox3D.min.z).toFixed(6),
          heightY: (terrainBbox3D.max.y - terrainBbox3D.min.y).toFixed(6)
        },
        サイズ_地理座標_逆変換後: {
          width: terrainGeoWidth.toFixed(6),
          height: terrainGeoHeight.toFixed(6)
        },
        中心_地理座標_逆変換後: {
          centerX: terrainCenterGeoX.toFixed(6),
          centerY: terrainCenterGeoY.toFixed(6)
        },
        bbox_3D空間: {
          minX: terrainBbox3D.min.x.toFixed(6),
          maxX: terrainBbox3D.max.x.toFixed(6),
          minY: terrainBbox3D.min.y.toFixed(6),
          maxY: terrainBbox3D.max.y.toFixed(6),
          minZ: terrainBbox3D.min.z.toFixed(6),
          maxZ: terrainBbox3D.max.z.toFixed(6)
        },
        bbox_地理座標_逆変換後: {
          minX: terrainMinX.toFixed(6),
          minY: terrainMinY.toFixed(6),
          maxX: terrainMaxX.toFixed(6),
          maxY: terrainMaxY.toFixed(6)
        }
      });
      console.log('比較結果:', {
        サイズが同じか: {
          width: Math.abs(canvasGeoWidth - terrainGeoWidth) < 1e-6,
          height: Math.abs(canvasGeoHeight - terrainGeoHeight) < 1e-6
        },
        中心のずれ: {
          deltaX: (canvasCenterGeoX - terrainCenterGeoX).toFixed(6),
          deltaY: (canvasCenterGeoY - terrainCenterGeoY).toFixed(6)
        },
        座標オフセット: {
          x: this.coordinateOffset.x.toFixed(6),
          z: this.coordinateOffset.z.toFixed(6)
        }
      });
      console.log('========================================');
    } else {
      console.warn('3D地形メッシュのboundingBoxが取得できませんでした');
    }

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
      if (this.terrainMeshRef.material) this.terrainMeshRef.material.dispose();
      this.terrainMeshRef = null;
    }
  }
}

export default GeoTerrainViewer;

