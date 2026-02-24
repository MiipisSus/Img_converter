import { useState, useCallback, useRef } from "react";
import type { PipelineState, ImageItem } from "../types";
import { calculateContainerParams, getCroppedOriginalSize } from "../utils/containerParams";

interface UploadPageProps {
  onImagesLoaded: (images: ImageItem[]) => void;
}

/** 將單一 File 轉為 ImageItem (含 pipeline 初始化) */
function loadImageFile(file: File): Promise<ImageItem> {
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

export function UploadPage({ onImagesLoaded }: UploadPageProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  // 處理多個檔案
  const processFiles = useCallback(
    async (files: FileList) => {
      const imageFiles = Array.from(files).filter((f) =>
        f.type.startsWith("image/"),
      );
      if (imageFiles.length === 0) return;

      const items = await Promise.all(imageFiles.map(loadImageFile));
      onImagesLoaded(items);
    },
    [onImagesLoaded],
  );

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) processFiles(files);
    },
    [processFiles],
  );

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.types.includes("Files")) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      dragCounterRef.current = 0;

      const files = e.dataTransfer.files;
      if (files && files.length > 0) processFiles(files);
    },
    [processFiles],
  );

  return (
    <div className="min-h-screen bg-preview flex flex-col items-center justify-center">
      <div className="flex flex-col items-center gap-6">
        <h1 className="text-3xl font-bold text-sidebar">圖片處理工具</h1>
        <label
          htmlFor="image-upload"
          className="relative flex flex-col items-center cursor-pointer"
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        >
          {/* 拖放區域 + 按鈕整合 */}
          <div
            className={`w-[60vw] min-w-[320px] max-w-[720px] h-[50vh] min-h-[200px] max-h-[400px] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all ${
              isDragOver
                ? "border-highlight bg-highlight/10 scale-[1.02]"
                : "border-gray-400 hover:border-highlight/60"
            }`}
          >
            <svg
              className={`w-12 h-12 transition-colors ${isDragOver ? "text-highlight" : "text-gray-400"}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13"
              />
            </svg>
            <span
              className={`text-base transition-colors ${isDragOver ? "text-highlight font-semibold" : "text-gray-500"}`}
            >
              {isDragOver ? "放開以上傳" : "拖放圖片至此"}
            </span>
            {/* 選擇圖片按鈕 */}
            <div className="px-8 py-3 bg-highlight text-black font-bold rounded-[10px] transition-all btn-highlight hover:brightness-110 text-lg">
              選擇圖片
            </div>
            <p className="text-sm text-gray-500">支援 JPG, PNG, WebP 等格式（可多選）</p>
          </div>
        </label>
        <input
          id="image-upload"
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
