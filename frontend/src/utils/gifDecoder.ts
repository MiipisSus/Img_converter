/**
 * GIF 幀解碼工具 — 使用 WebCodecs ImageDecoder API
 * 用於膠捲縮圖產生與時間軸拖曳時的幀預覽
 */

/** 檢查瀏覽器是否支援 ImageDecoder API */
export function isImageDecoderSupported(): boolean {
  return typeof globalThis.ImageDecoder === "function";
}

/** 從 GIF 檔產生膠捲縮圖 (data URL 陣列) */
export async function generateGifFilmstrip(
  file: File,
  count: number,
): Promise<string[]> {
  if (!isImageDecoderSupported()) return [];

  const buffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });

  await decoder.tracks.ready;
  const totalFrames = decoder.tracks.selectedTrack!.frameCount;

  const thumbH = 60;
  const canvas = document.createElement("canvas");
  const results: string[] = [];

  for (let i = 0; i < count; i++) {
    const frameIndex = Math.min(
      Math.floor(((i + 0.5) * totalFrames) / count),
      totalFrames - 1,
    );

    const { image } = await decoder.decode({ frameIndex });

    if (i === 0) {
      canvas.width = Math.round(
        (image.displayWidth / image.displayHeight) * thumbH,
      );
      canvas.height = thumbH;
    }

    const ctx = canvas.getContext("2d")!;
    // VideoFrame 實作 CanvasImageSource
    ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height);
    image.close();

    results.push(canvas.toDataURL("image/jpeg", 0.5));
  }

  decoder.close();
  return results;
}

/** GIF 幀搜尋器介面 */
export interface GifSeeker {
  totalFrames: number;
  /** 將指定時間的幀渲染到 canvas */
  seekTo(
    timeSec: number,
    durationSec: number,
    canvas: HTMLCanvasElement,
  ): Promise<void>;
  /** 釋放資源 */
  close(): void;
}

/** 建立 GIF 幀搜尋器 (用於拖曳時即時預覽) */
export async function createGifSeeker(
  file: File,
): Promise<GifSeeker | null> {
  if (!isImageDecoderSupported()) return null;

  const buffer = await file.arrayBuffer();
  const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });

  await decoder.tracks.ready;
  const totalFrames = decoder.tracks.selectedTrack!.frameCount;

  return {
    totalFrames,

    async seekTo(
      timeSec: number,
      durationSec: number,
      canvas: HTMLCanvasElement,
    ) {
      if (durationSec <= 0) return;
      const frameIndex = Math.min(
        Math.max(0, Math.floor((timeSec / durationSec) * totalFrames)),
        totalFrames - 1,
      );

      const { image } = await decoder.decode({ frameIndex });
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(image as unknown as CanvasImageSource, 0, 0, canvas.width, canvas.height);
      }
      image.close();
    },

    close() {
      decoder.close();
    },
  };
}
