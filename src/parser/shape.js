const { parseXml, child, toArray } = require('../core/xml');
const { emuToPx, angleToDegrees, fontSizeToPt } = require('../utils/units');
const { colorToCss } = require('./color');

// ==================== 通用变换解析 ====================
function parseXfrm(xfrmObj) {
  if (!xfrmObj) return null;
  const off = child(xfrmObj, 'off') || xfrmObj['a:off'];
  const ext = child(xfrmObj, 'ext') || xfrmObj['a:ext'];
  const chOff = child(xfrmObj, 'chOff') || xfrmObj['a:chOff'];
  const chExt = child(xfrmObj, 'chExt') || xfrmObj['a:chExt'];

  const result = {
    x: off ? emuToPx(off._x) : 0,
    y: off ? emuToPx(off._y) : 0,
    width: ext ? emuToPx(ext._cx) : 0,
    height: ext ? emuToPx(ext._cy) : 0,
    rotation: xfrmObj._rot ? angleToDegrees(xfrmObj._rot) : 0,
    flipH: xfrmObj._flipH === true || xfrmObj._flipH === '1',
    flipV: xfrmObj._flipV === true || xfrmObj._flipV === '1',
  };

  return result;
}

// ==================== 形状属性 ====================
function parseSpPr(spPr, theme) {
  const result = {
    xfrm: parseXfrm(child(spPr, 'xfrm') || spPr['a:xfrm']),
    geometry: null,
    fill: null,
    line: null,
  };

  // 几何体
  const prstGeom = child(spPr, 'prstGeom') || spPr['a:prstGeom'];
  if (prstGeom) {
    result.geometry = {
      type: 'prst',
      name: prstGeom._prst || 'rect',
    };
    // 形状调整参数（如圆角矩形的圆角大小）
    const avLst = child(prstGeom, 'avLst') || prstGeom['a:avLst'];
    if (avLst) {
      const gds = toArray(child(avLst, 'gd') || avLst['a:gd']);
      result.geometry.adjustments = gds.map(g => ({ name: g._name, fmla: g._fmla }));
    }
  }
  const custGeom = child(spPr, 'custGeom') || spPr['a:custGeom'];
  if (custGeom) {
    result.geometry = { type: 'cust', raw: custGeom };
  }

  // 填充
  const noFill = child(spPr, 'noFill') || spPr['a:noFill'];
  if (noFill) {
    result.fill = { type: 'none' };
  } else {
    const solidFill = child(spPr, 'solidFill') || spPr['a:solidFill'];
    if (solidFill) {
      result.fill = { type: 'solid', color: colorToCss(solidFill, theme) };
    }
    const gradFill = child(spPr, 'gradFill') || spPr['a:gradFill'];
    if (gradFill) {
      result.fill = parseGradientFill(gradFill, theme);
    }
    const blipFill = child(spPr, 'blipFill') || spPr['a:blipFill'];
    if (blipFill) {
      result.fill = { type: 'image', raw: blipFill };
    }
  }

  // 线条
  const ln = child(spPr, 'ln') || spPr['a:ln'];
  if (ln) {
    result.line = parseLine(ln, theme);
  }

  return result;
}

function parseGradientFill(gradFill, theme) {
  // 简化：提取所有渐变停止点
  const gsLst = child(gradFill, 'gsLst') || gradFill['a:gsLst'];
  const stops = toArray(child(gsLst, 'gs') || gsLst && gsLst['a:gs']).map(gs => ({
    pos: gs._pos / 100000,
    color: colorToCss(gs, theme),
  }));
  return { type: 'gradient', stops, raw: gradFill };
}

function parseLine(ln, theme) {
  const width = ln._w ? emuToPx(ln._w) : 1;
  const result = { width, color: 'transparent', dash: null, cap: ln._cap };
  const noFill = child(ln, 'noFill') || ln['a:noFill'];
  if (!noFill) {
    const solidFill = child(ln, 'solidFill') || ln['a:solidFill'];
    if (solidFill) result.color = colorToCss(solidFill, theme);
  }
  const prstDash = child(ln, 'prstDash') || ln['a:prstDash'];
  if (prstDash) result.dash = prstDash._val;
  return result;
}

