# PPTX Renderer 动画系统设计方案

> 调研来源：Kimi PPT 渲染动画分析  
> 状态：待实现（分步实施）

---

## 一、外部调研结论（Kimi PPT）

### 1.1 技术栈
- **框架**：Vue 3 + Vite
- **幻灯片生成**：`pptxgenjs`（导出 .pptx）
- **图表渲染**：`echarts`（懒加载 chunk `echarts--Ak0urE6.js`）
- **DOM 截图**：`html2canvas`
- **CSS 动画库**：`animate.css`（98 个标准 keyframes）

### 1.2 动画分层

| 层级 | 动画 | 实现方式 |
|------|------|---------|
| 容器级逐入 | 幻灯片元素按顺序浮现 | `QG` 调度器：逐个 `push` 到 DOM，间隔 `await Kt(r)` |
| 文本生成 | 打字机/逐字出现 | `BA` 函数：`tokenRange` + `tokenDuration` 控制随机增量 |
| CSS 入场 | fadeIn / zoomIn / slideInUp | `animate.css`（`index-C_by1750.css`） |
| 图表数据 | 从低到高 / 从左向右展开 | echarts 默认 `animation: true`（`cubicOut` 缓动） |
| 自定义 | 图片弹跳、底部滑入、扫光 | 自定义 `@keyframes`（`MainApp-ByxLLOo2.css`） |

### 1.3 echarts 图表入场动画（关键）

echarts 默认开启数据动画，无需额外配置：

```javascript
option = {
  animation: true,              // 默认开启
  animationDuration: 1000,      // 时长 1s
  animationEasing: 'cubicOut',  // 先快后慢
  animationDelay: function (idx) {
    return idx * 100;           // 数据项错峰（从左向右推开）
  }
}
```

**不同图表的默认效果**：
- 柱状图/条形图：柱子从 `y: 0` 向目标高度升起（从低到高）
- 折线图：线条从左到右逐步绘制
- 饼图/环形图：扇形从 `0°` 展开到实际角度
- 雷达图：区域从中心向外填充
- 散点图：点从中心放大到目标大小

---

## 二、本项目（pptx-renderer）动画实现路线图

### Phase 1：幻灯片切换动画（基础）
目标：让翻页不再是 `display: none/block`，而是有过渡效果。

#### 方案 A：CSS Transition（推荐）
在 `.slide` 上使用 `opacity` + `transform` 过渡：

```css
.slide {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  transform: translateX(100px);
  transition: opacity 0.5s ease, transform 0.5s cubic-bezier(0.25, 1, 0.5, 1);
  pointer-events: none;
}
.slide.active {
  opacity: 1;
  transform: translateX(0);
  pointer-events: all;
}
```

#### 方案 B：多种切换效果
在渲染时给每个 `.slide` 打上动画类型标记：

```html
<div class="slide" data-transition="fade">...</div>
<div class="slide" data-transition="slide-left">...</div>
<div class="slide" data-transition="zoom">...</div>
```

CSS 预置：
- `fade`：`opacity: 0 → 1`
- `slide-left`：`translateX(100%) → 0`
- `slide-right`：`translateX(-100%) → 0`
- `slide-up`：`translateY(100%) → 0`
- `zoom`：`scale(0.8) → scale(1)` + `opacity`
- `flip`：`rotateY(90deg) → rotateY(0)`

#### 方案 C：双向切换（上一页 vs 下一页）
点击「下一页」时新幻灯片从右侧进入；点击「上一页」时从左侧进入。需要 JS 动态添加方向类名：

```javascript
function show(i, direction) {
  slides.forEach((s, idx) => {
    s.classList.remove('active', 'from-left', 'from-right');
    if (idx === i) {
      s.classList.add('active', direction > 0 ? 'from-right' : 'from-left');
    }
  });
}
```

---

### Phase 2：元素入场动画（核心）
目标：幻灯片内的每个元素不是同时出现，而是依次/按效果进入。

#### 2.1 数据结构扩展

在 `parseSlide()` 或 `renderElement()` 阶段，给元素附加动画属性：

```javascript
// 解析时从 PPTX 读取动画（如果存在）
// PPTX 动画在 `ppt/notesSlides/` 或 `ppt/slides/_rels/` 的 timing 信息中
// 但 OpenXML 动画极其复杂，初期建议：默认赋予简单入场动画

const defaultAnimations = [
  'fadeIn',
  'slideInUp',
  'slideInLeft',
  'slideInRight',
  'zoomIn',
  'growIn'   // 自定义：从低到高
];
```

