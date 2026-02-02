圖片裁切工具架構設計規格 (Image Cropper Specification)

1. 核心邏輯架構 (The "Virtual View" Approach)

為了確保流暢度與開發彈性，我們捨棄直接操作像素，採用三層分離架構：

    Layer 1: Container (容器層) - 固定尺寸的作業區域。

    Layer 2: Image Layer (圖片層) - 原始圖片。透過 CSS transform (matrix) 進行位移、旋轉、縮放。

    Layer 3: Cropper Overlay (裁切框層) - 固定在中心或可拖動的 UI 框，定義最終輸出的 可視窗口 (Viewport)。

2. 數據模型 (Data State)

不記錄圖片的寬高，而是記錄圖片相對於裁切框中心的變換狀態：
TypeScript

interface CropState {
x: number; // 水平位移 (px)
y: number; // 垂直位移 (px)
scale: number; // 縮放比例 (預設 1)
rotate: number; // 旋轉角度 (0, 90, 180, 270)
aspectRatio: number; // 裁切比例 (例如 1, 4/3, 16/9)
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