// ==================== 文本解析 ====================
function parseTxBody(txBody, theme) {
  if (!txBody) return null;
  const bodyPr = child(txBody, 'bodyPr') || txBody['a:bodyPr'];
  const result = {
    anchor: 'top',
    anchorCtr: false,
    wrap: true,
    paragraphs: [],
  };

  if (bodyPr) {
    result.anchor = bodyPr._anchor || 'top';
    result.anchorCtr = bodyPr._anchorCtr === true || bodyPr._anchorCtr === '1';
    result.wrap = bodyPr._wrap !== 'none';
    // 边距（EMU 转 px）
    result.lIns = bodyPr._lIns ? emuToPx(bodyPr._lIns) : 7;
    result.tIns = bodyPr._tIns ? emuToPx(bodyPr._tIns) : 0;
    result.rIns = bodyPr._rIns ? emuToPx(bodyPr._rIns) : 7;
    result.bIns = bodyPr._bIns ? emuToPx(bodyPr._bIns) : 0;
  }

  const ps = toArray(child(txBody, 'p') || txBody['a:p']);
  for (const p of ps) {
    result.paragraphs.push(parseParagraph(p, theme));
  }

  return result;
}

function parseParagraph(p, theme) {
  const para = {
    align: 'left',
    lines: [],
    level: 0,
    spaceBefore: 0,
    spaceAfter: 0,
    lineSpacing: 1.2,
    bullet: null,
  };

  const pPr = child(p, 'pPr') || p['a:pPr'];
  if (pPr) {
    para.align = pPr._algn || 'left';
    para.level = parseInt(pPr._lvl || '0', 10);
    const spcBef = child(pPr, 'spcBef') || pPr['a:spcBef'];
    if (spcBef) {
      const spcPts = child(spcBef, 'spcPts') || spcBef['a:spcPts'];
      if (spcPts) para.spaceBefore = spcPts._val / 100; // 百分之一点
    }
    const spcAft = child(pPr, 'spcAft') || pPr['a:spcAft'];
    if (spcAft) {
      const spcPts = child(spcAft, 'spcPts') || spcAft['a:spcPts'];
      if (spcPts) para.spaceAfter = spcPts._val / 100;
    }
    const lnSpc = child(pPr, 'lnSpc') || pPr['a:lnSpc'];
    if (lnSpc) {
      const spcPct = child(lnSpc, 'spcPct') || lnSpc['a:spcPct'];
      if (spcPct) para.lineSpacing = spcPct._val / 100000;
    }
    // 项目符号：只有明确设置才显示
    const buChar = child(pPr, 'buChar') || pPr['a:buChar'];
    const buAutoNum = child(pPr, 'buAutoNum') || pPr['a:buAutoNum'];
    if (buChar) {
      para.bullet = { type: 'char', char: buChar._char };
    } else if (buAutoNum) {
      para.bullet = { type: 'auto', style: buAutoNum._type };
    }
    if (para.bullet) {
      const buClr = child(pPr, 'buClr') || pPr['a:buClr'];
      if (buClr) para.bulletColor = colorToCss(buClr, theme);
      const buSzPct = child(pPr, 'buSzPct') || pPr['a:buSzPct'];
      if (buSzPct) para.bulletSize = buSzPct._val / 100000;
    }
  }

  const runs = [];
  const children = Object.entries(p);
  for (const [key, val] of children) {
    if (key.startsWith('_')) continue;
    if (key.endsWith(':r') || key === 'r' || key.endsWith(':fld') || key === 'fld') {
      for (const r of toArray(val)) runs.push(parseRun(r, theme));
    } else if (key.endsWith(':br') || key === 'br') {
      runs.push({ type: 'br' });
    }
  }
  para.lines = runs;

  return para;
}

function parseRun(r, theme) {
  const rPr = child(r, 'rPr') || r['a:rPr'];
  const parsedText = child(r, 't');
  const rawText = parsedText !== undefined ? parsedText : r['a:t'];
  const run = {
    type: 'text',
    text: textValueToString(rawText),
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    size: 18,
    color: 'inherit',
    font: null,
    lang: null,
  };

  if (rPr) {
    run.bold = rPr._b === true || rPr._b === '1';
    run.italic = rPr._i === true || rPr._i === '1';
    run.underline = rPr._u === true || rPr._u === '1' || rPr._u === 'sng';
    run.strike = rPr._strike === true || rPr._strike === '1' || rPr._strike === 'sngStrike';
    if (rPr._sz) run.size = fontSizeToPt(rPr._sz);
    if (rPr._lang) run.lang = rPr._lang;

    const solidFill = child(rPr, 'solidFill') || rPr['a:solidFill'];
    if (solidFill) run.color = colorToCss(solidFill, theme);

    const latin = child(rPr, 'latin') || rPr['a:latin'];
    const ea = child(rPr, 'ea') || rPr['a:ea'];
    if (latin) run.font = latin._typeface;
    if (ea) run.fontEa = ea._typeface;
  }

  return run;
}

