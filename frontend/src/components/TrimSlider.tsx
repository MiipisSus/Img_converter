import { useCallback, useRef, useEffect } from "react";

export interface TrimSliderProps {
  duration: number;
  startT: number;
  endT: number;
  currentTime: number;
  filmstrip: string[];
  onStartChange: (v: number) => void;
  onEndChange: (v: number) => void;
  onSeek: (v: number) => void;
  onDragStart?: () => void;
  onDragEnd?: (target: "start" | "end" | "seek") => void;
}

export function TrimSlider({
  duration,
  startT,
  endT,
  currentTime,
  filmstrip,
  onStartChange,
  onEndChange,
  onSeek,
  onDragStart,
  onDragEnd,
}: TrimSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<"start" | "end" | "seek" | null>(null);

  const toPercent = (v: number) => (duration > 0 ? (v / duration) * 100 : 0);

  /** 從 mouse 或 touch 事件取得 clientX */
  const clientXFromEvent = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): number => {
    if ("touches" in e) {
      return e.touches.length > 0 ? e.touches[0].clientX : (e as TouchEvent).changedTouches[0].clientX;
    }
    return (e as MouseEvent).clientX;
  };

  const posFromEvent = useCallback(
    (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || duration <= 0) return 0;
      const x = clientXFromEvent(e);
      const ratio = Math.max(0, Math.min(1, (x - rect.left) / rect.width));
      return ratio * duration;
    },
    [duration],
  );

  const handlePointerDown = useCallback(
    (target: "start" | "end") => (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      draggingRef.current = target;
      onDragStart?.();
    },
    [onDragStart],
  );

  const handleTrackPointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".trim-slider__thumb")) return;
      e.preventDefault();
      e.stopPropagation();
      const pos = posFromEvent(e);
      onSeek(Math.max(startT, Math.min(endT, pos)));
      draggingRef.current = "seek";
      onDragStart?.();
    },
    [posFromEvent, onSeek, startT, endT, onDragStart],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent | TouchEvent) => {
      const d = draggingRef.current;
      if (!d) return;
      if (e.cancelable) e.preventDefault();
      const pos = Math.round(posFromEvent(e) * 10) / 10;
      if (d === "start") {
        onStartChange(Math.max(0, Math.min(pos, endT - 0.1)));
      } else if (d === "end") {
        onEndChange(Math.max(startT + 0.1, Math.min(pos, duration)));
      } else if (d === "seek") {
        onSeek(Math.max(startT, Math.min(endT, pos)));
      }
    };

    const handleUp = () => {
      const d = draggingRef.current;
      draggingRef.current = null;
      if (d) onDragEnd?.(d);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    window.addEventListener("touchmove", handleMove, { passive: false });
    window.addEventListener("touchend", handleUp);
    window.addEventListener("touchcancel", handleUp);
    return () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      window.removeEventListener("touchmove", handleMove);
      window.removeEventListener("touchend", handleUp);
      window.removeEventListener("touchcancel", handleUp);
    };
  }, [duration, startT, endT, posFromEvent, onStartChange, onEndChange, onSeek, onDragEnd]);

  const startPct = toPercent(startT);
  const endPct = toPercent(endT);

  return (
    <div
      className="trim-slider"
      ref={trackRef}
      style={{ touchAction: "none" }}
      onMouseDown={handleTrackPointerDown}
      onTouchStart={handleTrackPointerDown}
    >
      {/* 縮圖膠捲背景 */}
      {filmstrip.length > 0 && (
        <div className="trim-slider__filmstrip">
          {filmstrip.map((src, i) => (
            <img key={i} src={src} alt="" draggable={false} />
          ))}
        </div>
      )}

      {/* 未選取區域暗層 — 左側 */}
      <div
        className="trim-slider__dim"
        style={{ left: 0, width: `${startPct}%` }}
      />
      {/* 未選取區域暗層 — 右側 */}
      <div
        className="trim-slider__dim"
        style={{ left: `${endPct}%`, width: `${100 - endPct}%` }}
      />

      {/* 選取區間藍色邊框 */}
      <div
        className="trim-slider__range"
        style={{
          left: `${startPct}%`,
          width: `${endPct - startPct}%`,
        }}
      />

      {/* 播放進度指示線 */}
      <div
        className="trim-slider__playhead"
        style={{ left: `${toPercent(currentTime)}%` }}
      />

      {/* 左手把 */}
      <div
        className="trim-slider__thumb"
        style={{ left: `${startPct}%` }}
        onMouseDown={handlePointerDown("start")}
        onTouchStart={handlePointerDown("start")}
      />
      {/* 右手把 */}
      <div
        className="trim-slider__thumb"
        style={{ left: `${endPct}%` }}
        onMouseDown={handlePointerDown("end")}
        onTouchStart={handlePointerDown("end")}
      />
    </div>
  );
}
