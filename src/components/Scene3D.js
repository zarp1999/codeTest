import React, { useRef, useEffect, useState, useImperativeHandle, useMemo } from 'react';
import * as THREE from 'three';
import { message } from 'antd';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { useAppConfig } from '../contexts/AppConfigContext';
import SkyComponent from './SkyComponent';
import PipelineInfoDisplay from './PipelineInfoDisplay';
import { DistanceMeasurement, DistanceMeasurementDisplay } from './DistanceMeasurement';
import PolylineMeasurement from './PolylineMeasurement';
import CrossSectionPlane from './CrossSectionPlane';
import JGWImageLoader from './JGWImageLoader';
import PotreePointCloudViewer from './PotreePointCloudViewer';
import GeoTerrainWithJGWTexture from './GeoTerrainWithJGWTexture';
import './Scene3D.css';
import CameraBookmarkPanel from './CameraBookmarkPanel';
import EquipmentSearchPanel from './EquipmentSearchPanel';
import EquipmentBookmarkPanel from './EquipmentBookmarkPanel';
import AxisDirectionHud from './AxisDirectionHud';
import SubViewPanel from './SubViewPanel';
import createCityObjects, { isPipeObject } from './Geometry.js';
import createQuadTreeNodes from './3D/QuadTree.js';
import SCENE3D_CONFIG from './Scene3DConfig.js';
import SceneObjectRegistry from './SceneObjectReqistry.js';
import enterAddMode from './PipeLocator.js';
// import { createDataAccessor } from '../DataAccessor/Factory.js';
import { CityObjectState } from './CityObjectState.js';


/**
 * 3Dシーンコンポーネント
 * - CityJSONの内容からオブジェクトを生成
 * - キー/マウスによるカメラ操作
 * - 左上: 管路情報、左下: カメラ情報
 */
