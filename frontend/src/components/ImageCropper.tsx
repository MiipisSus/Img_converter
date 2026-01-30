import { useRef, useEffect, useCallback } from 'react';
import { Cropper } from 'react-advanced-cropper';
import type { CropperRef } from 'react-advanced-cropper';
import 'react-advanced-cropper/dist/style.css';

export interface CropCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ImageCropperProps {
  imageSrc: string;
  rotation: number;
  onCropChange: (coordinates: CropCoordinates | null) => void;
}

export function ImageCropper({ imageSrc, rotation, onCropChange }: ImageCropperProps) {
  const cropperRef = useRef<CropperRef>(null);

  // 當裁切區域變更時觸發
  const handleChange = useCallback(() => {
    const cropper = cropperRef.current;
    if (cropper) {
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

  // 當旋轉角度變化時重新渲染 cropper
  useEffect(() => {
    const cropper = cropperRef.current;
    if (cropper) {
      cropper.refresh();
    }
  }, [rotation]);

  return (
    <div className="relative w-full rounded-xl overflow-hidden bg-slate-900">
      <div
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 0.3s ease',
        }}
      >
        <Cropper
          ref={cropperRef}
          src={imageSrc}
          onChange={handleChange}
          className="cropper"
          stencilProps={{
            aspectRatio: undefined, // 自由裁切比例
            movable: true,
            resizable: true,
          }}
          backgroundClassName="bg-slate-900"
        />
      </div>
    </div>
  );
}

export default ImageCropper;
