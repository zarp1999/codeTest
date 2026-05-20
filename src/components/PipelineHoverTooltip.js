import React, { useLayoutEffect, useRef, useState } from 'react';
import './PipelineHoverTooltip.css';

const POINTER_OFFSET = 12;
const VIEWPORT_MARGIN = 8;

const HOVER_FIELDS = [
  { key: '識別番号', label: '識別番号' },
  { key: '東西[m]', label: '東西[m]' },
  { key: '土被り深さ[m]', label: '土被り深さ[m]' },
  { key: '南北[m]', label: '南北[m]' },
  { key: '直径[mm]', label: '直径[mm]' },
  { key: '種別', label: '種別' },
  { key: '材質', label: '材質' },
];

/**
 * 管路ホバー時の読み取り専用ポップアップ（ポインタ右上付近）
 */
function PipelineHoverTooltip({ summary, position }) {
  const tooltipRef = useRef(null);
  const [style, setStyle] = useState({ left: 0, top: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!summary || !position || !tooltipRef.current) {
      return;
    }

    const el = tooltipRef.current;
    const { width, height } = el.getBoundingClientRect();

    let left = position.x + POINTER_OFFSET;
    let top = position.y - POINTER_OFFSET;

    if (left + width > window.innerWidth - VIEWPORT_MARGIN) {
      left = window.innerWidth - width - VIEWPORT_MARGIN;
    }
    if (left < VIEWPORT_MARGIN) {
      left = VIEWPORT_MARGIN;
    }

    top -= height;
    if (top < VIEWPORT_MARGIN) {
      top = position.y + POINTER_OFFSET;
    }
    if (top + height > window.innerHeight - VIEWPORT_MARGIN) {
      top = window.innerHeight - height - VIEWPORT_MARGIN;
    }

    setStyle({ left, top, visibility: 'visible' });
  }, [summary, position]);

  if (!summary || !position) {
    return null;
  }

  return (
    <div
      ref={tooltipRef}
      className="pipeline-hover-tooltip"
      style={style}
      role="tooltip"
    >
      {HOVER_FIELDS.map(({ key, label }) => (
        <div key={key} className="pipeline-hover-tooltip-row">
          <span className="pipeline-hover-tooltip-label">{label}:</span>
          <span className="pipeline-hover-tooltip-value">{summary[key] ?? ''}</span>
        </div>
      ))}
    </div>
  );
}

export default PipelineHoverTooltip;
