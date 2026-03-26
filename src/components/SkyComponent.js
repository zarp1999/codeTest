import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { GUI } from 'lil-gui';

/**
 * Sky コンポーネント
 * 空と太陽のレンダリングを管理するクラス
 */
class SkyComponent {
  constructor(scene, renderer, container = null, showGUI = true) {
    this.scene = scene;
    this.renderer = renderer;
    this.container = container;
    this.sky = null;
    this.sun = new THREE.Vector3();
    this.gui = null;
    this.showGUI = showGUI; // GUI表示フラグを追加
    
    // エフェクトコントローラー（Skyパラメータ）
    this.effectController = {
      turbidity: 18.3,
      rayleigh: 0.313,
      mieCoefficient: 0.009,
      mieDirectionalG: 1,
      luminance: 1.041,
      inclination: 0.1027,
      azimuth: 0.1
    };
    
    this.initSky();
  }
  
  /**
   * Skyの初期化
   */
  initSky() {
    // Skyオブジェクトを作成
    this.sky = new Sky();
    this.sky.scale.setScalar(45000);
    this.scene.add(this.sky);
    
    // 初期値を設定
    this.updateSky();
    
    // GUIを作成
    this.initGUI();
  }
  
  /**
   * Skyパラメータの更新
   */
  updateSky() {
    const uniforms = this.sky.material.uniforms;
    
    // Sky パラメータを設定
    uniforms['turbidity'].value = this.effectController.turbidity;
    uniforms['rayleigh'].value = this.effectController.rayleigh;
    uniforms['mieCoefficient'].value = this.effectController.mieCoefficient;
    uniforms['mieDirectionalG'].value = this.effectController.mieDirectionalG;
    
    // 太陽の位置を計算
    const phi = THREE.MathUtils.degToRad(90 * this.effectController.inclination);
    const theta = THREE.MathUtils.degToRad(this.effectController.azimuth);
    
    this.sun.setFromSphericalCoords(1, phi, theta);
    uniforms['sunPosition'].value.copy(this.sun);
    
    // luminanceを使用してレンダラーの露出を設定
    this.renderer.toneMappingExposure = this.effectController.luminance;
  }
  
  /**
   * GUIコントロールの初期化
   */
  initGUI() {
    // showGUIがfalseの場合はGUIを作成しない
    if (!this.showGUI) {
      return;
    }
    
    this.gui = new GUI({ 
      container: this.container,
      title: 'Sky Controls'
    });
    
    // GUIをコンテナ内に配置
    if (this.container) {
      this.gui.domElement.style.position = 'absolute';
      this.gui.domElement.style.top = '10px';
      this.gui.domElement.style.right = '10px';
      this.gui.domElement.style.zIndex = '1000';
    }
    
    const guiChanged = () => {
      this.updateSky();
    };
    
    // Sky コントロール
    this.gui.add(this.effectController, 'turbidity', 0.0, 20.0, 0.1).onChange(guiChanged);
    this.gui.add(this.effectController, 'rayleigh', 0.0, 4, 0.001).onChange(guiChanged);
    this.gui.add(this.effectController, 'mieCoefficient', 0.0, 0.1, 0.001).onChange(guiChanged);
    this.gui.add(this.effectController, 'mieDirectionalG', 0.0, 1, 0.001).onChange(guiChanged);
    this.gui.add(this.effectController, 'luminance', 0.0, 2.0, 0.001).onChange(guiChanged);
    this.gui.add(this.effectController, 'inclination', 0, 1, 0.0001).onChange(guiChanged);
    this.gui.add(this.effectController, 'azimuth', 0, 1, 0.1).onChange(guiChanged);
  }
  
  /**
   * パラメータの取得
   */
  getParameters() {
    return this.effectController;
  }
  
  /**
   * パラメータの設定
   */
  setParameters(params) {
    Object.assign(this.effectController, params);
    this.updateSky();
  }
  
  /**
   * 太陽の位置を取得
   */
  getSunPosition() {
    return this.sun.clone();
  }
  
  /**
   * 背景の表示/非表示を制御
   * @param {boolean} visible - 背景の表示状態
   */
  setBackgroundVisible(visible) {
    if (this.sky) {
      this.sky.visible = visible;
    }
    if (!visible) {
      this.scene.background = new THREE.Color('#d0d0d0'); // グレー
    } else {
      this.scene.background = null; // Skyが表示されるので透明のまま
    }
  }

  /**
   * クリーンアップ
   */
  dispose() {
    if (this.gui) {
      this.gui.destroy();
    }
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky.material.dispose();
      this.sky.geometry.dispose();
    }
  }
}

export default SkyComponent;

