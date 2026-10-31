# dsh-handtrack — 3D Hand-Tracking Puppet Control

DSH 插件版本嘅 handtrack：純瀏覽器環境，Three.js + MediaPipe Hands，零 Python 依賴。

## 功能

- Webcam 實時手勢追蹤（MediaPipe Hands）
- 21 點手部骨骼 3D 可視化
- 3D robot avatar，手指通過「琴弦」連接到關節
- 滑鼠拖曳旋轉相機、滾輪縮放
- 自動懸浮面板，嵌入 DSH web 界面

## 控制

| 操作 | 效果 |
|---|---|
| 滑鼠拖曳 | 旋轉 3D 相機 |
| 滾輪 | 縮放 |
| — | 無需鍵盤，自動運行 |

## 技術棧

- Three.js（3D 渲染）
- MediaPipe Hands（手部檢測）
- React（DSH 插件框架）

## 安裝

```bash
# 方法一：npm 安裝（需先發佈到 npm）
dsh plugin install dsh-handtrack

# 方法二：從 GitHub 加載（plain dsh web）
# 在 DSH web 的插件市場搜尋 dsh-handtrack
```

## 與 Python 原版比較

| 特性 | Python 原版 | DSH 插件版 |
|---|---|---|
| 3D 渲染 | OpenGL (PyOpenGL) | Three.js |
| 手勢追蹤 | MediaPipe (TFLite) | MediaPipe (WebGL) |
| 環境 | Python 3.14 | 純瀏覽器 |
| 依賴 | pygame, numpy, opencv | 無（CDN 加載） |
| 性能 | 本地 GPU/CPU | 瀏覽器 WebGL |