const Scene3D = React.forwardRef(function Scene3D({ cityJsonData, userPositions, shapeTypes, layerData, sourceTypes, hideInfoPanel = false, hideBackground = false, enableCrossSectionMode = false, autoModeEnabled = false, onMeasurementUpdate = null, onSelectedObjectChange = null, generatedSections = [], sectionViewMode = false, currentSectionIndex = 0, geoTiffUrl = null, terrainVisible = false, terrainOpacity = 0.8, accessor, potreeMetadataUrl = null, potreeVisible = false }, ref) {
  const config = useAppConfig();
  const mode = config?.mode || 'normal';
  const verticalLineBaseYConfig = config?.verticalLineBaseY || {};
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  // カメラ切替用
  const cameraRigRef = useRef(null);
  const perspectiveCameraRef = useRef(null);
  const orthographicCameraRef = useRef(null);
  // 現在どちらのカメラを使用しているかを保持
  const activeCameraTypeRef = useRef('perspective');
  const rendererRef = useRef(null);
  const objectsRef = useRef({});
  const raycasterRef = useRef(new THREE.Raycaster());
  const mouseRef = useRef(new THREE.Vector2());
  const hoveredObjectRef = useRef(null);
  const selectedMeshRef = useRef(null);
  const keysPressed = useRef({});
  const controlsRef = useRef(null);
  const floorRef = useRef(null);
  const skyComponentRef = useRef(null);
  const crossSectionRef = useRef(null);
  const terrainViewerRef = useRef(null);
  const jgwImageLoaderRef = useRef(null);
  // const potreeViewerRef = useRef(null);
  const initialCameraPosition = useRef(new THREE.Vector3(
    SCENE3D_CONFIG.camera.initialPosition.x,
    SCENE3D_CONFIG.camera.initialPosition.y,
    SCENE3D_CONFIG.camera.initialPosition.z
  ));
  const initialCameraRotation = useRef(new THREE.Euler());
  const centerPosition = useRef(new THREE.Vector3(0, 0, 0));
  const previousCameraPosition = useRef(new THREE.Vector3(
    SCENE3D_CONFIG.camera.initialPosition.x,
    SCENE3D_CONFIG.camera.initialPosition.y,
    SCENE3D_CONFIG.camera.initialPosition.z
  ));
  const previousCameraRotation = useRef(new THREE.Euler());

  // const accessor = createDataAccessor();
  // accessorの渡り値の確認
  useEffect(() => {
    console.log('Scene3D accessor instance:', accessor);
    console.log('accessor class name:', accessor?.constructor?.name);
    console.log('has updateRegionUserPositionData?', typeof accessor?.updateRegionUserPositionData === 'function');
  }, [accessor]);

  // アウトライン表示用のref
  const outlineHelperRef = useRef(null);

  // 断面自動作成モードの状態をrefで保持（クリックハンドラーで最新の値を参照するため）
  const autoModeEnabledRef = useRef(autoModeEnabled);

  // ドラッグ機能用のref
  const isDragging = useRef(false);
  const pendingDragRef = useRef(false);
  const dragStartMouseRef = useRef({ x: 0, y: 0 });
  const dragStartPosition = useRef(new THREE.Vector3());
  const dragPlane = useRef(new THREE.Plane());
  const dragIntersection = useRef(new THREE.Vector3());
  // 断面モード専用の左ドラッグ（断面向き指定）
  const sectionDragPendingRef = useRef(false);
  const sectionIsDraggingRef = useRef(false);
  const sectionDragStartMouseRef = useRef({ x: 0, y: 0 });
  const sectionDragStartPointRef = useRef(null);
  const sectionDragEndPointRef = useRef(null);
  const sectionDragTargetRef = useRef(null);
  const skipNextSectionClickRef = useRef(false);
  const sectionDragPreviewLineRef = useRef(null);

  // 距離計測用のref
  const distanceMeasurementRef = useRef(null);
  // 中クリック折れ線計測用のref
  const polylineMeasurementRef = useRef(null);
  // カメラ位置とOrbitControls.targetの相対距離
  const targetOffsetRef = useRef(new THREE.Vector3(0, 0, -10));

  // 右ドラッグで「向きだけ」回転するためのref
  const isRightDraggingRef = useRef(false);
  const rightDragLastPosRef = useRef({ x: 0, y: 0 });
  const rightDragYawPitchRef = useRef({ yaw: 0, pitch: 0, targetDistance: 10 });

  // 4キー（断面に正対）
  const faceSectionSideSignRef = useRef(1);

  /**
   * カメラの yaw/pitch/roll を 'YXZ' として安全に編集するヘルパー
   */
  const getEulerYXZFromCamera = (camera) => {
    return new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
  };

  const applyEulerYXZToCamera = (camera, eulerYXZ) => {
    camera.quaternion.setFromEuler(eulerYXZ);
    // 次回の右ドラッグ開始でジャンプしないよう内部状態も同期
    rightDragYawPitchRef.current.yaw = eulerYXZ.y;
    rightDragYawPitchRef.current.pitch = eulerYXZ.x;
  };

  /**
   * - geom.center が無いデータがあるため、その場合は vertices の始点/終点から中心を推定する
   * - 取得できなければ [0,0,0]
   */
  const getOldCenterFromGeom = (geom) => {
    if (Array.isArray(geom?.center) && geom.center.length >= 3) {
      return [Number(geom.center[0]) || 0, Number(geom.center[1]) || 0, Number(geom.center[2]) || 0];
    }
    const extrudePath = geom?.extrudePath;
    if (Array.isArray(extrudePath) && extrudePath.length >= 2) {
      const a = extrudePath[0];
      const b = extrudePath[extrudePath.length - 1];
      if (Array.isArray(a) && Array.isArray(b) && a.length >= 3 && b.length >= 3) {
        const ax = Number(a[0]);
        const ay = Number(a[1]);
        const az = Number(a[2]);
        const bx = Number(b[0]);
        const by = Number(b[1]);
        const bz = Number(b[2]);
        if ([ax, ay, bx, by, bz].every((n) => Number.isFinite(n))) {
          return [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
        }
      }
    }
    const vs = geom?.vertices;
    if (Array.isArray(vs) && vs.length >= 2) {
      const a = vs[0];
      const b = vs[vs.length - 1];
      if (Array.isArray(a) && Array.isArray(b) && a.length >= 3 && b.length >= 3) {
        const ax = Number(a[0]);
        const ay = Number(a[1]);
        const az = Number(a[2]);
        const bx = Number(b[0]);
        const by = Number(b[1]);
        const bz = Number(b[2]);
        if ([ax, ay, az, bx, by, bz].every((n) => Number.isFinite(n))) {
          return [(ax + bx) / 2, (ay + by) / 2, (az + bz) / 2];
        }
      }
    }
    return [0, 0, 0];
  };

  // 3Dオブジェクトデータ管理
  // const objectRegistry = useMemo(() => new SceneObjectRegistry(accessor={accessor}), [accessor]);
  const objectRegistry = useMemo(() => new SceneObjectRegistry(accessor), [accessor]);


  // 3Dオブジェクトの状態(レイヤーパネル情報等が更新されると、再計算される)
  const cityObjectState = CityObjectState(layerData, shapeTypes, sourceTypes);

  /**
   * 透視/正射カメラ間で位置・姿勢を同期する
   * - Spaceキーで切り替えた際に視点が飛ばないようにするため
   */
  const syncCamerasFromActive = (sourceCamera = cameraRef.current) => {
    const perspectiveCamera = perspectiveCameraRef.current;
    const orthographicCamera = orthographicCameraRef.current;
    if (!sourceCamera || !perspectiveCamera || !orthographicCamera) return;

    if (sourceCamera === perspectiveCamera) {
      orthographicCamera.position.copy(sourceCamera.position);
      orthographicCamera.quaternion.copy(sourceCamera.quaternion);
      orthographicCamera.rotation.copy(sourceCamera.rotation);
      orthographicCamera.up.copy(sourceCamera.up);
      orthographicCamera.updateMatrixWorld();
    } else if (sourceCamera === orthographicCamera) {
      perspectiveCamera.position.copy(sourceCamera.position);
      perspectiveCamera.quaternion.copy(sourceCamera.quaternion);
      perspectiveCamera.rotation.copy(sourceCamera.rotation);
      perspectiveCamera.up.copy(sourceCamera.up);
      perspectiveCamera.updateMatrixWorld();
    }
  };

  /**
   * カメラの位置/オイラー角を情報パネル用stateへ反映
   */
  const updateCameraInfoFromCamera = (camera) => {
    if (!camera) return;
    const radToDeg = (rad) => (rad * 180) / Math.PI;
    // Unityの eulerAngles に合わせて 0〜360 表記へ正規化
    const normalize360 = (deg) => {
      const d = deg % 360;
      return d < 0 ? d + 360 : d;
    };
    const wrap360ForOneDecimal = (deg) => (deg >= 359.95 ? 0 : deg);
    const fixNegZero = (n) => (Object.is(n, -0) ? 0 : n);
    const snapForOneDecimal = (deg) => (Math.abs(deg) < 0.05 ? 0 : deg);

    const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
    setCameraInfo({
      x: camera.position.x,
      y: camera.position.y,
      z: -camera.position.z,
      roll: fixNegZero(snapForOneDecimal(radToDeg(euler.z))).toFixed(1),
      pitch: fixNegZero(snapForOneDecimal(wrap360ForOneDecimal(normalize360(-radToDeg(euler.x))))).toFixed(1),
      yaw: fixNegZero(snapForOneDecimal(wrap360ForOneDecimal(normalize360(-radToDeg(euler.y))))).toFixed(1)
    });
  };

  /**
   * シーン内の全メッシュの「平均高さ(Y)」を計算
   * - 取得できない場合は null を返す
   */
  const computeAverageObjectCenterY = () => {
    const meshes = Object.values(objectsRef.current || {}).filter(Boolean);
    if (meshes.length === 0) return null;

    let minCm = Infinity;
    let maxCm = -Infinity;
    let any = false;

    meshes.forEach((m) => {
      if (!m.visible) return;
      const obj = m.userData?.objectData;
      const attrs = obj?.attributes;
      if (!attrs) return;

      const spdRaw = attrs.start_point_depth;
      const epdRaw = attrs.end_point_depth;
      if (spdRaw == null || epdRaw == null) return;
      const spdCm = Number(spdRaw);
      const epdCm = Number(epdRaw);
      if (!Number.isFinite(spdCm) || !Number.isFinite(epdCm)) return;

      // 半径を計算
      let radiusM = 0;
      if (attrs.radius != null) {
        radiusM = Number(attrs.radius);
      } else if (attrs.diameter != null) {
        radiusM = Number(attrs.diameter) / 2;
      }
      if (!Number.isFinite(radiusM)) radiusM = 0;
      if (radiusM > 5) radiusM = radiusM / 1000;
      const radiusCmInt = Math.trunc(radiusM * 100);

      const spdCenterCm = spdCm + radiusCmInt;
      const epdCenterCm = epdCm + radiusCmInt;

      minCm = Math.min(minCm, spdCenterCm, epdCenterCm);
      maxCm = Math.max(maxCm, spdCenterCm, epdCenterCm);
      any = true;
    });

    if (!any || !Number.isFinite(minCm) || !Number.isFinite(maxCm)) {
      return null;
    }

    const baseDepthM = (minCm + maxCm) * 0.5 * 0.01;
    // 深さは地下方向
    return -baseDepthM;
  };

  /**
   * 中心点を計算
   * @returns {THREE.Vector3|null} (x,z)を設定した中心。
   */
  const computeBaseXYCenter = () => {
    const meshes = Object.values(objectsRef.current || {}).filter(Boolean);
    if (meshes.length === 0) return null;

    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let any = false;

    const considerPoint = (lon, lat) => {
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      minLon = Math.min(minLon, lon);
      maxLon = Math.max(maxLon, lon);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
      any = true;
    };

    meshes.forEach((m) => {
      if (!m.visible) return; // 可視オブジェクトを対象
      const obj = m.userData?.objectData;
      const geom = obj?.geometry?.[0];
      if (geom && Array.isArray(geom.vertices) && geom.vertices.length >= 1) {
        const start = geom.vertices[0];
        if (Array.isArray(start) && start.length >= 2) considerPoint(Number(start[0]), Number(start[1]));
        return;
      }
    });

    if (!any || !Number.isFinite(minLon) || !Number.isFinite(maxLon) || !Number.isFinite(minLat) || !Number.isFinite(maxLat)) {
      const worldCenter = computeWorldCenterOfAllObjects();
      if (!worldCenter) return null;
      const yKeep = controlsRef.current ? controlsRef.current.target.y : 0;
      const fallback = new THREE.Vector3(worldCenter.x, yKeep, worldCenter.z);
      if (!Number.isFinite(fallback.x) || !Number.isFinite(fallback.y) || !Number.isFinite(fallback.z)) return null;
      return fallback;
    }

    const baseX = (minLon + maxLon) * 0.5;
    const baseZ = (minLat + maxLat) * 0.5;
    const yKeep = controlsRef.current ? controlsRef.current.target.y : 0;
    return new THREE.Vector3(baseX, yKeep, baseZ);
  };

  /**
   * 全オブジェクト（objectsRef.current）のワールド中心点を取得（AABB中心）
   * - 取得できない場合は null
   */
  const computeWorldCenterOfAllObjects = () => {
    const meshes = Object.values(objectsRef.current || {}).filter(Boolean);
    if (meshes.length === 0) return null;

    const box = new THREE.Box3();
    let any = false;
    meshes.forEach((m) => {
      if (!m.visible) return; // 見えているオブジェクトを対象
      try {
        m.updateWorldMatrix(true, true);
        box.expandByObject(m);
        any = true;
      } catch (_) {
        // ignore
      }
    });
    if (!any) return null;

    const center = new THREE.Vector3();
    box.getCenter(center);
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) return null;
    return center;
  };

  /**
   * 正射カメラの視体積（top/right...）を再計算
   * - 透視カメラ距離を基準にサイズを合わせる
   */
  const updateOrthographicFrustum = (referenceCamera = null) => {
    const orthographicCamera = orthographicCameraRef.current;
    const mount = mountRef.current;
    if (!orthographicCamera || !mount) return;

    // ウィンドウ幅・高さ・アスペクト比を取得
    const width = mount.clientWidth || 1;
    const height = mount.clientHeight || 1;
    const aspect = height === 0 ? 1 : width / height;

    // 既存のfrustumHeight（表示範囲の高さ）があれば取得
    let frustumHeight = orthographicCamera.userData?.baseFrustumHeight;

    const baseCamera = referenceCamera || perspectiveCameraRef.current || cameraRef.current;
    if ((!frustumHeight || referenceCamera) && baseCamera) {
      const controls = controlsRef.current;
      const target = controls ? controls.target : new THREE.Vector3(0, 0, 0);

      // カメラ位置からターゲットへの距離
      const distance = Math.max(baseCamera.position.distanceTo(target), SCENE3D_CONFIG.other.minDistance);
      const fovDeg = baseCamera.isPerspectiveCamera
        ? baseCamera.fov
        : (perspectiveCameraRef.current ? perspectiveCameraRef.current.fov : SCENE3D_CONFIG.camera.fov);
      const fovRad = THREE.MathUtils.degToRad(fovDeg || SCENE3D_CONFIG.camera.fov);
      frustumHeight = 2 * distance * Math.tan(fovRad / 2);
      orthographicCamera.userData = orthographicCamera.userData || {};
      orthographicCamera.userData.baseFrustumHeight = frustumHeight;
    }

    if (!frustumHeight || !Number.isFinite(frustumHeight)) {
      frustumHeight = SCENE3D_CONFIG.floor.minSize / 10;
    }
    // OrthographicCameraの可視範囲を設定
    const frustumWidth = frustumHeight * aspect;
    orthographicCamera.top = frustumHeight / 2;
    orthographicCamera.bottom = -frustumHeight / 2;
    orthographicCamera.left = -frustumWidth / 2;
    orthographicCamera.right = frustumWidth / 2;

    // カメラの投影行列を更新
    orthographicCamera.updateProjectionMatrix();
  };

  /**
   * OrbitControls.targetとカメラ位置の相対オフセットをローカル座標で記録
   * - カメラを切り替えてもターゲットとの距離感を再現するため
   */
  const updateTargetOffsetFromCamera = (camera = cameraRef.current) => {
    if (!camera || !controlsRef.current) return;
    const offsetWorld = controlsRef.current.target.clone().sub(camera.position);
    const minLengthSq = SCENE3D_CONFIG.other.minDistance * SCENE3D_CONFIG.other.minDistance;
    if (offsetWorld.lengthSq() < minLengthSq || !Number.isFinite(offsetWorld.length())) {
      targetOffsetRef.current.set(0, 0, -10);
      return;
    }
    const inverseQuat = camera.quaternion.clone().invert();
    targetOffsetRef.current.copy(offsetWorld.clone().applyQuaternion(inverseQuat));
  };

  /**
   * 記録済みオフセットを使ってOrbitControls.targetを再配置
   * - カメラが移動/切替されたときに呼び出す
   */
  const repositionTargetUsingOffset = (camera = cameraRef.current) => {
    if (!camera || !controlsRef.current) return;
    const offsetLocal = targetOffsetRef.current.clone();
    const minLengthSq = SCENE3D_CONFIG.other.minDistance * SCENE3D_CONFIG.other.minDistance;
    if (offsetLocal.lengthSq() < minLengthSq || !Number.isFinite(offsetLocal.length())) {
      offsetLocal.set(0, 0, -10);
    }
    const offsetWorld = offsetLocal.applyQuaternion(camera.quaternion);
    controlsRef.current.target.copy(camera.position.clone().add(offsetWorld));
  };

  /**
   * 透視カメラ <-> 正射カメラをトグル切替
   * - 両カメラの状態を同期し、関連コンポーネントへも通知
   */
  const toggleCameraProjection = () => {
    const currentType = activeCameraTypeRef.current;
    const nextType = currentType === 'perspective' ? 'orthographic' : 'perspective';
    const currentCamera = cameraRef.current;
    const nextCamera = nextType === 'perspective'
      ? perspectiveCameraRef.current
      : orthographicCameraRef.current;

    if (!currentCamera || !nextCamera) {
      return;
    }

    if (currentCamera !== nextCamera) {
      nextCamera.position.copy(currentCamera.position);
      nextCamera.quaternion.copy(currentCamera.quaternion);
      nextCamera.rotation.copy(currentCamera.rotation);
      nextCamera.up.copy(currentCamera.up);
      nextCamera.updateMatrixWorld();
      if (nextCamera.isOrthographicCamera) {
        updateOrthographicFrustum(currentCamera);
      }
    }

    cameraRef.current = nextCamera;
    activeCameraTypeRef.current = nextType;

    if (controlsRef.current) {
      controlsRef.current.object = nextCamera;
      controlsRef.current.update();
    }

    if (distanceMeasurementRef.current && typeof distanceMeasurementRef.current.updateCamera === 'function') {
      distanceMeasurementRef.current.updateCamera(nextCamera);
    }
    if (polylineMeasurementRef.current && typeof polylineMeasurementRef.current.updateCamera === 'function') {
      polylineMeasurementRef.current.updateCamera(nextCamera);
    }

    if (crossSectionRef.current && typeof crossSectionRef.current.setCamera === 'function') {
      crossSectionRef.current.setCamera(nextCamera);
    }

    syncCamerasFromActive(nextCamera);
    updateTargetOffsetFromCamera(nextCamera);

    previousCameraPosition.current.copy(nextCamera.position);
    previousCameraRotation.current.copy(nextCamera.rotation);

    updateCameraInfoFromCamera(nextCamera);
  };

  // マウス移動フラグ（パフォーマンス最適化用）
  const mouseMovedRef = useRef(false);

  // カメラ位置情報のstate
  const [cameraInfo, setCameraInfo] = useState({
    x: SCENE3D_CONFIG.camera.initialPosition.x,
    y: SCENE3D_CONFIG.camera.initialPosition.y,
    z: SCENE3D_CONFIG.camera.initialPosition.z,
    roll: 0.0,
    pitch: 0.0,
    yaw: 0.0
  });

  // 選択されたオブジェクトのstate
  const [selectedObject, setSelectedObject] = useState(null);
  const [showGuides, setShowGuides] = useState(true);
  const [showAxisHud, setShowAxisHud] = useState(true);
  const [showPipes, setShowPipes] = useState(true);
  const [showFloor, setShowFloor] = useState(true);
  const [showRoad, setShowRoad] = useState(false);
  const [showBackground, setShowBackground] = useState(!hideBackground);
  const [showCameraBookmarks, setShowCameraBookmarks] = useState(false);
  const [showEquipmentSearchPanel, setShowEquipmentSearchPanel] = useState(false);
  const [showEquipmentBookmarksPanel, setShowEquipmentBookmarksPanel] = useState(false);
  const [showSubViews, setShowSubViews] = useState(false);
  const [subViewFollowEnabled, setSubViewFollowEnabled] = useState(true);
  // animateループ内の古いクロージャを避けるため、表示状態はrefにも同期して参照する
  const showSubViewsRef = useRef(false);
  const subViewFollowEnabledRef = useRef(true);
  const [equipmentSearchKeyword, setEquipmentSearchKeyword] = useState('');
  const [equipmentSearchRequestId, setEquipmentSearchRequestId] = useState(0);
  // サブビュー描画はSubViewPanelのimperative APIへ委譲
  const subViewPanelRef = useRef(null);

  const handleToggleCameraPanel = () => {
    setShowCameraBookmarks((prev) => {
      const next = !prev;
      if (next) {
        setShowEquipmentSearchPanel(false);
        setShowEquipmentBookmarksPanel(false);
      }
      return next;
    });
  };

  const handleToggleEquipmentBookmarksPanel = () => {
    setShowEquipmentBookmarksPanel((prev) => {
      const next = !prev;
      if (next) {
        setShowCameraBookmarks(false);
        setShowEquipmentSearchPanel(false);
      }
      return next;
    });
  };

  const handleOpenSearchPanel = () => {
    setShowEquipmentSearchPanel(true);
    setShowCameraBookmarks(false);
    setShowEquipmentBookmarksPanel(false);
  };

  const handleToggleSubViews = () => {
    setShowSubViews((prev) => !prev);
  };

  const handleToggleSubViewFollow = (event) => {
    setSubViewFollowEnabled(event.target.checked);
  };

  const isSubViewInteraction = (event) => {
    if (!showSubViewsRef.current || !subViewPanelRef.current || !mountRef.current) return false;
    const rect = mountRef.current.getBoundingClientRect();
    return subViewPanelRef.current.isPointInSubView({
      clientX: event.clientX,
      clientY: event.clientY,
      rect
    });
  };

  useEffect(() => {
    showSubViewsRef.current = showSubViews;
  }, [showSubViews]);

  useEffect(() => {
    subViewFollowEnabledRef.current = subViewFollowEnabled;
  }, [subViewFollowEnabled]);

  useEffect(() => {
    if (enableCrossSectionMode) {
      setShowSubViews(false);
    }
  }, [enableCrossSectionMode]);

  // 距離計測結果のstate
  const [measurementResult, setMeasurementResult] = useState(null);

  // showPipes が変更されたときに管路オブジェクトの表示/非表示を切り替え
  useEffect(() => {
    if (!objectsRef.current) return;

    // 全ての管路オブジェクトのvisibleプロパティを更新
    Object.values(objectsRef.current).forEach(obj => {
      if (obj && obj.type === 'Mesh') {
        obj.visible = showPipes;
      }
    });
  }, [showPipes]);

  // 距離計測結果が更新されたときに親コンポーネントに通知
  useEffect(() => {
    if (onMeasurementUpdate) {
      onMeasurementUpdate(measurementResult);
    }
  }, [measurementResult, onMeasurementUpdate]);

  // "POINT (x y)" を { x, y } に変換
  const parsePointWkt = (wkt) => {
    if (!wkt || typeof wkt !== 'string') return null;
    const match = /POINT\s*\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))\s*\)/i.exec(wkt);
    if (!match) return null;
    return { x: parseFloat(match[1]), y: parseFloat(match[2]) };
  };

  // userPositionsが無い場合のカメラ自動フィット
  const fitCameraToObjects = () => {
    const camera = cameraRef.current;
    const scene = sceneRef.current;
    if (!camera || !scene) return;

    const meshes = Object.values(objectsRef.current);
    if (meshes.length === 0) return;

    const box = new THREE.Box3();
    meshes.forEach((m) => {
      if (m) {
        m.updateWorldMatrix(true, true);
        box.expandByObject(m);
      }
    });

    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);

    const maxSize = Math.max(size.x, size.y, size.z);
    const fitOffset = SCENE3D_CONFIG.camera.fitOffset;
    const direction = new THREE.Vector3(1, 1, 1).normalize();

    if (camera.isPerspectiveCamera) {
      const fov = camera.fov * (Math.PI / 180);
      const distance = (maxSize / 2) / Math.tan(fov / 2) * fitOffset;
      const newPosition = center.clone().add(direction.multiplyScalar(distance));
      camera.position.copy(newPosition);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      updateOrthographicFrustum(camera);
    } else if (camera.isOrthographicCamera) {
      const mount = mountRef.current;
      const width = mount?.clientWidth || 1;
      const height = mount?.clientHeight || 1;
      const aspect = height === 0 ? 1 : width / height;
      const distance = maxSize * fitOffset;
      const newPosition = center.clone().add(direction.multiplyScalar(distance));
      camera.position.copy(newPosition);
      camera.lookAt(center);
      const frustumHeight = Math.max(maxSize * fitOffset, 10);
      const frustumWidth = frustumHeight * aspect;
      camera.top = frustumHeight / 2;
      camera.bottom = -frustumHeight / 2;
      camera.left = -frustumWidth / 2;
      camera.right = frustumWidth / 2;
      camera.userData = camera.userData || {};
      camera.userData.baseFrustumHeight = frustumHeight;
      camera.updateProjectionMatrix();
    }

    initialCameraPosition.current.copy(camera.position);
    initialCameraRotation.current.copy(camera.rotation);
    previousCameraPosition.current.copy(camera.position);
    previousCameraRotation.current.copy(camera.rotation);
    centerPosition.current.copy(center);

    if (controlsRef.current) {
      controlsRef.current.target.copy(center);
      controlsRef.current.update();
    }

    updateTargetOffsetFromCamera(camera);
    updateCameraInfoFromCamera(camera);
    syncCamerasFromActive(camera);
  };

  // マウス移動ハンドラー
  const handleMouseMove = (event) => {
    const rect = mountRef.current.getBoundingClientRect();
    if (showSubViewsRef.current && subViewPanelRef.current) {
      const handled = subViewPanelRef.current.handlePointerMove({
        clientX: event.clientX,
        clientY: event.clientY,
        rect,
        followEnabled: subViewFollowEnabledRef.current
      });
      if (handled) {
        mouseMovedRef.current = false;
        return;
      }
    }
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    mouseMovedRef.current = true;
    // 左shiftキーが押されている場合は距離計測を優先
    if (event.shiftKey) {
      return;
    }

    const DRAG_THRESHOLD_PX = 4;
    if (enableCrossSectionMode && sectionDragPendingRef.current) {
      const dx = event.clientX - sectionDragStartMouseRef.current.x;
      const dy = event.clientY - sectionDragStartMouseRef.current.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        sectionIsDraggingRef.current = true;
        sectionDragPendingRef.current = false;
      } else {
        return;
      }
    }

    if (enableCrossSectionMode && sectionIsDraggingRef.current) {
      const camera = cameraRef.current;
      const raycaster = raycasterRef.current;
      raycaster.setFromCamera(mouseRef.current, camera);

      let dragIntersects = [];
      if (sectionDragTargetRef.current) {
        dragIntersects = raycaster.intersectObject(sectionDragTargetRef.current, false);
      }
      if (!dragIntersects || dragIntersects.length === 0) {
        const intersects = raycaster.intersectObjects(Object.values(objectsRef.current), false);
        dragIntersects = intersects.filter(intersect => intersect.object.visible);
      }
      if (dragIntersects.length > 0) {
        sectionDragEndPointRef.current = dragIntersects[0].point.clone();
        if (sectionDragStartPointRef.current) {
          drawSectionDragPreviewLine(sectionDragStartPointRef.current, sectionDragEndPointRef.current);
        }
      }
      return;
    }

    if (pendingDragRef.current && selectedMeshRef.current) {
      const dx = event.clientX - dragStartMouseRef.current.x;
      const dy = event.clientY - dragStartMouseRef.current.y;
      if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
        // ドラッグ開始（ジャンプ防止のため、開始点を現在の交点に合わせる）
        const camera = cameraRef.current;
        const raycaster = raycasterRef.current;
        raycaster.setFromCamera(mouseRef.current, camera);
        raycaster.ray.intersectPlane(dragPlane.current, dragStartPosition.current);
        isDragging.current = true;
        pendingDragRef.current = false;
      } else {
        // しきい値未満は「クリック」とみなし、移動も情報更新もしない
        return;
      }
    }

    // ドラッグ中の処理
    if (isDragging.current && selectedMeshRef.current) {
      const camera = cameraRef.current;
      const raycaster = raycasterRef.current;

      raycaster.setFromCamera(mouseRef.current, camera);
      raycaster.ray.intersectPlane(dragPlane.current, dragIntersection.current);

      if (dragIntersection.current) {
        const offset = dragIntersection.current.clone().sub(dragStartPosition.current);
        selectedMeshRef.current.position.add(offset);

        // ドラッグ開始位置を更新
        dragStartPosition.current.copy(dragIntersection.current);

        // 管路情報表示を更新
        updatePipelineInfoDisplay();
      }
    }
  };

  // マウスダウンハンドラー
  const handleMouseDown = (event) => {
    // 左クリックのみ処理
    if (event.button !== 0) return;

    // 左shiftキーが押されている場合は距離計測を優先
    if (event.shiftKey) {
      return;
    }

    if (showSubViewsRef.current && subViewPanelRef.current) {
      const rect = mountRef.current.getBoundingClientRect();
      const handled = subViewPanelRef.current.handlePointerDown({
        clientX: event.clientX,
        clientY: event.clientY,
        rect,
        followEnabled: subViewFollowEnabledRef.current
      });
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    // 管路情報表示エリア内のクリックは無視
    if (event.target.closest('.pipeline-info-display') ||
      event.target.closest('.pipeline-info-text') ||
      event.target.closest('.camera-info-container')) {
      return;
    }

    // クリックされた要素が3Dシーンのレンダリング領域内かチェック
    if (event.target !== rendererRef.current?.domElement) {
      return;
    }

    const rect = mountRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(
      Object.values(objectsRef.current),
      false
    );

    // visible: true のオブジェクトのみをフィルタリング
    const visibleIntersects = intersects.filter(intersect => intersect.object.visible);

    if (visibleIntersects.length > 0) {
      const clickedObject = visibleIntersects[0].object;
      const clickPoint = visibleIntersects[0].point;

      if (enableCrossSectionMode && !autoModeEnabledRef.current && clickedObject.userData.objectData) {
        clearSectionDragPreviewLine();
        sectionDragPendingRef.current = true;
        sectionIsDraggingRef.current = false;
        sectionDragStartMouseRef.current = { x: event.clientX, y: event.clientY };
        sectionDragStartPointRef.current = clickPoint.clone();
        sectionDragEndPointRef.current = clickPoint.clone();
        sectionDragTargetRef.current = clickedObject;
      }

      // ドラッグ開始
      if (clickedObject.userData.objectData &&
        clickedObject === selectedMeshRef.current &&
        !enableCrossSectionMode) {
        // ドラッグ開始は「保留」にする
        pendingDragRef.current = true;
        dragStartMouseRef.current.x = event.clientX;
        dragStartMouseRef.current.y = event.clientY;
        clickedObject.userData.lastDragPos = clickedObject.position.clone();

        // ドラッグ平面を設定（カメラの向きに垂直な平面）
        const camera = cameraRef.current;
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        dragPlane.current.setFromNormalAndCoplanarPoint(
          cameraDirection.negate(),
          clickPoint
        );

        // ドラッグ開始位置を記録
        dragStartPosition.current.copy(clickPoint);

        // マウスイベントの伝播を停止
        event.preventDefault();
        event.stopPropagation();
      }

      ;
      if (event.button === 2 && event.ctrlKey) {
        // Ctrl + 右クリック → PAN
        controlsRef.current.mouseButtons.RIGHT = THREE.MOUSE.PAN;
      } else if (event.button === 2) {
        // 通常の右クリック → ROTATE
        controlsRef.current.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      }

    }
  };

  // マウスアップハンドラー
  const handleMouseUp = (event) => {
    if (event.button === 0) { // 左クリックのみ
      if (showSubViewsRef.current && subViewPanelRef.current) {
        const rect = mountRef.current.getBoundingClientRect();
        const handled = subViewPanelRef.current.handlePointerUp({
          clientX: event.clientX,
          clientY: event.clientY,
          rect
        });
        if (handled) {
          return;
        }
      }
      // 左shiftキーが押されている場合は距離計測を優先
      if (event.shiftKey) {
        return;
      }

      if (enableCrossSectionMode) {
        if (sectionIsDraggingRef.current && sectionDragTargetRef.current && sectionDragStartPointRef.current && crossSectionRef.current) {
          const dragStart = sectionDragStartPointRef.current.clone();
          const dragEnd = (sectionDragEndPointRef.current || sectionDragStartPointRef.current).clone();
          const dragDirection = dragEnd.sub(dragStart);
          dragDirection.y = 0;
          if (dragDirection.lengthSq() > 1e-8) {
            const geo = terrainViewerRef.current.terrainMeshRef?.geometry;
            crossSectionRef.current.createCrossSection(
              sectionDragTargetRef.current,
              dragStart,
              objectsRef,
              geo,
              0,
              true,
              dragDirection
            );
            skipNextSectionClickRef.current = true;
          }
        }
        sectionDragPendingRef.current = false;
        sectionIsDraggingRef.current = false;
        sectionDragStartPointRef.current = null;
        sectionDragEndPointRef.current = null;
        sectionDragTargetRef.current = null;
        clearSectionDragPreviewLine();
        return;
      }

      // しきい値未満で離した場合は「クリック」扱い
      if (pendingDragRef.current) {
        pendingDragRef.current = false;
        isDragging.current = false;
        return;
      }

      if (isDragging.current && selectedMeshRef.current) {
        updatePipelineInfoDisplay();

        // オブジェクトデータ管理に編集を登録。
        objectRegistry.editObject(selectedMeshRef.current);
      }
      isDragging.current = false;
      pendingDragRef.current = false;
    }
  };

  // 管路情報表示を更新する関数
  const updatePipelineInfoDisplay = () => {
    if (selectedMeshRef.current && selectedMeshRef.current.userData.objectData) {
      // 選択されたオブジェクトの位置を更新
      const currentObjectData = selectedMeshRef.current.userData.objectData;
      const updatedObject = { ...currentObjectData };
      const position = selectedMeshRef.current.position;

      // 位置情報を更新
      if (updatedObject.geometry && updatedObject.geometry[0]) {
        const geom = { ...updatedObject.geometry[0] };
        const isExtrude = Array.isArray(geom?.extrudePath) && geom.extrudePath.length >= 2;
        if (isExtrude) {
          const lastDragPos = selectedMeshRef.current.userData.lastDragPos || position.clone();
          const delta = position.clone().sub(lastDragPos);
          if (delta.lengthSq() > 0) {
            // Extrusionの場合、extrudePathはm単位で保持されている
            // deltaData[2]はm単位（下移動で減少）
            const deltaData = [delta.x, -delta.z, -delta.y];
            const oldCenter = getOldCenterFromGeom(geom);
            const newCenter = [
              oldCenter[0] + deltaData[0],
              oldCenter[1] + deltaData[1],
              oldCenter[2] + deltaData[2],
            ];
            geom.center = newCenter;
            geom.extrudePath = geom.extrudePath.map(point => [
              point[0] + deltaData[0],
              point[1] + deltaData[1],
              point[2] + deltaData[2],
            ]);
            
            // start/end_point_depth(cm) もドラッグに追従させる
            // 下移動(delta.y < 0) → extrudePath[2]が減少 → 深さ(正値cm)が増加
            // deltaData[2] = -delta.y (m単位)なので、cm単位のdepth変化は -delta.y * 100
            if (updatedObject.attributes) {
              const attrs = { ...updatedObject.attributes };
              if (attrs.start_point_depth != null) {
                attrs.start_point_depth = Number(attrs.start_point_depth) - delta.y * 100;
              }
              if (attrs.end_point_depth != null) {
                attrs.end_point_depth = Number(attrs.end_point_depth) - delta.y * 100;
              }
              updatedObject.attributes = attrs;
            }
          }
          selectedMeshRef.current.userData.lastDragPos = position.clone();
        } else {
          // デルタベースで更新（絶対座標変換による radius 分のズレを防ぐ）
          // handleMouseDown で lastDragPos は初期化済み
          const lastDragPos = selectedMeshRef.current.userData.lastDragPos || position.clone();
          const delta = position.clone().sub(lastDragPos);
          if (delta.lengthSq() > 0) {
            const oldCenter = getOldCenterFromGeom(geom);
            // Three.jsワールド座標系 → データ座標系への変換:
            //   X(東西)はそのまま, Z(南北)は符号反転, Y(鉛直m)×100 → データZ(cm)
            // 上移動(delta.y > 0) → 深さ減少 → vertices[*][2] (cm, 負値) が増加(0方向)
            const dX = delta.x;
            const dY = -delta.z;
            const dZ = delta.y * 100; // m → cm
            const newCenter = [oldCenter[0] + dX, oldCenter[1] + dY, oldCenter[2] + dZ];
            geom.center = newCenter;

            if (geom.vertices && geom.vertices.length > 0) {
              geom.vertices = geom.vertices.map(vertex => [
                vertex[0] + dX,
                vertex[1] + dY,
                vertex[2] + dZ,
              ]);
            }

            // start/end_point_depth(cm) もドラッグに追従させる
            // 上移動(delta.y > 0) → 深さ(正値cm)が減少
            if (updatedObject.attributes) {
              const attrs = { ...updatedObject.attributes };
              if (attrs.start_point_depth != null) {
                attrs.start_point_depth = Number(attrs.start_point_depth) - delta.y * 100;
              }
              if (attrs.end_point_depth != null) {
                attrs.end_point_depth = Number(attrs.end_point_depth) - delta.y * 100;
              }
              updatedObject.attributes = attrs;
            }
          }
          selectedMeshRef.current.userData.lastDragPos = position.clone();
        }

        // 更新されたgeometryを設定
        updatedObject.geometry = [geom];
      }

      // userDataを更新して永続化
      selectedMeshRef.current.userData.objectData = updatedObject;
      // 画面表示も更新
      setSelectedObject(updatedObject);
    }
  };

  // アウトライン表示関数
  const showOutline = (mesh) => {
    // 既存のアウトラインを削除
    clearOutline();

    if (!mesh || !sceneRef.current || !mesh.geometry) return;

    try {
      // EdgesGeometryでエッジを抽出（閾値角度を大きくして外枠のみ）
      const edges = new THREE.EdgesGeometry(
        mesh.geometry,
        SCENE3D_CONFIG.outline.edgeAngleThreshold
      );
      const outlineMaterial = new THREE.LineBasicMaterial({
        color: SCENE3D_CONFIG.outline.color,
        linewidth: SCENE3D_CONFIG.outline.lineWidth,
        depthTest: false,  // 常に前面に表示
        depthWrite: false
      });

      const outline = new THREE.LineSegments(edges, outlineMaterial);

      // 元メッシュのワールド変換をそのまま反映（親階層の有無に依存しない）
      mesh.updateMatrixWorld(true);
      const worldPosition = new THREE.Vector3();
      const worldQuaternion = new THREE.Quaternion();
      const worldScale = new THREE.Vector3();
      mesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
      outline.position.copy(worldPosition);
      outline.quaternion.copy(worldQuaternion);
      outline.scale.copy(worldScale);

      sceneRef.current.add(outline);
      outlineHelperRef.current = outline;
    } catch (error) {
      console.error('Failed to create outline:', error);
    }
  };

  // アウトライン削除関数
  const clearOutline = () => {
    if (outlineHelperRef.current && sceneRef.current) {
      sceneRef.current.remove(outlineHelperRef.current);
      if (outlineHelperRef.current.geometry) {
        outlineHelperRef.current.geometry.dispose();
      }
      if (outlineHelperRef.current.material) {
        outlineHelperRef.current.material.dispose();
      }
      outlineHelperRef.current = null;
    }
  };

  const clearSectionDragPreviewLine = () => {
    if (!sectionDragPreviewLineRef.current || !sceneRef.current) return;
    sceneRef.current.remove(sectionDragPreviewLineRef.current);
    sectionDragPreviewLineRef.current.geometry?.dispose();
    sectionDragPreviewLineRef.current.material?.dispose();
    sectionDragPreviewLineRef.current = null;
  };

  const drawSectionDragPreviewLine = (startPos, endPos) => {
    if (!sceneRef.current || !startPos || !endPos) return;
    const direction = new THREE.Vector3().subVectors(endPos, startPos);
    const length = direction.length();
    if (length <= 1e-6) {
      clearSectionDragPreviewLine();
      return;
    }

    clearSectionDragPreviewLine();

    const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
    const geometry = new THREE.PlaneGeometry(length, 0.15);
    const material = new THREE.MeshBasicMaterial({
      color: 0xff0000,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
      side: THREE.DoubleSide
    });
    const previewLine = new THREE.Mesh(geometry, material);
    previewLine.position.copy(midPoint);
    previewLine.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), direction.normalize());
    sceneRef.current.add(previewLine);
    sectionDragPreviewLineRef.current = previewLine;
  };

  // クリックハンドラー
  const handleClick = (event) => {
    if (isSubViewInteraction(event)) {
      return;
    }


    // 左shiftキーが押されている場合は距離計測を優先
    if (event.shiftKey) {
      return;
    }
    if (enableCrossSectionMode && skipNextSectionClickRef.current) {
      skipNextSectionClickRef.current = false;
      return;
    }

    // 管路情報表示エリア内のクリックは無視
    if (event.target.closest('.pipeline-info-display') ||
      event.target.closest('.pipeline-info-text') ||
      event.target.closest('.camera-info-container')) {
      return;
    }

    // クリックされた要素が3Dシーンのレンダリング領域内かチェック
    if (event.target !== rendererRef.current?.domElement) {
      return;
    }
    const rect = mountRef.current.getBoundingClientRect();
    mouseRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouseRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycasterRef.current.setFromCamera(mouseRef.current, cameraRef.current);
    const intersects = raycasterRef.current.intersectObjects(
      Object.values(objectsRef.current),
      false
    );

    // visible: true のオブジェクトのみをフィルタリング
    const visibleIntersects = intersects.filter(intersect => intersect.object.visible);

    if (visibleIntersects.length > 0) {
      const clickedObject = visibleIntersects[0].object;
      const clickPoint = visibleIntersects[0].point; // クリックした位置の3D座標
      if (clickedObject.userData.objectData) {
        // 標高情報を取得
        const geo = terrainViewerRef.current.terrainMeshRef?.geometry;
        // 断面モードの場合は断面を生成
        if (autoModeEnabledRef.current) {
          // 断面表示を確実にクリア
          if (crossSectionRef.current) {
            crossSectionRef.current.clearCrossSectionTerrainLine();
            crossSectionRef.current.clear();
          }

          setSelectedObject(clickedObject.userData.objectData);
          selectedMeshRef.current = clickedObject;

          // アウトライン表示を更新
          showOutline(clickedObject);
        } else if (enableCrossSectionMode && crossSectionRef.current) {
          // 断面生成
          crossSectionRef.current.createCrossSection(clickedObject, clickPoint, objectsRef, geo);
          console.log('断面を生成:', clickedObject.userData.objectData, 'クリック位置:', clickPoint);

        } else {
          // 通常モードの場合は選択
          setSelectedObject(clickedObject.userData.objectData);
          selectedMeshRef.current = clickedObject;

          // アウトライン表示を更新
          showOutline(clickedObject);
          // 生成された断面から、クリック位置に最も近い断面の位置を使用して断面を生成
          if (generatedSections && generatedSections.length > 0 && crossSectionRef.current) {
            // クリック位置に最も近い断面を探す
            let closestSection = null;
            let minDistance = Infinity;

            generatedSections.forEach(section => {
              const sectionPos = new THREE.Vector3(section.position.x, section.position.y, section.z);
              const distance = clickPoint.distanceTo(sectionPos);
              if (distance < minDistance) {
                minDistance = distance;
                closestSection = section;
              }
            });

            if (closestSection) {
              // 断面の位置を使用して断面を生成
              const sectionClickPoint = new THREE.Vector3(
                closestSection.position.x,
                closestSection.position.y,
                closestSection.z
              );
              const gridAngle = closestSection.angle || 0;
              crossSectionRef.current.createCrossSection(clickedObject, sectionClickPoint, objectsRef, geo, gridAngle, true);
            }
          }
        }
      }
    } else {
      if (enableCrossSectionMode && crossSectionRef.current) {
        // 断面図生成画面、何もしない
      } else {
        // 選択状態を解除。
        setSelectedObject(null);
        selectedMeshRef.current = null;
        clearOutline();
      }
    }
  };

  const handleDoubleClick = (event) => {
    if (!showSubViewsRef.current || !subViewPanelRef.current || !mountRef.current) return;
    const rect = mountRef.current.getBoundingClientRect();
    const handled = subViewPanelRef.current.handleDoubleClick({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      followEnabled: subViewFollowEnabledRef.current,
      selectedMesh: selectedMeshRef.current
    });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const handleMouseWheel = (event) => {
    if (!showSubViewsRef.current || !subViewPanelRef.current || !mountRef.current) return;
    const rect = mountRef.current.getBoundingClientRect();
    const handled = subViewPanelRef.current.handleWheel({
      clientX: event.clientX,
      clientY: event.clientY,
      rect,
      deltaY: event.deltaY
    });
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  // 追加ボタンのハンドラー
  const handleAdd = (objectData) => {

    if (!selectedMeshRef.current) return;

    const mesh = selectedMeshRef.current;

    if (!isPipeObject(mesh.userData.objectData)) {
      message.warning("選択したオブジェクトは、追加機能をサポートしていません。 配管状オブジェクトを選択してください。");
      return;
    }

    const objectKey = Object.keys(objectsRef.current).find(
      key => objectsRef.current[key] === mesh
    );

    // 元データを取得。
    const templateData = objectRegistry.getObjectDataOnScene(objectKey);
    if (!templateData) {
      //　オブジェクトが無い
      return false;
    }

    // オブジェクト追加モードに入る
    enterAddMode(sceneRef.current,
      rendererRef.current,
      cameraRef.current,
      floorRef.current,
      (result) => {
        const vertices = result.vertices;
        const geom = templateData?.geometry?.[0];
        const isPolyhedronTemplate =
          templateData?.shape_type === 25 ||
          geom?.type === 'Polyhedron';
        const isExtrusionTemplate =
          templateData?.shape_type === 21 ||
          geom?.type === 'Extrusion' ||
          geom?.type === 'ExtrudeGeometry' ||
          (Array.isArray(geom?.extrudePath) && geom.extrudePath.length >= 2);

        if (isPolyhedronTemplate) {
          const p1 = vertices?.[0];
          const p2 = vertices?.[1];
          if (!Array.isArray(p1) || !Array.isArray(p2)) {
            message.warning("Polyhedron追加には2点以上の指定が必要です。");
            return;
          }
          const added = objectRegistry.addPolyhedronObject(templateData, p1, p2);
          const addedMesh = createCityObjects(added.object, cityObjectState.shapeTypeMap);
          if (addedMesh) {
            sceneRef.current.add(addedMesh);
            objectsRef.current[added.key] = addedMesh;
            applyStyle(addedMesh);
          }
          return;
        }

        if (isExtrusionTemplate) {
          const added = objectRegistry.addPipeObject(templateData, vertices);
          const addedMesh = createCityObjects(added.object, cityObjectState.shapeTypeMap);
          if (addedMesh) {
            sceneRef.current.add(addedMesh);
            objectsRef.current[added.key] = addedMesh;
            applyStyle(addedMesh);
          }
          return;
        }

        for (let i = 0; i < vertices.length - 1; i++) {
          const v1 = vertices[i];
          const v2 = vertices[i + 1];
          const added = objectRegistry.addPipeObject(templateData, [v1, v2]);

          const addedMesh = createCityObjects(added.object, cityObjectState.shapeTypeMap);
          if (addedMesh) {
            sceneRef.current.add(addedMesh);
            objectsRef.current[added.key] = addedMesh;
            applyStyle(addedMesh);
          }
        }
      })
  }

  // 削除ボタンのハンドラー
  const handleDelete = async (objectData) => {
    if (!selectedMeshRef.current) return;

    const mesh = selectedMeshRef.current;
    const objectKey = objectRegistry.getObjectKey(mesh);
    if (!objectKey) return;

    // 新規追加オブジェクトはDB未登録なので、ローカル状態とシーンから即時削除する
    if (objectRegistry.isAddedObject(objectKey)) {
      const removed = objectRegistry.removeAddedObject(objectKey);
      if (!removed) return;

      deleteMesh(mesh);
      setSelectedObject(null);
      selectedMeshRef.current = null;
      clearOutline();
      message.success("オブジェクトを削除しました。");
      return;
    }

    // レジストリに削除登録
    const deleteTargetKey = objectRegistry.deleteObject(mesh);
    if (!deleteTargetKey) {
      return;
    }

    // 削除対象のみをDB反映
    const isDeleted = await objectRegistry.commitDeleteByKey(deleteTargetKey);
    if (!isDeleted) {
      objectRegistry.rollback(deleteTargetKey);
      return;
    }

    // シーンからオブジェクトを削除
    deleteMesh(mesh);

    // 選択状態を解除。
    setSelectedObject(null);
    selectedMeshRef.current = null;
    clearOutline();
  }

  // メッシュを削除
  const deleteMesh = (mesh) => {
    const scene = sceneRef.current;

    // シーンから削除
    scene.remove(mesh);

    // ジオメトリを破棄
    if (mesh.geometry) {
      mesh.geometry.dispose();
    }

    // マテリアルを破棄
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach(mat => mat.dispose());
      } else {
        mesh.material.dispose();
      }
    }

    // テクスチャを破棄（有れば）
    if (mesh.material && mesh.material.map) {
      mesh.material.map.dispose();
    }

    const objectKey = objectRegistry.getObjectKey(mesh);
    delete objectsRef.current[objectKey];
  }

  // 登録ボタンのハンドラー
  const handleRegister = async (objectData, inputValues) => {
    const committed = await objectRegistry.commit();
    if (!committed) return;

    // 登録後、サーバー採番された feature_id を表示へ即時反映する
    if (selectedMeshRef.current?.userData?.objectData) {
      setSelectedObject(JSON.parse(JSON.stringify(selectedMeshRef.current.userData.objectData)));
    }
  }

  // 複製ボタンのハンドラー
  const handleDuplicate = (objectData) => {
    if (!selectedMeshRef.current) return;

    const mesh = selectedMeshRef.current;

    const objectKey = Object.keys(objectsRef.current).find(
      key => objectsRef.current[key] === mesh
    );

    // 元データを取得。
    const templateData = objectRegistry.getObjectDataOnScene(objectKey);
    if (!templateData) {
      //　オブジェクトが無い
      return false;
    }

    const result = objectRegistry.duplicateObject(templateData, 3);

    const duplicatedMesh = createCityObjects(result.object, cityObjectState.shapeTypeMap);
    if (duplicatedMesh) {
      sceneRef.current.add(duplicatedMesh);
      objectsRef.current[result.key] = duplicatedMesh;
      applyStyle(duplicatedMesh);
      setSelectedObject(duplicatedMesh.userData.objectData);
      selectedMeshRef.current = duplicatedMesh;
    }
  }

  // 全復元ボタンのハンドラー
  const handleRestoreAll = (objectData) => {
    const perfNow =
      (typeof performance !== "undefined" && typeof performance.now === "function")
        ? () => performance.now()
        : () => Date.now();
    const startedAt = perfNow();
    const label = `restoreAll ${new Date().toISOString()}`;
    console.time(label);

    // シーン上の「変更があったオブジェクト」のみ復元
    const restoreLoopStartedAt = perfNow();
    const changedKeys = objectRegistry.getChangedObjectKeys();
    changedKeys.forEach(key => {
      const mesh = objectsRef.current[key];
      if (!mesh) return;
      // 移動したオブジェクトの位置を戻す
      const restored = restoreObject(key, mesh);
      if (!restored) {
        // 復元できなかったオブジェクトは新規追加したオブジェクトなので削除する
        deleteMesh(mesh);
      }
    });
    console.log(`[restoreAll] restore loop: ${(perfNow() - restoreLoopStartedAt).toFixed(1)}ms`);

    // 削除したオブジェクトを復帰する
    const reviveStartedAt = perfNow();
    const originalKeys = objectRegistry.getOrginalDataKeys();
    originalKeys.forEach(key => {
      // 現在のシーンに存在しない場合（削除済み）
      if (!(key in objectsRef.current)) {
        const originalData = objectRegistry.getOrginalData(key);
        if (originalData) {
          console.log("シーンからオブジェクトが削除済です");
          const restoredMesh = createCityObjects(originalData, cityObjectState.shapeTypeMap);
          if (restoredMesh) {
            sceneRef.current.add(restoredMesh);
            objectsRef.current[key] = restoredMesh;
            applyStyle(restoredMesh);
          }
        }
      }
    });
    console.log(`[restoreAll] revive deleted objects: ${(perfNow() - reviveStartedAt).toFixed(1)}ms`);

    const rollbackStartedAt = perfNow();
    objectRegistry.rollbackAll();
    console.log(`[restoreAll] registry rollbackAll: ${(perfNow() - rollbackStartedAt).toFixed(1)}ms`);

    console.timeEnd(label);
    console.log(`[restoreAll] total: ${(perfNow() - startedAt).toFixed(1)}ms`);
  }

  // 復元ボタンのハンドラー
  const handleRestore = (objectData) => {
    if (!selectedMeshRef.current) return;

    const mesh = selectedMeshRef.current;
    const objectKey = Object.keys(objectsRef.current).find(
      key => objectsRef.current[key] === mesh
    );

    restoreObject(objectKey, mesh);
    objectRegistry.rollback(objectKey);
  }

  // 復元処理
  const restoreObject = (objectKey, mesh) => {
    // 元データを取得。
    const originalData = objectRegistry.getRestoreBaseData(objectKey);
    if (!originalData) {
      //　オブジェクトが無い
      return false;
    }

    // メッシュの位置と形状を元に戻す
    const originalGeom = originalData.geometry?.[0];
    if (!originalGeom) {
      return false;
    }

    // Extrusionは extrudePath からジオメトリが生成されるため、
    // 入力編集後はメッシュを再生成しないと「復元しても形状/位置が戻らない」状態になり得る。
    // そのため、元データからメッシュを作り直して復元する。
    const isExtrude = Array.isArray(originalGeom?.extrudePath) && originalGeom.extrudePath.length >= 2;
    if (isExtrude) {
      // 当該のオブジェクトはいったん削除する
      deleteMesh(mesh);

      // 新しくオブジェクトを作成・再配置する（handlnputEdited と同じ方針）
      const restoredMesh = createCityObjects(originalData, cityObjectState.shapeTypeMap);
      if (restoredMesh) {
        sceneRef.current.add(restoredMesh);
        objectsRef.current[objectKey] = restoredMesh;
        applyStyle(restoredMesh);
        setSelectedObject(restoredMesh.userData.objectData);
        selectedMeshRef.current = restoredMesh;
        showOutline(restoredMesh);
        return true;
      }
      return false;
    }

    // geometry.vertices を持つものは「線状形状」とみなす（管路・Boxなど）
    if (originalGeom.vertices && originalGeom.vertices.length >= 2) {
      const start = originalGeom.vertices[0];
      const end = originalGeom.vertices[originalGeom.vertices.length - 1];

      // Box（shape_type === 14）は作成時と同じロジックで復元する
      if (originalData.shape_type === 14) {
        const heightAttr = Number(originalData.attributes?.height);
        const boxRadius = Number.isFinite(heightAttr) ? heightAttr / 2 : 0;

        // Geometry.getStartEndPoints と同じ座標変換ロジック（depth属性は通常無し）
        const startPoint = new THREE.Vector3(start[0], start[2] + boxRadius, -start[1]);
        const endPoint = new THREE.Vector3(end[0], end[2] + boxRadius, -end[1]);

        const center = startPoint.clone().add(endPoint).multiplyScalar(0.5);
        mesh.position.copy(center);

        const direction = endPoint.clone().sub(startPoint).normalize();
        // Box は Z 軸(0,0,1) から direction への回転で配置している
        const upForBox = new THREE.Vector3(0, 0, 1);
        const quaternion = new THREE.Quaternion().setFromUnitVectors(upForBox, direction);
        mesh.setRotationFromQuaternion(quaternion);

        // スケールをリセット
        mesh.scale.set(1, 1, 1);
      } else {
        // Box以外の線状形状（Cylinder / MultiCylinder など）は
        // 編集時にジオメトリ自体が変わるため、元データから再生成して復元する。
        deleteMesh(mesh);
        const restoredMesh = createCityObjects(originalData, cityObjectState.shapeTypeMap);
        if (restoredMesh) {
          sceneRef.current.add(restoredMesh);
          objectsRef.current[objectKey] = restoredMesh;
          applyStyle(restoredMesh);
          setSelectedObject(restoredMesh.userData.objectData);
          selectedMeshRef.current = restoredMesh;
          showOutline(restoredMesh);
          return true;
        }
        return false;
      }
    } else {
      // パイプ状以外の場合
      const shapeTypeName = cityObjectState.shapeTypeMap?.[String(originalData.shape_type)] || originalGeom.type;
      
      // Polyhedron（shape_type === 25）の場合
      if (shapeTypeName === 'Polyhedron' || originalGeom.type === 'Polyhedron') {
        // Polyhedronは入力編集で頂点形状自体が変わるため、元データから再生成して復元する。
        deleteMesh(mesh);
        const restoredMesh = createCityObjects(originalData, cityObjectState.shapeTypeMap);
        if (restoredMesh) {
          sceneRef.current.add(restoredMesh);
          objectsRef.current[objectKey] = restoredMesh;
          applyStyle(restoredMesh);
          setSelectedObject(restoredMesh.userData.objectData);
          selectedMeshRef.current = restoredMesh;
          showOutline(restoredMesh);
          return true;
        }
        return false;
      } else {
        // ExtrudeGeometry（shape_type === 21, "Extrusion"）やその他の形状
        let originalCenter = originalGeom.center || originalGeom.position || originalGeom.start || originalGeom.vertices?.[0] || [0, 0, 0];
        mesh.position.set(originalCenter[0], originalCenter[2], -originalCenter[1]);
        
        // ExtrudeGeometryの場合は回転も復元
        if (originalGeom.type === 'ExtrudeGeometry' || shapeTypeName === 'Extrusion') {
          const baseRot = originalGeom.rotation ? new THREE.Quaternion().fromArray(originalGeom.rotation) : new THREE.Quaternion();
          const rot90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
          mesh.quaternion.copy(rot90).multiply(baseRot);
        } else {
          // その他の形状は回転をリセット
          mesh.quaternion.set(0, 0, 0, 1);
        }
        // スケールをリセット
        mesh.scale.set(1, 1, 1);
      }
    }

    // userDataを元に戻す
    mesh.userData.objectData = JSON.parse(JSON.stringify(originalData));
    setSelectedObject(JSON.parse(JSON.stringify(originalData)));

    return true;

  };

  // 3Dオブジェクトのパラメータ編集時のイベントハンドラ
  const handlnputEdited = (changedValues) => {

    if (!selectedMeshRef.current) return;

    const mesh = selectedMeshRef.current;

    if (!isPipeObject(mesh.userData.objectData)) {
      message.warning("選択したオブジェクトは、パラメータ編集をサポートしていません。 配管状オブジェクトを選択してください。");
      return;
    }

    const result = objectRegistry.editPipeObject(mesh, changedValues);

    if (!result) {
      console.log("オブジェクトのパラメータ編集に失敗しました");
      return;
    }

    const objectKey = result.key;
    const editedData = result.object;

    // 当該のオブジェクトはいったん削除する
    deleteMesh(mesh);

    // 新しくオブジェクトを作成・再配置する
    const newMesh = createCityObjects(editedData, cityObjectState.shapeTypeMap);
    if (newMesh) {
      sceneRef.current.add(newMesh);
      objectsRef.current[objectKey] = newMesh;
      applyStyle(newMesh);
      setSelectedObject(newMesh.userData.objectData);
      selectedMeshRef.current = newMesh;
      showOutline(newMesh);
    } else {
      clearOutline();
      selectedMeshRef.current = null;
    }
  }

  // キーボード操作
  const handleKeyDown = async (event) => {
    // 入力欄にフォーカスがある場合は無視
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      if (!event.repeat) {
        toggleCameraProjection();
      }
      return;
    }

    // Mキー : 自己位置をサーバーに送信（暫定）
    if (event.key.toLowerCase() === 'm') {
      event.preventDefault();
      if (!event.repeat) {
        await sendCameraDataToServer();
      }
      return;
    }

    // Zキー (デバッグ用) メッシュデータをダンプ
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (!event.repeat) {
        // オブジェクト情報をファイルにダンプ
        objectRegistry.dumpAll();
      }
      return;
    }

    // 4キー/Bキーは長押しリピートを無視
    if ((event.key === '4' || event.key.toLowerCase() === 'b') && event.repeat) {
      return;
    }

    keysPressed.current[event.key.toLowerCase()] = true;
  };

  const handleKeyUp = (event) => {
    // 入力欄にフォーカスがある場合は無視
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      return;
    }
    keysPressed.current[event.key.toLowerCase()] = false;
  };

  // 初期化
  useEffect(() => {
    if (!mountRef.current) return;
    console.log(Object.keys(cityJsonData.CityObjects).length);
    // シーンの作成
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // 背景をSkyに変更（nullで透明に）
    scene.background = hideBackground
      ? new THREE.Color(SCENE3D_CONFIG.scene.backgroundColor)
      : null;

    // フォグを追加して深度感を出す
    if (!hideBackground) {
      scene.fog = new THREE.Fog(
        SCENE3D_CONFIG.scene.fog.color,
        SCENE3D_CONFIG.scene.fog.near,
        SCENE3D_CONFIG.scene.fog.far
      );
    }

    // カメラ切替用のリグ（両カメラを子として保持）
    const cameraRig = new THREE.Group();
    cameraRigRef.current = cameraRig;

    const perspectiveCamera = new THREE.PerspectiveCamera(
      SCENE3D_CONFIG.camera.fov,
      mountRef.current.clientWidth / mountRef.current.clientHeight,
      SCENE3D_CONFIG.camera.near,
      SCENE3D_CONFIG.camera.far
    );
    perspectiveCamera.position.set(
      SCENE3D_CONFIG.camera.initialPosition.x,
      SCENE3D_CONFIG.camera.initialPosition.y,
      SCENE3D_CONFIG.camera.initialPosition.z
    );
    perspectiveCamera.lookAt(0, 0, 0);
    perspectiveCamera.updateMatrixWorld();
    initialCameraPosition.current.copy(perspectiveCamera.position);
    initialCameraRotation.current.copy(perspectiveCamera.rotation);
    cameraRef.current = perspectiveCamera;
    perspectiveCameraRef.current = perspectiveCamera;
    activeCameraTypeRef.current = 'perspective';

    const orthographicCamera = new THREE.OrthographicCamera(
      SCENE3D_CONFIG.camera.orthographic.left,
      SCENE3D_CONFIG.camera.orthographic.right,
      SCENE3D_CONFIG.camera.orthographic.top,
      SCENE3D_CONFIG.camera.orthographic.bottom,
      SCENE3D_CONFIG.camera.near,
      SCENE3D_CONFIG.camera.far
    );
    orthographicCamera.position.copy(perspectiveCamera.position);
    orthographicCamera.quaternion.copy(perspectiveCamera.quaternion);
    orthographicCamera.updateMatrixWorld();
    orthographicCameraRef.current = orthographicCamera;

    cameraRig.add(perspectiveCamera);
    cameraRig.add(orthographicCamera);
    scene.add(cameraRig);

    updateOrthographicFrustum(perspectiveCamera);

    // レンダラーの作成
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance"
    });
    renderer.setSize(mountRef.current.clientWidth, mountRef.current.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    // トーンマッピング設定（EffectComposer使用時の色と明るさを正確に）
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = SCENE3D_CONFIG.renderer.toneMappingExposure;

    // WebGLコンテキスト喪失のハンドリング
    const handleContextLost = (event) => {
      event.preventDefault();
      console.warn('WebGL context lost. Preventing default behavior.');
    };

    const handleContextRestored = () => {
      console.log('WebGL context restored.');
    };

    renderer.domElement.addEventListener('webglcontextlost', handleContextLost, false);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored, false);

    mountRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // OrbitControlsの初期化
    const controls = new OrbitControls(cameraRef.current, renderer.domElement);
    controls.enableDamping = false;
    // controls.dampingFactor = 0.05;
    controls.enableZoom = true;
    controls.enablePan = true;
    controls.enableRotate = true;

    // ターゲットの制約を緩和して自由なカメラ移動を実現
    controls.target.set(
      SCENE3D_CONFIG.controls.initialTarget.x,
      SCENE3D_CONFIG.controls.initialTarget.y,
      SCENE3D_CONFIG.controls.initialTarget.z
    );
    controls.maxDistance = SCENE3D_CONFIG.controls.maxDistance;
    controls.minDistance = SCENE3D_CONFIG.controls.minDistance;
    controls.maxPolarAngle = SCENE3D_CONFIG.controls.maxPolarAngle;
    controls.minPolarAngle = SCENE3D_CONFIG.controls.minPolarAngle;

    // マウス操作の割当: 左クリック無効、右ドラッグ=回転、中クリック=ズーム
    controls.mouseButtons = {
      LEFT: null, // 左クリックを無効化
      MIDDLE: null, // 中クリックは折れ線計測で使用
      RIGHT: null // 右ドラッグ回転は独自実装（向きだけ回転）で行う
    };

    // 操作速度を調整
    controls.rotateSpeed = SCENE3D_CONFIG.controls.rotateSpeed.slow;
    controls.zoomSpeed = SCENE3D_CONFIG.controls.zoomSpeed.slow;
    controls.keyRotateSpeed = SCENE3D_CONFIG.controls.keyRotateSpeed;
    controlsRef.current = controls;
    updateTargetOffsetFromCamera(cameraRef.current);

    // 右ドラッグで「向きだけ」回転（位置固定）
    const handleContextMenu = (event) => {
      // 右クリックメニューを出さない（カメラ回転操作のため）
      event.preventDefault();
    };

    const handleRightDragPointerDown = (event) => {
      // 右ボタンのみ
      if (event.button !== 2) return;
      // 対象はレンダリング領域のみ
      if (event.target !== renderer.domElement) return;

      event.preventDefault();
      event.stopPropagation();

      isRightDraggingRef.current = true;
      rightDragLastPosRef.current = { x: event.clientX, y: event.clientY };

      // 現在のカメラ姿勢を yaw/pitch として取得
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (camera) {
        const euler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        rightDragYawPitchRef.current.yaw = euler.y;
        rightDragYawPitchRef.current.pitch = euler.x;
      }
      // target距離は現在のOrbitControls.targetとの距離を採用
      if (camera && controls) {
        const dist = controls.target.distanceTo(camera.position);
        rightDragYawPitchRef.current.targetDistance = Number.isFinite(dist) && dist > 0.1 ? dist : 10;
      } else {
        rightDragYawPitchRef.current.targetDistance = 10;
      }
    };

    const handleRightDragPointerMove = (event) => {
      if (!isRightDraggingRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      const camera = cameraRef.current;
      if (!camera) return;
      const controls = controlsRef.current;

      const last = rightDragLastPosRef.current;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      rightDragLastPosRef.current = { x: event.clientX, y: event.clientY };

      // 感度（必要なら調整）
      const sensitivity = 0.003;

      // yaw/pitchを更新（yawは無制限）
      rightDragYawPitchRef.current.yaw -= dx * sensitivity;
      rightDragYawPitchRef.current.pitch -= dy * sensitivity;

      // Pitchをクランプ（ひっくり返り防止）
      const pitchLimit = Math.PI / 2 - 0.01;
      rightDragYawPitchRef.current.pitch = Math.max(
        -pitchLimit,
        Math.min(pitchLimit, rightDragYawPitchRef.current.pitch)
      );

      // クォータニオンに反映（rollは0固定）
      const nextEuler = new THREE.Euler(
        rightDragYawPitchRef.current.pitch,
        rightDragYawPitchRef.current.yaw,
        0,
        'YXZ'
      );
      camera.quaternion.setFromEuler(nextEuler);
      camera.updateMatrixWorld();

      // targetを「常にカメラ前方」に置く（位置は固定、向きだけ回転）
      if (controls) {
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
        const dist = rightDragYawPitchRef.current.targetDistance || 10;
        controls.target.copy(camera.position.clone().add(forward.multiplyScalar(dist)));
        controls.update();
      }

      // 以降の移動操作などと整合させるため、オフセットも更新
      updateTargetOffsetFromCamera(camera);
    };

    const handleRightDragPointerUp = (event) => {
      if (event.button !== 2) return;
      if (!isRightDraggingRef.current) return;

      event.preventDefault();
      event.stopPropagation();

      isRightDraggingRef.current = false;
    };

    renderer.domElement.addEventListener('contextmenu', handleContextMenu);
    renderer.domElement.addEventListener('pointerdown', handleRightDragPointerDown);
    renderer.domElement.addEventListener('pointermove', handleRightDragPointerMove);
    window.addEventListener('pointerup', handleRightDragPointerUp);

    // Sky コンポーネントの初期化（コンテナを渡す）
    // 断面図モード（hideBackground: true）の場合はSkyを表示しない（白背景のみ）
    if (!hideBackground) {
      const skyComponent = new SkyComponent(scene, renderer, mountRef.current);
      skyComponentRef.current = skyComponent;
    } else {
      skyComponentRef.current = null;
    }

    const terrainViewer = new GeoTerrainWithJGWTexture(scene, {
      heightScale: 1.0,
      coordinateOffset: { x: -36708.8427, z: 8088.7211 },
      applyVerticalExaggeration: true
    });
    terrainViewerRef.current = terrainViewer;

    // JGWImageLoaderの初期化
    const jgwImageLoader = new JGWImageLoader(scene);
    jgwImageLoaderRef.current = jgwImageLoader;

    // PotreePointCloudViewerの初期化
    // const potreeViewer = new PotreePointCloudViewer(scene, renderer, cameraRef.current, {
    //   visible: potreeVisible,
    //   pointBudget: 1_000_000
    // });
    // potreeViewerRef.current = potreeViewer;

    // ライティングを設定（太陽の位置に合わせて調整）
    const ambientLight = new THREE.AmbientLight(
      hideBackground
        ? SCENE3D_CONFIG.lighting.ambient.color
        : SCENE3D_CONFIG.lighting.ambient.crossSectionColor,
      hideBackground
        ? SCENE3D_CONFIG.lighting.ambient.intensity.crossSection
        : SCENE3D_CONFIG.lighting.ambient.intensity.normal
    );
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(
      SCENE3D_CONFIG.lighting.directional.color,
      hideBackground
        ? SCENE3D_CONFIG.lighting.directional.intensity
        : SCENE3D_CONFIG.lighting.directional.intensityCrossSection
    );
    directionalLight.position.set(
      SCENE3D_CONFIG.lighting.directional.position.x,
      SCENE3D_CONFIG.lighting.directional.position.y,
      SCENE3D_CONFIG.lighting.directional.position.z
    );
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = SCENE3D_CONFIG.lighting.directional.shadowMapSize.width;
    directionalLight.shadow.mapSize.height = SCENE3D_CONFIG.lighting.directional.shadowMapSize.height;
    scene.add(directionalLight);

    // 太陽光の色を調整（暖かい色合い）
    if (!hideBackground) {
      directionalLight.color.setHex(SCENE3D_CONFIG.lighting.directional.sunColor);
    }

    // 追加のライトで色をより明るく
    const additionalLight = new THREE.DirectionalLight(
      SCENE3D_CONFIG.lighting.additional.color,
      SCENE3D_CONFIG.lighting.additional.intensity
    );
    additionalLight.position.set(
      SCENE3D_CONFIG.lighting.additional.position.x,
      SCENE3D_CONFIG.lighting.additional.position.y,
      SCENE3D_CONFIG.lighting.additional.position.z
    );
    scene.add(additionalLight);

    // 断面図の初期化（断面モードが有効な場合）
    if (enableCrossSectionMode) {
      const crossSection = new CrossSectionPlane(
        scene,
        cameraRef.current,
        objectsRef,
        terrainVisible,
        mode,
        verticalLineBaseYConfig
      );
      crossSectionRef.current = crossSection;
    }

    // 距離計測の初期化
    const distanceMeasurement = new DistanceMeasurement(
      scene,
      cameraRef.current,
      renderer,
      objectsRef,
      raycasterRef.current,
      mouseRef.current,
      crossSectionRef,  // CSG断面用のrefを追加
      enableCrossSectionMode  // 断面図生成画面かどうか
    );
    distanceMeasurement.setResultUpdateCallback(setMeasurementResult);
    distanceMeasurement.enable(mountRef.current);
    distanceMeasurementRef.current = distanceMeasurement;

    // 中クリック折れ線計測の初期化
    const polylineMeasurement = new PolylineMeasurement(
      scene,
      cameraRef.current,
      raycasterRef.current,
      () => floorRef.current,
      () => terrainViewerRef.current?.terrainMeshRef
    );
    polylineMeasurement.enable(mountRef.current);
    polylineMeasurementRef.current = polylineMeasurement;

    // イベントリスナー
    mountRef.current.addEventListener('mousemove', handleMouseMove);
    mountRef.current.addEventListener('mousedown', handleMouseDown);
    mountRef.current.addEventListener('mouseup', handleMouseUp);
    mountRef.current.addEventListener('click', handleClick);
    mountRef.current.addEventListener('dblclick', handleDoubleClick);
    renderer.domElement.addEventListener('wheel', handleMouseWheel, { passive: false, capture: true });
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // リサイズハンドラー
    const handleResize = () => {
      if (!mountRef.current) return;
      const width = mountRef.current.clientWidth;
      const height = mountRef.current.clientHeight;

      if (perspectiveCameraRef.current) {
        perspectiveCameraRef.current.aspect = width / height;
        perspectiveCameraRef.current.updateProjectionMatrix();
      }
      updateOrthographicFrustum();
      renderer.setSize(width, height);
      // CrossSectionPlaneのLine2マテリアルのresolutionを更新
      if (crossSectionRef.current) {
        crossSectionRef.current.handleResize(width, height);
      }
    };
    window.addEventListener('resize', handleResize);

    // アニメーションループ
    const animate = () => {
      requestAnimationFrame(animate);

      const camera = cameraRef.current;
      if (!camera) {
        return;
      }

      // 左Shiftキーでマウス操作を低速化
      if (keysPressed.current['shift']) {
        controls.rotateSpeed = SCENE3D_CONFIG.controls.rotateSpeed.slow;
        controls.zoomSpeed = SCENE3D_CONFIG.controls.zoomSpeed.slow;
      } else {
        controls.rotateSpeed = SCENE3D_CONFIG.controls.rotateSpeed.normal;
        controls.zoomSpeed = SCENE3D_CONFIG.controls.zoomSpeed.normal;
      }

      // OrbitControlsの更新
      controls.update();

      // キーボード操作でカメラ移動
      const speed = keysPressed.current['shift']
        ? SCENE3D_CONFIG.movement.slowSpeed
        : SCENE3D_CONFIG.movement.normalSpeed; // Shiftで低速
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);

      let cameraMoved = false;

      // W:上 S:下
      if (keysPressed.current['w'] || keysPressed.current['arrowup']) {
        camera.position.add(up.clone().multiplyScalar(speed));
        cameraMoved = true;
      }
      if (keysPressed.current['s'] || keysPressed.current['arrowdown']) {
        camera.position.add(up.clone().multiplyScalar(-speed));
        cameraMoved = true;
      }

      // A:左 D:右
      if (keysPressed.current['a'] || keysPressed.current['arrowleft']) {
        camera.position.add(right.clone().multiplyScalar(-speed));
        cameraMoved = true;
      }
      if (keysPressed.current['d'] || keysPressed.current['arrowright']) {
        camera.position.add(right.clone().multiplyScalar(speed));
        cameraMoved = true;
      }

      // Q:後進 E:前進
      if (keysPressed.current['q']) {
        camera.position.add(forward.clone().multiplyScalar(-speed));
        cameraMoved = true;
      }
      if (keysPressed.current['e']) {
        camera.position.add(forward.clone().multiplyScalar(speed));
        cameraMoved = true;
      }

      // カメラが移動した場合、ターゲットも動的に更新
      if (cameraMoved) {
        repositionTargetUsingOffset(camera);
      }

      // Y:位置向き初期化
      if (keysPressed.current['y']) {
        camera.position.copy(initialCameraPosition.current);
        repositionTargetUsingOffset(camera);
        camera.rotation.copy(initialCameraRotation.current);
        repositionTargetUsingOffset(camera);
        keysPressed.current['y'] = false;
      }

      // P:向き初期化
      if (keysPressed.current['p']) {
        camera.rotation.copy(initialCameraRotation.current);
        repositionTargetUsingOffset(camera);
        keysPressed.current['p'] = false;
      }

      // O:位置初期化
      if (keysPressed.current['o']) {
        camera.position.copy(initialCameraPosition.current);
        repositionTargetUsingOffset(camera);
        keysPressed.current['o'] = false;
      }

      // L:パン北向き
      if (keysPressed.current['l']) {
        const euler = getEulerYXZFromCamera(camera);
        euler.y = 0;
        applyEulerYXZToCamera(camera, euler);
        repositionTargetUsingOffset(camera);
        keysPressed.current['l'] = false;
      }

      // I:チルト水平
      if (keysPressed.current['i']) {
        const euler = getEulerYXZFromCamera(camera);
        euler.x = 0;
        applyEulerYXZToCamera(camera, euler);
        repositionTargetUsingOffset(camera);
        keysPressed.current['i'] = false;
      }

      // T:チルト真下
      if (keysPressed.current['t']) {
        const euler = getEulerYXZFromCamera(camera);
        euler.y = 0; // yaw
        euler.x = -Math.PI / 2; // pitch
        applyEulerYXZToCamera(camera, euler);
        repositionTargetUsingOffset(camera);
        keysPressed.current['t'] = false;
      }

      // R:チルト水平・高さ初期値
      if (keysPressed.current['r']) {
        // pitch=0（水平）にしつつ、高さ(Y)を全オブジェクトの平均値へ合わせる
        const euler = getEulerYXZFromCamera(camera);
        euler.x = 0;
        applyEulerYXZToCamera(camera, euler);
        const avgY = computeAverageObjectCenterY();
        if (Number.isFinite(avgY)) {
          camera.position.y = avgY;
        } else {
          camera.position.y = initialCameraPosition.current.y;
        }
        repositionTargetUsingOffset(camera);
        keysPressed.current['r'] = false;
      }

      // F:高さ重心
      if (keysPressed.current['f']) {
        // 現在の向きは維持したまま、高さ(Y)のみ全オブジェクトの平均値へ合わせる
        const avgY = computeAverageObjectCenterY();
        if (Number.isFinite(avgY)) {
          camera.position.y = avgY;
        } else {
          camera.position.y = initialCameraPosition.current.y;
        }
        repositionTargetUsingOffset(camera);
        keysPressed.current['f'] = false;
      }

      updateTargetOffsetFromCamera(camera);

      // 1: ガイド表示トグル（左上・左下の情報）
      if (keysPressed.current['1']) {
        setShowGuides((prev) => !prev);
        keysPressed.current['1'] = false;
      }

      // B: Axis HUD表示トグル
      if (keysPressed.current['b']) {
        setShowAxisHud((prev) => !prev);
        keysPressed.current['b'] = false;
      }


      // 7: 管路表示トグル
      if (keysPressed.current['7']) {
        setShowPipes((prev) => {
          const newShowPipes = !prev;
          // 管路と切り口の表示を逆にする
          if (enableCrossSectionMode && crossSectionRef.current) {
            crossSectionRef.current.toggleCrossSections(!newShowPipes);
            // 属性ラベルは「管路非表示時のみ」表示
            if (typeof crossSectionRef.current.toggleAttributeLabels === 'function') {
              crossSectionRef.current.toggleAttributeLabels(!newShowPipes);
            }
          }
          return newShowPipes;
        });
        keysPressed.current['7'] = false;
      }

      // 8: 路面表示トグル
      if (keysPressed.current['8']) {
        setShowRoad((prev) => !prev);
        keysPressed.current['8'] = false;
      }

      // 9: 地表面表示トグル
      if (keysPressed.current['9']) {
        setShowFloor((prev) => !prev);
        keysPressed.current['9'] = false;
      }

      // 2: 背景表示トグル
      if (keysPressed.current['2']) {
        setShowBackground((prev) => !prev);
        keysPressed.current['2'] = false;
      }

      // 3: グリッド線表示トグル（断面図生成画面）
      if (keysPressed.current['3']) {
        if (enableCrossSectionMode && crossSectionRef.current) {
          const nextShow = !crossSectionRef.current.showGridLines;
          crossSectionRef.current.toggleGridLines(nextShow);
        }
        keysPressed.current['3'] = false;
      }

      // 6: 折れ線ラベル表示（区間/累計）トグル
      if (keysPressed.current['6']) {
        if (polylineMeasurementRef.current) {
          polylineMeasurementRef.current.toggleDistanceLabelMode();
        }
        keysPressed.current['6'] = false;
      }

      // ESC: 計測結果と管路情報表示をクリア
      if (keysPressed.current['escape']) {
        // 中クリック折れ線計測がある場合は優先してクリア
        if (polylineMeasurementRef.current && polylineMeasurementRef.current.hasMeasurements()) {
          polylineMeasurementRef.current.clear();
        } else if (distanceMeasurementRef.current && measurementResult) {
          // 離隔計測結果がある場合は計測結果のみクリア
          distanceMeasurementRef.current.clear();
        } else {
          // 計測結果がない場合は管路情報表示をクリア
          setSelectedObject(null);
          selectedMeshRef.current = null;
          // アウトラインをクリア
          clearOutline();
        }
        keysPressed.current['escape'] = false;
      }

      // Backspace: 断面をクリア（断面モードの場合）
      if (keysPressed.current['backspace']) {
        if (enableCrossSectionMode && crossSectionRef.current) {
          crossSectionRef.current.clearCrossSectionTerrainLine();
          crossSectionRef.current.clear();
          console.log('断面をクリア');
        }
        keysPressed.current['backspace'] = false;
      }

      // U:パン重心
      if (keysPressed.current['u']) {
        // 全オブジェクトの中心を向く
        const baseCenter = computeBaseXYCenter();
        const avgY = computeAverageObjectCenterY();
        const center = baseCenter || avgY || centerPosition.current.clone();

        if (baseCenter && avgY) {
          center.y = avgY;
        }
        centerPosition.current.copy(center);
        if (controls) {
          controls.target.copy(center);
          camera.lookAt(center);
          camera.updateMatrixWorld();
          controls.update();
        } else {
          camera.lookAt(center);
          camera.updateMatrixWorld();
        }

        repositionTargetUsingOffset(camera);
        keysPressed.current['u'] = false;
      }

      // J:位置重心
      if (keysPressed.current['j']) {
        // オブジェクト群の中心に向かって、中心に移動する
        const baseCenter = computeBaseXYCenter();
        const baseCenterY = computeAverageObjectCenterY();

        if (baseCenter) {
          camera.position.x = baseCenter.x;
          camera.position.z = baseCenter.z;
        } else {
          camera.position.x = centerPosition.current.x;
          camera.position.z = centerPosition.current.z;
        }

        if (Number.isFinite(baseCenterY)) {
          camera.position.y = baseCenterY;
        }
        repositionTargetUsingOffset(camera);
        keysPressed.current['j'] = false;
      }

      // H:重心向き後進
      if (keysPressed.current['h']) {
        // H:オブジェクト群の中心に向かって、距離を倍増させる
        const baseCenter = computeBaseXYCenter();
        const avgY = computeAverageObjectCenterY();
        const center = (baseCenter || avgY || centerPosition.current.clone()).clone();
        if (baseCenter && avgY) {
          center.y = avgY;
        }
        centerPosition.current.copy(center);

        const offset = camera.position.clone().sub(center);
        if (offset.lengthSq() < 1e-6 || !Number.isFinite(offset.length())) {
          const backward = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
          offset.copy(backward.multiplyScalar(10));
        }
        camera.position.copy(center.clone().add(offset.multiplyScalar(2)));
        // 高さは中心と同じ
        camera.position.y = center.y;

        if (controls) {
          controls.target.copy(center);
        }
        camera.lookAt(center);
        camera.updateMatrixWorld();
        if (controls) {
          controls.update();
        }

        repositionTargetUsingOffset(camera);
        keysPressed.current['h'] = false;
      }

      // G:重心向き前進
      if (keysPressed.current['g']) {
        // H の逆: オブジェクト群の中心に向かって、距離を半減させる
        const baseCenter = computeBaseXYCenter();
        const avgY = computeAverageObjectCenterY();
        const center = (baseCenter || avgY || centerPosition.current.clone()).clone();
        if (baseCenter && avgY) {
          center.y = avgY;
        }
        centerPosition.current.copy(center);

        const offset = camera.position.clone().sub(center);
        const offsetLen = offset.length();
        if (offset.lengthSq() < 1e-6 || !Number.isFinite(offsetLen)) {
          // 既に中心付近なら移動は最小限にして向きだけ合わせる
        } else {
          // 距離を1/2に（中心→カメラ方向は維持）
          camera.position.copy(center.clone().add(offset.multiplyScalar(0.5)));
        }
        // 高さは中心と同じ
        camera.position.y = center.y;

        if (controls) {
          controls.target.copy(center);
        }
        camera.lookAt(center);
        camera.updateMatrixWorld();
        if (controls) {
          controls.update();
        }

        repositionTargetUsingOffset(camera);
        keysPressed.current['g'] = false;
      }

      // K:重心真下
      if (keysPressed.current['k']) {
        // K:オブジェクト群の中心の真上から、真下を見下ろす
        const baseCenter = computeBaseXYCenter();
        const avgY = computeAverageObjectCenterY();
        const center = (baseCenter || avgY || centerPosition.current.clone()).clone();
        if (baseCenter && avgY) {
          center.y = avgY;
        }
        centerPosition.current.copy(center);

        // 可視オブジェクトのX/Z の広がりを取得
        const meshes = Object.values(objectsRef.current || {}).filter(Boolean);
        const box = new THREE.Box3();
        let any = false;
        meshes.forEach((m) => {
          if (!m.visible) return;
          try {
            m.updateWorldMatrix(true, true);
            box.expandByObject(m);
            any = true;
          } catch (_) {
            // ignore
          }
        });

        let maxDistance = 10;
        if (any) {
          const size = new THREE.Vector3();
          box.getSize(size);
          const maxx = Math.abs(size.x) * 0.5;
          const maxz = Math.abs(size.z) * 0.5;
          const d = Math.sqrt(maxx * maxx + maxz * maxz);
          if (Number.isFinite(d) && d > 0.1) maxDistance = d;
        }

        // 「全体が映るくらい」の高さへ（真下視点）
        const fitOffset = 1.2;
        const fovDeg = camera.isPerspectiveCamera ? camera.fov : (perspectiveCameraRef.current ? perspectiveCameraRef.current.fov : SCENE3D_CONFIG.camera.fov);
        const fovRad = THREE.MathUtils.degToRad(Number.isFinite(fovDeg) ? fovDeg : SCENE3D_CONFIG.camera.fov);
        const dist = Math.max((maxDistance * fitOffset) / Math.tan(fovRad * 0.5), SCENE3D_CONFIG.other.minDistance);

        // 真上へ移動
        camera.position.set(center.x, center.y + dist, center.z);

        // 真下を向く
        camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0, 'YXZ'));
        camera.updateMatrixWorld();

        if (controls) {
          controls.target.copy(center);
          controls.update();
        }
        // 正射側も含めて見た目を揃える
        syncCamerasFromActive(camera);
        updateOrthographicFrustum(camera);

        repositionTargetUsingOffset(camera);
        keysPressed.current['k'] = false;
      }

      // 4:断面に正対（断面が生成されている時のみ）
      if (keysPressed.current['4']) {
        if (enableCrossSectionMode && crossSectionRef.current) {
          const center = typeof crossSectionRef.current.getCurrentPlaneCenter === 'function'
            ? crossSectionRef.current.getCurrentPlaneCenter()
            : null;
          const normalRaw = typeof crossSectionRef.current.getCurrentPlaneNormal === 'function'
            ? crossSectionRef.current.getCurrentPlaneNormal()
            : null;

          if (center && normalRaw && normalRaw.lengthSq && normalRaw.lengthSq() > 1e-8) {
            const normal = normalRaw.clone().normalize();

            // 4キー後の「断面からの距離」は固定値
            const dist = Number.isFinite(SCENE3D_CONFIG.camera.sectionViewDistance)
              ? SCENE3D_CONFIG.camera.sectionViewDistance
              : 50;
            // 押すたびに「必ず反対側」へ
            const dot = camera.position.clone().sub(center).dot(normal);
            const hasSide = Number.isFinite(dot) && Math.abs(dot) > 1e-6;
            const currentSide = hasSide ? (dot > 0 ? 1 : -1) : null;
            const side = currentSide ? -currentSide : faceSectionSideSignRef.current;
            faceSectionSideSignRef.current = -side;

            const nextPos = center.clone().add(normal.multiplyScalar(dist * side));
            nextPos.y = SCENE3D_CONFIG.camera.sectionViewHeight;
            camera.position.copy(nextPos);
            camera.up.set(0, 1, 0);

            if (controls) {
              controls.target.copy(center);
            }
            camera.lookAt(center);
            camera.updateMatrixWorld();
            if (controls) {
              controls.update();
            }

            // 正射側も含めて見た目を揃える
            syncCamerasFromActive(camera);
            updateOrthographicFrustum(camera);

            repositionTargetUsingOffset(camera);
          }
        }
        keysPressed.current['4'] = false;
      }

      if (mouseMovedRef.current) {
        mouseMovedRef.current = false;
        // レイキャスティングでホバー検出
        raycasterRef.current.setFromCamera(mouseRef.current, camera);
        const intersects = raycasterRef.current.intersectObjects(
          Object.values(objectsRef.current),
          false
        );

        // visible: true のオブジェクトのみをフィルタリング
        const visibleIntersects = intersects.filter(intersect => intersect.object.visible);

        // 前回ホバーしていたオブジェクトをクリア
        if (hoveredObjectRef.current) {
          document.body.style.cursor = 'default';
          hoveredObjectRef.current = null;
        }

        // 新しくホバーしたオブジェクトを設定（選択中は除外）
        if (visibleIntersects.length > 0) {
          const hoveredObject = visibleIntersects[0].object;
          if (hoveredObject !== selectedMeshRef.current) {
            document.body.style.cursor = 'pointer';
            hoveredObjectRef.current = hoveredObject;
          }
        }
      }

      // カメラ位置情報を更新（位置または回転に変化があった場合のみ）
      const positionChanged = camera.position.distanceTo(previousCameraPosition.current) >
        SCENE3D_CONFIG.other.positionChangeThreshold;
      const rotationChanged =
        Math.abs(camera.rotation.x - previousCameraRotation.current.x) >
        SCENE3D_CONFIG.other.rotationChangeThreshold ||
        Math.abs(camera.rotation.y - previousCameraRotation.current.y) >
        SCENE3D_CONFIG.other.rotationChangeThreshold ||
        Math.abs(camera.rotation.z - previousCameraRotation.current.z) >
        SCENE3D_CONFIG.other.rotationChangeThreshold;

      if (positionChanged || rotationChanged) {
        updateCameraInfoFromCamera(camera);
        if (positionChanged && activeCameraTypeRef.current === 'perspective') {
          updateOrthographicFrustum(camera);
        }

        // 前回の値を更新
        previousCameraPosition.current.copy(camera.position);
        previousCameraRotation.current.copy(camera.rotation);
      }

      // 距離計測の線をカメラに向けて回転
      if (distanceMeasurementRef.current) {
        distanceMeasurementRef.current.update();
      }
      if (polylineMeasurementRef.current) {
        polylineMeasurementRef.current.update();
      }

      // 断面の深さラベルをカメラからの距離に応じて更新
      if (crossSectionRef.current) {
        crossSectionRef.current.update();
      }

      // アウトラインの位置を更新（選択されたメッシュが移動した場合）
      if (outlineHelperRef.current && selectedMeshRef.current) {
        const mesh = selectedMeshRef.current;
        mesh.updateMatrixWorld(true);

        // ワールド座標系で同期（親子関係があってもズレない）
        const worldPosition = new THREE.Vector3();
        const worldQuaternion = new THREE.Quaternion();
        const worldScale = new THREE.Vector3();
        mesh.matrixWorld.decompose(worldPosition, worldQuaternion, worldScale);
        outlineHelperRef.current.position.copy(worldPosition);
        outlineHelperRef.current.quaternion.copy(worldQuaternion);
        outlineHelperRef.current.scale.copy(worldScale);
        outlineHelperRef.current.updateMatrixWorld();
      }

      // Potree点群の更新
      // if (potreeViewerRef.current) {
      //   potreeViewerRef.current.update(camera);
      // }

      // レンダリング（エラーハンドリング付き）
      try {
        syncCamerasFromActive(camera);
        renderer.autoClear = true;
        renderer.render(scene, camera);
        // メイン描画後に同一rendererでサブビュー（3面）を重ね描きする
        if (showSubViewsRef.current && subViewPanelRef.current) {
          const width = mountRef.current?.clientWidth || 0;
          const height = mountRef.current?.clientHeight || 0;
          subViewPanelRef.current.renderSubViews({
            renderer,
            scene,
            mainCamera: camera,
            selectedMesh: selectedMeshRef.current,
            followEnabled: subViewFollowEnabledRef.current,
            canvasWidth: width,
            canvasHeight: height
          });
        }
      } catch (error) {
        console.error('Rendering error:', error);
        // エラー発生時はアニメーションを停止
        return;
      }
    };
    animate();

    // クリーンアップ
    return () => {
      // mountRef.currentを一時変数に保存（null化される前に）
      const currentMount = mountRef.current;

      // 距離計測のクリーンアップ（最初に実行）
      if (distanceMeasurementRef.current && currentMount) {
        try {
          distanceMeasurementRef.current.dispose(currentMount);
        } catch (error) {
          console.error('距離計測のクリーンアップでエラー:', error);
        }
      }
      if (polylineMeasurementRef.current && currentMount) {
        try {
          polylineMeasurementRef.current.dispose(currentMount);
        } catch (error) {
          console.error('折れ線計測のクリーンアップでエラー:', error);
        }
      }

      // 断面図のクリーンアップ
      if (crossSectionRef.current) {
        try {
          crossSectionRef.current.dispose();
        } catch (error) {
          console.error('断面図のクリーンアップでエラー:', error);
        }
      }

      // イベントリスナーの削除
      try {
        window.removeEventListener('resize', handleResize);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
      } catch (error) {
        console.error('windowイベントリスナーの削除でエラー:', error);
      }
      try {
        if (currentMount) {
          currentMount.removeEventListener('mousemove', handleMouseMove);
          currentMount.removeEventListener('mousedown', handleMouseDown);
          currentMount.removeEventListener('mouseup', handleMouseUp);
          currentMount.removeEventListener('click', handleClick);
          currentMount.removeEventListener('dblclick', handleDoubleClick);
        }
      } catch (error) {
        console.error('DOMイベントリスナーの削除でエラー:', error);
      }
      try {
        renderer.domElement.removeEventListener('wheel', handleMouseWheel, true);
      } catch (error) {
        console.error('wheelイベントリスナーの削除でエラー:', error);
      }

      // 右ドラッグ回転用イベントの削除
      try {
        if (renderer?.domElement) {
          renderer.domElement.removeEventListener('contextmenu', handleContextMenu);
          renderer.domElement.removeEventListener('pointerdown', handleRightDragPointerDown);
          renderer.domElement.removeEventListener('pointermove', handleRightDragPointerMove);
        }
        window.removeEventListener('pointerup', handleRightDragPointerUp);
      } catch (error) {
        console.error('右ドラッグ回転イベントの削除でエラー:', error);
      }

      // コンポーネントのクリーンアップ
      if (skyComponentRef.current) {
        skyComponentRef.current.dispose();
      }
      if (terrainViewerRef.current) {
        terrainViewerRef.current.dispose();
      }
      if (jgwImageLoaderRef.current) {
        jgwImageLoaderRef.current.dispose();
      }
      // if (potreeViewerRef.current) {
      //   potreeViewerRef.current.dispose();
      // }
      if (controlsRef.current) {
        controlsRef.current.dispose();
      }

      // アウトラインのクリーンアップ
      clearOutline();
      clearSectionDragPreviewLine();

      // シーン内のすべてのオブジェクトをクリーンアップ
      if (scene) {
        scene.traverse((object) => {
          if (object.geometry) {
            object.geometry.dispose();
          }
          if (object.material) {
            if (Array.isArray(object.material)) {
              object.material.forEach(material => {
                if (material.map) material.map.dispose();
                material.dispose();
              });
            } else {
              if (object.material.map) object.material.map.dispose();
              object.material.dispose();
            }
          }
        });
        scene.clear();
      }

      // レンダラーのクリーンアップ
      if (renderer) {
        // レンダラーのdisposeでイベントリスナーも自動的にクリーンアップされます
        if (currentMount && renderer.domElement.parentNode === currentMount) {
          currentMount.removeChild(renderer.domElement);
        }
        renderer.dispose();
        // forceContextLossはWebGL1のみで利用可能
        if (renderer.forceContextLoss) {
          renderer.forceContextLoss();
        }
        // WebGL2の場合
        const gl = renderer.getContext();
        if (gl && gl.getExtension('WEBGL_lose_context')) {
          gl.getExtension('WEBGL_lose_context').loseContext();
        }
      }
    };
  }, []);

  useEffect(() => {
    // 初期カメラは props.userPositions から設定（App 側でフェッチ済み）
    updateCameraPosition(userPositions[0])
  }, [userPositions]);

  // ユーザー位置情報でカメラ位置を更新する。
  const updateCameraPosition = (userPos) => {
    if (userPos) {
      const regionXY = parsePointWkt(userPos.region_position);
      const height = Number(userPos.region_hight);
      const yawDeg = Number(userPos.yaw);
      const pitchDeg = Number(userPos.pitch);
      const rollDeg = Number(userPos.roll);

      const activeCamera = cameraRef.current;

      if (regionXY && Number.isFinite(height)) {
        activeCamera.position.set(regionXY.x, height, -regionXY.y);
      }

      if ([yawDeg, pitchDeg, rollDeg].some((v) => Number.isFinite(v))) {
        const yaw = THREE.MathUtils.degToRad(Number.isFinite(yawDeg) ? -yawDeg : 0);
        const pitch = THREE.MathUtils.degToRad(Number.isFinite(pitchDeg) ? -pitchDeg : 0);
        const roll = THREE.MathUtils.degToRad(Number.isFinite(rollDeg) ? rollDeg : 0);
        activeCamera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
        activeCamera.updateMatrixWorld();

        // ここで OrbitControls の target をカメラの前方に合わせて再設定し、初期回転を維持
        const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera.quaternion);
        const target = activeCamera.position.clone().add(forward.multiplyScalar(10));

        const controls = controlsRef.current;
        controls.target.copy(target);
        controls.update();
        updateTargetOffsetFromCamera(activeCamera);
      }

      initialCameraPosition.current.copy(activeCamera.position);
      initialCameraRotation.current.copy(activeCamera.rotation);
      previousCameraPosition.current.copy(activeCamera.position);
      previousCameraRotation.current.copy(activeCamera.rotation);

      // 角度表示は通常更新時と同じ正規化ロジックへ統一する
      updateCameraInfoFromCamera(activeCamera);
      syncCamerasFromActive(activeCamera);
      updateOrthographicFrustum(activeCamera);
    } else {
      updateTargetOffsetFromCamera(cameraRef.current);
    }
  };

  // カメラ位置情報をサーバーに送信する。
  const sendCameraDataToServer = async () => {
    // console.log("カメラ情報を送ります：")

    // state(cameraInfo)だと最新の状態が取れないためactiveCameraを参照する
    const activeCamera = cameraRef.current;
    if (!activeCamera) return;
    const pos = activeCamera.position;
    const eulerYXZ = new THREE.Euler().setFromQuaternion(activeCamera.quaternion, 'YXZ');
    const rollDeg = THREE.MathUtils.radToDeg(eulerYXZ.z);
    const pitchDeg = -THREE.MathUtils.radToDeg(eulerYXZ.x);
    const yawDeg = THREE.MathUtils.radToDeg(eulerYXZ.y - Math.PI / 2);
    try {
      await accessor.updateRegionUserPositionData(
        1,
        `POINT(${parseFloat(pos.x)} ${parseFloat(-pos.z)})`,
        pos.y, // height
        rollDeg,
        pitchDeg,
        yawDeg
      );
      //alert('Global position updated successfully');
    } catch (error) {
      console.error('Error updating global position:', error);
    }
  }

  const getCurrentCameraBookmark = () => {
    // 現在のThree.jsカメラを、ブックマーク保存用の座標/角度へ変換する
    const activeCamera = cameraRef.current;
    if (!activeCamera) return null;

    const pos = activeCamera.position;
    const eulerYXZ = new THREE.Euler().setFromQuaternion(activeCamera.quaternion, 'YXZ');
    const rollDeg = THREE.MathUtils.radToDeg(eulerYXZ.z);
    const pitchDeg = -THREE.MathUtils.radToDeg(eulerYXZ.x);
    const yawDeg = THREE.MathUtils.radToDeg(eulerYXZ.y - Math.PI / 2);

    return {
      x: parseFloat(pos.x),
      y: parseFloat(pos.y),
      z: parseFloat(-pos.z),
      roll: rollDeg,
      pitch: pitchDeg,
      yaw: yawDeg,
      height: pos.y,
      region_position: `POINT(${parseFloat(pos.x)} ${parseFloat(-pos.z)})`,
    };
  };

  const jumpToCameraBookmark = (cameraBookmark) => {
    // ブックマーク行から受け取った視点情報をThree.jsカメラへ復元する
    if (!cameraBookmark) return;
    const activeCamera = cameraRef.current;
    if (!activeCamera) return;

    const x = Number(cameraBookmark.x);
    const y = Number(cameraBookmark.y);
    const z = Number(cameraBookmark.z);
    const rollDeg = Number(cameraBookmark.roll);
    const pitchDeg = Number(cameraBookmark.pitch);
    const yawDeg = Number(cameraBookmark.yaw);

    if ([x, y, z].every((v) => Number.isFinite(v))) {
      // 保存時は z が画面表示座標なので、Three.js空間へ戻す際に符号反転する
      activeCamera.position.set(x, y, -z);
    }

    // 保存時の角度定義(yaw=Y-90, pitch=-X)を逆変換して適用する
    const yaw = THREE.MathUtils.degToRad(Number.isFinite(yawDeg) ? yawDeg + 90 : 90);
    const pitch = THREE.MathUtils.degToRad(Number.isFinite(pitchDeg) ? -pitchDeg : 0);
    const roll = THREE.MathUtils.degToRad(Number.isFinite(rollDeg) ? rollDeg : 0);
    activeCamera.quaternion.setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
    activeCamera.updateMatrixWorld();

    const controls = controlsRef.current;
    if (controls) {
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera.quaternion);
      const target = activeCamera.position.clone().add(forward.multiplyScalar(10));
      controls.target.copy(target);
      controls.update();
    }

    updateTargetOffsetFromCamera(activeCamera);
    updateCameraInfoFromCamera(activeCamera);
    syncCamerasFromActive(activeCamera);
    updateOrthographicFrustum(activeCamera);
  };

  /**
   * 検索キーワードで設備一覧を部分一致検索する。
   * 対象は feature_id / material / pipe_type(pipe_kind互換)。
   *
   * @param {string} keyword 検索語
   * @returns {{key: string, featureId: string, material: string, pipeType: string}[]} 検索結果行
   */
  const searchEquipmentByKeyword = (keyword) => {
    // 右上の検索窓から渡されたキーワードで、シーン上の全設備を部分一致検索する
    const query = String(keyword ?? '').trim().toLowerCase();
    if (!query) return [];
    // 半角/全角スペース区切りでトークン化し、全トークン一致(AND)で検索する
    const tokens = query.split(/[\s\u3000]+/).filter(Boolean);
    if (tokens.length === 0) return [];

    return Object.entries(objectsRef.current || {})
      .filter(([, mesh]) => Boolean(mesh?.visible))
      .map(([key, mesh]) => {
        const objectData = mesh?.userData?.objectData || {};
        const attrs = objectData.attributes || {};
        const featureId = objectData.feature_id != null ? String(objectData.feature_id) : '';
        const material = attrs.material != null ? String(attrs.material) : '';
        const pipeTypeValue = attrs.pipe_type ?? attrs.pipe_kind ?? '';
        const pipeType = pipeTypeValue != null ? String(pipeTypeValue) : '';
        return {
          key,
          featureId,
          material,
          pipeType,
          searchableText: `${featureId} ${material} ${pipeType}`.toLowerCase()
        };
      })
      .filter((row) => tokens.every((token) => row.searchableText.includes(token)))
      .map(({ searchableText, ...row }) => row);
  };

  /**
   * 対象設備を画面中央に据え、固定距離でカメラを再配置する。
   * カメラ姿勢は維持し、現在の前方ベクトル方向で center から一定距離だけ離す。
   *
   * @param {string} objectKey objectsRef に登録された設備キー
   * @returns {boolean} 移動できた場合 true
   */
  const panCameraToEquipment = (objectKey) => {
    const mesh = objectsRef.current?.[objectKey];
    const activeCamera = cameraRef.current;
    const controls = controlsRef.current;
    if (!mesh || !activeCamera || !controls) return false;

    const box = new THREE.Box3();
    try {
      mesh.updateWorldMatrix(true, true);
      box.expandByObject(mesh);
    } catch (_) {
      return false;
    }
    if (box.isEmpty()) return false;

    const center = box.getCenter(new THREE.Vector3());
    if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !Number.isFinite(center.z)) {
      return false;
    }

    const fixedDistance = 10;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(activeCamera.quaternion).normalize();
    if (!Number.isFinite(forward.x) || !Number.isFinite(forward.y) || !Number.isFinite(forward.z)) {
      return false;
    }

    // 対象中心から固定距離(10m)を保つように、現在姿勢のままカメラ位置のみ再配置する
    activeCamera.position.copy(center.clone().sub(forward.multiplyScalar(fixedDistance)));
    controls.target.copy(center);
    controls.update();

    selectedMeshRef.current = mesh;
    setSelectedObject(mesh.userData?.objectData || null);
    // 検索結果選択でも通常クリックと同様にアウトラインを再生成する
    showOutline(mesh);

    updateTargetOffsetFromCamera(activeCamera);
    updateCameraInfoFromCamera(activeCamera);
    syncCamerasFromActive(activeCamera);
    updateOrthographicFrustum(activeCamera);
    return true;
  };

  /**
   * 設備検索パネルで選択中の設備にブックマーク属性を付与して登録する。
   * attributes.bookmark=1, attributes.bookmark_memo="" を設定し、更新APIへコミットする。
   *
   * @param {string} objectKey objectsRef に登録された設備キー
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  const registerEquipmentBookmark = async (objectKey) => {
    const mesh = objectsRef.current?.[objectKey];
    if (!mesh?.userData?.objectData) {
      return { ok: false, message: '対象設備が見つかりません' };
    }

    const objectData = mesh.userData.objectData;
    objectData.attributes = objectData.attributes || {};
    // bookmark属性が既存なら値を1に更新し、無い場合は新規追加する
    objectData.attributes.bookmark = 1;
    // 既存メモは保持し、未定義時のみ初期値を入れる
    if (!Object.prototype.hasOwnProperty.call(objectData.attributes, 'bookmark_memo')) {
      objectData.attributes.bookmark_memo = '';
    }

    selectedMeshRef.current = mesh;
    setSelectedObject(objectData);
    showOutline(mesh);

    objectRegistry.editObject(mesh);
    const committed = await objectRegistry.commit();
    if (!committed) {
      return { ok: false, message: '登録に失敗しました' };
    }

    setSelectedObject(JSON.parse(JSON.stringify(mesh.userData.objectData)));
    return { ok: true, message: 'bookmark を登録しました' };
  };

  /**
   * ブックマーク登録された設備一覧を返す。
   * bookmark=1 の設備のみ抽出し、検索キーワードがある場合は一致行のみ返す。
   * 表示用には識別番号・メモ・作成日(最終)を整形する。
   *
   * @returns {{key: string, featureId: string, memo: string, lastCreatedAt: string}[]}
   */
  const listBookmarkedEquipments = () => {
    const query = String(equipmentSearchKeyword ?? '').trim().toLowerCase();
    const tokens = query ? query.split(/[\s\u3000]+/).filter(Boolean) : [];

    const rows = Object.entries(objectsRef.current || {})
      .map(([key, mesh]) => {
        const obj = mesh?.userData?.objectData || {};
        const attrs = obj.attributes || {};
        const bookmarkFlag = Number(attrs.bookmark ?? 0);
        if (bookmarkFlag !== 1) return null;

        const featureId = obj.feature_id != null ? String(obj.feature_id) : '';
        const material = attrs.material != null ? String(attrs.material) : '';
        const pipeTypeValue = attrs.pipe_type ?? attrs.pipe_kind ?? '';
        const pipeType = pipeTypeValue != null ? String(pipeTypeValue) : '';
        const memo = attrs.bookmark_memo != null ? String(attrs.bookmark_memo) : '';
        const lastCreatedAtRaw = obj.updated_at || obj.created_at || '';
        const lastCreatedAt = lastCreatedAtRaw ? String(lastCreatedAtRaw) : '-';
        const searchableText = `${featureId} ${material} ${pipeType} ${memo}`.toLowerCase();

        const sortTs = Date.parse(lastCreatedAtRaw || '');
        return {
          key,
          featureId,
          memo,
          lastCreatedAt,
          searchableText,
          sortTs: Number.isFinite(sortTs) ? sortTs : -Infinity
        };
      })
      .filter(Boolean)
      .filter((row) => tokens.length === 0 || tokens.every((token) => row.searchableText.includes(token)))
      .sort((a, b) => b.sortTs - a.sortTs)
      .map(({ sortTs, searchableText, ...row }) => row);

    return rows;
  };

  /**
   * 現在カーソル選択中の設備を bookmark=1 で登録する。
   *
   * @param {string} memo メモ文字列
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  const registerSelectedEquipmentBookmark = async (memo = '') => {
    const mesh = selectedMeshRef.current;
    if (!mesh?.userData?.objectData) {
      return { ok: false, message: '選択中の設備がありません' };
    }

    const objectData = mesh.userData.objectData;
    objectData.attributes = objectData.attributes || {};
    objectData.attributes.bookmark = 1;
    objectData.attributes.bookmark_memo = String(memo ?? '');

    setSelectedObject(objectData);
    showOutline(mesh);
    objectRegistry.editObject(mesh);

    const committed = await objectRegistry.commit();
    if (!committed) {
      return { ok: false, message: '登録に失敗しました' };
    }

    setSelectedObject(JSON.parse(JSON.stringify(mesh.userData.objectData)));
    return { ok: true, message: 'ブックマークを登録しました' };
  };

  /**
   * 現在カーソル選択中の設備の bookmark を解除する。
   * bookmark を null にして登録する。
   *
   * @returns {Promise<{ok: boolean, message: string}>}
   */
  const deleteSelectedEquipmentBookmark = async () => {
    const mesh = selectedMeshRef.current;
    if (!mesh?.userData?.objectData) {
      return { ok: false, message: '選択中の設備がありません' };
    }

    const objectData = mesh.userData.objectData;
    objectData.attributes = objectData.attributes || {};
    objectData.attributes.bookmark = null;

    setSelectedObject(objectData);
    showOutline(mesh);
    objectRegistry.editObject(mesh);

    const committed = await objectRegistry.commit();
    if (!committed) {
      return { ok: false, message: '削除に失敗しました' };
    }

    setSelectedObject(JSON.parse(JSON.stringify(mesh.userData.objectData)));
    return { ok: true, message: 'ブックマークを削除しました' };
  };

  // オブジェクトの作成（初回のみ）
  useEffect(() => {
    if (!sceneRef.current || !cityJsonData || !layerData) return;

    // 既存のオブジェクトを削除
    Object.values(objectsRef.current).forEach(obj => {
      sceneRef.current.remove(obj);
      obj.geometry.dispose();
      obj.material.dispose();
    });
    objectsRef.current = {};

    // 選択状態もクリア
    selectedMeshRef.current = null;

    // CityObjects 全体から生成
    const entries = cityJsonData.CityObjects ? Object.entries(cityJsonData.CityObjects) : [];
    const startDbgTime = performance.now();
    entries.forEach(([key, obj]) => {
      const mesh = createCityObjects(obj, cityObjectState.shapeTypeMap);
      if (mesh) {
        sceneRef.current.add(mesh);
        objectsRef.current[key] = mesh;

        // 元データをデータ管理に登録。
        objectRegistry.register(key, obj);
      }
    });
    const endDbgTime = performance.now();
    console.log('createCityObjects Time: ', endDbgTime - startDbgTime, ', Size: ', entries.length, ', Ratio: ', (endDbgTime - startDbgTime)/entries.length);

    // メッシュ情報をデータ管理にアタッチ
    objectRegistry.attachObjectsMeshRef(objectsRef.current);

    // 既存の床を先に削除（再生成時の重複防止）
    if (floorRef.current) {
      sceneRef.current.remove(floorRef.current);
      if (floorRef.current.geometry) {
        floorRef.current.geometry.dispose();
      }
      if (floorRef.current.material) {
        if (Array.isArray(floorRef.current.material)) {
          floorRef.current.material.forEach((mat) => mat.dispose());
        } else {
          floorRef.current.material.dispose();
        }
      }
      floorRef.current = null;
    }

    // オブジェクト作成後に地表面のサイズを更新
    if (Object.values(objectsRef.current).length > 0) {
      const box = new THREE.Box3();
      Object.values(objectsRef.current).forEach((m) => {
        if (m) {
          m.updateWorldMatrix(true, true);
          box.expandByObject(m);
        }
      });

      const factor = 2;
      const center = box.getCenter(new THREE.Vector3());
      const boxSize = new THREE.Vector3();
      box.getSize(boxSize);
      const newSize = boxSize.multiplyScalar(factor);
      const halfSize = newSize.multiplyScalar(0.5);
      const boxMin = new THREE.Vector3(
        center.x - halfSize.x,
        center.y - halfSize.y,
        center.z - halfSize.z);
      const boxMax = new THREE.Vector3(
        center.x + halfSize.x,
        center.y + halfSize.y,
        center.z + halfSize.z);
      const enlargedBox = new THREE.Box3(boxMin, boxMax);

      // XとZの最大値を取得し、余裕を持たせる（2倍）
      const maxSize = Math.max(size.x, size.z, SCENE3D_CONFIG.floor.minSize) *
        SCENE3D_CONFIG.floor.sizeMultiplier;

      // 新しいサイズで床を作成
      const floorGeometry = new THREE.PlaneGeometry(maxSize, maxSize);
      const floorMaterial = new THREE.MeshStandardMaterial({
        color: SCENE3D_CONFIG.floor.color,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: SCENE3D_CONFIG.floor.opacity,
        depthWrite: false
      });
      const floor = new THREE.Mesh(floorGeometry, floorMaterial);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = 0;
      floor.receiveShadow = true;
      sceneRef.current.add(floor);
      floorRef.current = floor;

      const startDbgTime = performance.now();
      const maxDepth = 20;
      const maxObjects = 100;
      objectRegistry.rootQuadTree(enlargedBox, maxDepth, maxObjects);
      entries.forEach(([key, obj]) => {
        const nodes = createQuadTreeNodes(obj, cityObjectState.shapeTypeMap);
        if (nodes) {
          const nodeId = (obj?.feature_id != null) ? String(obj.feature_id) : String(key);
          objectRegistry.registerQuadTree(nodeId, nodes);
        }
      });
      const endDbgTime = performance.now();
      console.log('createQuadTreeNodes Time: ', endDbgTime - startDbgTime, ', Size: ', entries.length, ', Ratio: ', (endDbgTime - startDbgTime)/entries.length);
    }

    // userPositions が無ければ自動フィット
    if (!userPositions || userPositions.length === 0) {
      fitCameraToObjects();
    }
  }, [cityJsonData, shapeTypes, sourceTypes]);


  // cityObjectStateの状態に応じて、指定されたオブジェクトにスタイルを適用する
  const applyStyle = (mesh) => {
    if (!mesh || !mesh.material) return;
    const { sourceTypeMap, styleMap, materialVisibilityMap, materialValStyleMap, pipeKindValStyleMap } = cityObjectState || {};

    const obj = mesh.userData?.objectData;
    const attrs = obj?.attributes || {};
    const sourceType = obj?.source_type_id || 0;
    const materialName = attrs.material;
    const pipeKindName = attrs.pipe_kind;
    const sourceName = sourceTypeMap[sourceType];
    // 可視判定
    let visible = true;
    if (materialVisibilityMap) {
      if (pipeKindName) {
        visible = materialVisibilityMap?.[sourceName]?.pipe_kind[pipeKindName];
      } else if (materialName) {
        visible = materialVisibilityMap?.[sourceName]?.material[materialName];
      }
    }

    if (typeof visible !== 'boolean') {
      visible = true;
    }
    mesh.visible = visible;

    // 色設定
    let defaultStyle = { color: '#808080', alpha: 1 };
    let style = defaultStyle;

    if (sourceName) {
      if (pipeKindName) {
        style = styleMap?.[sourceName]?.pipe_kind[pipeKindName];
      } else if (materialName) {
        style = styleMap?.[sourceName]?.material[materialName];
      }
    } else {
      // sourceが割り当たっていない場合はベストエフォート
      console.log("sourceが割り当たってません")
      if (pipeKindName) {
        style = pipeKindValStyleMap?.[pipeKindName];
      } else if (materialName) {
        style = materialValStyleMap?.[materialName];
      }
    }

    if (!style) {
      style = defaultStyle;
    }

    // マテリアル反映
    const mat = mesh.material;
    if (style.color && mat.color) {
      mat.color.set(style.color);
    }
    if (typeof style.alpha === 'number') {
      mat.opacity = style.alpha;
      mat.transparent = style.alpha < 1;
    }
    mat.needsUpdate = true;
  }

  // レイヤーパネル情報更新時処理
  useEffect(() => {
    if (!layerData || !objectsRef.current) return;

    console.log("レイヤーパネル設定でマテリアルを更新");
    Object.values(objectsRef.current).forEach(mesh => {
      applyStyle(mesh);
    });

  }, [layerData]);

  // GeoTIFFファイルを読み込む
  useEffect(() => {
    if (!sceneRef.current || !terrainViewerRef.current) return;

    // URLが無いモードでは既存地形を明示的に破棄
    if (!geoTiffUrl) {
      terrainViewerRef.current.dispose();
      return;
    }

    const jgwImageList = [{ imageUrl: SCENE3D_CONFIG.textureImageUrl }];
    const loadTerrain = async () => {
      try {
        console.log('GeoTIFFファイルを読み込み中:', geoTiffUrl);
        await terrainViewerRef.current.loadGeoTIFFWithJGWTexture(geoTiffUrl, jgwImageList);
        console.log('GeoTIFFファイルの読み込み完了');
      } catch (error) {
        console.error('GeoTIFFファイルの読み込みエラー:', error);
      }
    };

    loadTerrain();
  }, [geoTiffUrl]);

  // 地形の表示/非表示を制御
  useEffect(() => {
    if (terrainViewerRef.current) {
      terrainViewerRef.current.setVisible(terrainVisible);
    }
    if (jgwImageLoaderRef.current) {
      if (terrainVisible) {
        jgwImageLoaderRef.current.setVisible(false);
      } else {
        jgwImageLoaderRef.current.setVisible(true);
      }
    }
    // CrossSectionPlaneの地形表示状態も更新
    if (crossSectionRef.current) {
      crossSectionRef.current.setTerrainVisible(terrainVisible);
    }
  }, [terrainVisible]);

  // 断面ロジックへ mode と縦線基準Y設定を同期
  useEffect(() => {
    if (!crossSectionRef.current) return;
    if (typeof crossSectionRef.current.setMode === 'function') {
      crossSectionRef.current.setMode(mode);
    }
    if (typeof crossSectionRef.current.setVerticalLineBaseYConfig === 'function') {
      crossSectionRef.current.setVerticalLineBaseYConfig(verticalLineBaseYConfig);
    }
  }, [mode, verticalLineBaseYConfig]);

  // 地形opacityを制御（0〜1）
  useEffect(() => {
    if (terrainViewerRef.current && typeof terrainViewerRef.current.setOpacity === 'function') {
      terrainViewerRef.current.setOpacity(terrainOpacity);
    }
  }, [terrainOpacity]);

  // Potreeファイルを読み込む
  // useEffect(() => {
  //   if (!potreeMetadataUrl || !sceneRef.current || !potreeViewerRef.current) return;

  //   const loadPointCloud = async () => {
  //     try {
  //       console.log('Potreeファイルを読み込み中:', potreeMetadataUrl);
  //       await potreeViewerRef.current.loadPointCloud(potreeMetadataUrl);
  //       console.log('Potreeファイルの読み込み完了');
  //     } catch (error) {
  //       console.error('Potreeファイルの読み込みエラー:', error);
  //     }
  //   };

  //   loadPointCloud();
  // }, [potreeMetadataUrl]);

  // // Potreeポイントクラウドの表示/非表示を制御
  // useEffect(() => {
  //   if (potreeViewerRef.current) {
  //     potreeViewerRef.current.setVisible(potreeVisible);
  //   }
  // }, [potreeVisible]);

  // JGW付き画像を読み込む
  useEffect(() => {
    if (!sceneRef.current || !jgwImageLoaderRef.current) return;

    const loadJGWImages = async () => {
      try {
        const res = await fetch(SCENE3D_CONFIG.geoSurfaceListPath);
        if (!res.ok) throw new Error(`list.jsonの読み込みエラー: ${res.status}`);
        const data = await res.json();
        const { files } = data;

        for (let i = 0; i < files.length; i++) {
          const jgwUrl = files[i];
          const imageUrl = files[i + 1];
          if (!jgwUrl || !imageUrl) continue;
          if (!jgwUrl.endsWith(".jgw") || !imageUrl.endsWith(".jpg")) continue;

          console.log(`JGW付き画像を読み込み中: ${imageUrl}, ${jgwUrl}`);
          try {
            await jgwImageLoaderRef.current.loadJGWImage(imageUrl, jgwUrl);
            console.log(`JGW付き画像の読み込み完了: ${imageUrl}`);
          } catch (error) {
            console.error(`JGW付き画像の読み込みエラー (${imageUrl}):`, error);
            // エラーが発生しても次の画像の読み込みを続ける
          }
        }
        console.log('すべてのJGW付き画像の読み込み処理が完了しました');
      } catch (error) {
        console.error('JGW付き画像の読み込みエラー:', error);
      }
    };

    loadJGWImages();
  }, []);

  // 管路表示制御
  useEffect(() => {
    if (!sceneRef.current) return;

    Object.values(objectsRef.current).forEach(mesh => {
      if (mesh && mesh.userData.objectData) {
        const obj = mesh.userData.objectData;
        // 管路オブジェクト（Cylinder + LineString または LineString）の表示制御
        const isPipe = isPipeObject(obj)

        if (isPipe) {
          // materialVisibilityMapによる可視性をチェック
          const { sourceTypeMap, materialVisibilityMap } = cityObjectState || {};
          const attrs = obj?.attributes || {};
          const sourceType = obj?.source_type_id || 0;
          const materialName = attrs.material;
          const pipeKindName = attrs.pipe_kind;
          const sourceName = sourceTypeMap?.[sourceType];
          
          let materialVisible = true;
          if (materialVisibilityMap) {
            if (pipeKindName) {
              materialVisible = materialVisibilityMap?.[sourceName]?.pipe_kind[pipeKindName];
            } else if (materialName) {
              materialVisible = materialVisibilityMap?.[sourceName]?.material[materialName];
            }
          }
          
          if (typeof materialVisible !== 'boolean') {
            materialVisible = true;
          }

          // materialVisibilityMapによる可視性をuserDataに保存（断面生成時に使用）
          mesh.userData.materialVisible = materialVisible;

          // showPipes、sectionViewMode、materialVisibilityMapのすべてを考慮
          mesh.visible = !sectionViewMode && showPipes && materialVisible && mesh.userData.initialVisible !== false;
        }
      }
    });
  }, [showPipes, sectionViewMode, cityObjectState]);

  // 路面表示制御
  useEffect(() => {
    if (jgwImageLoaderRef.current) {
      jgwImageLoaderRef.current.setVisible(showRoad);
    }
  }, [showRoad]);

  // 地表面表示制御
  useEffect(() => {
    if (floorRef.current) {
      floorRef.current.visible = showFloor;
    }
  }, [showFloor]);

  // 背景表示制御
  useEffect(() => {
    if (skyComponentRef.current) {
      skyComponentRef.current.setBackgroundVisible(showBackground);
    }
    const scene = sceneRef.current;
    if (!scene) return;
    if (showBackground) {
      scene.fog = new THREE.Fog(
        SCENE3D_CONFIG.scene.fog.color,
        SCENE3D_CONFIG.scene.fog.near,
        SCENE3D_CONFIG.scene.fog.far
      );
    } else {
      scene.fog = null;
    }
  }, [showBackground]);

  // 断面自動作成モードの状態をrefに同期
  useEffect(() => {
    autoModeEnabledRef.current = autoModeEnabled;
  }, [autoModeEnabled]);

  // 選択されたオブジェクトの変更を通知
  useEffect(() => {
    if (onSelectedObjectChange) {
      onSelectedObjectChange(selectedObject, selectedMeshRef.current);
    }
  }, [selectedObject, onSelectedObjectChange]);

  // 断面自動作成モードが変更された時の処理
  useEffect(() => {
    if (!mountRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;

    if (autoModeEnabled && enableCrossSectionMode) {
      // 断面自動作成モードが有効になった時
      // 既存の断面表示（水平線など）を確実にクリア
      if (crossSectionRef.current) {
        crossSectionRef.current.clearCrossSectionTerrainLine();
        crossSectionRef.current.clear();
        // クリア後、少し待ってから再度クリア（確実に削除するため）
        setTimeout(() => {
          if (crossSectionRef.current) {
            crossSectionRef.current.clearCrossSectionTerrainLine();
            crossSectionRef.current.clear();
          }
        }, 100);
      }

      clearOutline();
    } else if (!autoModeEnabled && enableCrossSectionMode) {
      // 断面自動作成モードが無効になった時
      clearOutline();
    }
  }, [autoModeEnabled, enableCrossSectionMode]);

  // 断面表示モードの処理
  useEffect(() => {
    if (sectionViewMode && generatedSections && generatedSections.length > 0 && crossSectionRef.current) {
      const currentSection = generatedSections[currentSectionIndex];
      clearOutline();
      if (currentSection) {
        // 選択された管路を取得
        const selectedPipe = selectedMeshRef.current;
        if (selectedPipe && selectedPipe.userData.objectData) {
          // 断面を生成
          const clickPoint = new THREE.Vector3(
            currentSection.position.x,
            currentSection.position.y,
            currentSection.z
          );
          // グリッド線の角度を渡す
          const gridAngle = currentSection.angle || 0;
          crossSectionRef.current.clearCrossSectionTerrainLine();
          crossSectionRef.current.clear();
          const geo = terrainViewerRef.current.terrainMeshRef?.geometry;
          crossSectionRef.current.createCrossSection(selectedPipe, clickPoint, objectRegistry, geo, gridAngle, true);
          crossSectionRef.current.toggleCrossSections(true);
          if (typeof crossSectionRef.current.toggleAttributeLabels === 'function') {
            crossSectionRef.current.toggleAttributeLabels(true);
          }
          // setShowPipes(false);

          // カメラを断面平面に正対させる
          if (cameraRef.current && controlsRef.current && crossSectionRef.current) {
            // CrossSectionPlaneから断面平面の法線ベクトルを取得
            const planeNormal = crossSectionRef.current.getCurrentPlaneNormal();

            // 断面平面の中心点を取得（なければクリック位置を使用）
            const planeCenter = crossSectionRef.current.getCurrentPlaneCenter() || clickPoint;

            // カメラの位置を断面平面から適当な距離に配置（法線ベクトルの方向に）
            const cameraDistance = SCENE3D_CONFIG.camera.sectionViewDistance;
            const cameraPosition = planeCenter.clone().add(planeNormal.clone().multiplyScalar(cameraDistance));
            // カメラの高さを適当に設定（断面が見えるように）
            cameraPosition.y = SCENE3D_CONFIG.camera.sectionViewHeight;

            cameraRef.current.position.copy(cameraPosition);
            // カメラを断面平面の中心に向ける
            cameraRef.current.lookAt(planeCenter);
            controlsRef.current.target.copy(planeCenter);
            controlsRef.current.update();
          }
        }
      }
    } else if (!sectionViewMode && crossSectionRef.current) {
      // 断面表示モードが無効になった時はクリア
      crossSectionRef.current.clearCrossSectionTerrainLine();
      crossSectionRef.current.clear();
      crossSectionRef.current.toggleCrossSections(false);
      if (typeof crossSectionRef.current.toggleAttributeLabels === 'function') {
        crossSectionRef.current.toggleAttributeLabels(false);
      }
      // setShowPipes(true);
    }
  }, [sectionViewMode, currentSectionIndex, generatedSections]);

  // refで公開するメソッド
  useImperativeHandle(ref, () => ({
    drawGeneratedSections: (sections) => {
      // マーカーは描画しないため、何もしない
    }
  }));

  return (
    <div className="scene3d-container">
      <div ref={mountRef} style={{ width: '100%', height: '100%' }} />

      {/* 左上の管路情報 */}
      {showGuides && !hideInfoPanel && (
        <div className="pipeline-info-text">
          <div className="section-title">◆管路情報</div>
          左クリック: 管路情報を表示します<br />
          <div className="section-title">◆離隔計測</div>
          左Shift+左ドラッグ: 管路間の最近接距離を計測します<br />
          中クリック:地表面で折れ線の長さを計測します<br />
          ESCキー: 離隔をクリア<br />
          <div className="section-title">◆表示切り替え</div>
          1: ガイド 2: 背景 3: グリッド線 5:離隔 6: 折れ線 7: 管路 8: 路面 9: 地表面<br />
          Space: 透視投影・正射投影 マウスホイール: 拡大縮小 +左Ctrlキー: 低速<br />
          <div className="section-title">◆離隔計測結果</div>
          {/* 距離計測結果を表示 */}
          {measurementResult && (
            <DistanceMeasurementDisplay measurementResult={measurementResult} />
          )}
          {/* 選択された管路情報を表示 */}
          {selectedObject && (
            <PipelineInfoDisplay
              selectedObject={selectedObject}
              selectedMesh={selectedMeshRef.current}
              shapeTypes={shapeTypes}
              onRegister={handleRegister}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onAdd={handleAdd}
              onRestore={handleRestore}
              onRestoreAll={handleRestoreAll}
              onInputEdited={handlnputEdited}
            />
          )}
        </div>
      )}

      {/* 左下のカメラ情報 */}
      {showGuides && (
        <div className="camera-info-container">
          <div className="camera-position-info">
            ◆カメラ位置<br />
            座標: 東西 {cameraInfo.x.toFixed(3)} 高さ {cameraInfo.y.toFixed(3)} 南北 {cameraInfo.z.toFixed(3)} [m]<br />
            向き:ロール {cameraInfo.roll} ピッチ {cameraInfo.pitch} ヨー {cameraInfo.yaw} [度]
          </div>
          <div className="camera-controls-info">
            ◆カメラ操作<br />
            W／↑:上 S／↓:下 A／←:左 D／→:右 Q:後進 E:前進 +左Shiftキー:低速<br />
            Y:位置向き初期化 P:向き初期化 O:位置初期化 L:パン北向き<br />
            I:チルト水平 T:チルト真下 R:チルト水平・高さ初期値 F:高さ重心<br />
            U:パン重心 J:位置重心 H:重心向き後進 G:重心向き前進 K:重心真下<br />
            P:ユーザの自己位置をKeyMapに更新
            {enableCrossSectionMode && <><br />4:断面に正対</>}
          </div>
        </div>
      )}

      <div className="scene-top-right-buttons">
        <button
          type="button"
          className={`scene-top-right-button ${showEquipmentBookmarksPanel ? 'active' : ''}`}
          onClick={handleToggleEquipmentBookmarksPanel}
        >
          設備
        </button>
        <button
          type="button"
          className={`scene-top-right-button ${showCameraBookmarks ? 'active' : ''}`}
          onClick={handleToggleCameraPanel}
        >
          {showCameraBookmarks ? 'カメラを閉じる' : 'カメラ'}
        </button>
        {!enableCrossSectionMode && (
          <button
            type="button"
            className={`scene-top-right-button ${showSubViews ? 'active' : ''}`}
            onClick={handleToggleSubViews}
          >
            {showSubViews ? 'サブビューを閉じる' : 'サブビュー'}
          </button>
        )}
        {!enableCrossSectionMode && showSubViews && (
          <label className="scene-top-right-checkbox">
            <input
              type="checkbox"
              checked={subViewFollowEnabled}
              onChange={handleToggleSubViewFollow}
            />
            サブビュー追従
          </label>
        )}
        <input
          type="text"
          className={`scene-top-right-search-input ${showEquipmentSearchPanel ? 'active' : ''}`}
          value={equipmentSearchKeyword}
          onChange={(e) => setEquipmentSearchKeyword(e.target.value)}
          placeholder="検索窓"
          onFocus={handleOpenSearchPanel}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              // Enter押下をトリガーに、同一キーワードでも再検索できるようrequestIdを進める
              handleOpenSearchPanel();
              setEquipmentSearchRequestId((prev) => prev + 1);
            }
          }}
        />
        {showAxisHud && (
          <AxisDirectionHud
            cameraRef={cameraRef}
            activeCameraTypeRef={activeCameraTypeRef}
            cameraInfo={cameraInfo}
          />
        )}
      </div>

      {showCameraBookmarks && (
        <CameraBookmarkPanel
          onRequestCurrentCamera={getCurrentCameraBookmark}
          onJumpToBookmark={jumpToCameraBookmark}
          accessor={accessor}
        />
      )}

      {showEquipmentSearchPanel && (
        <EquipmentSearchPanel
          onSearch={searchEquipmentByKeyword}
          onFocusResult={panCameraToEquipment}
          onRegisterResult={registerEquipmentBookmark}
          hideInput
          externalKeyword={equipmentSearchKeyword}
          searchRequestId={equipmentSearchRequestId}
        />
      )}

      {showEquipmentBookmarksPanel && (
        <EquipmentBookmarkPanel
          onListBookmarks={listBookmarkedEquipments}
          onFocusResult={panCameraToEquipment}
          onRegisterBookmark={registerSelectedEquipmentBookmark}
          onDeleteBookmark={deleteSelectedEquipmentBookmark}
        />
      )}

      <SubViewPanel
        ref={subViewPanelRef}
        visible={!enableCrossSectionMode && showSubViews}
      />

      {/* 画面下部の正射投影モード表示 */}
      {activeCameraTypeRef.current === 'orthographic' && (
        <div className="orthographic-mode-indicator">
          正射投影モードです
        </div>
      )}
    </div>
  );
});

export default Scene3D;

