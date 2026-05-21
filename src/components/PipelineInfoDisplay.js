import React, { useState, useEffect, useRef } from 'react';
import './PipelineInfoDisplay.css';
import PipelineActionButtons from './PipelineActionButtons';
import { buildPipelineData } from './pipelineInfoUtils';

/**
 * 管路情報表示コンポーネント
 * クリックされた管路オブジェクトの情報をテーブル形式で表示
 */
function PipelineInfoDisplay({
  selectedObject,
  selectedMesh,
  shapeTypes,
  sourceTypes,
  onRegister,
  onDuplicate,
  onDelete,
  onAdd,
  onRestore,
  onRestoreAll,
  onInputEdited
}) {
  const [originalValues, setOriginalValues] = useState({});
  const [inputValues, setInputValues] = useState({});
  const [hasChanges, setHasChanges] = useState(false);

  const [isComposing, setIsComposing] = React.useState(false);
  const isApplyingRef = useRef(false);

  const updateSelectedObject = () => {
    if (selectedObject) {
      const pipelineData = buildPipelineData(selectedObject, { selectedMesh, shapeTypes, sourceTypes });
      setOriginalValues(pipelineData || {});
      setInputValues({});
      setHasChanges(false);
    }
  };

  useEffect(() => {
    updateSelectedObject();
  }, [selectedObject, shapeTypes, sourceTypes, selectedObject?.geometry]);

  if (!selectedObject) return null;

  const handleInputChange = (key, value) => {
    setInputValues((prev) => ({
      ...prev,
      [key]: value,
    }));
    setHasChanges(true);
  };

  const handleEdited = () => {
    if (isApplyingRef.current) return;
    isApplyingRef.current = true;
    if (onInputEdited) {
      onInputEdited(inputValues);
    }
    setHasChanges(false);
    setTimeout(() => {
      isApplyingRef.current = false;
    }, 0);
  };

  const handleBlur = () => {
    if (isApplyingRef.current) return;
    if (hasChanges) {
      handleEdited();
    }
  };

  const handleInputClick = (event) => {
    event.stopPropagation();
  };

  const handleRegisterClick = () => {
    if (onRegister) {
      onRegister(selectedObject, inputValues);
      setInputValues({});
      setHasChanges(false);
      updateSelectedObject();
    }
  };

  const handleDuplicateClick = () => {
    if (onDuplicate) {
      onDuplicate(selectedObject);
    }
  };

  const handleDeleteClick = () => {
    if (onDelete) {
      onDelete(selectedObject);
    }
  };

  const handleAddClick = () => {
    if (onAdd) {
      onAdd();
    }
  };

  const handleRestoreClick = () => {
    if (onRestore) {
      onRestore(selectedObject);
      setInputValues({});
      setHasChanges(false);
    }
  };

  const handleRestoreAllClick = () => {
    if (onRestoreAll) {
      onRestoreAll();
      setInputValues({});
      setHasChanges(false);
    }
  };

  return (
    <div className="pipeline-info-display" onClick={handleInputClick}>
      <table className="pipeline-table">
        <thead>
          <tr>
            <th>[項目]</th>
            <th>[設定済み]</th>
            <th>[入力欄]</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(originalValues).map(([key, value]) => (
            <tr key={key}>
              <td className="item-label">{key}</td>
              <td className="set-value">{value || ''}</td>
              <td className="input-field">
                {(key === '') ? (
                  <input
                    type="text"
                    value={inputValues[key] ?? value}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    className="pipeline-input"
                    placeholder={value || ''}
                    onClick={handleInputClick}
                  />
                ) : (
                  <input
                    type="text"
                    value={inputValues[key] ?? value}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                    className="pipeline-input"
                    placeholder={value || '入力'}
                    onClick={handleInputClick}
                    onCompositionStart={() => setIsComposing(true)}
                    onCompositionEnd={() => {
                      setIsComposing(false);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !isComposing) {
                        e.preventDefault();
                        handleEdited();
                        e.currentTarget.blur();
                      }
                    }}
                    onBlur={handleBlur}
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <PipelineActionButtons
        onRegister={handleRegisterClick}
        onDuplicate={handleDuplicateClick}
        onDelete={handleDeleteClick}
        onAdd={handleAddClick}
        onRestore={handleRestoreClick}
        onRestoreAll={handleRestoreAllClick}
        hasChanges={hasChanges}
      />
    </div>
  );
}

export default PipelineInfoDisplay;