function textValueToString(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value['#text'] !== undefined) return textValueToString(value['#text']);
  return '';
}

// ==================== 形状类型解析 ====================
function parseShape(sp, theme) {
  const nvSpPr = child(sp, 'nvSpPr') || sp['p:nvSpPr'];
  const spPr = child(sp, 'spPr') || sp['p:spPr'];
  const txBody = child(sp, 'txBody') || sp['p:txBody'];

  const shape = {
    type: 'shape',
    id: null,
    name: '',
    isTextBox: false,
    ...parseSpPr(spPr, theme),
    text: parseTxBody(txBody, theme),
  };

  if (nvSpPr) {
    const cNvPr = child(nvSpPr, 'cNvPr') || nvSpPr['p:cNvPr'];
    if (cNvPr) {
      shape.id = cNvPr._id;
      shape.name = cNvPr._name || '';
      shape.isTextBox = shape.name.toLowerCase().includes('textbox') || shape.name === '';
    }
    // 如果是占位符，标记
    const nvPr = child(nvSpPr, 'nvPr') || nvSpPr['p:nvPr'];
    if (nvPr) {
      const ph = child(nvPr, 'ph') || nvPr['p:ph'];
      if (ph) {
        shape.placeholder = {
          type: ph._type,
          idx: ph._idx,
        };
      }
    }
  }

  // 纯文本框（无几何体或几何体为 rect 且无填充无线条）
  if (!shape.geometry && !shape.fill && !shape.line) {
    shape.isTextBox = true;
  }

  return shape;
}

function parsePicture(pic, theme, relsMap) {
  const nvPicPr = child(pic, 'nvPicPr') || pic['p:nvPicPr'];
  const spPr = child(pic, 'spPr') || pic['p:spPr'];
  const blipFill = child(pic, 'blipFill') || pic['p:blipFill'];

  const image = {
    type: 'image',
    id: null,
    name: '',
    ...parseSpPr(spPr, theme),
    src: null,
    crop: null,
  };

  if (nvPicPr) {
    const cNvPr = child(nvPicPr, 'cNvPr') || nvPicPr['p:cNvPr'];
    if (cNvPr) {
      image.id = cNvPr._id;
      image.name = cNvPr._name || '';
    }
  }

  if (blipFill) {
    const blip = child(blipFill, 'blip') || blipFill['a:blip'];
    if (blip) {
      const embedId = blip['_r:embed'] || blip._embed;
      if (embedId && relsMap[embedId]) {
        image.src = relsMap[embedId];
      }
    }
  }

  return image;
}

function parseGraphicFrame(gf, theme, relsMap) {
  const nvGraphicFramePr = child(gf, 'nvGraphicFramePr') || gf['p:nvGraphicFramePr'];
  const xfrm = parseXfrm(child(gf, 'xfrm') || gf['a:xfrm']);

  const graphic = child(gf, 'graphic') || gf['a:graphic'];
  if (!graphic) return null;
  const graphicData = child(graphic, 'graphicData') || graphic['a:graphicData'];
  if (!graphicData) return null;

  const uri = graphicData._uri;
  const chart = child(graphicData, 'chart') || graphicData['c:chart'];
  const tbl = child(graphicData, 'tbl') || graphicData['a:tbl'];

  let subType = 'unknown';
  if (chart) subType = 'chart';
  if (tbl) subType = 'table';

  const result = {
    type: 'graphicFrame',
    subType,
    uri,
    xfrm,
    id: null,
    name: '',
  };
  if (chart && (chart['r:id'] || chart['_r:id'])) {
    result.chartRelId = chart['r:id'] || chart['_r:id'];
  }
  if (tbl) {
    result.tableData = parseTableData(tbl, theme);
  }
  return result;
}

function parseCxnSp(cxnSp, theme) {
  const nvCxnSpPr = child(cxnSp, 'nvCxnSpPr') || cxnSp['p:nvCxnSpPr'];
  const spPr = child(cxnSp, 'spPr') || cxnSp['p:spPr'];

  const shape = {
    type: 'connector',
    id: null,
    name: '',
    ...parseSpPr(spPr, theme),
  };

  if (nvCxnSpPr) {
    const cNvPr = child(nvCxnSpPr, 'cNvPr') || nvCxnSpPr['p:cNvPr'];
    if (cNvPr) {
      shape.id = cNvPr._id;
      shape.name = cNvPr._name || '';
    }
  }

  return shape;
}

