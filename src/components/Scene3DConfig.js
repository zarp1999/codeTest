/**
 * 3Dシーン描画に利用する共通設定値。
 */
const SCENE3D_CONFIG = Object.freeze({
    /**
     * カメラ設定。
     */
    camera: {
      /** 初期位置 */
      initialPosition: { x: 20, y: 20, z: 20 },
      /** 視野角（度） */
      fov: 75,
      /** ニアクリップ距離 */
      near: 0.1,
      /** ファークリップ距離 */
      far: 1000,
      /** 正射カメラの初期視体積 */
      orthographic: {
        left: -1,
        right: 1,
        top: 1,
        bottom: -1,
      },
      /** カメラ自動フィット時のオフセット倍率 */
      fitOffset: 1.4,
      /** 断面表示時のカメラ距離 */
      sectionViewDistance: 80,
      /** 断面表示時のカメラ高さ */
      sectionViewHeight: 0,
    },
    /**
     * レンダラー設定。
     */
    renderer: {
      /** トーンマッピングの露出値 */
      toneMappingExposure: 1.0,
      /** 最大ピクセル比率 */
      maxPixelRatio: 2,
    },
    /**
     * シーン設定。
     */
    scene: {
      /** 背景色（断面図モード） */
      backgroundColor: 0xffffff,
      /** フォグ設定 */
      fog: {
        color: 0xC5D2DC,
        near: 700,
        far: 800,
      },
    },
    /**
     * ライティング設定。
     */
    lighting: {
      /** アンビエントライト */
      ambient: {
        color: 0xffffff,
        crossSectionColor: 0x808080,
        intensity: {
          normal: 1.4,
          crossSection: 1.5,
        },
      },
      /** ディレクショナルライト（太陽光） */
      directional: {
        color: 0xffffff,
        intensity: 3.5,
        intensityCrossSection: 1.0,
        position: { x: 1, y: 1, z: 1 },
        shadowMapSize: { width: 2048, height: 2048 },
        sunColor: 0xfff4e6,
      },
      /** 追加のディレクショナルライト */
      additional: {
        color: 0xffffff,
        intensity: 1.2,
        position: { x: -1, y: -1, z: 1 },
      },
    },
    /**
     * OrbitControls設定。
     */
    controls: {
      /** 回転速度 */
      rotateSpeed: {
        normal: 1.0,
        slow: 0.05,
      },
      /** ズーム速度 */
      zoomSpeed: {
        normal: 1.0,
        slow: 0.05,
      },
      /** キーボード回転速度 */
      keyRotateSpeed: 1.0,
      /** 最小距離制限 */
      minDistance: 0.1,
      /** 最大距離制限（Infinity = 制限なし） */
      maxDistance: Infinity,
      /** 垂直回転の最大角度（ラジアン） */
      maxPolarAngle: Math.PI,
      /** 垂直回転の最小角度（ラジアン） */
      minPolarAngle: 0,
      /** 初期ターゲット位置 */
      initialTarget: { x: 0, y: 0, z: 0 },
    },
    /**
     * カメラ移動設定。
     */
    movement: {
      /** 通常速度 */
      normalSpeed: 1,
      /** 低速（Shiftキー押下時） */
      slowSpeed: 0.05,
    },
    /**
     * アウトライン表示設定。
     */
    outline: {
      /** エッジ抽出の角度閾値（度） */
      edgeAngleThreshold: 75,
      /** アウトラインの色 */
      color: 0xffff00,
      /** アウトラインの線幅 */
      lineWidth: 2,
    },
    /**
     * 床（地表面）設定。
     */
    floor: {
      /** 床の色 */
      color: '#D3D3D3',
      /** 床の不透明度 */
      opacity: 0.5,
      /** 床の粗さ */
      roughness: 0.5,
      /** 床サイズ計算時の最小値 */
      minSize: 1000,
      /** 床サイズ計算時の倍率 */
      sizeMultiplier: 2,
    },
    /**
     * ジオメトリ設定。
     */
    geometry: {
      /** 簡易表示用のボックスサイズ */
      simpleBoxSize: 0.1,
      /** ポイント表示用の球体半径 */
      pointRadius: 0.2,
      /** ポイント表示用のセグメント数 */
      pointSegments: 16,
      /** 円柱のセグメント数 */
      cylinderSegments: 24,
      /** 円/球体のセグメント数 */
      circleSegments: 32,
      /** コーンのセグメント数 */
      coneSegments: 32,
      /** トーラスのセグメント数 */
      torusSegments: { radial: 16, tubular: 100 },
    },
    /**
     * マテリアル設定。
     */
    material: {
      /** 断面図モードのエミッシブ倍率 */
      emissiveMultiplier: {
        crossSection: 0.2,
        normal: 0.1,
      },
      /** エミッシブ強度 */
      emissiveIntensity: {
        crossSection: 0.3,
        normal: 0.05,
      },
    },
    /**
     * その他の設定。
     */
    other: {
      /** カメラ位置変更の検出閾値 */
      positionChangeThreshold: 0.001,
      /** カメラ回転変更の検出閾値（ラジアン） */
      rotationChangeThreshold: 0.01,
      /** 距離計算の最小値 */
      minDistance: 0.1,
      /** 管路複製時の垂直オフセット */
      duplicateVerticalOffset: 1.5,
    },
    /** JGW付き地表画像 */
    geoSurfaceListPath: "/config/list.json",
   
    /** テクスチャ */
    textureImageUrl: "/geo/toranomon/texture_from_point_cloud.jpg",
  });
   
  export default SCENE3D_CONFIG;
   