import { useEffect, useRef } from "react";

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 主題色 accent (預設 #00B4FF) */
  accent?: string;
}

export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "確認",
  cancelLabel = "取消",
  onConfirm,
  onCancel,
  accent = "#00B4FF",
}: ConfirmModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  // ESC 關閉
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === overlayRef.current) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-modal-title"
        className="bg-[#1e1e1e] border border-white/10 rounded-2xl p-6 w-[320px] shadow-2xl flex flex-col gap-4"
      >
        <h3 id="confirm-modal-title" className="text-base font-bold text-white">{title}</h3>
        <p className="text-sm text-white/60 leading-relaxed">{message}</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-medium text-white/70 bg-white/10 hover:bg-white/15 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 py-2.5 text-sm font-bold text-black rounded-lg transition-colors"
            style={{ background: accent }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