function parseTableData(tblObj, theme) {
  const grid = child(tblObj, 'tblGrid') || tblObj['a:tblGrid'];
  const gridCols = grid ? toArray(child(grid, 'gridCol') || grid['a:gridCol']) : [];
  const colWidths = gridCols.map(col => col._w ? emuToPx(col._w) : null);
  const rows = [];
  const trList = toArray(child(tblObj, 'tr') || tblObj['a:tr']);
  for (const tr of trList) {
    const cells = [];
    const tcList = toArray(child(tr, 'tc') || tr['a:tc']);
    for (const tc of tcList) {
      let text = '';
      const txBody = child(tc, 'txBody') || tc['a:txBody'];
      const textBody = parseTxBody(txBody, theme);
      const style = parseTableCellStyle(tc, theme);
      if (textBody && style.margins) {
        textBody.lIns = style.margins.left ?? textBody.lIns;
        textBody.rIns = style.margins.right ?? textBody.rIns;
        textBody.tIns = style.margins.top ?? textBody.tIns;
        textBody.bIns = style.margins.bottom ?? textBody.bIns;
      }
      if (txBody) {
        const pList = toArray(child(txBody, 'p') || txBody['a:p']);
        for (const para of pList) {
          const rList = toArray(child(para, 'r') || para['a:r']);
          for (const run of rList) {
            text += textValueToString(child(run, 't') || run['a:t']);
          }
        }
      }
      cells.push({ text, textBody, style });
    }
    rows.push({ height: tr._h ? emuToPx(tr._h) : null, cells });
  }
  return { colWidths, rows };
}

function parseTableCellStyle(tc, theme) {
  const tcPr = child(tc, 'tcPr') || tc['a:tcPr'];
  const style = {};
  if (!tcPr) return style;

  const solidFill = child(tcPr, 'solidFill') || tcPr['a:solidFill'];
  if (solidFill) style.fill = colorToCss(solidFill, theme);

  const border = parseTableBorder(tcPr, theme);
  if (border) style.border = border;

  const margins = {};
  if (tcPr._marL) margins.left = emuToPx(tcPr._marL);
  if (tcPr._marR) margins.right = emuToPx(tcPr._marR);
  if (tcPr._marT) margins.top = emuToPx(tcPr._marT);
  if (tcPr._marB) margins.bottom = emuToPx(tcPr._marB);
  if (Object.keys(margins).length > 0) style.margins = margins;

  return style;
}

function parseTableBorder(tcPr, theme) {
  const sides = ['lnL', 'lnR', 'lnT', 'lnB'];
  for (const side of sides) {
    const ln = child(tcPr, side) || tcPr['a:' + side];
    if (!ln) continue;
    const parsed = parseLine(ln, theme);
    if (parsed && parsed.color && parsed.color !== 'transparent') {
      return parsed;
    }
  }
  return null;
}