#### 2.2 渲染层修改（`html-render.js`）

给每个 `.p-el` 增加动画类名和延迟：

```javascript
function renderElement(el, index) {
  // ... 原有逻辑
  const animClass = el.animation || defaultAnimations[index % defaultAnimations.length];
  const delay = (el.animDelay !== undefined) ? el.animDelay : index * 120;
  
  // 在 style 中加入 animation-delay
  style += `animation-delay:${delay}ms;`;
  
  return `<div class="p-el p-shape ${animClass}" style="${style}">${inner}</div>`;
}
```

#### 2.3 CSS 动画库（`viewer.css` 或单独 `animations.css`）

预置核心动画：

```css
/* 从低到高（柱状图/元素生长感） */
@keyframes growIn {
  from {
    opacity: 0;
    transform: scaleY(0);
    transform-origin: bottom center;
  }
  to {
    opacity: 1;
    transform: scaleY(1);
    transform-origin: bottom center;
  }
}

/* 从左向右展开 */
@keyframes expandRight {
  from {
    opacity: 0;
    transform: scaleX(0);
    transform-origin: left center;
  }
  to {
    opacity: 1;
    transform: scaleX(1);
    transform-origin: left center;
  }
}

/* 标准 animate.css 子集 */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideInUp {
  from { opacity: 0; transform: translateY(40px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes slideInLeft {
  from { opacity: 0; transform: translateX(-40px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes zoomIn {
  from { opacity: 0; transform: scale(0.85); }
  to { opacity: 1; transform: scale(1); }
}

/* 应用类 */
.p-el {
  animation-fill-mode: both;
  animation-duration: 0.6s;
  animation-timing-function: cubic-bezier(0.25, 1, 0.5, 1);
}
.growIn { animation-name: growIn; }
.expandRight { animation-name: expandRight; }
.fadeIn { animation-name: fadeIn; }
.slideInUp { animation-name: slideInUp; }
.slideInLeft { animation-name: slideInLeft; }
.zoomIn { animation-name: zoomIn; }
```

#### 2.4 幻灯片级入场调度

当幻灯片切换为 `active` 时，触发内部元素的动画。有两种方式：

**方式 A：CSS 纯方案（推荐 Phase 1 使用）**
利用 `.slide.active .p-el` 选择器控制动画播放：

```css
.slide .p-el {
  opacity: 0;
  animation-play-state: paused;
}
.slide.active .p-el {
  animation-play-state: running;
}
```

**方式 B：JS 调度方案（更精细）**
在 `show(i)` 时手动给子元素添加类名：

```javascript
function show(i) {
  slides.forEach((s, idx) => {
    const isActive = idx === i;
    s.classList.toggle('active', isActive);
    
    // 激活时重启动画
    if (isActive) {
      s.querySelectorAll('.p-el').forEach((el, elIdx) => {
        el.style.animationName = 'none';
        el.offsetHeight; // 强制 reflow
        el.style.animationName = '';
        el.style.animationDelay = `${elIdx * 120}ms`;
      });
    }
  });
}
```

---

### Phase 3：图表数据动画（高级）
目标：让 `graphicFrame`（图表占位符）变成真实可动的图表。

#### 3.1 当前状态
目前 `graphicFrame` 被渲染为灰色占位矩形：

```html
<div class="p-el p-placeholder">[graphic]</div>
```

#### 3.2 实现路径

**路径 A：集成 echarts（功能最全）**
1. 解析 PPTX 中的图表 XML（`ppt/charts/chart1.xml`）
2. 提取数据系列、坐标轴、标签
3. 渲染时插入 `<div id="chart-1"></div>` + 内联 echarts option
4. 利用 echarts 默认动画获得「从低到高」「从左向右」效果

**路径 B：CSS 模拟（轻量）**
如果不需要真实交互图表，可用 CSS 动画模拟柱状图生长：

```html
<div class="chart-bar" style="--target-height: 120px;">
  <div class="bar-fill"></div>
</div>
```

```css
.bar-fill {
  height: 0;
  animation: barGrow 1s cubic-bezier(0.25, 1, 0.5, 1) forwards;
}
@keyframes barGrow {
  to { height: var(--target-height); }
}
```

