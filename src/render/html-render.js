const { emuToPx } = require('../utils/units');

/**
 * 渲染器 —— 生成幻灯片 HTML 片段
 * 输出注入到 template/index.html 的 #stage-inner 中
 */

const ENTRANCE_ANIMS = [
  'anim-fadeIn',
  'anim-slideInUp',
  'anim-slideInLeft',
  'anim-slideInRight',
  'anim-zoomIn',
];

// 已经带有 transform 的元素（旋转、翻转、线条）只能使用不冲突的动画
const SAFE_ANIM = 'anim-fadeIn';

function elementHasTransform(el) {
  const xf = el.xfrm;
  if (!xf) return false;
  // 旋转、水平翻转、垂直翻转
  if (xf.rotation || xf.flipH || xf.flipV) return true;
  // 线条/connector 在 renderLine 中会附加 rotate transform
  if (el.type === 'connector') return true;
  if (el.geometry && el.geometry.name === 'line') return true;
  // 宽高极扁的也按线条处理（允许 width 或 height 为 0）
  if (typeof xf.width === 'number' && typeof xf.height === 'number' && Math.min(xf.width, xf.height) < 2) return true;
  return false;
}

function pickAnimClass(el, index) {
  return elementHasTransform(el) ? SAFE_ANIM : ENTRANCE_ANIMS[index % ENTRANCE_ANIMS.length];
}

function renderSlides(slides, presMeta) {
  const { widthEmu, heightEmu, roundSize } = presMeta;
  let slideW = emuToPx(widthEmu);
  let slideH = emuToPx(heightEmu);
  if (roundSize) {
    slideW = Math.round(slideW);
    slideH = Math.round(slideH);
  }

  return slides.map((slide, idx) => renderSlide(slide, idx, slideW, slideH)).join('\n');
}

function renderSlide(slide, index, w, h) {
  const bgStyle = slide.background && slide.background.type === 'solid'
    ? `background:${slide.background.color};`
    : 'background:#fff;';

  let html = `  <div class="slide" data-index="${index}" style="width:${w}px;height:${h}px;${bgStyle}">\n`;

  slide.elements.forEach((el, elIdx) => {
    const elHtml = renderElement(el, elIdx);
    if (elHtml) html += '    ' + elHtml + '\n';
  });

  html += '  </div>';
  return html;
}

function renderElement(el, index) {
  const xf = el.xfrm;
  if (!xf) return '';

  const style = buildBaseStyle(xf);
  const animClass = pickAnimClass(el, index);
  const animDelay = index * 100; // 每个元素错峰 100ms

  if (el.type === 'image' && el.src) {
    const fullStyle = style + `animation-delay:${animDelay}ms;`;
    return `<img class="p-el p-img ${animClass}" src="${escapeHtml(el.src)}" style="${fullStyle}" alt="">`;
  }

  if (el.type === 'shape' || el.type === 'connector') {
    const isLineShape = el.geometry && el.geometry.name === 'line';
    const isThin = Math.min(xf.width, xf.height) < 2;
    if (el.type === 'connector' || isLineShape || isThin) {
      return renderLine(el, animClass, animDelay);
    }

    let shapeStyle = style;
    const fillCss = buildFillCss(el);
    const lineCss = buildLineCss(el);
    const shapeCss = buildShapeCss(el);
    shapeStyle += fillCss + lineCss + shapeCss;
    shapeStyle += `animation-delay:${animDelay}ms;`;

    let inner = '';
    if (el.text && el.text.paragraphs.length > 0) {
      inner = renderText(el.text);
    }

    return `<div class="p-el p-shape ${animClass}" style="${shapeStyle}">${inner}</div>`;
  }

  if (el.type === 'graphicFrame') {
    if (el.chartData) {
      const chartJson = JSON.stringify(el.chartData).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const chartStyle = style + `animation-delay:${animDelay}ms;`;
      return `<div class="p-el p-chart ${animClass}" data-chart="${chartJson}" style="${chartStyle}"></div>`;
    }
    if (el.tableData) {
      const tblHtml = renderTable(el.tableData, xf.height);
      const tblStyle = style + `animation-delay:${animDelay}ms;overflow:hidden;`;
      return `<div class="p-el p-table-wrap ${animClass}" style="${tblStyle}">${tblHtml}</div>`;
    }
    const fullStyle = style + `background:#f0f0f0;border:1px dashed #ccc;animation-delay:${animDelay}ms;`;
    return `<div class="p-el p-placeholder ${animClass}" style="${fullStyle}">[${el.subType || 'graphic'}]</div>`;
  }

  return '';
}