function parseChartXml(xmlStr, theme) {
  const doc = parseXml(xmlStr);
  const chartSpace = child(doc, 'chartSpace') || doc['c:chartSpace'] || doc;
  const chart = child(chartSpace, 'chart') || chartSpace['c:chart'];
  if (!chart) return null;
  const plotArea = child(chart, 'plotArea') || chart['c:plotArea'];
  if (!plotArea) return null;

  let chartType = null;
  let chartNode = null;
  const typeKeys = ['barChart', 'lineChart', 'pieChart', 'areaChart', 'scatterChart', 'doughnutChart', 'radarChart', 'stockChart', 'surfaceChart'];
  for (const tk of typeKeys) {
    const node = child(plotArea, tk) || plotArea['c:' + tk];
    if (node) { chartType = tk; chartNode = node; break; }
  }
  if (!chartType) return null;

  let barDir = null;
  if (chartType === 'barChart') {
    const bd = child(chartNode, 'barDir') || chartNode['c:barDir'];
    barDir = bd ? bd._val : 'col';
  }

  let grouping = null;
  const grp = child(chartNode, 'grouping') || chartNode['c:grouping'];
  if (grp) grouping = grp._val;

  const showVal = getShowVal(child(chartNode, 'dLbls') || chartNode['c:dLbls']);

  let title = '';
  const titleNode = child(chart, 'title') || chart['c:title'];
  if (titleNode) {
    const tx = child(titleNode, 'tx') || titleNode['c:tx'];
    title = extractRichText(tx);
  }

  function extractRichText(node) {
    const pieces = [];
    collectTextRuns(node, pieces);
    return pieces.join('');
  }

  function collectTextRuns(node, pieces) {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(item => collectTextRuns(item, pieces));
      return;
    }
    if (typeof node !== 'object') {
      const value = textValueToString(node);
      if (value) pieces.push(value);
      return;
    }

    const t = child(node, 't') || node['a:t'];
    const value = textValueToString(t);
    if (value) pieces.push(value);

    collectTextRuns(child(node, 'rich') || node['c:rich'] || node['a:rich'], pieces);
    collectTextRuns(child(node, 'p') || node['a:p'], pieces);
    collectTextRuns(child(node, 'r') || node['a:r'], pieces);
    collectTextRuns(child(node, 'fld') || node['a:fld'], pieces);
  }

  function extractText(node) {
    if (!node) return '';
    const v = child(node, 'v') || node['c:v'];
    return textValueToString(v);
  }

  function extractCacheValues(cache) {
    if (!cache) return [];
    const directPts = toArray(child(cache, 'pt') || cache['c:pt']);
    if (directPts.length) return directPts.map(extractText);

    const levels = toArray(child(cache, 'lvl') || cache['c:lvl']);
    const values = [];
    for (const lvl of levels) {
      const levelPts = toArray(child(lvl, 'pt') || lvl['c:pt']);
      values.push(...levelPts.map(extractText));
    }
    return values;
  }

  function extractChartPoints(container, refNames, cacheNames) {
    if (!container) return [];

    let refs = [];
    for (const refName of refNames) {
      refs = refs.concat(toArray(child(container, refName) || container['c:' + refName]));
    }
    if (!refs.length) refs = [container];

    for (const ref of refs) {
      for (const cacheName of cacheNames) {
        const cache = child(ref, cacheName) || ref['c:' + cacheName];
        const values = extractCacheValues(cache);
        if (values.length) return values;
      }

      const directValues = extractCacheValues(ref);
      if (directValues.length) return directValues;
    }

    return [];
  }

  const seriesList = toArray(child(chartNode, 'ser') || chartNode['c:ser']);
  const series = [];
  for (const ser of seriesList) {
    let sName = '';
    const tx = child(ser, 'tx') || ser['c:tx'];
    if (tx) {
      const strRef = child(tx, 'strRef') || tx['c:strRef'];
      const strCache = strRef && (child(strRef, 'strCache') || strRef['c:strCache']);
      const pt = strCache && (child(strCache, 'pt') || strCache['c:pt']);
      if (pt) sName = extractText(pt);
    }

    const categories = [];
    const cat = child(ser, 'cat') || ser['c:cat'];
    if (cat) {
      categories.push(...extractChartPoints(
        cat,
        ['strRef', 'numRef', 'multiLvlStrRef', 'strLit', 'numLit'],
        ['strCache', 'numCache', 'multiLvlStrCache']
      ));
    }

    const values = [];
    const val = child(ser, 'val') || ser['c:val'];
    if (val) {
      const valueTexts = extractChartPoints(val, ['numRef', 'strRef', 'numLit', 'strLit'], ['numCache', 'strCache']);
      for (const valueText of valueTexts) {
        const num = parseFloat(valueText);
        values.push(isNaN(num) ? 0 : num);
      }
    }

    const serShowVal = getShowVal(child(ser, 'dLbls') || ser['c:dLbls']);
    series.push({
      name: sName,
      categories,
      values,
      color: parseChartSeriesColor(ser, theme),
      showVal: serShowVal === null ? showVal : serShowVal,
    });
  }

  return { title, chartType, barDir, grouping, showVal, series };
}

function getShowVal(dLbls) {
  if (!dLbls) return null;
  const showVal = child(dLbls, 'showVal') || dLbls['c:showVal'];
  if (!showVal) return null;
  const val = showVal._val;
  return val === true || val === 1 || val === '1' || String(val).toLowerCase() === 'true';
}

function parseChartSeriesColor(ser, theme) {
  const spPr = child(ser, 'spPr') || ser['c:spPr'];
  if (!spPr) return null;
  const solidFill = child(spPr, 'solidFill') || spPr['a:solidFill'];
  return solidFill ? colorToCss(solidFill, theme) : null;
}

module.exports = {
  parseShape,
  parsePicture,
  parseGraphicFrame,
  parseCxnSp,
  parseXfrm,
  parseSpPr,
  parseTxBody,
  parseChartXml,
};
