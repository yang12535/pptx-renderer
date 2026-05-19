const { emuToPx, angleToDegrees } = require('../utils/units');

/**
 * 极简渲染器 —— 第一期只支持：
 * - 文本框（含段落、粗体、颜色、字体大小）
 * - 矩形、椭圆（CSS border-radius）
 * - 图片（img 标签）
 * - 直线（div + rotate）
 * 
 * 不支持：复杂路径、渐变、阴影、3D、图表、表格、SmartArt
 */

function renderSlides(slides, presMeta) {
  const { widthEmu, heightEmu } = presMeta;
  const slideW = emuToPx(widthEmu);
  const slideH = emuToPx(heightEmu);

  return slides.map((slide, idx) => renderSlide(slide, idx, slideW, slideH)).join('\n');
}

function renderSlide(slide, index, w, h) {
  const bgStyle = slide.background && slide.background.type === 'solid'
    ? `background:${slide.background.color};`
    : 'background:#fff;';

  let html = `<div class="slide" data-index="${index}" style="width:${w}px;height:${h}px;${bgStyle}">\n`;

  for (const el of slide.elements) {
    const elHtml = renderElement(el);
    if (elHtml) html += '  ' + elHtml + '\n';
  }

  html += '</div>';
  return html;
}

function renderElement(el) {
  const xf = el.xfrm;
  if (!xf) return '';

  const style = buildBaseStyle(xf);

  if (el.type === 'image' && el.src) {
    return `<img class="p-el p-img" src="${escapeHtml(el.src)}" style="${style}" alt="">`;
  }

  if (el.type === 'shape' || el.type === 'connector') {
    // 直线判断：connector 类型，或 prst=line，或宽高极扁
    const isLineShape = el.geometry && el.geometry.name === 'line';
    const isThin = Math.min(xf.width, xf.height) < 2;
    if (el.type === 'connector' || isLineShape || isThin) {
      return renderLine(el, style);
    }

    let shapeStyle = style;
    const fillCss = buildFillCss(el);
    const lineCss = buildLineCss(el);
    const shapeCss = buildShapeCss(el);
    shapeStyle += fillCss + lineCss + shapeCss;

    let inner = '';
    if (el.text && el.text.paragraphs.length > 0) {
      inner = renderText(el.text);
    }

    return `<div class="p-el p-shape" style="${shapeStyle}">${inner}</div>`;
  }

  // graphicFrame / table / chart：第一期用占位矩形
  if (el.type === 'graphicFrame') {
    return `<div class="p-el p-placeholder" style="${style}background:#f0f0f0;border:1px dashed #ccc;display:flex;align-items:center;justify-content:center;font-size:12px;color:#999;">[${el.subType || 'graphic'}]</div>`;
  }

  return '';
}

function renderLine(el, baseStyle) {
  const xf = el.xfrm;
  const line = el.line;
  // 计算直线角度和长度
  const dx = xf.width;
  const dy = xf.height;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);

  let style = `position:absolute;left:${xf.x}px;top:${xf.y}px;`;
  style += `width:${length}px;height:${line.width || 1}px;`;
  style += `background:${line.color || '#000'};`;
  style += `transform:rotate(${angle}deg);transform-origin:0 0;`;
  if (line.dash && line.dash !== 'solid') {
    style += 'background:repeating-linear-gradient(90deg,' + (line.color || '#000') + ',' + (line.color || '#000') + ' 4px,transparent 4px,transparent 8px);';
  }
  return `<div class="p-el p-line" style="${style}"></div>`;
}

function renderText(txBody) {
  const { paragraphs, lIns, tIns, rIns, bIns, anchor, anchorCtr } = txBody;
  let align = 'left';
  if (anchorCtr) align = 'center';
  else if (anchor === 'ctr') align = 'center';
  else if (anchor === 'r') align = 'right';
  else if (anchor === 'just') align = 'justify';

  let pad = '';
  if (lIns || tIns || rIns || bIns) {
    pad = `padding:${tIns || 0}px ${rIns || 7}px ${bIns || 0}px ${lIns || 7}px;`;
  }

  const valign = anchor === 'b' ? 'flex-end' : anchor === 'ctr' ? 'center' : 'flex-start';

  let html = `<div class="p-txBody" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:${valign};text-align:${align};${pad}box-sizing:border-box;">`;

  for (const para of paragraphs) {
    const pAlign = para.align || align;
    let pStyle = `text-align:${pAlign};margin:0;`;
    if (para.spaceBefore) pStyle += `margin-top:${para.spaceBefore}px;`;
    if (para.spaceAfter) pStyle += `margin-bottom:${para.spaceAfter}px;`;
    if (para.lineSpacing) pStyle += `line-height:${para.lineSpacing};`;

    html += `<p style="${pStyle}">`;

    const bullet = para.bullet ? (para.bullet.char || '•') : '';
    if (bullet) {
      html += `<span style="margin-right:6px;">${bullet}</span>`;
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
  // 渐变：第一期简化，取第一个和最后一个颜色做线性渐变
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
  // dash 暂用 border-style（仅对矩形有效）
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
      // 简化：固定圆角比例
      const adj = el.geometry.adjustments && el.geometry.adjustments.find(a => a.name === 'adj');
      const radius = adj ? Math.min(parseAdjVal(adj.fmla), 50000) / 50000 : 0.15;
      return `border-radius:${Math.round(radius * 100)}%;`;
    }
  }
  // 自定义几何体：第一期不做，用矩形占位
  return '';
}

function parseAdjVal(fmla) {
  // 形如 "val 5000"
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