function renderTable(tableData, availableHeight) {
  let tblHtml = '<table class="p-table" style="width:100%;height:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;">';
  const totalRowHeight = tableData.rows.reduce((sum, row) => sum + (row.height || 0), 0);
  const rowScale = availableHeight && totalRowHeight > availableHeight ? availableHeight / totalRowHeight : 1;

  if (tableData.colWidths && tableData.colWidths.length > 0) {
    const total = tableData.colWidths.reduce((sum, width) => sum + (width || 0), 0);
    if (total > 0) {
      tblHtml += '<colgroup>';
      for (const width of tableData.colWidths) {
        tblHtml += `<col style="width:${(width || 0) / total * 100}%;">`;
      }
      tblHtml += '</colgroup>';
    }
  }

  for (let ri = 0; ri < tableData.rows.length; ri++) {
    const row = tableData.rows[ri];
    const rowHeight = row.height ? row.height * rowScale : null;
    const delay = (0.82 + ri * 0.06).toFixed(2);
    const rowStyle = (rowHeight ? `height:${rowHeight}px;` : '') + `animation-delay:${delay}s;`;
    tblHtml += `<tr style="${rowStyle}">`;
    for (let ci = 0; ci < row.cells.length; ci++) {
      const tag = ri === 0 ? 'th' : 'td';
      const cell = row.cells[ci];
      const content = cell.textBody ? renderText(cell.textBody) : escapeHtml(cell.text || '');
      tblHtml += `<${tag} class="p-table-cell" style="${buildTableCellStyle(cell, rowHeight)}">${content}</${tag}>`;
    }
    tblHtml += '</tr>';
  }

  tblHtml += '</table>';
  return tblHtml;
}

function buildTableCellStyle(cell, rowHeight) {
  const cellStyle = cell.style || {};
  let s = '';
  const borders = cellStyle.borders;
  if (borders) {
    for (const side in borders) {
      const b = borders[side];
      s += `border-${side}:${b.width || 1}px solid ${b.color || '#d9d9d9'};`;
    }
  } else {
    const border = cellStyle.border || { width: 1, color: '#d9d9d9' };
    s += `border:${border.width || 1}px solid ${border.color || '#d9d9d9'};`;
  }
  s += `background:${cellStyle.fill || '#fff'};`;
  s += 'padding:0;vertical-align:middle;overflow:hidden;font-weight:normal;text-align:left;';
  if (rowHeight) s += `height:${rowHeight}px;`;
  return s;
}

function renderLine(el, animClass, animDelay) {
  const xf = el.xfrm;
  const line = el.line || { width: 1, color: '#000', dash: null };
  const dx = xf.width;
  const dy = xf.height;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  let style = `position:absolute;left:${xf.x}px;top:${xf.y}px;`;
  style += `width:${length}px;height:${line.width}px;`;
  style += `background:${line.color};`;
  style += `transform:rotate(${angle}deg);transform-origin:0 0;`;
  style += `animation-delay:${animDelay}ms;`;
  if (line.dash && line.dash !== 'solid') {
    style += 'background:repeating-linear-gradient(90deg,' + line.color + ',' + line.color + ' 4px,transparent 4px,transparent 8px);';
  }
  return `<div class="p-el p-line ${animClass}" style="${style}"></div>`;
}

