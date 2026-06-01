import React from 'react';

function DemPanelItem({ dem, onToggleVisible, onRemove, onSetOpacity, onSetColor, onSetLineStyle, onSetRes }) {
    return (
        <div className="dem-panel-item">
            <div className="dem-panel-item-header">
                <div className="dem-panel-item-header-left">
                    <div className="dem-panel-item-header-left-name">{dem.name}</div>
                </div>
            </div>
        </div>
    );
}

export default DemPanelItem;