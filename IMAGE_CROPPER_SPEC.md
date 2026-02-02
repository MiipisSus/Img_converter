圖片裁切工具架構設計規格 (V5 - 比例貼合與還原修正版)

1.  佈局邏輯：Responsive Fitting

    容器比例 (Container Aspect)：容器的長寬比必須嚴格等於圖片的 naturalWidth / naturalHeight。

    顯示倍率 (Display Multiplier)：

        若圖片原始寬度 > MIN_WIDTH (如 400px)，則顯示倍率 M=1。

        若圖片原始寬度 < MIN_WIDTH，則顯示倍率 M=400/naturalWidth。

        容器 CSS 尺寸 = (naturalWidth∗M,naturalHeight∗M)。

    視覺呈現：圖片應初始填滿容器（不留白邊），容器背景應被圖片完全覆蓋。

2.  數據模型 (Data State)

所有座標均以「UI 顯示尺寸」為基準（即包含 M 放大後的尺寸）：
TypeScript

interface CropState {
displayMultiplier: number; // 即上述的 M
image: {
x: number; y: number; // 圖片中心相對於容器中心的 UI 位移
scale: number; // 使用者縮放倍率
rotate: number; // 0-360
};
cropBox: {
x: number; y: number; // 裁切框在容器內的 UI 座標
w: number; h: number; // 裁切框在容器內的 UI 寬高
};
}

3. 座標同步與變換順序 (The Golden Rule)

預覽 (CSS) 與 導出 (Canvas) 必須嚴格遵守以下變換順序：

    Translate (平移)

    Rotate (旋轉)

    Scale (縮放)

4. Canvas 導出精確公式 (Canvas Export Logic)

為確保「成品尺寸」等於「原始像素尺寸」，必須在 Canvas 運算中消除 M 的影響：

    畫布尺寸 (還原像素)：

        canvas.width = cropBox.w / M;

        canvas.height = cropBox.h / M;

    座標變換與繪製 (邏輯對齊)：

        計算 UI 向量差：

            distX = (cropBox.x + cropBox.w / 2) - (container.w / 2 + image.x);

            distY = (cropBox.y + cropBox.h / 2) - (container.h / 2 + image.y);

        轉換為原始像素向量：

            distX_orig = distX / M;

            distY_orig = distY / M;

        Canvas 繪製：

            ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig); (平移原點)

            ctx.rotate((image.rotate * Math.PI) / 180);

            ctx.scale(image.scale, image.scale);

            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2, img.naturalWidth, img.naturalHeight);

5. 實作檢查清單

   [] 容器寬高比需動態綁定為 img.naturalWidth / img.naturalHeight。

   [] 小圖載入時自動計算 M，確保 UI 操作區寬度至少為 400px。

   [] 重點：Canvas 導出時，W_view 應代換為 img.naturalWidth，並確保所有位移量均已除以 displayMultiplier。
