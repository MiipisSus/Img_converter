import type { PipelineState, ImageItem } from "../types";
import { calculateContainerParams, getCroppedOriginalSize } from "./containerParams";

/** 將單一 File 轉為 ImageItem (含 pipeline 初始化) */
export function loadImageFile(file: File): Promise<ImageItem> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("不是圖片檔案"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = (event) => {
      const src = event.target?.result as string;

      const img = new Image();
      img.src = src;
      img.onload = () => {
        const { M, containerWidth, containerHeight } =
          calculateContainerParams(img.naturalWidth, img.naturalHeight, 0);

        const initialState = {
          imageX: 0,
          imageY: 0,
          scale: 1,
          rotate: 0,
          baseRotate: 0,
          flipX: false,
          flipY: false,
          cropX: 0,
          cropY: 0,
          cropW: containerWidth,
          cropH: containerHeight,
        };

        const initialImageInfo = {
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          displayMultiplier: M,
          containerWidth,
          containerHeight,
        };

        const croppedSize = getCroppedOriginalSize(initialState, initialImageInfo);

        const initialPipeline: PipelineState = {
          editorState: initialState,
          imageInfo: initialImageInfo,
          previewUrl: null,
          previewBlob: null,
          resize: {
            active: false,
            targetWidth: croppedSize.width,
            targetHeight: croppedSize.height,
            lockAspectRatio: true,
            croppedWidth: croppedSize.width,
            croppedHeight: croppedSize.height,
          },
          outputWidth: croppedSize.width,
          outputHeight: croppedSize.height,
        };

        resolve({
          id: crypto.randomUUID(),
          src,
          imgElement: img,
          pipelineState: initialPipeline,
          visualBaseRotate: 0,
        });
      };
      img.onerror = () => reject(new Error("圖片載入失敗"));
    };
    reader.readAsDataURL(file);
  });
}
