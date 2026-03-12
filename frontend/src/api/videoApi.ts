const API_BASE = "/api";

export interface VideoInfoResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  file_size: number;
  preview_url?: string;
}

export interface BitrateEstimateResult {
  duration: number;
  width: number;
  height: number;
  has_audio: boolean;
  original_size_kb: number;
  estimated_video_bitrate_kbps: number | null;
  estimated_audio_bitrate_kbps: number | null;
  estimated_total_bitrate_kbps: number | null;
  warning?: string;
}

/** 取得影片基本資訊 */
export async function getVideoInfo(file: File): Promise<VideoInfoResult> {
  const formData = new FormData();
  formData.append("video", file);

  const res = await fetch(`${API_BASE}/videos/info`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "取得影片資訊失敗" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

/** 預估壓縮後的位元率與檔案大小 */
export async function estimateVideo(
  file: File,
  opts: {
    target_kb?: number;
    include_audio?: boolean;
  } = {},
): Promise<BitrateEstimateResult> {
  const formData = new FormData();
  formData.append("video", file);
  if (opts.target_kb !== undefined) {
    formData.append("target_kb", String(opts.target_kb));
  }
  if (opts.include_audio !== undefined) {
    formData.append("include_audio", String(opts.include_audio));
  }

  const res = await fetch(`${API_BASE}/videos/estimate`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "預估失敗" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }

  return res.json();
}

// ─────────────────────────────────────────────
// 影片匯出 (壓縮 / 狀態 / 下載 / 清理)
// ─────────────────────────────────────────────

export interface TaskSubmitResult {
  task_id: string;
  status: string;
  estimated_video_bitrate_kbps?: number;
  estimated_audio_bitrate_kbps?: number;
  warning?: string;
}

export interface TaskStatusResult {
  task_id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  download_url?: string;
  original_size_kb?: number;
  output_size_kb?: number;
  duration?: number;
  video_bitrate_kbps?: number;
  audio_bitrate_kbps?: number;
  warning?: string;
  error?: string;
}

export interface CompressOptions {
  target_kb?: number;
  output_format?: string;
  include_audio?: boolean;
  quality_preset?: string;
  start_t?: number;
  end_t?: number;
  rotate?: number;
  flip_h?: boolean;
  flip_v?: boolean;
  target_w?: number;
  crop_x?: number;
  crop_y?: number;
  crop_w?: number;
  crop_h?: number;
}

/** 提交影片壓縮任務（支援上傳進度回報） */
export async function submitCompress(
  file: File,
  opts: CompressOptions = {},
  onUploadProgress?: (pct: number) => void,
): Promise<TaskSubmitResult> {
  const fd = new FormData();
  fd.append("video", file);
  for (const [k, v] of Object.entries(opts)) {
    if (v !== undefined) fd.append(k, String(v));
  }

  return new Promise<TaskSubmitResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/videos/compress`);

    if (onUploadProgress) {
      xhr.upload.addEventListener("progress", (e) => {
        if (e.lengthComputable && e.total > 0) {
          onUploadProgress(Math.round((e.loaded / e.total) * 100));
        }
      });
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText));
        } catch {
          reject(new Error("解析回應失敗"));
        }
      } else {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.detail || `HTTP ${xhr.status}`));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };

    xhr.onerror = () => reject(new Error("網路錯誤"));
    xhr.send(fd);
  });
}

/** 查詢任務狀態 */
export async function getTaskStatus(taskId: string): Promise<TaskStatusResult> {
  const res = await fetch(`${API_BASE}/videos/status/${taskId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "查詢狀態失敗" }));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return res.json();
}

/** 下載處理完成的影片 */
export async function downloadVideo(taskId: string): Promise<Blob> {
  const res = await fetch(`${API_BASE}/videos/download/${taskId}`);
  if (!res.ok) {
    throw new Error("下載失敗");
  }
  return res.blob();
}

/** 清理已完成的任務 */
export async function cleanupTask(taskId: string): Promise<void> {
  await fetch(`${API_BASE}/videos/tasks/${taskId}`, { method: "DELETE" });
}
