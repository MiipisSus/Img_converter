# 圖片裁切引擎規格 (V6 - 雙向自適應與像素還原版)

## 1. 佈局邏輯：Responsive Fitting

- **容器比例 (Container Aspect)**：容器長寬比必須嚴格等於 `naturalWidth / naturalHeight`。
- **動態顯示倍率 (displayMultiplier, M)**：
  - `MIN_WIDTH = 400`, `MAX_WIDTH = 800`。
  - 計算邏輯：
    1. 若 `naturalWidth > MAX_WIDTH`：$M = MAX\_WIDTH / naturalWidth$
    2. 若 `naturalWidth < MIN_WIDTH`：$M = 400 / naturalWidth$
    3. 其他：$M = 1$
  - 容器 CSS 尺寸 = $(naturalWidth * M, naturalHeight * M)$。
- **背景設計**：
  - 容器層：背景色固定為黑色 (`#000000`)。
  - 圖片層：下方墊一層 CSS 棋盤格圖案（Checkerboard），用於識別透明區域。

## 2. 數據模型 (Crop State)

座標以「UI 顯示尺寸」記錄，數據需與 `displayMultiplier` 綁定。

```typescript
interface CropState {
  displayMultiplier: number;
  image: { x: number; y: number; scale: number; rotate: number };
  cropBox: { x: number; y: number; w: number; h: number };
}
```

3. 變換順序 (The Golden Rule)

預覽與 Canvas 導出順序必須一致：1. Translate -> 2. Rotate -> 3. Scale。4. Canvas 導出公式 (Pixel-Back Logic)

導出時須消除 M 的影響以還原原始像素：

    畫布尺寸：canvas.width = cropBox.w / M; canvas.height = cropBox.h / M;

    座標變換：

        distX_orig = ((cropBox.x + cropBox.w/2) - (container.w/2 + image.x)) / M;

        distY_orig = ((cropBox.y + cropBox.h/2) - (container.h/2 + image.y)) / M;

        ctx.translate(canvas.width / 2 - distX_orig, canvas.height / 2 - distY_orig);

        ctx.rotate((image.rotate * Math.PI) / 180);

        ctx.scale(image.scale, image.scale);

        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
