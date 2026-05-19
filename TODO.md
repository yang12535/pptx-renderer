# pptx-renderer 动画系统 TODO

> 详细设计方案见 `ANIMATION.md`

---

## Phase 1：幻灯片切换动画

- [ ] 重构 `.slide` 为绝对定位堆叠布局（脱离 display:none/block 模式）
- [ ] 预置 CSS 过渡类：`fade` / `slide-left` / `slide-right` / `slide-up` / `zoom` / `flip`
- [ ] JS 双向切换逻辑：下一页从右进，上一页从左进
- [ ] 增加键盘支持（← → 方向键、空格）
- [ ] 测试多种切换效果在查看器中的表现

---

## Phase 2：元素入场动画

- [ ] 创建 `animations.css`，预置核心 `@keyframes`
  - [ ] `fadeIn`
  - [ ] `slideInUp`
  - [ ] `slideInLeft` / `slideInRight`
  - [ ] `zoomIn`
  - [ ] `growIn`（从低往高，scaleY）
  - [ ] `expandRight`（从左向右，scaleX）
- [ ] 修改 `html-render.js`，给 `renderElement` 增加 `animClass` 与 `animDelay`
- [ ] 实现「幻灯片激活时子元素依次入场」机制
  - [ ] CSS 纯方案：`.slide.active .p-el` 控制 `animation-play-state`
  - [ ] 备选 JS 方案：手动 reflow 重启动画
- [ ] 支持按元素索引自动错峰（默认 100–150ms 间隔）
- [ ] 预留 PPTX 原生动画解析接口（不实现，仅留扩展点）

---

## Phase 3：图表占位符升级

- [ ] 解析 PPTX 图表 XML（`ppt/charts/chart*.xml`）
  - [ ] 提取 categories / values / series
  - [ ] 识别 chartType（bar / line / pie / radar / scatter）
- [ ] 轻量方案：CSS 模拟柱状图生长（不引入 echarts）
  - [ ] 用 `--target-height` + `@keyframes barGrow` 实现
- [ ] （可选）echarts 集成方案
  - [ ] CDN 引入 echarts.min.js
  - [ ] 渲染时插入 `<div class="p-chart">` + `echarts.init().setOption()`
  - [ ] 利用 echarts 默认 `animation: true` 获得数据展开效果

---

## Phase 4：体验优化

- [ ] 幻灯片切换时重置内部元素动画（避免二次进入无动画）
- [ ] 添加「自动播放」模式（interval 5s）
- [ ] 触摸手势支持（滑动切页）
- [ ] 全屏模式（Fullscreen API）
- [ ] 进度指示器（底部圆点或缩略图）

---

## Phase 5：PPTX 原生动画提取（远期）

- [ ] 解析 `slide.xml` 中的 `<p:timing>` / `<p:animEffect>` 节点
- [ ] 建立 filter → CSS animation-name 映射表
  - [ ] `fade` → `fadeIn`
  - [ ] `wipe(right)` → `expandRight`
  - [ ] `wipe(up)` → `growIn`
  - [ ] `box(out)` → `zoomIn`
- [ ] 解析 `delay` / `dur` 映射到 `animation-delay` / `animation-duration`

---

## 阻塞项 / 待确认

- [ ] 是否引入 echarts 作为 chart 渲染方案？（会显著增加体积）
- [ ] 是否优先实现 PPTX 原生动画提取？（OpenXML 动画结构复杂）
- [ ] 移动端适配策略（触控 + 缩放）

---

## 当前阻塞

无。Phase 1 可立即开始。