function renderText(txBody) {
  const { paragraphs, lIns, tIns, rIns, bIns, anchor, anchorCtr } = txBody;
  let align = 'left';
  if (anchorCtr) align = 'center';
  else if (anchor === 'ctr') align = 'center';
  else if (anchor === 'r') align = 'right';
  else if (anchor === 'just') align = 'justify';
  align = normalizeTextAlign(align);

  let pad = '';
  if (hasInset(lIns) || hasInset(tIns) || hasInset(rIns) || hasInset(bIns)) {
    pad = `padding:${textInset(tIns, 0)}px ${textInset(rIns, 7)}px ${textInset(bIns, 0)}px ${textInset(lIns, 7)}px;`;
  }

  const valign = anchor === 'b' ? 'flex-end' : anchor === 'ctr' ? 'center' : 'flex-start';

  let html = `<div class="p-txBody" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:${valign};text-align:${align};${pad}box-sizing:border-box;">`;

  for (const para of paragraphs) {
    const pAlign = normalizeTextAlign(para.align || align);
    let pStyle = `text-align:${pAlign};margin:0;`;
    if (para.spaceBefore) pStyle += `margin-top:${para.spaceBefore}px;`;
    if (para.spaceAfter) pStyle += `margin-bottom:${para.spaceAfter}px;`;
    if (para.lineSpacing) pStyle += `line-height:${para.lineSpacing};`;

    html += `<p style="${pStyle}">`;

    const bullet = para.bullet ? (para.bullet.char || '•') : '';
    if (bullet) {
      html += `<span style="margin-right:6px;">${escapeHtml(bullet)}</span>`;
    }

    for (const run of para.lines) {
      if (run.type === 'br') {
        html += '<br>';
        continue;
      }
      let rStyle = '';
      if (run.bold) rStyle += 'font-weight:bold;';
      if (run.italic) rStyle += 'font-style:italic;';
      if (run.underline) rStyle += 'text-decoration:underline;';
      if (run.size) rStyle += `font-size:${run.size}pt;`;
      if (run.color && run.color !== 'inherit') rStyle += `color:${run.color};`;
      rStyle += buildFontFamilyStyle(run.font || run.fontEa);

      const text = escapeHtml(run.text || '');
      if (run.href && isSafeUrl(run.href)) {
        const aStyle = rStyle ? ` style="${rStyle}"` : '';
        html += `<a href="${escapeHtml(String(run.href))}" target="_blank" rel="noopener noreferrer"${aStyle}>${text}</a>`;
      } else if (rStyle) {
        html += `<span style="${rStyle}">${text}</span>`;
      } else {
        html += text;
      }
    }

    html += '</p>';
  }

  html += '</div>';
  return html;
}

function hasInset(value) {
  return value !== undefined && value !== null;
}

function textInset(value, fallback) {
  return hasInset(value) ? value : fallback;
}

function buildFontFamilyStyle(font) {
  if (!font) return '';
  const safeFont = sanitizeFontName(font);
  return safeFont ? `font-family:'${safeFont}',sans-serif;` : 'font-family:sans-serif;';
}

