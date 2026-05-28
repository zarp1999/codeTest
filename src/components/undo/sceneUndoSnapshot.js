/**
 * 3Dシーンの Undo/Redo 用スナップショット取得・復元
 */

const deepClone = (value) => JSON.parse(JSON.stringify(value));

export function captureSceneSnapshot(objectRegistry, objectsRef, selectedMeshRef) {
  const objectsInScene = {};

  Object.entries(objectsRef.current || {}).forEach(([key, mesh]) => {
    if (mesh?.userData?.objectData) {
      objectsInScene[key] = deepClone(mesh.userData.objectData);
    }
  });

  return {
    objectsInScene,
    registry: {
      editedOrDeletedObjectsData: deepClone(objectRegistry.editedOrDeletedObjectsData || {}),
      addedObjectsData: deepClone(objectRegistry.addedObjectsData || {}),
    },
    selectedObjectKey: selectedMeshRef.current
      ? objectRegistry.getObjectKey(selectedMeshRef.current)
      : null,
  };
}

function disposeMesh(mesh) {
  if (!mesh) return;

  if (mesh.geometry) {
    mesh.geometry.dispose();
  }

  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((mat) => mat.dispose());
    } else {
      mesh.material.dispose();
    }
  }

  if (mesh.material?.map) {
    mesh.material.map.dispose();
  }
}

function removeMeshFromScene(key, mesh, { sceneRef, objectsRef }) {
  if (sceneRef.current && mesh) {
    sceneRef.current.remove(mesh);
  }
  disposeMesh(mesh);
  delete objectsRef.current[key];
}

export function applySceneSnapshot(snapshot, context) {
  const {
    sceneRef,
    objectsRef,
    objectRegistry,
    selectedMeshRef,
    createCityObjects,
    shapeTypeMap,
    applyStyle,
    setSelectedObject,
    showOutline,
    clearOutline,
  } = context;

  if (!snapshot) return;

  objectRegistry.editedOrDeletedObjectsData = deepClone(
    snapshot.registry?.editedOrDeletedObjectsData || {}
  );
  objectRegistry.addedObjectsData = deepClone(
    snapshot.registry?.addedObjectsData || {}
  );

  const targetKeys = new Set(Object.keys(snapshot.objectsInScene || {}));
  const currentKeys = Object.keys(objectsRef.current || {});

  currentKeys.forEach((key) => {
    if (!targetKeys.has(key)) {
      removeMeshFromScene(key, objectsRef.current[key], context);
    }
  });

  Object.entries(snapshot.objectsInScene || {}).forEach(([key, objectData]) => {
    const existing = objectsRef.current[key];
    const targetJson = JSON.stringify(objectData);

    if (existing && JSON.stringify(existing.userData?.objectData) === targetJson) {
      return;
    }

    if (existing) {
      removeMeshFromScene(key, existing, context);
    }

    const mesh = createCityObjects(objectData, shapeTypeMap);
    if (!mesh || !sceneRef.current) return;

    sceneRef.current.add(mesh);
    objectsRef.current[key] = mesh;
    applyStyle(mesh);
  });

  const selectedKey = snapshot.selectedObjectKey;
  if (selectedKey && objectsRef.current[selectedKey]) {
    const mesh = objectsRef.current[selectedKey];
    setSelectedObject(deepClone(mesh.userData.objectData));
    selectedMeshRef.current = mesh;
    showOutline(mesh);
    return;
  }

  setSelectedObject(null);
  selectedMeshRef.current = null;
  clearOutline();
}
