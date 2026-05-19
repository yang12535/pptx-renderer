# pptx-renderer 动画系统 TODO

> 详细设计方案见 `ANIMATION.md`

---

## ✅ 已完成

### 基础架构
- [x] 重构 build.js 输出自包含 dist/ 目录（index.html + assets/ + media/）
- [x] 分离 CSS/JS 为独立文件（template/assets/）
- [x] 添加 .gitignore 排除 node_modules/、dist/、临时文件

### 浏览器端解析（大功能）
- [x] 浏览器端 PPTX 解析器（pptx-parser.js）
  - [x] DOMParser 适配层（domToJson）替代 fast-xml-parser
  - [x] 跳过 xmlns 属性，修复纯文本节点解析
  - [x] 修复根元素解析（domToJson 不包根元素名）
  - [x] 移植所有解析函数（presentation、slide、shape、picture、graphicFrame、connector、theme、color）
  - [x] 移植渲染函数（renderSlides、renderElement、renderText、renderLine）
  - [x] JSZip 解压 + 图片转 Base64
  - [x] 主入口 loadPptxFromFile(File) → Promise
- [x] 文件上传区域（template/index.html）
  - [x] 点击选择 / 拖拽上传
  - [x] 文件类型校验（.pptx）
  - [x] 加载状态提示

### 幻灯片切换动画
- [x] 重构 .slide 为绝对定位堆叠布局
- [x] 预置 CSS 过渡类：fade / slide-left / slide-right / slide-up / zoom
- [x] JS 双向切换逻辑：下一页从右进，上一页从左进
- [x] 方向判断修复（typeof direction !== 'number'）

### 元素入场动画
- [x] 创建 animations.css（并入 viewer.css）
  - [x] fadeIn / slideInUp / slideInLeft / slideInRight / zoomIn / growIn / expandRight
- [x] 修改 html-render.js，给 renderElement 增加 animClass 与 animDelay
- [x] 实现「幻灯片激活时子元素依次入场」机制
- [x] 支持按元素索引自动错峰（100ms 间隔）
- [x] 修复 transform 冲突：已有 transform 的元素（旋转/翻转/线条）强制使用 fadeIn
- [x] 修复零宽高线条 guard 短路问题

### 查看器交互
- [x] 键盘支持（←→ 方向键、空格、Home/End、F 全屏、T 缩略图）
- [x] 触摸滑动切页
- [x] 全屏模式（Fullscreen API）+ 动态提示
- [x] 进度条指示器
- [x] 舞台自动缩放（适配窗口大小）
- [x] 缩略图栏（延迟构建 + 轻量表示）
- [x] 控制栏自动隐藏 / 显示
- [x] prefers-reduced-motion 无障碍支持

### Review 修复
- [x] Codex Round 1: reduced-motion 清除 transform
- [x] Copilot Round 1: direction falsy、遍历性能、缩略图内存、死代码、viewport、尺寸匹配、line null
- [x] Codex Round 2: 缩略图空面板、零维度 guard
- [x] Copilot Round 2: 未使用导入/参数、硬编码 controls 高度
- [x] PR squash merge 到 master

---

## 🐛 已知 Bug

- [x] **下一页按钮点击无效** — 已修复：上传页初始没有 `.slide`，`init()` 过早返回导致按钮、键盘、触摸等查看器事件没有绑定；现在事件会先一次性绑定，上传后只刷新幻灯片列表与 UI 状态。
  - [x] `show()` 正确切换 active 类
  - [x] 控制按钮事件在上传模式也会绑定
  - [x] 键盘方向键不再被隐藏文件输入或按钮焦点误拦截
  - [x] `btnNext` disabled 状态按真实总页数更新

---

## 🚧 待实现（Phase 2+）

### 图表支持
- [ ] 解析 PPTX 图表 XML（ppt/charts/chart*.xml）
  - [ ] 提取 categories / values / series
  - [ ] 识别 chartType（bar / line / pie / radar / scatter）
- [ ] 轻量方案：CSS 模拟柱状图生长（不引入 echarts）
  - [ ] 用 --target-height + @keyframes barGrow 实现
- [ ] （可选）echarts 集成方案

### PPTX 原生动画提取
- [ ] 解析 slide.xml 中的 <p:timing> / <p:animEffect> 节点
- [ ] 建立 filter → CSS animation-name 映射表

### 体验优化
- [ ] 添加「自动播放」模式（interval 5s）
- [ ] 触摸手势优化（双指缩放画布）
- [ ] 进度指示器增强（底部圆点或缩略图网格）
- [ ] 幻灯片切换时重置内部元素动画（已部分实现，需验证二次进入）

---

## 📦 打包 & 分发

- [x] dist 目录可独立运行（双击 index.html 或 python http.server）
- [x] 打包到 /home/yangtim/ls/pptx-renderer-dist.zip
- [x] 分支推送到 GitHub（feat/browser-upload）