function sanitizeFontName(font) {
  const name = String(font).trim();
  if (!name || /[\u0000-\u001f\u007f&"'\\;{}<>]/.test(name)) return '';
  return name;
}

function normalizeTextAlign(value) {
  if (value === 'ctr') return 'center';
  if (value === 'r') return 'right';
  if (value === 'just') return 'justify';
  if (value === 'l') return 'left';
  return value || 'left';
}

function buildBaseStyle(xf) {
  let s = `position:absolute;left:${xf.x}px;top:${xf.y}px;width:${xf.width}px;height:${xf.height}px;`;
  if (xf.rotation) {
    s += `transform:rotate(${xf.rotation}deg);`;
  }
  if (xf.flipH) s += 'transform:scaleX(-1);';
  if (xf.flipV) s += 'transform:scaleY(-1);';
  return s;
}

function buildFillCss(el) {
  if (!el.fill) return 'background:transparent;';
  if (el.fill.type === 'none') return 'background:transparent;';
  if (el.fill.type === 'solid') return `background:${el.fill.color};`;
  if (el.fill.type === 'gradient' && el.fill.stops && el.fill.stops.length >= 2) {
    const s1 = el.fill.stops[0];
    const s2 = el.fill.stops[el.fill.stops.length - 1];
    return `background:linear-gradient(to bottom,${s1.color},${s2.color});`;
  }
  return 'background:transparent;';
}

function buildLineCss(el) {
  if (!el.line) return '';
  const line = el.line;
  let s = '';
  if (line.color && line.color !== 'transparent') {
    s += `border:${line.width || 1}px solid ${line.color};`;
  } else {
    s += `border:${line.width || 1}px solid transparent;`;
  }
  if (line.dash && line.dash !== 'solid') {
    s += 'border-style:dashed;';
  }
  return s;
}

function buildShapeCss(el) {
  if (!el.geometry) return '';
  if (el.geometry.type === 'prst') {
    const name = el.geometry.name;
    if (name === 'ellipse' || name === 'circle') {
      return 'border-radius:50%;';
    }
    if (name === 'roundRect') {
      const adj = el.geometry.adjustments && el.geometry.adjustments.find(a => a.name === 'adj');
      const radius = adj ? Math.min(parseAdjVal(adj.fmla), 50000) / 50000 : 0.15;
      return `border-radius:${Math.round(radius * 100)}%;`;
    }
    const clip = PRST_CLIP_PATHS[name];
    if (clip) return `clip-path:${clip};`;
  }
  return '';
}

// PPTX preset geometry → CSS clip-path 映射
// 覆盖 PowerPoint 中最常见的 30+ 种预设形状
const PRST_CLIP_PATHS = {
  // 三角形
  triangle:     'polygon(50% 0%, 0% 100%, 100% 100%)',
  rtTriangle:   'polygon(0% 0%, 0% 100%, 100% 100%)',
  // 四边形
  diamond:      'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)',
  parallelogram:'polygon(25% 0%, 100% 0%, 75% 100%, 0% 100%)',
  trapezoid:    'polygon(20% 0%, 80% 0%, 100% 100%, 0% 100%)',
  // 多边形
  pentagon:     'polygon(50% 0%, 100% 38%, 82% 100%, 18% 100%, 0% 38%)',
  hexagon:      'polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)',
  heptagon:     'polygon(50% 0%, 90% 20%, 100% 60%, 75% 100%, 25% 100%, 0% 60%, 10% 20%)',
  octagon:      'polygon(30% 0%, 70% 0%, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0% 70%, 0% 30%)',
  decagon:      'polygon(50% 0%, 80% 10%, 100% 35%, 100% 65%, 80% 90%, 50% 100%, 20% 90%, 0% 65%, 0% 35%, 20% 10%)',
  dodecagon:    'polygon(50% 0%, 75% 7%, 93% 25%, 100% 50%, 93% 75%, 75% 93%, 50% 100%, 25% 93%, 7% 75%, 0% 50%, 7% 25%, 25% 7%)',
  // 箭头
  rightArrow:   'polygon(0% 20%, 60% 20%, 60% 0%, 100% 50%, 60% 100%, 60% 80%, 0% 80%)',
  leftArrow:    'polygon(100% 20%, 40% 20%, 40% 0%, 0% 50%, 40% 100%, 40% 80%, 100% 80%)',
  upArrow:      'polygon(20% 100%, 20% 40%, 0% 40%, 50% 0%, 100% 40%, 80% 40%, 80% 100%)',
  downArrow:    'polygon(20% 0%, 20% 60%, 0% 60%, 50% 100%, 100% 60%, 80% 60%, 80% 0%)',
  leftRightArrow:'polygon(0% 25%, 40% 25%, 40% 0%, 100% 50%, 40% 100%, 40% 75%, 0% 75%)',
  upDownArrow:  'polygon(25% 0%, 75% 0%, 75% 40%, 100% 40%, 50% 100%, 0% 40%, 25% 40%)',
  quadArrow:    'polygon(25% 25%, 25% 0%, 50% 25%, 75% 0%, 75% 25%, 100% 25%, 75% 50%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 25% 100%, 25% 75%, 0% 75%, 25% 50%, 0% 25%)',
  stripedRightArrow:'polygon(0% 15%, 50% 15%, 50% 0%, 100% 50%, 50% 100%, 50% 85%, 0% 85%)',
  notchedRightArrow:'polygon(0% 20%, 55% 20%, 55% 0%, 100% 50%, 55% 100%, 55% 80%, 0% 80%)',
  chevron:      'polygon(75% 0%, 100% 50%, 75% 100%, 0% 100%, 25% 50%, 0% 0%)',
  circularArrow:'circle(50%)',
  // 五角星
  star5:        'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)',
  star6:        'polygon(50% 0%, 65% 25%, 93% 25%, 75% 50%, 93% 75%, 65% 75%, 50% 100%, 35% 75%, 7% 75%, 25% 50%, 7% 25%, 35% 25%)',
  star8:        'polygon(50% 0%, 63% 20%, 87% 13%, 80% 37%, 100% 50%, 80% 63%, 87% 87%, 63% 80%, 50% 100%, 37% 80%, 13% 87%, 20% 63%, 0% 50%, 20% 37%, 13% 13%, 37% 20%)',
  star10:       'polygon(50% 0%, 61% 18%, 81% 10%, 72% 31%, 95% 36%, 74% 49%, 90% 69%, 68% 64%, 63% 82%, 50% 72%, 37% 82%, 32% 64%, 10% 69%, 26% 49%, 5% 36%, 28% 31%, 19% 10%, 39% 18%)',
  star12:       'polygon(50% 0%, 59% 15%, 75% 8%, 68% 26%, 87% 28%, 72% 42%, 84% 59%, 66% 55%, 63% 74%, 50% 65%, 37% 74%, 34% 55%, 16% 59%, 28% 42%, 13% 28%, 32% 26%, 25% 8%, 41% 15%)',
  star16:       'polygon(50% 0%, 57% 12%, 69% 6%, 64% 22%, 81% 21%, 69% 35%, 79% 48%, 64% 47%, 62% 62%, 50% 55%, 38% 62%, 36% 47%, 21% 48%, 31% 35%, 19% 21%, 36% 22%, 31% 6%, 43% 12%)',
  star24:       'polygon(50% 0%, 56% 9%, 66% 5%, 62% 17%, 75% 16%, 66% 28%, 74% 38%, 62% 36%, 60% 48%, 50% 43%, 40% 48%, 38% 36%, 26% 38%, 34% 28%, 25% 16%, 38% 17%, 34% 5%, 44% 9%)',
  // 横幅/徽章
  plaque:       'polygon(10% 0%, 90% 0%, 100% 50%, 90% 100%, 10% 100%, 0% 50%)',
  wave:         'polygon(0% 30%, 10% 10%, 30% 30%, 50% 10%, 70% 30%, 90% 10%, 100% 30%, 100% 100%, 0% 100%)',
  doubleWave:   'polygon(0% 20%, 8% 5%, 16% 20%, 25% 5%, 33% 20%, 42% 5%, 50% 20%, 58% 5%, 67% 20%, 75% 5%, 83% 20%, 92% 5%, 100% 20%, 100% 100%, 0% 100%)',
  // 十字/加号
  plus:         'polygon(35% 0%, 65% 0%, 65% 35%, 100% 35%, 100% 65%, 65% 65%, 65% 100%, 35% 100%, 35% 65%, 0% 65%, 0% 35%, 35% 35%)',
  // 其他常用
  arc:          'polygon(0% 50%, 0% 0%, 100% 0%, 100% 50%, 50% 50%)',
  bentArrow:    'polygon(0% 80%, 60% 80%, 60% 100%, 100% 50%, 60% 0%, 60% 20%, 0% 20%)',
  uturnArrow:   'polygon(0% 100%, 60% 100%, 60% 30%, 20% 30%, 20% 0%, 0% 0%, 0% 50%, 40% 50%, 40% 80%, 0% 80%)',
  moon:         'polygon(50% 0%, 100% 0%, 100% 100%, 50% 100%, 50% 80%, 80% 50%, 50% 20%)',
  heart:        'polygon(50% 100%, 0% 40%, 0% 15%, 20% 0%, 40% 10%, 50% 30%, 60% 10%, 80% 0%, 100% 15%, 100% 40%)',
  lightningBolt:'polygon(60% 0%, 30% 40%, 50% 40%, 10% 100%, 70% 50%, 50% 50%, 90% 0%)',
  sun:          'polygon(50% 0%, 61% 15%, 80% 8%, 75% 25%, 92% 30%, 78% 43%, 92% 55%, 75% 60%, 80% 78%, 61% 70%, 50% 85%, 39% 70%, 20% 78%, 25% 60%, 8% 55%, 22% 43%, 8% 30%, 25% 25%, 20% 8%, 39% 15%)',
  cloud:        'polygon(30% 30%, 15% 45%, 15% 65%, 25% 80%, 40% 85%, 60% 85%, 75% 80%, 85% 65%, 85% 50%, 80% 35%, 65% 25%, 50% 28%, 40% 20%)',
};

function parseAdjVal(fmla) {
  const m = /val\s+(\d+)/.exec(fmla);
  return m ? parseInt(m[1], 10) : 0;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function isSafeUrl(url) {
  if (!url) return false;
  // 剔除 ASCII 控制字符和空白符，防止 java\nscript: 等绕过 scheme 检测
  const normalized = String(url).replace(/[\x00-\x20\x7F]/g, '');
  if (!normalized) return false;
  // 相对路径、锚点、协议相对 URL（无 scheme 可检测）
  if (/^(\.\.?\/|\/\/|#)/.test(normalized) || !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(normalized)) {
    return true;
  }
  const scheme = normalized.split(':')[0].toLowerCase();
  return ['http', 'https', 'mailto', 'tel'].includes(scheme);
}

module.exports = { renderSlides };
