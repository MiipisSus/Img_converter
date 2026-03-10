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
  const isUrl = typeof source === "string";
  const url = isUrl ? source : URL.createObjectURL(source);

  try {
    return await extractFrames(url, count);
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
    video.setAttribute("webkit-playsinline", "true");
    video.src = url;

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      video.removeEventListener("error", onError);
      video.pause();
      video.src = "";
      video.load();
    };

    const onError = () => {
      cleanup();
      reject(new Error("影片載入失敗"));
    };
    video.addEventListener("error", onError);

    const results: string[] = [];
    let idx = 0;
    let interval = 0;
    let thumbW = 0;
    const thumbH = 60;
    let canvas: HTMLCanvasElement;
    let ctx: CanvasRenderingContext2D;

    const seekTo = (time: number) => {
      // 使用 one-shot seeked listener 避免殘留 listener 多次觸發
      video.addEventListener("seeked", onSeeked, { once: true });
      video.currentTime = Math.min(time, video.duration - 0.01);
    };

    const captureNext = () => {
      if (idx >= count) {
        cleanup();
        resolve(results);
        return;
      }
      const targetTime = interval * idx + interval / 2;
      seekTo(targetTime);
    };

    const onSeeked = () => {
      // 行動端可能 seeked 時尚未解碼 — 等待有足夠資料
      if (video.readyState < 2) {
        video.addEventListener("canplay", drawAndNext, { once: true });
        return;
      }
      drawAndNext();
    };

    const drawAndNext = () => {
      try {
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        results.push(canvas.toDataURL("image/jpeg", 0.5));
      } catch {
        // drawImage 可能因 CORS 或安全性限制失敗 — 跳過此幀
        results.push("");
      }
      idx++;
      captureNext();
    };

    video.addEventListener("loadedmetadata", async () => {
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

      // 行動端解鎖硬體解碼器：短暫 play → pause，確保 Canvas 能抓到非黑屏畫面
      try {
        await video.play();
        video.pause();
      } catch {
        // 自動播放被阻擋時忽略，seek 仍可運作
      }

      captureNext();
    });
  });
}
