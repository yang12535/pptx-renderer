# CHANGED

## 2026-05-20

### Added

- 新增 `README.md`，补充项目定位、快速开始、目录结构、当前验证样例和已知限制。
- 新增本变更日志，用于记录渲染能力、测试覆盖和后续风险。
- 为 ECharts 图表增加入场动画：
  - 柱状图从零值弹出。
  - 折线图先显示坐标轴，再按分类点逐步展开，避免瞬间铺满。
- 为表格行增加逐行显现动画，并兼容 `prefers-reduced-motion`。

### Changed

- 构建流程改为使用系统临时目录解压 PPTX，避免在 `dist/` 内留下 `.temp` 工作目录。
- 构建入口导出 `build` 函数，便于后续自动化或测试复用。
- relationship target 解析改为基于源 slide 路径和 package root 解析，减少图片、图表等相对路径错位。
- 表格解析升级为结构化数据：
  - 解析列宽和行高。
  - 解析单元格填充、边框和内边距。
  - 保留单元格内富文本结构。
- 表格渲染升级：
  - 按容器高度压缩行高，避免表格撑出幻灯片。
  - 单元格使用 `overflow: hidden` 控制溢出。
  - 表头、边框和背景更接近 PPTX 原始效果。
- 图表渲染升级：
  - 解析 chart XML 的 categories、series、values、series color 和 `showVal`。
  - 支持多层分类缓存和数字缓存。
  - 坐标轴使用数据范围生成更稳的刻度。
  - 数值标签使用统一格式化。
- 浏览器端 `pptx-parser.js` 同步服务端解析能力，上传预览与 CLI 构建保持一致。

### Fixed

- 修复年份等纯数字文本被 XML parser 解析为 number 后丢失的问题。
- 修复 `<a:fld>` 字段文本未作为段落 run 解析的问题。
- 修复折线图动画看起来瞬间完成的问题，现在按时间片逐点追加数据。
- 修复 `800ms` 被误当成 `800s` 级别延迟的动画等待问题。
- 修复部分图表、表格 placeholder 残留问题。
- 删除误提交的 `pptx-parser.js.bak`，并在 `.gitignore` 中忽略 `*.bak`。
- 构建临时目录清理改为 `try/finally`，构建失败时也会删除临时解压目录。
- 模板状态切换改为显式 token 替换，缺失 token 时直接失败而不是静默生成错误页面。
- 上传区域补充键盘可访问性和 100MB 文件大小限制。
- 移除 TODO 中的个人绝对路径，并统一主线分支名称为仓库实际的 `master`。
- 修复含负值的横向柱状图被 `min: 0` 数值轴裁掉的问题，正负发散图现在按真实数据范围显示。

### Verified

- `npm run build -- "ls/就业压力、高质量就业与下沉原因分析(1).pptx" dist`
- `node --check build.js`
- `node --check src/parser/shape.js`
- `node --check src/parser/slide.js`
- `node --check src/render/html-render.js`
- `node --check template/assets/js/pptx-parser.js`
- `node --check template/assets/js/viewer.js`
- `node --check dist/assets/js/viewer.js`
- `rg -n "p-placeholder|\[chart\]|\[graphic\]" dist/index.html` 无匹配
- Chrome 验证 `http://127.0.0.1:8765/`：
  - 第 3 页折线图中途只显示部分年份，随后完整展开。
  - Chrome 控制台无 error。
