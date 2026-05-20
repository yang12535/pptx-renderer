# pptx-renderer

一个轻量级 PPTX 静态渲染器。它可以把 `.pptx` 转成可独立打开的 `dist/` 静态页面，也支持在浏览器里上传 PPTX 后本地解析预览。

## 功能概览

- 命令行构建：输出 `index.html`、静态资源和媒体文件到 `dist/`。
- 浏览器端上传：使用 JSZip + 浏览器解析器在本地读取 `.pptx`。
- 幻灯片查看器：支持上一页/下一页、键盘、触摸滑动、全屏、缩略图和自动缩放。
- 文本与形状：解析段落、富文本 run、字段文本、线条、图片和常见 shape。
- 表格渲染：保留列宽、行高、单元格边框、填充、内边距和文本样式，并自动压缩行高避免溢出。
- 图表渲染：解析 PPTX chart XML 的分类、序列、数值、颜色和标签，并使用 ECharts 渲染柱状图、折线图等常见图表。
- 入场动画：幻灯片元素错峰进入，表格逐行显现，柱状图弹出，折线图按年份逐点展开。

## 快速开始

安装依赖：

```powershell
npm install
```

构建上传模式产物（默认，浏览器端上传 PPTX 预览）：

```powershell
npm run build -- dist
```

构建静态预渲染产物（可选，将 PPTX 预渲染为静态 HTML）：

```powershell
npm run build:static -- "ls/就业压力、高质量就业与下沉原因分析(1).pptx" dist
```

启动本地静态服务：

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory dist
```

打开：

```text
http://127.0.0.1:8765/
```

## 项目结构

```text
build.js                    CLI 构建入口
src/core/                   PPTX 解压和 XML 基础工具
src/parser/                 presentation / slide / shape / chart 解析
src/render/                 HTML 渲染
template/index.html         静态查看器模板
template/assets/css/        查看器样式和动画
template/assets/js/         浏览器端解析器与查看器交互
ls/                         本地测试 PPTX
```

## Vendor 资源

浏览器上传模式依赖以下前端库，当前以静态文件形式放在 `template/assets/vendor/`，构建时复制到 `dist/assets/vendor/`：

- `jszip.min.js`: JSZip 3.10.1，用于浏览器端读取 PPTX zip 包。
- `echarts.min.js`: Apache ECharts 5.6.0，用于渲染 PPTX 图表。

## 当前验证样例

本轮重点验证文件：

```text
ls/就业压力、高质量就业与下沉原因分析(1).pptx
```

覆盖点：

- 第 3 页折线图年份不再丢失，折线按时间轴缓慢展开。
- 第 4 页横向柱状图和下方表格可以同时保留标签、数值和表格内容。
- 第 7 页供需表格年份列可正常显示。
- 第 9 页数据口径表格不再挤压成过密的小字，并保留逐行入场动画。

## 已知限制

- 目前不是完整 PowerPoint 渲染引擎，复杂版式、SmartArt、母版继承和全部原生动画仍可能有差异。
- 图表支持优先覆盖常见 bar / line / pie 结构，复杂组合图、双轴图、散点图仍需继续补齐。
- PPTX 原生 `<p:timing>` 动画尚未完整解析，目前使用渲染器自己的 CSS/JS 入场动画。
