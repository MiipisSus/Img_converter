import type { EditorState, ImageInfo } from "../hooks/useImageEditor";
import {
  CONTAINER_MIN_WIDTH,
  CONTAINER_MAX_WIDTH,
  CONTAINER_MIN_HEIGHT,
  CONTAINER_MAX_HEIGHT,
} from "../constants";

/** 計算有效尺寸和容器參數 - 符合 IMAGE_CROPPER_SPEC V7 (雙向限制) */
export function calculateContainerParams(
  naturalWidth: number,
  naturalHeight: number,
  baseRotate: number,
): {
  effW: number;
  effH: number;
  M: number;
  containerWidth: number;
  containerHeight: number;
} {
  const MIN_WIDTH = CONTAINER_MIN_WIDTH,
    MAX_WIDTH = CONTAINER_MAX_WIDTH;
  const MIN_HEIGHT = CONTAINER_MIN_HEIGHT,
    MAX_HEIGHT = CONTAINER_MAX_HEIGHT;

  const isLeaning = Math.abs(baseRotate % 180) === 90;
  const effW = isLeaning ? naturalHeight : naturalWidth;
  const effH = isLeaning ? naturalWidth : naturalHeight;

  // 寬度需求倍率
  let Mw: number;
  if (effW > MAX_WIDTH) Mw = MAX_WIDTH / effW;
  else if (effW < MIN_WIDTH) Mw = MIN_WIDTH / effW;
  else Mw = 1;

  // 高度需求倍率
  let Mh: number;
  if (effH > MAX_HEIGHT) Mh = MAX_HEIGHT / effH;
  else if (effH < MIN_HEIGHT) Mh = MIN_HEIGHT / effH;
  else Mh = 1;

  // 模式判定：縮小優先
  const needsShrink = effW > MAX_WIDTH || effH > MAX_HEIGHT;
  const needsEnlarge = effW < MIN_WIDTH || effH < MIN_HEIGHT;

  let M: number;
  if (needsShrink) M = Math.min(Mw, Mh);
  else if (needsEnlarge) M = Math.max(Mw, Mh);
  else M = 1;

  const containerWidth = Math.round(effW * M);
  const containerHeight = Math.round(effH * M);

  return { effW, effH, M, containerWidth, containerHeight };
}

/** 計算裁切後的原始像素尺寸 */
export function getCroppedOriginalSize(
  state: EditorState,
  info: ImageInfo,
): { width: number; height: number } {
  const width = Math.round(state.cropW / info.displayMultiplier);
  const height = Math.round(state.cropH / info.displayMultiplier);
  return { width, height };
}

/** 計算預覽顯示倍率 - 符合 IMAGE_CROPPER_SPEC V7 (雙向限制) */
export function calculatePreviewMultiplier(
  width: number,
  height: number,
): number {
  const MIN_WIDTH = CONTAINER_MIN_WIDTH,
    MAX_WIDTH = CONTAINER_MAX_WIDTH;
  const MIN_HEIGHT = CONTAINER_MIN_HEIGHT,
    MAX_HEIGHT = CONTAINER_MAX_HEIGHT;

  const Mw =
    width > MAX_WIDTH
      ? MAX_WIDTH / width
      : width < MIN_WIDTH
        ? MIN_WIDTH / width
        : 1;

  const Mh =
    height > MAX_HEIGHT
      ? MAX_HEIGHT / height
      : height < MIN_HEIGHT
        ? MIN_HEIGHT / height
        : 1;

  const needsShrink = width > MAX_WIDTH || height > MAX_HEIGHT;
  const needsEnlarge = width < MIN_WIDTH || height < MIN_HEIGHT;

  if (needsShrink) return Math.min(Mw, Mh);
  if (needsEnlarge) return Math.max(Mw, Mh);
  return 1;
}