**建议**：Phase 3 先走路径 B（CSS 模拟），后续再考虑集成 echarts。

#### 3.3 echarts 集成要点（备忘）

```javascript
// 在 html-render.js 中处理 chart 类型
if (el.type === 'graphicFrame' && el.subType === 'chart') {
  const chartId = `chart-${index}`;
  // 插入容器
  const container = `<div id="${chartId}" class="p-el p-chart" style="${style}"></div>`;
  // 在页面底部插入内联 script（或延迟加载）
  const script = `
    <script>
      echarts.init(document.getElementById('${chartId}')).setOption({
        animation: true,
        animationDuration: 1000,
        animationEasing: 'cubicOut',
        animationDelay: function(idx) { return idx * 100; },
        xAxis: { type: 'category', data: ${JSON.stringify(el.chartData.categories)} },
        yAxis: { type: 'value' },
        series: [{
          type: '${el.chartType}', // bar | line | pie
          data: ${JSON.stringify(el.chartData.values)}
        }]
      });
    </script>
  `;
}
```

---

## 三、文件修改清单

| 文件 | 修改内容 |
|------|---------|
| `template/viewer.css` | 增加 `.slide` 过渡态、`.p-el` 动画类、`@keyframes` |
| `template/index.html` | 增加 `data-transition` 支持、双向切换逻辑 |
| `src/render/html-render.js` | 给 `renderElement` 增加 `animClass` / `animDelay` |
| `src/parser/slide.js` | （可选）解析 PPTX 中的动画/图表数据 |
| `build.js` | （可选）如果有图表，复制 echarts CDN 或内联库 |

---

## 四、Quick Start（实现草稿）

### 最小可运行版本（Phase 1 + 2 核心）

1. **给所有 `.p-el` 添加随机入场动画**：
   ```javascript
   // html-render.js
   const ENTRANCE_ANIMS = ['fadeIn', 'slideInUp', 'slideInLeft', 'zoomIn'];
   const anim = ENTRANCE_ANIMS[index % ENTRANCE_ANIMS.length];
   const delay = index * 100;
   ```

2. **CSS 增加 `.slide.active` 触发动画**：
   ```css
   .slide:not(.active) .p-el { animation: none !important; opacity: 0; }
   .slide.active .p-el { animation-fill-mode: both; }
   ```

3. **JS 控制幻灯片切换方向**：
   ```javascript
   // index.html 中的 show 函数
   let current = 0;
   function show(next) {
     const direction = next > current ? 'next' : 'prev';
     slides[current].classList.remove('active');
     slides[next].classList.add('active', direction === 'next' ? 'enter-right' : 'enter-left');
     current = next;
   }
   ```

---

## 五、PPTX 原生动画提取（未来）

OpenXML 中动画定义在 `ppt/slides/slideN.xml` 的 `<p:timing>` 节点下，结构：

```xml
<p:timing>
  <p:tnLst>
    <p:par>
      <p:cTn id="1" dur="indefinite" restart="never" nodeType="mainSeq">
        <p:childTnLst>
          <p:par>
            <p:cTn id="2" fill="hold">
              <p:stCondLst><p:cond delay="0"/></p:stCondLst>
              <p:childTnLst>
                <p:animEffect transition="in" filter="fade">
                  <!-- 元素入场效果 -->
                </p:animEffect>
              </p:childTnLst>
            </p:cTn>
          </p:par>
        </p:childTnLst>
      </p:cTn>
    </p:par>
  </p:tnLst>
</p:timing>
```

常见 `filter` 值：
- `fade` → fadeIn
- `wipe(right)` → 从左向右展开
- `wipe(up)` → 从下到上（从低往高）
- `box(out)` → zoomIn
- `randombar(horizontal)` → 百叶窗

提取后可映射到 CSS `animation-name`。

---

## 六、参考资源

- Kimi PPT 本地快照：`/root/ls/世界银行多图表分析 - Kimi.htm`
- Kimi PPT 编辑器快照：`/root/ls/世界银行多图表分析 - Kimi_files/a.htm`
- Kimi PPT 主 bundle：`/root/ls/世界银行多图表分析 - Kimi_files/a_data/index-C5BmbuCZ.js`
- Kimi PPT CSS 动画库：`/root/ls/世界银行多图表分析 - Kimi_files/a_data/index-C_by1750.css`
