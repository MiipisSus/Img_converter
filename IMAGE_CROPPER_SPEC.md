圖片裁切引擎規格 (V7 - 離散變換支援版)

1.  佈局邏輯：Responsive Fitting

    有效尺寸 (Effective Dimensions)：

        若 baseRotate 為 90 或 270 度，則 effW = naturalHeight, effH = naturalWidth。

        若 baseRotate 為 0 或 180 度，則 effW = naturalWidth, effH = naturalHeight。

    容器比例 (Container Aspect)：容器長寬比必須嚴格等於 effW / effH。

    動態顯示倍率 (displayMultiplier, M)：

    限制常數：

        MIN_WIDTH = 400, MAX_WIDTH = 600

        MIN_HEIGHT = 300, MAX_HEIGHT = 500

    計算邏輯：

        計算寬度需求倍率 Mw​：

            若 effW > MAX_WIDTH：Mw​=MAX_WIDTH/effW

            若 effW < MIN_WIDTH：Mw​=MIN_WIDTH/effW

            其他：Mw​=1

        計算高度需求倍率 Mh​：

            若 effH > MAX_HEIGHT：Mh​=MAX_HEIGHT/effH

            若 effH < MIN_HEIGHT：Mh​=MIN_HEIGHT/effH

            其他：Mh​=1

        最終倍率判定：

            縮小模式 (若任一維度 > MAX)：M=Math.min(Mw​,Mh​)

            放大模式 (若任一維度 < MIN)：M=Math.max(Mw​,Mh​)

            其餘情況：M=1

    背景設計：

        容器層：背景色固定為黑色 (#000000)。

        圖片層：下方墊一層 CSS 棋盤格圖案（Checkerboard）。

2.  數據模型 (Crop State)

座標以「UI 顯示尺寸」記錄。
TypeScript

interface CropState {
displayMultiplier: number;
image: {
x: number; y: number;
scale: number; // 使用者縮放滑桿
rotate: number; // 自由旋轉角度 (-180~180)
baseRotate: number; // 步進旋轉 (0, 90, 180, 270)
flipX: boolean; // 水平翻轉
flipY: boolean; // 垂直翻轉
};
cropBox: { x: number; y: number; w: number; h: number };
}

3. 變換順序 (The Golden Rule)

預覽與 Canvas 導出順序必須一致，以確保鏡像後的操作邏輯正確：

    Translate (平移至中心)

    Base Rotate (90度單位旋轉)

    Free Rotate (自由旋轉)

    Flip (水平/垂直翻轉)

    User Scale (使用者縮放)

4. Canvas 導出公式 (Pixel-Back Logic)

導出時須消除 M 的影響以還原原始像素：

    畫布尺寸：canvas.width = cropBox.w / M; canvas.height = cropBox.h / M;

    座標變換：

        計算原始像素位移：

            distX_orig = ((cropBox.x + cropBox.w/2) - (container.w/2 + image.x)) / M;

            distY_orig = ((cropBox.y + cropBox.h/2) - (container.h/2 + image.y)) / M;

        繪製步驟：

            ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig);

            ctx.rotate((image.baseRotate * Math.PI) / 180);

            ctx.rotate((image.rotate * Math.PI) / 180);

            ctx.scale(image.flipX ? -1 : 1, image.flipY ? -1 : 1);

            ctx.scale(image.scale, image.scale);

            ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
