import type { EditorState, ImageInfo } from "./hooks/useImageEditor";

export type AppStep = "upload" | "edit" | "export";

/** 調整尺寸狀態 */
export interface ResizeState {
  active: boolean;
  targetWidth: number;
  targetHeight: number;
  lockAspectRatio: boolean;
  /** 裁切後的原始基準尺寸 (用於計算比例和顯示) */
  croppedWidth: number;
  croppedHeight: number;
}

/** 持久化的 Pipeline 狀態 */
export interface PipelineState {
  editorState: EditorState;
  imageInfo: ImageInfo;
  previewUrl: string | null;
  /** 最近一次產生的圖片 Blob (用於 PDF 匯出等) */
  previewBlob: Blob | null;
  resize: ResizeState;
  /** 實際輸出尺寸 (僅在套用後更新) */
  outputWidth: number;
  outputHeight: number;
}

/** 匯出格式類型 (含原始格式) */
export type ExportFormat = "png" | "jpeg" | "webp" | "original";

/** 多圖管理的單一圖片項目 */
export interface ImageItem {
  id: string;
  src: string;
  imgElement: HTMLImageElement;
  pipelineState: PipelineState;
  /** 累積視覺旋轉角度 (不取模，用於 CSS 平滑動畫避免 270°→0° 反向插值) */
  visualBaseRotate: number;
  /** 原始檔案的 MIME Type (例如 image/jpeg) */
  originalMimeType: string;
  /** 原始格式 (由 MIME Type 解析，僅 png/jpeg/webp，其餘 fallback 為 png) */
  originalFormat: "png" | "jpeg" | "webp";
  /** 輸出格式 (ExportPage 統一輸出用) */
  exportFormat?: ExportFormat;
  /** 輸出品質 0-100 (ExportPage 統一輸出用) */
  exportQuality?: number;
}

/** 輸出設定狀態 (暫態，返回裁切時會重置) */
export interface OutputSettings {
  targetWidth: number;
  targetHeight: number;
  lockAspectRatio: boolean;
  format: ExportFormat;
  /** 基準尺寸 (進入輸出模式時的裁切尺寸) */
  baseWidth: number;
  baseHeight: number;
  /** 品質 (0-100, 僅 JPEG/WebP 有效) */
  quality: number;
  /** 目標檔案大小 (KB)，null 表示不限制 */
  targetKB: number | null;
  /** 是否啟用目標 KB 限制 */
  enableTargetKB: boolean;
  /** 上次導出的檔案大小 (bytes) */
  lastExportSize: number | null;
}
