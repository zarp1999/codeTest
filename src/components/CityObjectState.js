 
// CreateCityObjectConfiのパラメータ
// layerData, shapeTypes, sourceTypes等に変更が有った場合、再計算される
import { useMemo } from 'react';
 
// 3Dオブジェクトの状態（材質等）のフック
export function CityObjectState(layerData, shapeTypes, sourceTypes) {
 
    // 各種マップを構築。
    const shapeTypeMap = useMemo(
        () => buildShapeTypeMap(shapeTypes || []),
        [shapeTypes]
    );
 
    const sourceTypeMap = useMemo(
        () => buildSourceTypeMap(sourceTypes || []),
        [sourceTypes]
    );
 
    const styleMap = useMemo(
        () => buildStyleMap(layerData || []),
        [layerData]
    );
 
    const materialValStyleMap = useMemo(
        () => buildValStyleMap(layerData || [], 'material'),
        [layerData]
    );
 
    const pipeKindValStyleMap = useMemo(
        () => buildValStyleMap(layerData || [], 'pipe_kind'),
        [layerData]
    );
 
    const materialVisibilityMap = useMemo(() => {
 
        const vis = {};
        (layerData || []).forEach(entry => {
            const discr = entry.discr_class;
            const attr = entry.attribute;
            const val = entry.val;
            const isVisible = entry.val_disp_flag;
            if (!discr || !attr || !val) return;
            vis[discr] = vis[discr] || {};
            vis[discr][attr] = vis[discr][attr] || {};
            vis[discr][attr][val] = isVisible;
        });
        return vis;
    }, [layerData]);
 
    // まとめて返す
    return {
        shapeTypeMap,
        sourceTypeMap,
        styleMap,
        materialVisibilityMap,
        materialValStyleMap,
        pipeKindValStyleMap
    };
}
 
// shape_type.json -> { id: shape_type }
const buildShapeTypeMap = (shapeTypesArr) => {
    const map = {};
    (shapeTypesArr || []).forEach(({ id, shape_type }) => {
        map[String(id)] = shape_type;
    });
    return map;
};
 
// source_types.json -> { id: source_type }
const buildSourceTypeMap = (sourceTypesArr) => {
    const map = {};
    (sourceTypesArr || []).forEach(({ id, source_type }) => {
        map[String(id)] = source_type;
    });
    return map;
};
 
// layer_panel.json -> { discr_class: { attribute: { val: { color, alpha } } } }
const buildStyleMap = (layerPanelArr) => {
    const styles = {};
    (layerPanelArr || []).forEach(entry => {
        const discr = entry.discr_class;
        const attr = entry.attribute;
        const val = entry.val;
        const color = entry.color;
        const alpha = entry.alpha ?? 1;
        if (!discr || !attr || !val || !color) return;
        styles[discr] = styles[discr] || {};
        styles[discr][attr] = styles[discr][attr] || {};
        styles[discr][attr][val] = { color: `#${color}`, alpha };
    });
    return styles;
};
 
// layer_panel.json -> attribute 単位（'material' or 'pipe_kind'）で val 直引きのスタイルマップ
const buildValStyleMap = (layerPanelArr, targetAttr) => {
    const map = {};
    (layerPanelArr || []).forEach(entry => {
        if (entry?.attribute !== targetAttr) return;
        const val = entry?.val;
        const color = entry?.color;
        const alpha = entry?.alpha ?? 1;
        if (val == null || !color) return;
        // 後勝ち/上書き。
        map[val] = { color: `#${color}`, alpha };
    });
    return map;
};
 
 