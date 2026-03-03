import type { VideoTransformState } from "../hooks/useVideoTransform";

// ─────────────────────────────────────────────
// reconstructTransformFromCrop — 從原始像素座標反推 UI transform state
// ─────────────────────────────────────────────
// 用於重新進入剪輯模式時，根據新的容器尺寸重建裁切框
// 裁切框居中於容器，translate 反推確保影片與裁切區域對齊

export function reconstructTransformFromCrop(
  crop: { x: number; y: number; width: number; height: number },
  savedScale: number,
  videoW: number,
  videoH: number,
  containerW: number,
  containerH: number,
): VideoTransformState {
  const M = Math.min(containerW / videoW, containerH / videoH);
  const scale = savedScale;

  // 裁切框 UI 尺寸 = 原始像素 × M × scale
  let cropW = crop.width * M * scale;
  let cropH = crop.height * M * scale;

  // 確保裁切框不超出容器
  cropW = Math.min(cropW, containerW);
  cropH = Math.min(cropH, containerH);

  // 裁切框居中於容器
  const cropX = (containerW - cropW) / 2;
  const cropY = (containerH - cropH) / 2;

  // 反推 translate：讓裁切區域中心對齊裁切框中心
  // UI_x = (cW - vW*M*s)/2 + tx + px*M*s
  // 令 px = crop.x + crop.width/2，UI_x = cropX + cropW/2
  const tx =
    cropX + cropW / 2 -
    (containerW - videoW * M * scale) / 2 -
    (crop.x + crop.width / 2) * M * scale;
  const ty =
    cropY + cropH / 2 -
    (containerH - videoH * M * scale) / 2 -
    (crop.y + crop.height / 2) * M * scale;

  return { scale, translateX: tx, translateY: ty, cropX, cropY, cropW, cropH };
}

// ─────────────────────────────────────────────
// getFinalVideoCropArea — UI 座標→原始像素座標 (含偶數修正)
// ─────────────────────────────────────────────
//
// 座標系統 (transform-origin: center center)：
//   影片元素由 flexbox 居中於容器 → 元素中心 = 容器中心
//   CSS transform: translate(tx,ty) scale(s)
//     1. scale(s) 圍繞元素中心縮放
//     2. translate(tx,ty) 平移
//   → 影片視覺左上角 = (containerW - videoW*M*s)/2 + tx
//
//   容器中某點 (cropX, cropY) 對應的元素佈局座標：
//     px = (cropX - vx) / scale = relX / scale
//   轉換為原始像素：
//     original_x = px / M = relX / (M * scale)
//
//   前提：videoW/H、M、CSS 元素尺寸 全部使用同一組尺寸來源
//         (effectiveVideoW/H — 優先 video.videoWidth，fallback videoInfo)

export function getFinalVideoCropArea(
  state: VideoTransformState,
  M: number,
  containerW: number,
  containerH: number,
  videoW: number,
  videoH: number,
): { x: number; y: number; width: number; height: number } {
  const { scale, translateX: tx, translateY: ty, cropX, cropY, cropW, cropH } = state;

  // 影片 CSS 元素的視覺尺寸
  const vw = videoW * M * scale;
  const vh = videoH * M * scale;

  // 影片視覺左上角 (transform-origin: center, flexbox 居中)
  const vx = (containerW - vw) / 2 + tx;
  const vy = (containerH - vh) / 2 + ty;

  // 裁切框相對於影片視覺左上角的偏移 (screen px)
  const relX = cropX - vx;
  const relY = cropY - vy;

  // 每個原始像素 = M * scale 個顯示像素
  const pixelScale = M * scale;
  let x = Math.max(0, Math.round(relX / pixelScale));
  let y = Math.max(0, Math.round(relY / pixelScale));
  let w = Math.max(2, Math.round(cropW / pixelScale));
  let h = Math.max(2, Math.round(cropH / pixelScale));

  // Clamp 至影片邊界
  x = Math.min(x, videoW - 2);
  y = Math.min(y, videoH - 2);
  w = Math.min(w, videoW - x);
  h = Math.min(h, videoH - y);

  // 偶數修正 — 符合影片編碼規範
  w = Math.floor(w / 2) * 2;
  h = Math.floor(h / 2) * 2;
  x = Math.floor(x / 2) * 2;
  y = Math.floor(y / 2) * 2;

  // 修正後邊界安全檢查
  if (x + w > videoW) x = videoW - w;
  if (y + h > videoH) y = videoH - h;
  if (x < 0) x = 0;
  if (y < 0) y = 0;

  return { x, y, width: w, height: h };
}
