import React from 'react';
import axios from 'axios';
import { useDemDisplay } from '../../contexts/DemDisplayContext';
import DemPanelItem from './DemPanelItem';
import './DemPanel.css';

function DemPanel({ dataAccessor }) {
    const {
        availbelDems,
        activeDem,
        loading,
        addDem,
        removeDem,
        setVisible,
        setOpacity,
        setColor,
        setLineStyle,
        setRes,
    } = useDemDisplay();

    const [collpased, setCollapsed] = useState(false);
    const [revisionMap, setRevisionMap] = useState({});
    const [ selectedSurfaceId, setSelectedSurfaceId] = useState(null);

    const handleSurfaceSelect = async (surfaceId) => {
        setSelectedSurfaceId(surfaceId);
        if (!surfaceId || revisionMap[surfaceId]) return;

        try {
            const response = await axios.get(`${API_BASE_URL}/dems/${surfaceId}/revisions`);
            const revisions = response.data;
            setRevisionMap(prev => ({ ...prev, [surfaceId]: revisions }));
        } catch (error) {
            console.error('Error fetching revisions:', error);
        }
    }

    const handleAddDem = (revisionId) => {
        const surFace = availbelDems.find(dem => dem.surface_id === selectedSurfaceId);
        const revision = revisionMap[selectedSurfaceId].find(rev => rev.revision_id === revisionId);
        const name = `${surFace.surface_name} ${revision.revision_name}`;
        addDem(selectedSurfaceId, revisionId, name);
        setSelectedSurfaceId(null);
    };

    if (collpased) {
        return (
            <div className="dem-panel-collapsed">
                <button className="dem-panel-toggle" onClick={() => setCollapsed(!collpased)}></button>
                <span>DEM</span>
            </div>
        );
    }

    return (
        <div className="dem-panel-expanded">
            <div className="dem-panel-header">
                <button className="dem-panel-toggle" onClick={() => setCollapsed(!collpased)}>
                    <span>DEM</span>
                </button>
            </div>
            <div className="dem-panel-content">
                <div className="dem-panel-surface-list">
                    <h3>Surface List</h3>
                    <ul>
                        {availbelDems.map(dem => (
                            <li key={dem.surface_id}>
                                <button onClick={() => handleSurfaceSelect(dem.surface_id)}>{dem.surface_name}</button>
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="dem-panel-revision-list">
                    <h3>Revision List</h3>
                    <ul>
                        {revisionMap[selectedSurfaceId]?.map(rev => (
                            <li key={rev.revision_id}>
                                <button onClick={() => handleAddDem(rev.revision_id)}>{rev.revision_name}</button>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default DemPanel;