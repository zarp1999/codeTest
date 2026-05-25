import React, { useEffect, useState } from 'react';
import './DepthRangeSlider.css';

/** 左右ハンドルが重ならないよう確保する最小間隔（m） */
const MIN_GAP = 0.5;
/** つまみ半径相当（clip-path の余白） */
const THUMB_HIT_PAD_PX = 14;

/**
 * サブビュー「視野範囲」用のデュアルハンドルスライダー。
 *
 * - 左ハンドル … OrthographicCamera.near（この深度より手前は非表示）
 * - 右ハンドル … far（この深度より奥は非表示）
 * - 2 本の range を重ねるため、トラックは clip-path で操作領域を分割する
 *
 * @param {{
 *   minLimit: number,
 *   maxLimit: number,
 *   valueMin: number,
 *   valueMax: number,
 *   onChange: (min: number, max: number) => void,
 *   disabled?: boolean,
 *   lockMin?: boolean,
 *   step?: number
 * }} props
 */
export default function DepthRangeSlider({
  minLimit,
  maxLimit,
  valueMin,
  valueMax,
  onChange,
  disabled = false,
  lockMin = false,
  step = 0.1
}) {
  const [activeRange, setActiveRange] = useState(null);

  const lo = Math.min(minLimit, maxLimit);
  const hi = Math.max(minLimit, maxLimit);
  const span = Math.max(hi - lo, MIN_GAP);
  const safeMin = Math.max(lo, Math.min(valueMin, valueMax - MIN_GAP));
  const safeMax = Math.min(hi, Math.max(valueMax, safeMin + MIN_GAP));
  const pctMin = ((safeMin - lo) / span) * 100;
  const pctMax = ((safeMax - lo) / span) * 100;

  useEffect(() => {
    const clearActive = () => setActiveRange(null);
    window.addEventListener('pointerup', clearActive);
    window.addEventListener('pointercancel', clearActive);
    return () => {
      window.removeEventListener('pointerup', clearActive);
      window.removeEventListener('pointercancel', clearActive);
    };
  }, []);

  const valueFromClientX = (clientX, rect) => {
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return lo + ratio * span;
  };

  const handleTrackPointerDown = (event) => {
    if (disabled) return;
    if (event.target instanceof HTMLInputElement) return;

    const wrap = event.currentTarget;
    const rect = wrap.getBoundingClientRect();
    const clicked = valueFromClientX(event.clientX, rect);
    const distMin = Math.abs(clicked - safeMin);
    const distMax = Math.abs(clicked - safeMax);

    if (distMin <= distMax) {
      if (lockMin) return;
      const clamped = Math.max(lo, Math.min(clicked, safeMax - MIN_GAP));
      onChange(clamped, safeMax);
      setActiveRange('min');
      return;
    }

    const clamped = Math.min(hi, Math.max(clicked, safeMin + MIN_GAP));
    onChange(safeMin, clamped);
    setActiveRange('max');
  };

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

  const trackStyle = {
    '--pct-min': pctMin,
    '--pct-max': pctMax,
    '--thumb-pad': `${THUMB_HIT_PAD_PX}px`
  };

  return (
    <div className={`depth-range-slider ${disabled ? 'disabled' : ''}`}>
      <span className="depth-range-value depth-range-value-min">{safeMin.toFixed(1)} m</span>
      <div
        className="depth-range-track-wrap"
        style={trackStyle}
        onPointerDown={handleTrackPointerDown}
      >
        <div className="depth-range-track" />
        <div
          className="depth-range-fill"
          style={{ left: `${pctMin}%`, width: `${Math.max(0, pctMax - pctMin)}%` }}
        />
        <input
          type="range"
          className={`depth-range-input depth-range-input-min${activeRange === 'min' ? ' depth-range-input-active' : ''}`}
          min={lo}
          max={hi}
          step={step}
          value={safeMin}
          disabled={disabled || lockMin}
          onChange={handleMin}
          onPointerDown={() => {
            if (!disabled && !lockMin) setActiveRange('min');
          }}
        />
        <input
          type="range"
          className={`depth-range-input depth-range-input-max${activeRange === 'max' ? ' depth-range-input-active' : ''}`}
          min={lo}
          max={hi}
          step={step}
          value={safeMax}
          disabled={disabled}
          onChange={handleMax}
          onPointerDown={() => {
            if (!disabled) setActiveRange('max');
          }}
        />
      </div>
      <span className="depth-range-value depth-range-value-max">{safeMax.toFixed(1)} m</span>
    </div>
  );
}
