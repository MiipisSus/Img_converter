import type React from "react";

type CropResizeHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

interface CropOverlayProps {
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  transition: string;
  onResizeMouseDown: (handle: CropResizeHandle) => (e: React.MouseEvent) => void;
  onResizeTouchStart?: (handle: CropResizeHandle) => (e: React.TouchEvent) => void;
}

export function CropOverlay({
  cropX,
  cropY,
  cropW,
  cropH,
  transition,
  onResizeMouseDown,
  onResizeTouchStart,
}: CropOverlayProps) {
  return (
    <>
      {/* 遮罩層 */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute bg-black/50"
          style={{ top: 0, left: 0, right: 0, height: cropY, transition }}
        />
        <div
          className="absolute bg-black/50"
          style={{ top: cropY + cropH, left: 0, right: 0, bottom: 0, transition }}
        />
        <div
          className="absolute bg-black/50"
          style={{ top: cropY, left: 0, width: cropX, height: cropH, transition }}
        />
        <div
          className="absolute bg-black/50"
          style={{
            top: cropY,
            left: cropX + cropW,
            right: 0,
            height: cropH,
            transition,
          }}
        />
      </div>

      {/* 裁切框 + 手把 */}
      <div
        className="absolute border-2 pointer-events-none"
        style={{
          left: cropX,
          top: cropY,
          width: cropW,
          height: cropH,
          borderColor: "#00B4FF",
          transition,
        }}
      >
        {/* 九宮格 */}
        <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
          {[...Array(9)].map((_, i) => (
            <div
              key={i}
              className="border"
              style={{ borderColor: "rgba(0, 180, 255, 0.3)" }}
            />
          ))}
        </div>

        {/* 四角 Handles (含擴展觸控區) */}
        {(["nw", "ne", "sw", "se"] as const).map((handle) => (
          <div
            key={handle}
            className="absolute w-5 h-5 pointer-events-auto crop-handle"
            style={{
              top: handle.includes("n") ? -10 : "auto",
              bottom: handle.includes("s") ? -10 : "auto",
              left: handle.includes("w") ? -10 : "auto",
              right: handle.includes("e") ? -10 : "auto",
              cursor:
                handle === "nw" || handle === "se"
                  ? "nwse-resize"
                  : "nesw-resize",
              backgroundColor: "#00B4FF",
              borderRadius: 2,
            }}
            onMouseDown={onResizeMouseDown(handle)}
            onTouchStart={onResizeTouchStart?.(handle)}
          />
        ))}

        {/* 四邊 Handles (含擴展觸控區) */}
        {(["n", "s", "e", "w"] as const).map((handle) => (
          <div
            key={handle}
            className="absolute pointer-events-auto crop-handle"
            style={{
              backgroundColor: "#00B4FF",
              borderRadius: 3,
              ...(handle === "n" && {
                top: -4,
                left: "50%",
                transform: "translateX(-50%)",
                width: 36,
                height: 8,
                cursor: "ns-resize",
              }),
              ...(handle === "s" && {
                bottom: -4,
                left: "50%",
                transform: "translateX(-50%)",
                width: 36,
                height: 8,
                cursor: "ns-resize",
              }),
              ...(handle === "w" && {
                left: -4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 8,
                height: 36,
                cursor: "ew-resize",
              }),
              ...(handle === "e" && {
                right: -4,
                top: "50%",
                transform: "translateY(-50%)",
                width: 8,
                height: 36,
                cursor: "ew-resize",
              }),
            }}
            onMouseDown={onResizeMouseDown(handle)}
            onTouchStart={onResizeTouchStart?.(handle)}
          />
        ))}
      </div>
    </>
  );
}
