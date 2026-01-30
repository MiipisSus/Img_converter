import { useRef, useCallback, useEffect, useState } from 'react';
import { Cropper } from 'react-advanced-cropper';
import type { CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';

export interface CropCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ViewMode = 'view' | 'crop';

interface ImageViewerProps {
  imageSrc: string;
  rotation: number;
  mode: ViewMode;
  initialCropCoordinates?: CropCoordinates | null;
  onCropChange?: (coordinates: CropCoordinates | null) => void;
}

export function ImageViewer({
  imageSrc,
  rotation,
  mode,
  initialCropCoordinates,
  onCropChange,
}: ImageViewerProps) {
  const cropperRef = useRef<CropperRef>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const prevRotationRef = useRef(rotation);

  // 當裁切區域變更時觸發
  const handleCropChange = useCallback(() => {
    const cropper = cropperRef.current;
    if (cropper && onCropChange) {
      const coordinates = cropper.getCoordinates();
      if (coordinates) {
        onCropChange({
          x: Math.round(coordinates.left),
          y: Math.round(coordinates.top),
          width: Math.round(coordinates.width),
          height: Math.round(coordinates.height),
        });
      }
    }
  }, [onCropChange]);

  // 當旋轉角度變化時，使用 cropper 的內建 rotate 方法
  useEffect(() => {
    const cropper = cropperRef.current;
    if (cropper && mode === 'crop') {
      const delta = rotation - prevRotationRef.current;
      if (delta !== 0) {
        // 使用 cropper 的內建旋轉功能，只旋轉圖片不旋轉裁切框
        cropper.rotateImage(delta);
      }
    }
    prevRotationRef.current = rotation;
  }, [rotation, mode]);

  // 重置圖片載入狀態
  useEffect(() => {
    setImageLoaded(false);
    prevRotationRef.current = 0;
  }, [imageSrc]);

  // 當進入裁切模式時，應用初始旋轉和裁切座標
  useEffect(() => {
    const cropper = cropperRef.current;
    if (cropper && mode === 'crop') {
      // 延遲執行以確保 cropper 已初始化
      const timer = setTimeout(() => {
        // 應用初始旋轉
        if (rotation !== 0) {
          cropper.rotateImage(rotation);
          prevRotationRef.current = rotation;
        }
        // 應用初始裁切座標
        if (initialCropCoordinates) {
          cropper.setCoordinates({
            left: initialCropCoordinates.x,
            top: initialCropCoordinates.y,
            width: initialCropCoordinates.width,
            height: initialCropCoordinates.height,
          });
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [mode, imageSrc]);

  return (
    <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden">
      {mode === 'crop' ? (
        // 裁切模式 - 使用 cropper 內建旋轉
        <Cropper
          ref={cropperRef}
          src={imageSrc}
          onChange={handleCropChange}
          className="h-full! w-full!"
          stencilProps={{
            movable: true,
            resizable: true,
            lines: true,
            handlers: true,
          }}
          backgroundClassName="!bg-slate-950"
        />
      ) : (
        // 檢視模式
        <div
          className="relative flex items-center justify-center w-full h-full p-4"
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: 'transform 0.3s ease',
          }}
        >
          {!imageLoaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
            </div>
          )}
          <img
            src={imageSrc}
            alt="Preview"
            onLoad={() => setImageLoaded(true)}
            className={`
              max-w-full max-h-full object-contain
              transition-opacity duration-300
              ${imageLoaded ? 'opacity-100' : 'opacity-0'}
            `}
          />
        </div>
      )}
    </div>
  );
}

export default ImageViewer;
