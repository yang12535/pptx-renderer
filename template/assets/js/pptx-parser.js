/**
 * PPTX Parser — 浏览器端纯 JS 解析器
 * 依赖：JSZip（全局 JSZip）
 * 输入：File/Blob（.pptx）
 * 输出：{ slides: [...], widthEmu, heightEmu } + HTML 字符串
 */
(function (global) {
  'use strict';

  // ==================== XML 解析（DOMParser 适配层）====================
  function parseXml(xmlStr) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlStr, 'application/xml');
    var err = doc.querySelector('parsererror');
    if (err) throw new Error('XML parse error');
    return domToJson(doc.documentElement);
  }

  function domToJson(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    var obj = {};
    // 属性（加 _ 前缀与 fast-xml-parser 对齐，忽略 xmlns 声明）
    var attrCount = 0;
    if (node.attributes) {
      for (var i = 0; i < node.attributes.length; i++) {
        var attr = node.attributes[i];
        if (attr.name.startsWith('xmlns')) continue;
        obj['_' + attr.name] = attr.value;
        attrCount++;
      }
    }

    var textContent = '';
    var elementChildren = [];
    for (var j = 0; j < node.childNodes.length; j++) {
      var child = node.childNodes[j];
      if (child.nodeType === Node.TEXT_NODE) {
        textContent += child.textContent;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        elementChildren.push({ tag: child.nodeName, dom: child });
      }
    }

    // 纯文本节点（无非 xmlns 属性、无元素子节点）直接返回字符串，与 fast-xml-parser 对齐
    if (attrCount === 0 && elementChildren.length === 0) {
      return textContent;
    }

    // 无元素子节点但有文本，放入 #text
    if (elementChildren.length === 0 && textContent) {
      obj['#text'] = textContent;
      return obj;
    }

    // 处理元素子节点
    for (var k = 0; k < elementChildren.length; k++) {
      var c = elementChildren[k];
      var key = c.tag;
      var val = domToJson(c.dom);
      if (obj[key] !== undefined) {
        if (!Array.isArray(obj[key])) obj[key] = [obj[key]];
        obj[key].push(val);
      } else {
        obj[key] = val;
      }
    }

    // 混合内容保留文本
    if (textContent.trim()) {
      obj['#text'] = textContent;
    }
    return obj;
  }

  function child(obj, tag) {
    if (!obj) return undefined;
    if (obj[tag] !== undefined) return obj[tag];
    // 尝试带命名空间前缀
    for (var key in obj) {
      if (key.endsWith(':' + tag)) return obj[key];
    }
    return undefined;
  }

  function toArray(val) {
    if (val === undefined || val === null) return [];
    return Array.isArray(val) ? val : [val];
  }

  function resolveZipPath(basePath, relPath) {
    if (relPath.charAt(0) === '/') return relPath.slice(1);
    var parts = basePath.split('/');
    parts.pop();
    var relParts = relPath.split('/');
    for (var i = 0; i < relParts.length; i++) {
      if (relParts[i] === '..') {
        parts.pop();
      } else if (relParts[i] !== '.' && relParts[i] !== '') {
        parts.push(relParts[i]);
      }
    }
    return parts.join('/');
  }

  // ==================== 单位转换 ====================
  function emuToPx(emu) {
    var n = typeof emu === 'string' ? parseInt(emu, 10) : emu;
    return Math.round(n / 9525 * 100) / 100;
  }
  function angleToDegrees(angle) {
    return Math.round(parseInt(angle, 10) / 60000 * 10) / 10;
  }
  function fontSizeToPt(hundredths) {
    return parseInt(hundredths, 10) / 100;
  }

  // ==================== 颜色解析 ====================
  function colorToCss(source, theme) {
    if (!source) return '#000000';
    var srgb = child(source, 'srgbClr');
    if (srgb && srgb._val) return '#' + srgb._val;
    var sys = child(source, 'sysClr');
    if (sys && sys._lastClr) return '#' + sys._lastClr;
    var scheme = child(source, 'schemeClr');
    if (scheme && scheme._val && theme && theme.colors && theme.colors[scheme._val]) {
      return theme.colors[scheme._val];
    }
    return '#000000';
  }

  // ==================== 主题解析 ====================
  function parseTheme(xmlStr) {
    var doc = parseXml(xmlStr);
    var theme = { colors: {} };
    var root = doc['a:theme'] || doc;
    var themeElements = child(root, 'themeElements');
    var clrScheme = themeElements ? child(themeElements, 'clrScheme') : null;
    if (clrScheme) {
      for (var key in clrScheme) {
        if (key.startsWith('a:')) {
          var name = key.slice(2);
          theme.colors[name] = colorToCss(clrScheme[key]);
        }
      }
    }
    return theme;
  }

  // ==================== 演示文稿解析 ====================
  function parsePresentation(xmlStr) {
    var doc = parseXml(xmlStr);
    var pres = doc['p:presentation'] || doc;
    var sldSz = child(pres, 'sldSz');
    var widthEmu = sldSz ? sldSz._cx : 9144000;
    var heightEmu = sldSz ? sldSz._cy : 5143500;

    var slides = [];
    var sldIdLst = child(pres, 'sldIdLst');
    var items = toArray(child(sldIdLst, 'sldId'));
    for (var i = 0; i < items.length; i++) {
      slides.push({ rId: items[i]['_r:id'] || items[i]._id });
    }
    return { slides: slides, widthEmu: widthEmu, heightEmu: heightEmu };
  }

  // ==================== 关系解析 ====================
  function parseRels(xmlStr) {
    var doc = parseXml(xmlStr);
    var rels = child(doc, 'Relationships') || doc;
    var items = toArray(child(rels, 'Relationship'));
    var map = {};
    for (var i = 0; i < items.length; i++) {
      map[items[i]._Id] = items[i]._Target;
    }
    return map;
  }

  // ==================== 幻灯片解析 ====================
  function parseSlide(xmlStr, theme, relsMap) {
    var doc = parseXml(xmlStr);
    // domToJson 直接返回根元素的属性和子节点（不包根元素名），所以 doc 就是 <p:sld> 的内容
    var sld = doc;
    var cSld = child(sld, 'cSld') || sld['p:cSld'];
    if (!cSld) return null;

    var slideObj = { background: null, elements: [] };

    // 背景
    var bg = child(cSld, 'bg') || cSld['p:bg'];
    if (bg) {
      slideObj.background = parseBackground(bg, theme);
    }

    // 元素树
    var spTree = child(cSld, 'spTree') || cSld['p:spTree'];
    if (!spTree) return slideObj;

    for (var key in spTree) {
      if (key.startsWith('_') || key === '#text') continue;
      var items = toArray(spTree[key]);
      for (var j = 0; j < items.length; j++) {
        var item = items[j];
        var el = null;
        if (key.endsWith(':sp') || key === 'sp') {
          el = parseShape(item, theme);
        } else if (key.endsWith(':pic') || key === 'pic') {
          el = parsePicture(item, theme, relsMap);
        } else if (key.endsWith(':graphicFrame') || key === 'graphicFrame') {
          el = parseGraphicFrame(item, theme, relsMap);
        } else if (key.endsWith(':cxnSp') || key === 'cxnSp') {
          el = parseCxnSp(item, theme);
        } else if (key.endsWith(':grpSp') || key === 'grpSp') {
          var grpEls = parseGroup(item, theme, relsMap);
          slideObj.elements.push.apply(slideObj.elements, grpEls);
          continue;
        }
        if (el) slideObj.elements.push(el);
      }
    }
    return slideObj;
  }

  function parseBackground(bgObj, theme) {
    var bgPr = child(bgObj, 'bgPr') || bgObj['p:bgPr'];
    if (bgPr) {
      var solidFill = child(bgPr, 'solidFill') || bgPr['a:solidFill'];
      if (solidFill) return { type: 'solid', color: colorToCss(solidFill, theme) };
      var gradFill = child(bgPr, 'gradFill') || bgPr['a:gradFill'];
      if (gradFill) return { type: 'gradient', raw: gradFill };
    }
    var bgRef = child(bgObj, 'bgRef') || bgObj['p:bgRef'];
    if (bgRef) return { type: 'solid', color: colorToCss(bgRef, theme) };
    return null;
  }

  function parseGroup(grpObj, theme, relsMap) {
    var spTree = child(grpObj, 'spTree') || grpObj['p:spTree'];
    if (!spTree) return [];
    var elements = [];
    for (var key in spTree) {
      if (key.startsWith('_') || key === '#text') continue;
      var items = toArray(spTree[key]);
      for (var i = 0; i < items.length; i++) {
        var el = null;
        if (key.endsWith(':sp') || key === 'sp') el = parseShape(items[i], theme);
        else if (key.endsWith(':pic') || key === 'pic') el = parsePicture(items[i], theme, relsMap);
        else if (key.endsWith(':graphicFrame') || key === 'graphicFrame') el = parseGraphicFrame(items[i], theme, relsMap);
        else if (key.endsWith(':cxnSp') || key === 'cxnSp') el = parseCxnSp(items[i], theme);
        if (el) elements.push(el);
      }
    }
    return elements;
  }

  // ==================== 形状解析 ====================
  function parseXfrm(xfrmObj) {
    if (!xfrmObj) return null;
    var off = child(xfrmObj, 'off') || xfrmObj['a:off'];
    var ext = child(xfrmObj, 'ext') || xfrmObj['a:ext'];
    return {
      x: off ? emuToPx(off._x) : 0,
      y: off ? emuToPx(off._y) : 0,
      width: ext ? emuToPx(ext._cx) : 0,
      height: ext ? emuToPx(ext._cy) : 0,
      rotation: xfrmObj._rot ? angleToDegrees(xfrmObj._rot) : 0,
      flipH: xfrmObj._flipH === '1' || xfrmObj._flipH === true,
      flipV: xfrmObj._flipV === '1' || xfrmObj._flipV === true,
    };
  }

  function parseSpPr(spPr, theme) {
    var result = {
      xfrm: parseXfrm(child(spPr, 'xfrm') || spPr['a:xfrm']),
      geometry: null,
      fill: null,
      line: null,
    };
    var prstGeom = child(spPr, 'prstGeom') || spPr['a:prstGeom'];
    if (prstGeom) {
      result.geometry = { type: 'prst', name: prstGeom._prst || 'rect' };
      var avLst = child(prstGeom, 'avLst') || prstGeom['a:avLst'];
      if (avLst) {
        var gds = toArray(child(avLst, 'gd') || avLst['a:gd']);
        result.geometry.adjustments = gds.map(function (g) { return { name: g._name, fmla: g._fmla }; });
      }
    }
    var noFill = child(spPr, 'noFill') || spPr['a:noFill'];
    if (noFill) {
      result.fill = { type: 'none' };
    } else {
      var solidFill = child(spPr, 'solidFill') || spPr['a:solidFill'];
      if (solidFill) result.fill = { type: 'solid', color: colorToCss(solidFill, theme) };
      var gradFill = child(spPr, 'gradFill') || spPr['a:gradFill'];
      if (gradFill) result.fill = parseGradientFill(gradFill, theme);
    }
    var ln = child(spPr, 'ln') || spPr['a:ln'];
    if (ln) result.line = parseLine(ln, theme);
    return result;
  }

  function parseGradientFill(gradFill, theme) {
    var gsLst = child(gradFill, 'gsLst') || gradFill['a:gsLst'];
    var stops = toArray(child(gsLst, 'gs') || gsLst && gsLst['a:gs']).map(function (gs) {
      return { pos: gs._pos / 100000, color: colorToCss(gs, theme) };
    });
    return { type: 'gradient', stops: stops, raw: gradFill };
  }

  function parseLine(ln, theme) {
    var width = ln._w ? emuToPx(ln._w) : 1;
    var result = { width: width, color: 'transparent', dash: null, cap: ln._cap };
    var noFill = child(ln, 'noFill') || ln['a:noFill'];
    if (!noFill) {
      var solidFill = child(ln, 'solidFill') || ln['a:solidFill'];
      if (solidFill) result.color = colorToCss(solidFill, theme);
    }
    var prstDash = child(ln, 'prstDash') || ln['a:prstDash'];
    if (prstDash) result.dash = prstDash._val;
    return result;
  }

  function parseTxBody(txBody, theme) {
    if (!txBody) return null;
    var bodyPr = child(txBody, 'bodyPr') || txBody['a:bodyPr'];
    var result = {
      anchor: 'top',
      anchorCtr: false,
      wrap: true,
      paragraphs: [],
    };
    if (bodyPr) {
      result.anchor = bodyPr._anchor || 'top';
      result.anchorCtr = bodyPr._anchorCtr === '1' || bodyPr._anchorCtr === true;
      result.wrap = bodyPr._wrap !== 'none';
      result.lIns = bodyPr._lIns ? emuToPx(bodyPr._lIns) : 7;
      result.tIns = bodyPr._tIns ? emuToPx(bodyPr._tIns) : 0;
      result.rIns = bodyPr._rIns ? emuToPx(bodyPr._rIns) : 7;
      result.bIns = bodyPr._bIns ? emuToPx(bodyPr._bIns) : 0;
    }
    var ps = toArray(child(txBody, 'p') || txBody['a:p']);
    for (var i = 0; i < ps.length; i++) {
      result.paragraphs.push(parseParagraph(ps[i], theme));
    }
    return result;
  }

  function parseParagraph(p, theme) {
    var para = { align: 'left', lines: [], level: 0, spaceBefore: 0, spaceAfter: 0, lineSpacing: 1.2, bullet: null };
    var pPr = child(p, 'pPr') || p['a:pPr'];
    if (pPr) {
      para.align = pPr._algn || 'left';
      para.level = parseInt(pPr._lvl || '0', 10);
      var spcBef = child(pPr, 'spcBef') || pPr['a:spcBef'];
      if (spcBef) {
        var spcPts = child(spcBef, 'spcPts') || spcBef['a:spcPts'];
        if (spcPts) para.spaceBefore = spcPts._val / 100;
      }
      var spcAft = child(pPr, 'spcAft') || pPr['a:spcAft'];
      if (spcAft) {
        var spcPts2 = child(spcAft, 'spcPts') || spcAft['a:spcPts'];
        if (spcPts2) para.spaceAfter = spcPts2._val / 100;
      }
      var lnSpc = child(pPr, 'lnSpc') || pPr['a:lnSpc'];
      if (lnSpc) {
        var spcPct = child(lnSpc, 'spcPct') || lnSpc['a:spcPct'];
        if (spcPct) para.lineSpacing = spcPct._val / 100000;
      }
      var buChar = child(pPr, 'buChar') || pPr['a:buChar'];
      var buAutoNum = child(pPr, 'buAutoNum') || pPr['a:buAutoNum'];
      if (buChar) para.bullet = { type: 'char', char: buChar._char };
      else if (buAutoNum) para.bullet = { type: 'auto', style: buAutoNum._type };
    }
    var runs = [];
    for (var key in p) {
      if (key.startsWith('_') || key === '#text') continue;
      if (key.endsWith(':r') || key === 'r' || key.endsWith(':fld') || key === 'fld') {
        var arr = toArray(p[key]);
        for (var i = 0; i < arr.length; i++) runs.push(parseRun(arr[i], theme));
      } else if (key.endsWith(':br') || key === 'br') {
        var arr2 = toArray(p[key]);
        for (var j = 0; j < arr2.length; j++) runs.push({ type: 'br' });
      }
    }
    para.lines = runs;
    return para;
  }

  function parseRun(r, theme) {
    var rPr = child(r, 'rPr') || r['a:rPr'];
    var parsedText = child(r, 't');
    var rawText = parsedText !== undefined ? parsedText : r['a:t'];
    var run = { type: 'text', text: textValueToString(rawText), bold: false, italic: false, underline: false, strike: false, size: 18, color: 'inherit', font: null, lang: null };
    if (rPr) {
      run.bold = rPr._b === '1' || rPr._b === true;
      run.italic = rPr._i === '1' || rPr._i === true;
      run.underline = rPr._u === '1' || rPr._u === true || rPr._u === 'sng';
      run.strike = rPr._strike === '1' || rPr._strike === true || rPr._strike === 'sngStrike';
      if (rPr._sz) run.size = fontSizeToPt(rPr._sz);
      if (rPr._lang) run.lang = rPr._lang;
      var solidFill = child(rPr, 'solidFill') || rPr['a:solidFill'];
      if (solidFill) run.color = colorToCss(solidFill, theme);
      var latin = child(rPr, 'latin') || rPr['a:latin'];
      var ea = child(rPr, 'ea') || rPr['a:ea'];
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

  function parseShape(sp, theme) {
    var nvSpPr = child(sp, 'nvSpPr') || sp['p:nvSpPr'];
    var spPr = child(sp, 'spPr') || sp['p:spPr'];
    var txBody = child(sp, 'txBody') || sp['p:txBody'];
    var shape = { type: 'shape', id: null, name: '', isTextBox: false };
    Object.assign(shape, parseSpPr(spPr, theme));
    shape.text = parseTxBody(txBody, theme);
    if (nvSpPr) {
      var cNvPr = child(nvSpPr, 'cNvPr') || nvSpPr['p:cNvPr'];
      if (cNvPr) {
        shape.id = cNvPr._id;
        shape.name = cNvPr._name || '';
        shape.isTextBox = (shape.name || '').toLowerCase().includes('textbox') || shape.name === '';
      }
      var nvPr = child(nvSpPr, 'nvPr') || nvSpPr['p:nvPr'];
      if (nvPr) {
        var ph = child(nvPr, 'ph') || nvPr['p:ph'];
        if (ph) shape.placeholder = { type: ph._type, idx: ph._idx };
      }
    }
    if (!shape.geometry && !shape.fill && !shape.line) shape.isTextBox = true;
    return shape;
  }

  function parsePicture(pic, theme, relsMap) {
    var nvPicPr = child(pic, 'nvPicPr') || pic['p:nvPicPr'];
    var spPr = child(pic, 'spPr') || pic['p:spPr'];
    var blipFill = child(pic, 'blipFill') || pic['p:blipFill'];
    var image = { type: 'image', id: null, name: '', src: null, crop: null };
    Object.assign(image, parseSpPr(spPr, theme));
    if (nvPicPr) {
      var cNvPr = child(nvPicPr, 'cNvPr') || nvPicPr['p:cNvPr'];
      if (cNvPr) { image.id = cNvPr._id; image.name = cNvPr._name || ''; }
    }
    if (blipFill) {
      var blip = child(blipFill, 'blip') || blipFill['a:blip'];
      if (blip) {
        var embedId = blip['_r:embed'] || blip._embed;
        if (embedId && relsMap[embedId]) image.src = relsMap[embedId];
      }
    }
    return image;
  }

  function parseGraphicFrame(gf, theme, relsMap) {
    var nvGraphicFramePr = child(gf, 'nvGraphicFramePr') || gf['p:nvGraphicFramePr'];
    var xfrm = parseXfrm(child(gf, 'xfrm') || gf['a:xfrm']);
    var graphic = child(gf, 'graphic') || gf['a:graphic'];
    if (!graphic) return null;
    var graphicData = child(graphic, 'graphicData') || graphic['a:graphicData'];
    if (!graphicData) return null;
    var uri = graphicData._uri;
    var chart = child(graphicData, 'chart') || graphicData['c:chart'];
    var tbl = child(graphicData, 'tbl') || graphicData['a:tbl'];
    var subType = chart ? 'chart' : (tbl ? 'table' : 'unknown');
    var result = { type: 'graphicFrame', subType: subType, uri: uri, xfrm: xfrm, id: null, name: '' };
    if (chart && chart['_r:id']) {
      result.chartRelId = chart['_r:id'];
    }
    if (tbl) {
      result.tableData = parseTableData(tbl, theme);
    }
    return result;
  }

  function parseTableData(tblObj, theme) {
    var grid = child(tblObj, 'tblGrid') || tblObj['a:tblGrid'];
    var gridCols = grid ? toArray(child(grid, 'gridCol') || grid['a:gridCol']) : [];
    var colWidths = gridCols.map(function (col) { return col._w ? emuToPx(col._w) : null; });
    var rows = [];
    var trList = toArray(child(tblObj, 'tr') || tblObj['a:tr']);
    for (var r = 0; r < trList.length; r++) {
      var tr = trList[r];
      var cells = [];
      var tcList = toArray(child(tr, 'tc') || tr['a:tc']);
      for (var c = 0; c < tcList.length; c++) {
        var tc = tcList[c];
        var text = '';
        var txBody = child(tc, 'txBody') || tc['a:txBody'];
        var textBody = parseTxBody(txBody, theme);
        var style = parseTableCellStyle(tc, theme);
        if (textBody && style.margins) {
          if (typeof style.margins.left === 'number') textBody.lIns = style.margins.left;
          if (typeof style.margins.right === 'number') textBody.rIns = style.margins.right;
          if (typeof style.margins.top === 'number') textBody.tIns = style.margins.top;
          if (typeof style.margins.bottom === 'number') textBody.bIns = style.margins.bottom;
        }
        if (txBody) {
          var pList = toArray(child(txBody, 'p') || txBody['a:p']);
          for (var p = 0; p < pList.length; p++) {
            var para = pList[p];
            var rList = toArray(child(para, 'r') || para['a:r']);
            for (var ri = 0; ri < rList.length; ri++) {
              var run = rList[ri];
              var t = child(run, 't') || run['a:t'];
              if (typeof t === 'string') text += t;
              else if (t && t['#text']) text += t['#text'];
            }
          }
        }
        cells.push({ text: text, textBody: textBody, style: style });
      }
      rows.push({ height: tr._h ? emuToPx(tr._h) : null, cells: cells });
    }
    return { colWidths: colWidths, rows: rows };
  }

  function parseTableCellStyle(tc, theme) {
    var tcPr = child(tc, 'tcPr') || tc['a:tcPr'];
    var style = {};
    if (!tcPr) return style;

    var solidFill = child(tcPr, 'solidFill') || tcPr['a:solidFill'];
    if (solidFill) style.fill = colorToCss(solidFill, theme);

    var border = parseTableBorder(tcPr, theme);
    if (border) style.border = border;

    var margins = {};
    if (tcPr._marL) margins.left = emuToPx(tcPr._marL);
    if (tcPr._marR) margins.right = emuToPx(tcPr._marR);
    if (tcPr._marT) margins.top = emuToPx(tcPr._marT);
    if (tcPr._marB) margins.bottom = emuToPx(tcPr._marB);
    if (Object.keys(margins).length > 0) style.margins = margins;

    return style;
  }

  function parseTableBorder(tcPr, theme) {
    var sides = ['lnL', 'lnR', 'lnT', 'lnB'];
    for (var i = 0; i < sides.length; i++) {
      var side = sides[i];
      var ln = child(tcPr, side) || tcPr['a:' + side];
      if (!ln) continue;
      var parsed = parseLine(ln, theme);
      if (parsed && parsed.color && parsed.color !== 'transparent') {
        return parsed;
      }
    }
    return null;
  }

  function parseChartXml(xmlStr, theme) {
    var doc = parseXml(xmlStr);
    var chartSpace = child(doc, 'chartSpace') || doc['c:chartSpace'] || doc;
    var chart = child(chartSpace, 'chart') || chartSpace['c:chart'];
    if (!chart) return null;
    var plotArea = child(chart, 'plotArea') || chart['c:plotArea'];
    if (!plotArea) return null;

    var chartType = null;
    var chartNode = null;
    var typeKeys = ['barChart', 'lineChart', 'pieChart', 'areaChart', 'scatterChart', 'doughnutChart', 'radarChart', 'stockChart', 'surfaceChart'];
    for (var i = 0; i < typeKeys.length; i++) {
      var node = child(plotArea, typeKeys[i]) || plotArea['c:' + typeKeys[i]];
      if (node) { chartType = typeKeys[i]; chartNode = node; break; }
    }
    if (!chartType) return null;

    var barDir = null;
    if (chartType === 'barChart') {
      var bd = child(chartNode, 'barDir') || chartNode['c:barDir'];
      barDir = bd ? bd._val : 'col';
    }

    var grouping = null;
    var grp = child(chartNode, 'grouping') || chartNode['c:grouping'];
    if (grp) grouping = grp._val;

    var showVal = getShowVal(child(chartNode, 'dLbls') || chartNode['c:dLbls']);

    var title = '';
    var titleNode = child(chart, 'title') || chart['c:title'];
    if (titleNode) {
      var tx = child(titleNode, 'tx') || titleNode['c:tx'];
      title = extractRichText(tx);
    }

    function extractRichText(node) {
      var pieces = [];
      collectTextRuns(node, pieces);
      return pieces.join('');
    }

    function collectTextRuns(node, pieces) {
      if (!node) return;
      if (Array.isArray(node)) {
        for (var ti = 0; ti < node.length; ti++) collectTextRuns(node[ti], pieces);
        return;
      }
      if (typeof node !== 'object') {
        var rawValue = textValueToString(node);
        if (rawValue) pieces.push(rawValue);
        return;
      }

      var t = child(node, 't') || node['a:t'];
      var value = textValueToString(t);
      if (value) pieces.push(value);

      collectTextRuns(child(node, 'rich') || node['c:rich'] || node['a:rich'], pieces);
      collectTextRuns(child(node, 'p') || node['a:p'], pieces);
      collectTextRuns(child(node, 'r') || node['a:r'], pieces);
      collectTextRuns(child(node, 'fld') || node['a:fld'], pieces);
    }

    function extractText(node) {
      if (!node) return '';
      var v = child(node, 'v') || node['c:v'];
      return textValueToString(v);
    }

    function extractCacheValues(cache) {
      if (!cache) return [];
      var directPts = toArray(child(cache, 'pt') || cache['c:pt']);
      if (directPts.length) {
        return directPts.map(function (pt) { return extractText(pt); });
      }

      var levels = toArray(child(cache, 'lvl') || cache['c:lvl']);
      var values = [];
      for (var li = 0; li < levels.length; li++) {
        var levelPts = toArray(child(levels[li], 'pt') || levels[li]['c:pt']);
        for (var pi = 0; pi < levelPts.length; pi++) values.push(extractText(levelPts[pi]));
      }
      return values;
    }

    function extractChartPoints(container, refNames, cacheNames) {
      if (!container) return [];

      var refs = [];
      for (var ri = 0; ri < refNames.length; ri++) {
        var ref = child(container, refNames[ri]) || container['c:' + refNames[ri]];
        refs = refs.concat(toArray(ref));
      }
      if (!refs.length) refs = [container];

      for (var si = 0; si < refs.length; si++) {
        var source = refs[si];
        for (var ci = 0; ci < cacheNames.length; ci++) {
          var cache = child(source, cacheNames[ci]) || source['c:' + cacheNames[ci]];
          var values = extractCacheValues(cache);
          if (values.length) return values;
        }

        var directValues = extractCacheValues(source);
        if (directValues.length) return directValues;
      }

      return [];
    }

    var seriesList = toArray(child(chartNode, 'ser') || chartNode['c:ser']);
    var series = [];
    for (var s = 0; s < seriesList.length; s++) {
      var ser = seriesList[s];
      var sName = '';
      var tx = child(ser, 'tx') || ser['c:tx'];
      if (tx) {
        var strRef = child(tx, 'strRef') || tx['c:strRef'];
        var strCache = strRef && (child(strRef, 'strCache') || strRef['c:strCache']);
        var pt = strCache && (child(strCache, 'pt') || strCache['c:pt']);
        if (pt) sName = extractText(pt);
      }

      var categories = [];
      var cat = child(ser, 'cat') || ser['c:cat'];
      if (cat) {
        categories = extractChartPoints(
          cat,
          ['strRef', 'numRef', 'multiLvlStrRef', 'strLit', 'numLit'],
          ['strCache', 'numCache', 'multiLvlStrCache']
        );
      }

      var values = [];
      var val = child(ser, 'val') || ser['c:val'];
      if (val) {
        var valueTexts = extractChartPoints(val, ['numRef', 'strRef', 'numLit', 'strLit'], ['numCache', 'strCache']);
        for (var vi = 0; vi < valueTexts.length; vi++) {
          var num = parseFloat(valueTexts[vi]);
          values.push(isNaN(num) ? 0 : num);
        }
      }

      var serShowVal = getShowVal(child(ser, 'dLbls') || ser['c:dLbls']);
      series.push({
        name: sName,
        categories: categories,
        values: values,
        color: parseChartSeriesColor(ser, theme),
        showVal: serShowVal === null ? showVal : serShowVal
      });
    }

    return { title: title, chartType: chartType, barDir: barDir, grouping: grouping, showVal: showVal, series: series };
  }

  function getShowVal(dLbls) {
    if (!dLbls) return null;
    var showVal = child(dLbls, 'showVal') || dLbls['c:showVal'];
    if (!showVal) return null;
    var val = showVal._val;
    return val === true || val === 1 || val === '1' || String(val).toLowerCase() === 'true';
  }

  function parseChartSeriesColor(ser, theme) {
    var spPr = child(ser, 'spPr') || ser['c:spPr'];
    if (!spPr) return null;
    var solidFill = child(spPr, 'solidFill') || spPr['a:solidFill'];
    return solidFill ? colorToCss(solidFill, theme) : null;
  }

  function parseCxnSp(cxnSp, theme) {
    var nvCxnSpPr = child(cxnSp, 'nvCxnSpPr') || cxnSp['p:nvCxnSpPr'];
    var spPr = child(cxnSp, 'spPr') || cxnSp['p:spPr'];
    var shape = { type: 'connector', id: null, name: '' };
    Object.assign(shape, parseSpPr(spPr, theme));
    if (nvCxnSpPr) {
      var cNvPr = child(nvCxnSpPr, 'cNvPr') || nvCxnSpPr['p:cNvPr'];
      if (cNvPr) { shape.id = cNvPr._id; shape.name = cNvPr._name || ''; }
    }
    return shape;
  }

  // ==================== 渲染 ====================
  var ENTRANCE_ANIMS = ['anim-fadeIn', 'anim-slideInUp', 'anim-slideInLeft', 'anim-slideInRight', 'anim-zoomIn'];
  var SAFE_ANIM = 'anim-fadeIn';

  function elementHasTransform(el) {
    var xf = el.xfrm;
    if (!xf) return false;
    if (xf.rotation || xf.flipH || xf.flipV) return true;
    if (el.type === 'connector') return true;
    if (el.geometry && el.geometry.name === 'line') return true;
    if (typeof xf.width === 'number' && typeof xf.height === 'number' && Math.min(xf.width, xf.height) < 2) return true;
    return false;
  }
  function pickAnimClass(el, index) {
    return elementHasTransform(el) ? SAFE_ANIM : ENTRANCE_ANIMS[index % ENTRANCE_ANIMS.length];
  }

  function renderSlides(slides, presMeta) {
    var slideW = Math.round(emuToPx(presMeta.widthEmu));
    var slideH = Math.round(emuToPx(presMeta.heightEmu));
    return slides.map(function (slide, idx) { return renderSlide(slide, idx, slideW, slideH); }).join('\n');
  }

  function renderSlide(slide, index, w, h) {
    var bgStyle = slide.background && slide.background.type === 'solid'
      ? 'background:' + slide.background.color + ';'
      : 'background:#fff;';
    var html = '  <div class="slide" data-index="' + index + '" style="width:' + w + 'px;height:' + h + 'px;' + bgStyle + '">\n';
    slide.elements.forEach(function (el, elIdx) {
      var elHtml = renderElement(el, elIdx);
      if (elHtml) html += '    ' + elHtml + '\n';
    });
    html += '  </div>';
    return html;
  }

  function renderElement(el, index) {
    var xf = el.xfrm;
    if (!xf) return '';
    var style = buildBaseStyle(xf);
    var animClass = pickAnimClass(el, index);
    var animDelay = index * 100;

    if (el.type === 'image' && el.src) {
      return '<img class="p-el p-img ' + animClass + '" src="' + escapeHtml(el.src) + '" style="' + style + 'animation-delay:' + animDelay + 'ms;" alt="">';
    }
    if (el.type === 'shape' || el.type === 'connector') {
      var isLineShape = el.geometry && el.geometry.name === 'line';
      var isThin = Math.min(xf.width, xf.height) < 2;
      if (el.type === 'connector' || isLineShape || isThin) {
        return renderLine(el, animClass, animDelay);
      }
      var shapeStyle = style;
      shapeStyle += buildFillCss(el) + buildLineCss(el) + buildShapeCss(el);
      shapeStyle += 'animation-delay:' + animDelay + 'ms;';
      var inner = '';
      if (el.text && el.text.paragraphs.length > 0) inner = renderText(el.text);
      return '<div class="p-el p-shape ' + animClass + '" style="' + shapeStyle + '">' + inner + '</div>';
    }
    if (el.type === 'graphicFrame') {
      if (el.chartData) {
        var chartJson = JSON.stringify(el.chartData).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        var chartStyle = style + 'animation-delay:' + animDelay + 'ms;';
        return '<div class="p-el p-chart ' + animClass + '" data-chart="' + chartJson + '" style="' + chartStyle + '"></div>';
      }
      if (el.tableData) {
        var tblHtml = renderTable(el.tableData, xf.height);
        var tblStyle = style + 'animation-delay:' + animDelay + 'ms;overflow:hidden;';
        return '<div class="p-el p-table-wrap ' + animClass + '" style="' + tblStyle + '">' + tblHtml + '</div>';
      }
      return '<div class="p-el p-placeholder ' + animClass + '" style="' + style + 'background:#f0f0f0;border:1px dashed #ccc;animation-delay:' + animDelay + 'ms;">[' + (el.subType || 'graphic') + ']</div>';
    }
    return '';
  }

  function renderTable(tableData, availableHeight) {
    var tblHtml = '<table class="p-table" style="width:100%;height:100%;border-collapse:collapse;border-spacing:0;table-layout:fixed;">';
    var totalRowHeight = tableData.rows.reduce(function (sum, row) { return sum + (row.height || 0); }, 0);
    var rowScale = availableHeight && totalRowHeight > availableHeight ? availableHeight / totalRowHeight : 1;

    if (tableData.colWidths && tableData.colWidths.length > 0) {
      var total = tableData.colWidths.reduce(function (sum, width) { return sum + (width || 0); }, 0);
      if (total > 0) {
        tblHtml += '<colgroup>';
        for (var ci = 0; ci < tableData.colWidths.length; ci++) {
          tblHtml += '<col style="width:' + ((tableData.colWidths[ci] || 0) / total * 100) + '%;">';
        }
        tblHtml += '</colgroup>';
      }
    }

    for (var ri = 0; ri < tableData.rows.length; ri++) {
      var row = tableData.rows[ri];
      var rowHeight = row.height ? row.height * rowScale : null;
      var delay = (0.82 + ri * 0.06).toFixed(2);
      var rowStyle = (rowHeight ? 'height:' + rowHeight + 'px;' : '') + 'animation-delay:' + delay + 's;';
      tblHtml += '<tr style="' + rowStyle + '">';
      for (var c = 0; c < row.cells.length; c++) {
        var tag = ri === 0 ? 'th' : 'td';
        var cell = row.cells[c];
        var content = cell.textBody ? renderText(cell.textBody) : escapeHtml(cell.text || '');
        tblHtml += '<' + tag + ' class="p-table-cell" style="' + buildTableCellStyle(cell, rowHeight) + '">' + content + '</' + tag + '>';
      }
      tblHtml += '</tr>';
    }

    tblHtml += '</table>';
    return tblHtml;
  }

  function buildTableCellStyle(cell, rowHeight) {
    var cellStyle = cell.style || {};
    var border = cellStyle.border || { width: 1, color: '#d9d9d9' };
    var s = 'border:' + (border.width || 1) + 'px solid ' + (border.color || '#d9d9d9') + ';';
    s += 'background:' + (cellStyle.fill || '#fff') + ';';
    s += 'padding:0;vertical-align:middle;overflow:hidden;font-weight:normal;text-align:left;';
    if (rowHeight) s += 'height:' + rowHeight + 'px;';
    return s;
  }

  function escapeHtml(text) {
    if (text == null) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderLine(el, animClass, animDelay) {
    var xf = el.xfrm;
    var line = el.line || { width: 1, color: '#000', dash: null };
    var dx = xf.width, dy = xf.height;
    var length = Math.sqrt(dx * dx + dy * dy);
    var angle = Math.atan2(dy, dx) * (180 / Math.PI);
    var style = 'position:absolute;left:' + xf.x + 'px;top:' + xf.y + 'px;';
    style += 'width:' + length + 'px;height:' + line.width + 'px;';
    style += 'background:' + line.color + ';';
    style += 'transform:rotate(' + angle + 'deg);transform-origin:0 0;';
    style += 'animation-delay:' + animDelay + 'ms;';
    if (line.dash && line.dash !== 'solid') {
      style += 'background:repeating-linear-gradient(90deg,' + line.color + ',' + line.color + ' 4px,transparent 4px,transparent 8px);';
    }
    return '<div class="p-el p-line ' + animClass + '" style="' + style + '"></div>';
  }

  function renderText(txBody) {
    var paragraphs = txBody.paragraphs, lIns = txBody.lIns, tIns = txBody.tIns, rIns = txBody.rIns, bIns = txBody.bIns, anchor = txBody.anchor, anchorCtr = txBody.anchorCtr;
    var align = 'left';
    if (anchorCtr) align = 'center';
    else if (anchor === 'ctr') align = 'center';
    else if (anchor === 'r') align = 'right';
    else if (anchor === 'just') align = 'justify';
    align = normalizeTextAlign(align);
    var pad = '';
    if (lIns || tIns || rIns || bIns) {
      pad = 'padding:' + (tIns || 0) + 'px ' + (rIns || 7) + 'px ' + (bIns || 0) + 'px ' + (lIns || 7) + 'px;';
    }
    var valign = anchor === 'b' ? 'flex-end' : (anchor === 'ctr' ? 'center' : 'flex-start');
    var html = '<div class="p-txBody" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:' + valign + ';text-align:' + align + ';' + pad + 'box-sizing:border-box;">';
    for (var i = 0; i < paragraphs.length; i++) {
      var para = paragraphs[i];
      var pAlign = normalizeTextAlign(para.align || align);
      var pStyle = 'text-align:' + pAlign + ';margin:0;';
      if (para.spaceBefore) pStyle += 'margin-top:' + para.spaceBefore + 'px;';
      if (para.spaceAfter) pStyle += 'margin-bottom:' + para.spaceAfter + 'px;';
      if (para.lineSpacing) pStyle += 'line-height:' + para.lineSpacing + ';';
      html += '<p style="' + pStyle + '">';
      var bullet = para.bullet ? (para.bullet.char || '•') : '';
      if (bullet) html += '<span style="margin-right:6px;">' + escapeHtml(bullet) + '</span>';
      for (var j = 0; j < para.lines.length; j++) {
        var run = para.lines[j];
        if (run.type === 'br') { html += '<br>'; continue; }
        var rStyle = '';
        if (run.bold) rStyle += 'font-weight:bold;';
        if (run.italic) rStyle += 'font-style:italic;';
        if (run.underline) rStyle += 'text-decoration:underline;';
        if (run.size) rStyle += 'font-size:' + run.size + 'pt;';
        if (run.color && run.color !== 'inherit') rStyle += 'color:' + run.color + ';';
        if (run.font) rStyle += "font-family:'" + run.font + "',sans-serif;";
        else if (run.fontEa) rStyle += "font-family:'" + run.fontEa + "',sans-serif;";
        var text = escapeHtml(run.text || '');
        if (rStyle) html += '<span style="' + rStyle + '">' + text + '</span>';
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
    var s = 'position:absolute;left:' + xf.x + 'px;top:' + xf.y + 'px;width:' + xf.width + 'px;height:' + xf.height + 'px;';
    var transforms = [];
    if (xf.rotation) transforms.push('rotate(' + xf.rotation + 'deg)');
    if (xf.flipH) transforms.push('scaleX(-1)');
    if (xf.flipV) transforms.push('scaleY(-1)');
    if (transforms.length) s += 'transform:' + transforms.join(' ') + ';';
    return s;
  }
  function buildFillCss(el) {
    if (!el.fill) return 'background:transparent;';
    if (el.fill.type === 'none') return 'background:transparent;';
    if (el.fill.type === 'solid') return 'background:' + el.fill.color + ';';
    if (el.fill.type === 'gradient' && el.fill.stops && el.fill.stops.length >= 2) {
      return 'background:linear-gradient(to bottom,' + el.fill.stops[0].color + ',' + el.fill.stops[el.fill.stops.length - 1].color + ');';
    }
    return 'background:transparent;';
  }
  function buildLineCss(el) {
    if (!el.line) return '';
    var line = el.line;
    var s = '';
    if (line.color && line.color !== 'transparent') s += 'border:' + (line.width || 1) + 'px solid ' + line.color + ';';
    else s += 'border:' + (line.width || 1) + 'px solid transparent;';
    if (line.dash && line.dash !== 'solid') s += 'border-style:dashed;';
    return s;
  }
  function buildShapeCss(el) {
    if (!el.geometry) return '';
    if (el.geometry.type === 'prst') {
      var name = el.geometry.name;
      if (name === 'ellipse' || name === 'circle') return 'border-radius:50%;';
      if (name === 'roundRect') {
        var adj = el.geometry.adjustments && el.geometry.adjustments.find(function (a) { return a.name === 'adj'; });
        var radius = adj ? Math.min(parseAdjVal(adj.fmla), 50000) / 50000 : 0.15;
        return 'border-radius:' + Math.round(radius * 100) + '%;';
      }
    }
    return '';
  }
  function parseAdjVal(fmla) {
    var m = /val\s+(\d+)/.exec(fmla);
    return m ? parseInt(m[1], 10) : 0;
  }
  // ==================== 图片转 Base64 ====================
  function blobToDataURL(blob) {
    return new Promise(function (resolve) {
      var reader = new FileReader();
      reader.onloadend = function () { resolve(reader.result); };
      reader.readAsDataURL(blob);
    });
  }

  // ==================== 主入口 ====================
  global.loadPptxFromFile = function (file) {
    console.log("[Parser] loadPptxFromFile start");
    return new Promise(function (resolve, reject) {
      JSZip.loadAsync(file).then(function (zip) {
      console.log("[Parser] zip loaded, files:", Object.keys(zip.files).join(", "));
        // 读取 presentation.xml
        zip.file('ppt/presentation.xml').async('string').then(function (presXml) {
          var pres = parsePresentation(presXml);
      console.log("[Parser] presentation parsed, slides:", pres.slides.length, "size:", pres.widthEmu, "x", pres.heightEmu);
          // 读取主题
          var themePromise = Promise.resolve(null);
          var themeFiles = Object.keys(zip.files).filter(function (p) { return /^ppt\/theme\/theme\d+\.xml$/.test(p); });
          if (themeFiles.length > 0) {
            themePromise = zip.file(themeFiles[0]).async('string').then(parseTheme);
          }
          themePromise.then(function (theme) {
            // 读取 presentation.xml.rels
            zip.file('ppt/_rels/presentation.xml.rels').async('string').then(function (presRelsXml) {
              var presRels = parseRels(presRelsXml);
              var slidesData = [];
              var mediaMap = {}; // relId -> base64 data URL

              // 解析每张幻灯片
              var slidePromises = pres.slides.map(function (sInfo) {
                var slideTarget = presRels[sInfo.rId];
                if (!slideTarget) return Promise.resolve(null);
                var slidePath = 'ppt/' + slideTarget;
                var slideRelsPath = slidePath.replace('slides/', 'slides/_rels/') + '.rels';
                return zip.file(slidePath).async('string').then(function (slideXml) {
                  return Promise.resolve().then(function () {
                    var relsFile = zip.file(slideRelsPath);
                    if (!relsFile) return {};
                    return relsFile.async('string').then(parseRels);
                  }).then(function (slideRels) {
                    var resolvedRels = {};
                    var mediaPromises = [];
                    for (var rid in slideRels) {
                      var target = slideRels[rid];
                      if (target.startsWith('../media/')) {
                        var mediaPath = target.replace(/^\.\.\//, 'ppt/');
                        var mediaName = mediaPath.split('/').pop();
                        if (!mediaMap[mediaPath]) {
                          var mp = zip.file(mediaPath).async('blob').then(function (blob) {
                            return blobToDataURL(blob).then(function (url) { mediaMap[mediaPath] = url; });
                          });
                          mediaPromises.push(mp);
                        }
                        resolvedRels[rid] = (function (mp) {
                          return function () { return mediaMap[mp]; };
                        })(mediaPath);
                      } else {
                        resolvedRels[rid] = target;
                      }
                    }
                    return Promise.all(mediaPromises).then(function () {
                      // 解析 rels 中的函数引用转为实际值
                      var finalRels = {};
                      for (var rid in resolvedRels) {
                        finalRels[rid] = typeof resolvedRels[rid] === 'function' ? resolvedRels[rid]() : resolvedRels[rid];
                      }
                      var slideResult = parseSlide(slideXml, theme, finalRels);
                      console.log("[Parser] slide parsed, elements:", slideResult ? slideResult.elements.length : 0);
                      if (!slideResult) return slideResult;
                      var chartPromises = [];
                      slideResult.elements.forEach(function(el) {
                        if (el.type === 'graphicFrame' && el.chartRelId) {
                          var chartPath = slideRels[el.chartRelId];
                          if (chartPath) {
                            chartPath = resolveZipPath(slidePath, chartPath);
                            var chartFile = zip.file(chartPath);
                            if (!chartFile) {
                              console.warn('[Parser] chart file not found:', chartPath, 'relId:', el.chartRelId);
                              return;
                            }
                            var cp = chartFile.async('string').then(function(chartXml) {
                              el.chartData = parseChartXml(chartXml, theme);
                            }).catch(function() { el.chartData = null; });
                            chartPromises.push(cp);
                          }
                        }
                      });
                      return Promise.all(chartPromises).then(function() { return slideResult; });
                    });
                  });
                });
              });

              Promise.all(slidePromises).then(function (results) {
                slidesData = results.filter(function (s) { return s !== null; });
                var slideW = Math.round(emuToPx(pres.widthEmu));
                var slideH = Math.round(emuToPx(pres.heightEmu));
                var slidesHtml = renderSlides(slidesData, pres);
                console.log("[Parser] render complete, html length:", slidesHtml.length);
                resolve({
                  slidesHtml: slidesHtml,
                  slideCount: slidesData.length,
                  slideW: slideW,
                  slideH: slideH,
                });
              });
            });
          });
        });
      }).catch(function(err) { console.error("[Parser] parse error:", err.message, err.stack); reject(err); });
    });
  };

})(window);
