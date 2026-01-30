import { useCallback, useRef } from 'react';

interface SliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  label?: string;
  showValue?: boolean;
  valueFormatter?: (value: number) => string;
}

export function Slider({
  value,
  min = 0,
  max = 100,
  step = 1,
  onChange,
  disabled = false,
  label,
  showValue = true,
  valueFormatter = (v) => `${v}`,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const percentage = ((value - min) / (max - min)) * 100;

  const handleTrackClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (disabled || !trackRef.current) return;

      const rect = trackRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const percent = Math.max(0, Math.min(1, x / rect.width));
      const newValue = Math.round((min + percent * (max - min)) / step) * step;
      onChange(Math.max(min, Math.min(max, newValue)));
    },
    [disabled, min, max, step, onChange]
  );

  return (
    <div className="space-y-2">
      {(label || showValue) && (
        <div className="flex items-center justify-between">
          {label && (
            <span className="text-sm font-medium text-slate-300">{label}</span>
          )}
          {showValue && (
            <span className="text-sm font-semibold text-blue-400 tabular-nums">
              {valueFormatter(value)}
            </span>
          )}
        </div>
      )}

      <div
        ref={trackRef}
        onClick={handleTrackClick}
        className={`
          relative h-11 flex items-center cursor-pointer
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
        `}
      >
        {/* Track background */}
        <div className="absolute inset-x-0 h-1.5 bg-slate-700/80 rounded-full" />

        {/* Track fill */}
        <div
          className="absolute left-0 h-1.5 bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-75"
          style={{ width: `${percentage}%` }}
        />

        {/* Thumb */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          disabled={disabled}
          className="
            absolute inset-0 w-full h-full opacity-0 cursor-pointer
            disabled:cursor-not-allowed
          "
        />
        <div
          className={`
            absolute w-6 h-6 bg-white rounded-full shadow-lg shadow-black/20
            transform -translate-x-1/2 pointer-events-none
            transition-transform duration-75
            ${!disabled && 'group-active:scale-110'}
          `}
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

export default Slider;
