import axios from 'axios';
import type { AxiosProgressEvent } from 'axios';

// API 基礎設定
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 60000, // 60 秒超時（大檔案可能需要較長時間）
});

// 圖片處理參數介面
export interface ProcessImageParams {
  file: File;
  outputFormat?: string;
  quality?: number;
  rotateAngle?: number;
  rotateExpand?: boolean;
  flipDirection?: 'horizontal' | 'vertical';
  cropX?: number;
  cropY?: number;
  cropWidth?: number;
  cropHeight?: number;
  resizeWidth?: number;
  resizeHeight?: number;
  resizeScale?: number;
  resizeKeepRatio?: boolean;
}

// 圖片資訊回應介面
export interface ImageInfoResponse {
  format: string;
  mode: string;
  width: number;
  height: number;
  file_size: number;
  is_vector: boolean;
}

// 處理結果回應介面
export interface ProcessingResultResponse {
  success: boolean;
  message: string;
  original_filename: string;
  original_size: [number, number];
  output_size: [number, number];
  input_file_size: number;
  output_file_size: number;
  operations_applied: string[];
}

// 進度回呼函式類型
type ProgressCallback = (progress: number) => void;

/**
 * 取得圖片資訊
 */
export async function getImageInfo(file: File): Promise<ImageInfoResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<ImageInfoResponse>('/images/info', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });

  return response.data;
}

/**
 * 處理圖片並返回處理資訊（不下載圖片）
 */
export async function processImageInfo(
  params: ProcessImageParams,
  onProgress?: ProgressCallback
): Promise<ProcessingResultResponse> {
  const formData = buildFormData(params);

  const response = await api.post<ProcessingResultResponse>(
    '/images/upload/info',
    formData,
    {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (event: AxiosProgressEvent) => {
        if (onProgress && event.total) {
          onProgress(Math.round((event.loaded / event.total) * 100));
        }
      },
    }
  );

  return response.data;
}

/**
 * 處理圖片並返回圖片 Blob
 */
export async function processImage(
  params: ProcessImageParams,
  onProgress?: ProgressCallback
): Promise<{ blob: Blob; filename: string; originalSize: string; outputSize: string }> {
  const formData = buildFormData(params);

  const response = await api.post('/images/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    responseType: 'blob',
    onUploadProgress: (event: AxiosProgressEvent) => {
      if (onProgress && event.total) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    },
  });

  // 從 Content-Disposition 取得檔名
  const contentDisposition = response.headers['content-disposition'] || '';
  const filenameMatch = contentDisposition.match(/filename="?([^";\n]+)"?/);
  const filename = filenameMatch ? filenameMatch[1] : 'processed_image';

  // 從自訂標頭取得尺寸資訊
  const originalSize = response.headers['x-original-size'] || '';
  const outputSize = response.headers['x-output-size'] || '';

  return {
    blob: response.data,
    filename,
    originalSize,
    outputSize,
  };
}

/**
 * 建立 FormData
 */
function buildFormData(params: ProcessImageParams): FormData {
  const formData = new FormData();
  formData.append('file', params.file);

  if (params.outputFormat) {
    formData.append('output_format', params.outputFormat);
  }
  if (params.quality !== undefined) {
    formData.append('quality', params.quality.toString());
  }
  if (params.rotateAngle !== undefined) {
    formData.append('rotate_angle', params.rotateAngle.toString());
  }
  if (params.rotateExpand !== undefined) {
    formData.append('rotate_expand', params.rotateExpand.toString());
  }
  if (params.flipDirection) {
    formData.append('flip_direction', params.flipDirection);
  }
  if (params.cropX !== undefined) {
    formData.append('crop_x', params.cropX.toString());
  }
  if (params.cropY !== undefined) {
    formData.append('crop_y', params.cropY.toString());
  }
  if (params.cropWidth !== undefined) {
    formData.append('crop_width', params.cropWidth.toString());
  }
  if (params.cropHeight !== undefined) {
    formData.append('crop_height', params.cropHeight.toString());
  }
  if (params.resizeWidth !== undefined) {
    formData.append('resize_width', params.resizeWidth.toString());
  }
  if (params.resizeHeight !== undefined) {
    formData.append('resize_height', params.resizeHeight.toString());
  }
  if (params.resizeScale !== undefined) {
    formData.append('resize_scale', params.resizeScale.toString());
  }
  if (params.resizeKeepRatio !== undefined) {
    formData.append('resize_keep_ratio', params.resizeKeepRatio.toString());
  }

  return formData;
}

/**
 * 下載處理後的圖片
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default api;
