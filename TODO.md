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
- [x] PPTX 动画不跟随系统 reduced-motion 设置禁用

### Review 修复
- [x] Codex Round 1: reduced-motion 清除 transform（后续按产品要求改为始终播放动画）
- [x] Copilot Round 1: direction falsy、遍历性能、缩略图内存、死代码、viewport、尺寸匹配、line null
- [x] Codex Round 2: 缩略图空面板、零维度 guard
- [x] Copilot Round 2: 未使用导入/参数、硬编码 controls 高度
- [x] PR squash merge 到 master
- [x] 2026-05-20: 修复测试 PPTX 中年份字段丢失、图表/表格 placeholder 残留和表格过密问题
- [x] 2026-05-20: 按视频参考补齐图表数据绘制动画，柱状图弹出、折线图逐点展开
- [x] 2026-05-20: 修复 PR review 指出的多 chart group、稀疏 chart cache、表格边框字段和未使用 jszip 依赖问题
- [x] 2026-05-20: 修复 PR review 指出的输出路径误删、浏览器 Promise 链、package-relative 关系路径、多媒体异步闭包、显式零 inset 和 null 图表值问题
- [x] 2026-05-21: 修复 PR review 指出的静态 chart 绝对路径重解析和上传解析器缺失时 loading 卡住问题
- [x] 2026-05-21: 修复 PR review 指出的上传样式内联、loading live region 和 run 字体样式注入风险
- [x] 2026-05-21: 修复 PR review 指出的输出目录清理守卫、段落子节点顺序、tooltip HTML 和 ZIP 文件名长日志问题

---

## 🐛 已知 Bug

- [x] **下一页按钮点击无效** — 已修复：上传页初始没有 `.slide`，`init()` 过早返回导致按钮、键盘、触摸等查看器事件没有绑定；现在事件会先一次性绑定，上传后只刷新幻灯片列表与 UI 状态。
  - [x] `show()` 正确切换 active 类
  - [x] 控制按钮事件在上传模式也会绑定
  - [x] 键盘方向键不再被隐藏文件输入或按钮焦点误拦截
  - [x] `btnNext` disabled 状态按真实总页数更新
- [x] **年份识别失败** — 已修复：`a:t` 中的纯数字会被 XML parser 解析成 number，现在统一转成字符串；同时将 `a:fld` 字段作为 run 解析。
- [x] **折线图动画几乎瞬间完成** — 已修复：折线图不再一次性注入完整数据，而是按分类点逐步追加，最后切换到完整最终态。
- [x] **表格内容过密或溢出** — 已修复：结构化解析列宽、行高、边框、填充和内边距，渲染时按容器高度压缩行高并隐藏溢出。
- [x] **动画延迟单位误判** — 已修复：`800ms` 不再被当作 `800s` 处理。
- [x] **系统关闭动画后 PPTX 动画不播放** — 已修复：移除 `prefers-reduced-motion` 禁用规则，上传模式和图表动画在 reduced-motion 环境下仍按 PPTX viewer 逻辑播放。

---

## 🚧 待实现（Phase 2+）

### 图表支持
- [x] 解析 PPTX 图表 XML（ppt/charts/chart*.xml）
  - [x] 提取 categories / values / series
  - [x] 识别常见 chartType（bar / line / pie）
  - [x] 提取 series color 与 showVal
- [x] ECharts 集成方案
  - [x] 柱状图弹出动画
  - [x] 折线图逐点展开动画
- [ ] 复杂图表补齐
  - [ ] 组合图 / 双轴图
  - [ ] radar / scatter
  - [ ] 更完整的数据标签位置与格式

### 表格支持
- [x] 解析表格列宽、行高、填充、边框、内边距
- [x] 表格按容器高度适配，避免撑破幻灯片
- [x] 表格逐行入场动画
- [ ] 更完整的合并单元格支持
- [ ] 更完整的单元格垂直对齐和文本换行策略

### PPTX 原生动画提取
- [ ] 解析 slide.xml 中的 `<p:timing>` / `<p:animEffect>` 节点
- [ ] 建立 filter → CSS animation-name 映射表

### 体验优化
- [ ] 添加「自动播放」模式（interval 5s）
- [ ] 触摸手势优化（双指缩放画布）
- [ ] 进度指示器增强（底部圆点或缩略图网格）
- [x] 幻灯片切换时重置内部元素动画
- [ ] 建立更多真实 PPTX 回归样例，覆盖图表、表格、图片和不同主题

---

## 📦 打包 & 分发

- [x] dist 目录可独立运行（双击 index.html 或 python http.server）
- [x] 可打包为 `pptx-renderer-dist.zip`
- [x] 分支推送到 GitHub（feat/browser-upload）
- [ ] PR 合并回 master 后打 tag 或记录 release note
