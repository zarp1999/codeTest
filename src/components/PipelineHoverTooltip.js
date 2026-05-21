import React, { useLayoutEffect, useRef, useState } from 'react';
import './PipelineHoverTooltip.css';

/** マウス位置からポップアップを離す余白（px） */
const POINTER_OFFSET = 12;
/** 表示領域端との最小距離（px） */
const VIEWPORT_MARGIN = 8;

const HOVER_FIELDS = [
  { key: '識別番号', label: '識別番号' },
  { key: '情報源', label: '情報源' },
  { key: '東西[m]', label: '東西[m]' },
  { key: '土被り深さ[m]', label: '土被り深さ[m]' },
  { key: '南北[m]', label: '南北[m]' },
  { key: '直径[mm]', label: '直径[mm]' },
  { key: '種別', label: '種別' },
  { key: '材質', label: '材質' },
];

/**
 * ツールチップを配置してよい矩形（ビューポート座標）。
 * Scene3D の mountRef.getBoundingClientRect() を渡すと、レイヤパネル側にはみ出さない。
 */
function resolveBoundsRect(bounds) {
  if (bounds) {
    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
    };
  }
  return {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  };
}

function fitsInBounds(left, top, width, height, rect) {
  return (
    left >= rect.left + VIEWPORT_MARGIN &&
    top >= rect.top + VIEWPORT_MARGIN &&
    left + width <= rect.right - VIEWPORT_MARGIN &&
    top + height <= rect.bottom - VIEWPORT_MARGIN
  );
}

/**
 * 第1候補: カーソル右上。収まらなければ第2候補: カーソル左下。
 */
export function computeTooltipPosition(pointerX, pointerY, width, height, bounds) {
  const rect = resolveBoundsRect(bounds);
  const minLeft = rect.left + VIEWPORT_MARGIN;
  const minTop = rect.top + VIEWPORT_MARGIN;
  const maxLeft = rect.right - width - VIEWPORT_MARGIN;
  const maxTop = rect.bottom - height - VIEWPORT_MARGIN;

  // 右上: 左端=カーソル右、上端=カーソル上（高さ分引く）
  const upperRightLeft = pointerX + POINTER_OFFSET;
  const upperRightTop = pointerY - POINTER_OFFSET - height;

  if (fitsInBounds(upperRightLeft, upperRightTop, width, height, rect)) {
    return { left: upperRightLeft, top: upperRightTop };
  }

  // 左下: 右端=カーソル左、上端=カーソル下
  const lowerLeftLeft = pointerX - width - POINTER_OFFSET;
  const lowerLeftTop = pointerY + POINTER_OFFSET;

  const left = Math.min(Math.max(lowerLeftLeft, minLeft), maxLeft);
  const top = Math.min(Math.max(lowerLeftTop, minTop), maxTop);

  return { left, top };
}

/**
 * 管路ホバー時の読み取り専用ポップアップ。
 *
 * position: event.clientX / clientY（ビューポート座標）
 * bounds: 3D表示領域の getBoundingClientRect()（省略時はビューポート全体）
 */
function PipelineHoverTooltip({ summary, position, bounds }) {
  const tooltipRef = useRef(null);
  const [style, setStyle] = useState({ left: 0, top: 0, visibility: 'hidden' });

  useLayoutEffect(() => {
    if (!summary || !position || !tooltipRef.current) {
      return;
    }

    const el = tooltipRef.current;
    const { width, height } = el.getBoundingClientRect();
    const { left, top } = computeTooltipPosition(
      position.x,
      position.y,
      width,
      height,
      bounds
    );

    setStyle({ left, top, visibility: 'visible' });
  }, [summary, position, bounds]);

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
