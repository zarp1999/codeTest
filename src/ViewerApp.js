import React , { useState, createContext, useMemo } from 'react';
import App3D from './App3D';
import LayerPanel from './components/LayerPanel';
//import MapComponent from './components/MapComponent';
import MapComponent from './components/MapComponentLimited';
import styles from './ViewerApp.module.css';
 
// region idのContext
import { useApiBaseUrl } from "../../ApiBaseUrlContext";
import { createDataAccessor } from "./DataAccessor/Factory";
 
 
// export const LayerContext = createContext();
 
export const LayerContext = React.createContext({
  layerData: null,
  setLayerData: () => {}
});
 
const ViewerAppOSS = () => {
    const [layerData, setLayerData] = useState([]);
 
    // Contextから選択中リージョンIDを取得
    const { activeRegionId } = useApiBaseUrl();
 
    // regionIdの変更に応じてDataAccessorを再生成
    const dataAccessor = useMemo(() => {
        return createDataAccessor(activeRegionId);
  }, [activeRegionId]);
 
    return (
        <div className={styles.va_root}>
            <LayerContext.Provider value={{ layerData, setLayerData }}>
                <div className={styles.va_left}>
                    <App3D dataAccessor={dataAccessor} />
                </div>
                <div className={styles.va_right}>
                    <div className={styles.va_right_top}>
                        <LayerPanel dataAccessor={dataAccessor} />
                    </div>
                    <div className={styles.va_right_bottom}>
                        <MapComponent dataAccessor={dataAccessor} />
                    </div>
                </div>
            </LayerContext.Provider>
        </div>
    );
};
 
export default ViewerAppOSS;
 