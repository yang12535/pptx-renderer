const { parseXml, child, toArray } = require('../core/xml');
const { parseShape, parsePicture, parseGraphicFrame, parseCxnSp, parseChartXml } = require('./shape');
const fs = require('fs');
const path = require('path');

function parseSlide(slidePath, theme, relsMap) {
  if (!fs.existsSync(slidePath)) return null;
  const xml = fs.readFileSync(slidePath, 'utf-8');
  const doc = parseXml(xml);
  const sld = child(doc, 'sld') || doc['p:sld'];
  const cSld = child(sld, 'cSld') || sld['p:cSld'];

  const slideObj = {
    background: null,
    elements: [],
  };

  // 背景
  const bg = child(cSld, 'bg') || cSld['p:bg'];
  if (bg) {
    slideObj.background = parseBackground(bg, theme);
  }

  // 元素树
  const spTree = child(cSld, 'spTree') || cSld['p:spTree'];
  if (!spTree) return slideObj;

  for (const [key, val] of Object.entries(spTree)) {
    if (key.startsWith('_')) continue;
    const items = toArray(val);
    for (const item of items) {
      let el = null;
      if (key.endsWith(':sp') || key === 'sp') {
        el = parseShape(item, theme);
      } else if (key.endsWith(':pic') || key === 'pic') {
        el = parsePicture(item, theme, relsMap);
      } else if (key.endsWith(':graphicFrame') || key === 'graphicFrame') {
        el = parseGraphicFrame(item, theme, relsMap);
      } else if (key.endsWith(':cxnSp') || key === 'cxnSp') {
        el = parseCxnSp(item, theme);
      } else if (key.endsWith(':grpSp') || key === 'grpSp') {
        // 组合形状：递归解析（简化处理，打平）
        const grpEls = parseGroup(item, theme, relsMap);
        slideObj.elements.push(...grpEls);
        continue;
      }
      if (el) slideObj.elements.push(el);
    }
  }

  // 解析图表
  for (const el of slideObj.elements) {
    if (el.type === 'graphicFrame' && el.chartRelId && relsMap[el.chartRelId]) {
      const chartPath = path.resolve(path.dirname(slidePath), relsMap[el.chartRelId]);
      if (fs.existsSync(chartPath)) {
        try {
          const chartXml = fs.readFileSync(chartPath, 'utf-8');
          el.chartData = parseChartXml(chartXml);
        } catch (e) {
          el.chartData = null;
        }
      }
    }
  }

  return slideObj;
}

function parseBackground(bgObj, theme) {
  const bgPr = child(bgObj, 'bgPr') || bgObj['p:bgPr'];
  if (bgPr) {
    const solidFill = child(bgPr, 'solidFill') || bgPr['a:solidFill'];
    if (solidFill) {
      const { colorToCss } = require('./color');
      return { type: 'solid', color: colorToCss(solidFill, theme) };
    }
    const gradFill = child(bgPr, 'gradFill') || bgPr['a:gradFill'];
    if (gradFill) {
      return { type: 'gradient', raw: gradFill };
    }
  }
  const bgRef = child(bgObj, 'bgRef') || bgObj['p:bgRef'];
  if (bgRef) {
    const { colorToCss } = require('./color');
    return { type: 'solid', color: colorToCss(bgRef, theme) };
  }
  return null;
}

function parseGroup(grpObj, theme, relsMap) {
  const spTree = child(grpObj, 'spTree') || grpObj['p:spTree'];
  if (!spTree) return [];
  const elements = [];
  for (const [key, val] of Object.entries(spTree)) {
    if (key.startsWith('_')) continue;
    const items = toArray(val);
    for (const item of items) {
      let el = null;
      if (key.endsWith(':sp') || key === 'sp') el = parseShape(item, theme);
      else if (key.endsWith(':pic') || key === 'pic') el = parsePicture(item, theme, relsMap);
      else if (key.endsWith(':graphicFrame') || key === 'graphicFrame') el = parseGraphicFrame(item, theme, relsMap);
      else if (key.endsWith(':cxnSp') || key === 'cxnSp') el = parseCxnSp(item, theme);
      if (el) elements.push(el);
    }
  }
  return elements;
}

module.exports = { parseSlide };
