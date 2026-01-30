import type { LucideIcon } from 'lucide-react';

interface ToolButtonProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  onClick: () => void;
  disabled?: boolean;
}

export function ToolButton({
  icon: Icon,
  label,
  active = false,
  onClick,
  disabled = false,
}: ToolButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`
        flex flex-col items-center justify-center gap-1.5
        min-w-[64px] min-h-[64px] p-2
        rounded-2xl transition-all duration-200
        ${active
          ? 'bg-blue-500/20 text-blue-400'
          : 'bg-slate-800/50 text-slate-400 hover:bg-slate-700/50 hover:text-slate-300'
        }
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer active:scale-95'}
      `}
    >
      <Icon className="w-6 h-6" strokeWidth={1.5} />
      <span className="text-xs font-medium">{label}</span>
    </button>
  );
}

export default ToolButton;
