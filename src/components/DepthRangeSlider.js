import React from 'react';
import { Slider } from 'antd';
import './DepthRangeSlider.css';

/** 左右ハンドルが重ならないよう確保する最小間隔（m） */
const MIN_GAP = 0.5;

/**
 * サブビュー「視野範囲」用レンジスライダー（Ant Design）。
 *
 * - 左 … near（この深度より手前は非表示）
 * - 右 … far（この深度より奥は非表示）
 */
export default function DepthRangeSlider({
  className = '',
  minLimit,
  maxLimit,
  valueMin,
  valueMax,
  onChange,
  disabled = false,
  lockMin = false,
  step = 0.1
}) {
  const lo = Math.min(minLimit, maxLimit);
  const hi = Math.max(minLimit, maxLimit);
  const safeMin = Math.max(lo, Math.min(valueMin, valueMax - MIN_GAP));
  const safeMax = Math.min(hi, Math.max(valueMax, safeMin + MIN_GAP));

  const handleChange = (vals) => {
    if (!Array.isArray(vals) || vals.length < 2) return;
    let nextMin = Number(vals[0]);
    let nextMax = Number(vals[1]);
    if (!Number.isFinite(nextMin) || !Number.isFinite(nextMax)) return;

    nextMin = Math.max(lo, Math.min(nextMin, nextMax - MIN_GAP));
    nextMax = Math.min(hi, Math.max(nextMax, nextMin + MIN_GAP));
    onChange(nextMin, nextMax);
  };

  const sliderDisabled = lockMin ? [true, !!disabled] : !!disabled;

  return (
    <div className={`depth-range-slider ${className} ${disabled ? 'disabled' : ''}`.trim()}>
      <span className="depth-range-value depth-range-value-min">{safeMin.toFixed(1)} m</span>
      <Slider
        className="depth-range-ant-slider"
        range
        min={lo}
        max={hi}
        step={step}
        value={[safeMin, safeMax]}
        disabled={sliderDisabled}
        onChange={handleChange}
        tooltip={{ formatter: (v) => `${Number(v).toFixed(1)} m` }}
      />
      <span className="depth-range-value depth-range-value-max">{safeMax.toFixed(1)} m</span>
    </div>
  );
}
