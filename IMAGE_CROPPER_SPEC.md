圖片裁切工具架構設計規格 (V3 - 最終座標修正版)

1.  核心邏輯：固定視窗縮放 (Fixed Viewport Scaling)

    Viewport (容器)：畫面上固定的顯示區域（例如 500x500）。

    Image Content (圖片)：在 Viewport 內變換，transform-origin 必須為 center center。

    Crop Box (裁切框)：獨立於圖片，浮動在 Viewport 之上。

    座標基準：

        image.x/y：圖片中心點相對於 Viewport 中心點 的位移。

        cropBox.x/y：裁切框左上角相對於 Viewport 左上角 的座標。

2.  數據模型 (Data State)
    interface CropState {
    image: {
    x: number; // 圖片中心位移 (px)
    y: number; // 圖片中心位移 (px)
    scale: number; // 縮放倍率 (1.0+)
    rotate: number; // 旋轉角度 (0-360)
    };
    cropBox: {
    x: number; // 框左上角 X (相對 Viewport)
    y: number; // 框左上角 Y (相對 Viewport)
    w: number; // 框寬度
    h: number; // 框高度
    };
    }

3.  座標同步與變換順序 (The Golden Rule)

預覽 (CSS) 與 導出 (Canvas) 必須嚴格遵守以下變換順序，否則旋轉時會產生軌跡偏移：

    Translate (平移至中心)

    Rotate (旋轉)

    Scale (縮放)

4. Canvas 導出精確公式 (Canvas Export Logic)

在執行 ctx.drawImage 前，必須建立一個與圖片預覽狀態完全平行的座標系：

    畫布尺寸：canvas.width = cropBox.w; canvas.height = cropBox.h;

    平移至畫布中心：ctx.translate(canvas.width / 2, canvas.height / 2);

    套用旋轉與縮放：

        ctx.rotate((image.rotate * Math.PI) / 180);

        ctx.scale(image.scale, image.scale);

    計算相對位移 (Vector D)：

        distX = (cropBox.x + cropBox.w / 2) - (viewport.w / 2 + image.x);

        distY = (cropBox.y + cropBox.h / 2) - (viewport.h / 2 + image.y);

    繪製圖片 (Final Draw)：

        使用圖片在 Viewport 中的初始顯示寬高 (Wview​, Hview​)。

        ctx.drawImage(img, (-W_view / 2) - (distX / image.scale), (-H_view / 2) - (distY / image.scale), W_view, H_view);

        注意：dist 必須除以 scale 是因為 ctx.scale 會縮放整個座標軸空間。

5. 實作檢查清單

   [ ] 圖片加載後，初始 Wview​ 與 Hview​ 需根據 object-fit: contain 計算。

   [ ] 確保 CSS transform 順序為 translate(x, y) rotate(r) scale(s)。

   [ ] 導出時，W_view 是圖片未經 scale 變換前的初始顯示尺寸。
