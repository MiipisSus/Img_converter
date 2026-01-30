interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
}

export function Switch({ checked, onChange, disabled = false, label }: SwitchProps) {
  return (
    <label
      className={`
        flex items-center justify-between gap-3 min-h-[44px] cursor-pointer
        ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
      `}
    >
      {label && (
        <span className="text-sm font-medium text-slate-300">{label}</span>
      )}

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
        className={`
          relative inline-flex h-8 w-14 shrink-0 items-center rounded-full
          transition-colors duration-200 ease-in-out
          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900
          ${checked ? 'bg-blue-500' : 'bg-slate-600'}
          ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        <span
          className={`
            inline-block h-6 w-6 transform rounded-full bg-white shadow-lg shadow-black/20
            transition-transform duration-200 ease-in-out
            ${checked ? 'translate-x-7' : 'translate-x-1'}
          `}
        />
      </button>
    </label>
  );
}

export default Switch;
