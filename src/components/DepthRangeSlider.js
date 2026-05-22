import React from 'react';
import './DepthRangeSlider.css';

/** 左右ハンドルが重ならないよう確保する最小間隔（m） */
const MIN_GAP = 0.5;

/**
 * サブビュー「視野範囲」用のデュアルハンドルスライダー。
 *
 * - 左ハンドル … OrthographicCamera.near（この深度より手前は非表示）
 * - 右ハンドル … far（この深度より奥は非表示）
 * - 左右の数値はメートル表示
 *
 * @param {{
 *   minLimit: number,
 *   maxLimit: number,
 *   valueMin: number,
 *   valueMax: number,
 *   onChange: (min: number, max: number) => void,
 *   disabled?: boolean
 * }} props
 */
export default function DepthRangeSlider({
  minLimit,
  maxLimit,
  valueMin,
  valueMax,
  onChange,
  disabled = false
}) {
  const lo = Math.min(minLimit, maxLimit);
  const hi = Math.max(minLimit, maxLimit);
  const span = Math.max(hi - lo, MIN_GAP);
  // ハンドルが交差しないようクランプした表示用の値
  const safeMin = Math.max(lo, Math.min(valueMin, valueMax - MIN_GAP));
  const safeMax = Math.min(hi, Math.max(valueMax, safeMin + MIN_GAP));
  const pctMin = ((safeMin - lo) / span) * 100;
  const pctMax = ((safeMax - lo) / span) * 100;

  const handleMin = (event) => {
    const next = Number(event.target.value);
    const clamped = Math.min(next, safeMax - MIN_GAP);
    onChange(clamped, safeMax);
  };

  const handleMax = (event) => {
    const next = Number(event.target.value);
    const clamped = Math.max(next, safeMin + MIN_GAP);
    onChange(safeMin, clamped);
  };

  return (
    <div className={`depth-range-slider ${disabled ? 'disabled' : ''}`}>
      <span className="depth-range-value depth-range-value-min">{safeMin.toFixed(1)} m</span>
      <div className="depth-range-track-wrap">
        <div className="depth-range-track" />
        {/* 有効視野（near〜far）を色付きで表示 */}
        <div
          className="depth-range-fill"
          style={{ left: `${pctMin}%`, width: `${Math.max(0, pctMax - pctMin)}%` }}
        />
        <input
          type="range"
          className="depth-range-input depth-range-input-min"
          min={lo}
          max={hi}
          step={0.1}
          value={safeMin}
          disabled={disabled}
          onChange={handleMin}
        />
        <input
          type="range"
          className="depth-range-input depth-range-input-max"
          min={lo}
          max={hi}
          step={0.1}
          value={safeMax}
          disabled={disabled}
          onChange={handleMax}
        />
      </div>
      <span className="depth-range-value depth-range-value-max">{safeMax.toFixed(1)} m</span>
    </div>
  );
}
