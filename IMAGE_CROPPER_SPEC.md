圖片裁切工具架構設計規格 (Image Cropper Specification)

## 1. 核心邏輯架構 (Fixed Image, Movable CropBox)

我們採用「底圖固定，裁切框自由操作」的架構：

- **Layer 1: Background Layer**: 放置原始圖片，通常縮放至適應螢幕大小。
- **Layer 2: CropBox Layer**: 一個可移動、可調整大小的矩形框，浮動在圖片上方。
- **Layer 3: Shroud/Mask**: 裁切框以外的區域顯示半透明黑色遮罩。

## 2. 數據模型 (Data State)

狀態管理以「裁切框相對於圖片的像素座標」為準：

```typescript
interface CropState {
  cropX: number;      // 裁切框左上角在圖片上的 X 座標
  cropY: number;      // 裁切框左上角在圖片上的 Y 座標
  cropW: number;      // 裁切框的寬度
  cropH: number;      // 裁切框的高度
  imageRotate: number; // 圖片旋轉角度 (0, 90, 180, 270)
}

3.  前端預覽實作原則

    效能優先：所有預覽變動必須透過 CSS transform: translate(x, y) rotate(r) scale(s) 達成，由 GPU 加速，嚴禁在拖動時頻繁操作 Canvas。

    逆向座標計算：當用戶點擊「完成」時，將 CSS 的變換數值映射回原始圖片尺寸（Original Source Size），計算出對應的像素座標。

    Transform Origin：將圖片的變換中心設定為 center center，這能簡化旋轉後的位移計算邏輯。

4.  技術流程 (The Workflow)
    第一階段：載入與初始化

        獲取圖片原始寬高 (Worig​, Horig​)。

        計算初始縮放比例，使圖片能完全覆蓋裁切框（Covering strategy）。

第二階段：交互處理 (Interaction)

    平移 (Pan)：更新 x 與 y。

    縮放 (Zoom)：更新 scale，需限制最小值不得小於裁切框。

    旋轉 (Rotate)：更新 rotate，注意旋轉後長寬比對調後的邊界限制。

第三階段：產出結果 (Output)

使用離屏 Canvas (Offscreen Canvas)：

    建立一個與裁切目標等大的 Canvas。

    執行 ctx.translate, ctx.rotate, ctx.scale 同步狀態。

    使用 ctx.drawImage(img, ...) 繪製。

    匯出 Blob 或 base64。

5. 實作檢查清單 (Implementation Checklist)

   [ ] 使用 requestAnimationFrame 或 CSS Transitions 優化拖動感。

   [ ] 實作邊界檢查（Boundary Check）：圖片邊緣不應進入裁切框內（除非有特殊需求）。

   [ ] 支援觸控事件 (Touch Events) 的雙指縮放。

   [ ] 旋轉時自動調整圖片縮放比例以填滿框位。

## 6. 座標轉換與裁切邏輯 (Coordinate Transformation)

為了確保「所見即所得」，Canvas 導出時必須嚴格遵循與 CSS 預覽相同的變換順序。

### A. 核心參數定義

- **OriginalSize**: 圖片原始像素寬高 ($W_{orig}$, $H_{orig}$)。
- **DisplaySize**: 圖片在畫面上顯示的初始寬高（通常是縮放後的 $W_{view}$, $H_{view}$）。
- **CropBoxSize**: 裁切框的固定寬高。
- **TransformState**: 使用者操作後的 $\{x, y, scale, rotate\}$。

### B. 繪製公式與步驟

當執行 `canvas.drawImage()` 時，請依照下列順序操作 Context：

1. **設定 Canvas 畫布尺寸**：
   Canvas 寬高應等於 `CropBoxSize` 的目標輸出尺寸。

2. **移至中心 (Center Pivot)**：
   `ctx.translate(canvas.width / 2, canvas.height / 2)`
   _所有後續旋轉與縮放都將以此中心點進行。_

3. **執行旋轉 (Rotate)**：
   `ctx.rotate((rotate * Math.PI) / 180)`

4. **執行縮放 (Scale)**：
   `ctx.scale(scale, scale)`

5. **繪製圖片 (Draw)**：
   需計算圖片相對於中心點的偏移。計算公式如下：
   `ctx.drawImage(img, -W_{view} / 2 + (x / scale), -H_{view} / 2 + (y / scale), W_{view}, H_{view})`

### C. 注意事項

- **座標歸一化**：$x$ 與 $y$ 是相對於裁切框中心的偏移量，而非絕對座標。
- **DPI 處理**：若需導出高解析度圖片，Canvas 尺寸需乘以 `window.devicePixelRatio` 或自定義倍率。
```
