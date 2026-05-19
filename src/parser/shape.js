const { child, toArray } = require('../core/xml');
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
    if (key.endsWith(':r') || key === 'r') {
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
  const t = child(r, 't') || r['a:t'];
  const run = {
    type: 'text',
    text: typeof t === 'string' ? t : '',
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

  return {
    type: 'graphicFrame',
    subType,
    uri,
    xfrm,
    id: null,
    name: '',
    // chart/table 详细数据后续按需解析
  };
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

module.exports = {
  parseShape,
  parsePicture,
  parseGraphicFrame,
  parseCxnSp,
  parseXfrm,
  parseSpPr,
  parseTxBody,
};
