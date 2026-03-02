const API_BASE = "/api";

export interface VideoInfoResult {
  duration: number;
  width: number;
  height: number;
  fps: number;
  has_audio: boolean;
  file_size: number;
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
