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
  const border = cellStyle.border || { width: 1, color: '#d9d9d9' };
  let s = `border:${border.width || 1}px solid ${border.color || '#d9d9d9'};`;
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
  if (lIns || tIns || rIns || bIns) {
    pad = `padding:${tIns || 0}px ${rIns || 7}px ${bIns || 0}px ${lIns || 7}px;`;
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
      if (run.font) rStyle += `font-family:'${run.font}',sans-serif;`;
      else if (run.fontEa) rStyle += `font-family:'${run.fontEa}',sans-serif;`;

      const text = escapeHtml(run.text || '');
      if (rStyle) html += `<span style="${rStyle}">${text}</span>`;
      else html += text;
    }

    html += '</p>';
  }

  html += '</div>';
  return html;
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
  }
  return '';
}

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

module.exports = { renderSlides };
