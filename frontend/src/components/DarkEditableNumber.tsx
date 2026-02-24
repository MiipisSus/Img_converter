import { useState } from "react";

/** 可點擊編輯的數字 (dark theme) */
export function DarkEditableNumber({
  value,
  min,
  max,
  suffix = "",
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(value));

  const commit = () => {
    setEditing(false);
    const num = parseInt(inputValue);
    if (!isNaN(num) && num >= min && num <= max) {
      onChange(num);
    } else {
      setInputValue(String(value));
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        min={min}
        max={max}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setInputValue(String(value));
            setEditing(false);
          }
        }}
        autoFocus
        className="w-16 px-1 py-0 text-xs text-right input-dark"
      />
    );
  }

  return (
    <span
      onClick={() => {
        setInputValue(String(value));
        setEditing(true);
      }}
      className="text-xs text-white/70 font-medium cursor-pointer hover:text-highlight transition-colors"
      title="點擊輸入數值"
    >
      {value}
      {suffix}
    </span>
  );
}
