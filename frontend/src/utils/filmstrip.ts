/**
 * generateFilmstrip — 從影片檔擷取等間距縮圖
 *
 * 在記憶體中建立隱藏 <video> + <canvas>，
 * 將影片切成 count 等分依序 seek 並 drawImage 產生 JPEG data URL。
 */
export async function generateFilmstrip(
  source: File | string,
  count = 10,
): Promise<string[]> {
  // string → 直接當作 URL；File → 建立 ObjectURL
  const isUrl = typeof source === "string";
  const url = isUrl ? source : URL.createObjectURL(source);

  try {
    const thumbnails = await extractFrames(url, count);
    return thumbnails;
  } finally {
    if (!isUrl) URL.revokeObjectURL(url);
  }
}

function extractFrames(url: string, count: number): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    video.src = url;

    const onError = () => {
      cleanup();
      reject(new Error("影片載入失敗"));
    };

    const cleanup = () => {
      video.removeEventListener("error", onError);
      video.removeEventListener("seeked", onSeeked);
      video.src = "";
      video.load();
    };

    video.addEventListener("error", onError);

    const results: string[] = [];
    let idx = 0;
    let interval = 0;
    let thumbW = 0;
    let thumbH = 60;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;

    const captureNext = () => {
      if (idx >= count) {
        cleanup();
        resolve(results);
        return;
      }
      const dur = video.duration;
      const targetTime = interval * idx + interval / 2;
      video.currentTime = Math.min(targetTime, dur - 0.01);
    };

    const onSeeked = () => {
      // 確保影片有畫面可繪製 (行動端可能尚未解碼)
      if (video.readyState < 2) {
        const waitForData = () => {
          video.removeEventListener("canplay", waitForData);
          drawAndNext();
        };
        video.addEventListener("canplay", waitForData);
        return;
      }
      drawAndNext();
    };

    const drawAndNext = () => {
      ctx.drawImage(video, 0, 0, thumbW, thumbH);
      results.push(canvas.toDataURL("image/jpeg", 0.5));
      idx++;
      captureNext();
    };

    video.addEventListener("seeked", onSeeked);

    video.addEventListener("loadedmetadata", () => {
      const duration = video.duration;
      if (!duration || !isFinite(duration) || duration <= 0) {
        cleanup();
        reject(new Error("無法取得影片長度"));
        return;
      }

      thumbW = Math.round((video.videoWidth / video.videoHeight) * thumbH);
      canvas = document.createElement("canvas");
      canvas.width = thumbW;
      canvas.height = thumbH;
      ctx = canvas.getContext("2d")!;
      interval = duration / count;

      captureNext();
    });
  });
}
