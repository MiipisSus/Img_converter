圖片裁切工具架構設計規格 (V5 - 比例貼合與還原修正版)

1.  佈局邏輯：Responsive Fitting

    容器比例 (Container Aspect)：容器的長寬比必須嚴格等於圖片的 naturalWidth / naturalHeight。

    動態顯示倍率 (displayMultiplier, M)：

        設定顯示邊界：MIN_WIDTH = 400, MAX_WIDTH = 800 (或視窗寬度的 80%)。

        計算邏輯：

            若 naturalWidth > MAX_WIDTH：M=MAX_WIDTH/naturalWidth (縮小顯示)。

            若 naturalWidth < MIN_WIDTH：M=MIN_WIDTH/naturalWidth (放大顯示)。

            其他情況：M=1 (原始大小顯示)。

        容器 CSS 尺寸 = (naturalWidth∗M,naturalHeight∗M)。

    視覺呈現：容器應剛好包裹圖片，不論縮小或放大，背景都應被圖片填滿。

2.  數據模型 (Data State)

所有座標與尺寸（如 cropBox.w）均以「UI 顯示尺寸」記錄：
TypeScript

interface CropState {
displayMultiplier: number; // 關鍵倍率 M
image: {
x: number; y: number; // 相對於容器中心的 UI 位移
scale: number; // 用戶縮放倍率
rotate: number; // 0-360
};
cropBox: {
x: number; y: number; // 相對於容器左上角的 UI 座標
w: number; h: number; // UI 寬高
};
}

3. 座標同步與變換順序 (The Golden Rule)

預覽 (CSS) 與 導出 (Canvas) 順序必須完全一致：

    Translate (平移)

    Rotate (旋轉)

    Scale (縮放)

4. Canvas 導出精確公式 (Canvas Export Logic)

導出的核心是**「無視 M 的存在」**，直接對應原始像素：

    畫布尺寸 (還原像素)：

        canvas.width = cropBox.w / M;

        canvas.height = cropBox.h / M;

    座標變換與繪製：

        計算 UI 向量差：

            distX = (cropBox.x + cropBox.w / 2) - (container.w / 2 + image.x);

            distY = (cropBox.y + cropBox.h / 2) - (container.h / 2 + image.y);

        轉換為原始像素向量：

            distX_orig = distX / M;

            distY_orig = distY / M;

        Canvas 繪製步驟：

            ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig);

            ctx.rotate((image.rotate * Math.PI) / 180);

            ctx.scale(image.scale, image.scale);

            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);

5. 實作檢查清單

   [x] 監聽圖片載入事件，動態計算符合 MAX_WIDTH 或 MIN_WIDTH 的 M 值。

   [x] 確保容器 CSS 使用 width 和 height 直接設定，而非固定的像素值。

   [x] 驗證：2500px 的圖在 UI 上顯示為 800px (M=0.32)，裁切 400px 的框時，導出圖片應為 400/0.32=1250px。
