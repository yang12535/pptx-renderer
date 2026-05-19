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
    var clrScheme = doc['a:theme'] && doc['a:theme']['a:themeElements'] && doc['a:theme']['a:themeElements']['a:clrScheme'];
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
      if (key.endsWith(':r') || key === 'r') {
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
    var t = child(r, 't') || r['a:t'];
    var run = { type: 'text', text: typeof t === 'string' ? t : '', bold: false, italic: false, underline: false, strike: false, size: 18, color: 'inherit', font: null, lang: null };
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
      result.tableData = parseTableData(tbl);
    }
    return result;
  }

  function parseTableData(tblObj) {
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
        cells.push({ text: text });
      }
      rows.push({ cells: cells });
    }
    return { rows: rows };
  }

  function parseChartXml(xmlStr) {
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

    var title = '';
    var titleNode = child(chart, 'title') || chart['c:title'];
    if (titleNode) {
      var tx = child(titleNode, 'tx') || titleNode['c:tx'];
      var rich = tx && (child(tx, 'rich') || tx['a:rich']);
      var p = rich && (child(rich, 'p') || rich['a:p']);
      if (p) {
        var r = child(p, 'r') || p['a:r'];
        var t = r && (child(r, 't') || r['a:t']);
        if (typeof t === 'string') title = t;
        else if (t && t['#text']) title = t['#text'];
      }
    }

    function extractText(node) {
      if (!node) return '';
      var v = child(node, 'v') || node['c:v'];
      if (typeof v === 'string') return v;
      if (typeof v === 'number') return String(v);
      if (v && v['#text']) return v['#text'];
      return '';
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
        var catRef = child(cat, 'strRef') || cat['c:strRef'] || child(cat, 'numRef') || cat['c:numRef'];
        var catCache = catRef && (child(catRef, 'strCache') || catRef['c:strCache'] || child(catRef, 'numCache') || catRef['c:numCache']);
        var catPts = catCache ? toArray(child(catCache, 'pt') || catCache['c:pt']) : [];
        for (var ci = 0; ci < catPts.length; ci++) categories.push(extractText(catPts[ci]));
      }

      var values = [];
      var val = child(ser, 'val') || ser['c:val'];
      if (val) {
        var valRef = child(val, 'numRef') || val['c:numRef'] || child(val, 'strRef') || val['c:strRef'];
        var valCache = valRef && (child(valRef, 'numCache') || valRef['c:numCache'] || child(valRef, 'strCache') || valRef['c:strCache']);
        var valPts = valCache ? toArray(child(valCache, 'pt') || valCache['c:pt']) : [];
        for (var vi = 0; vi < valPts.length; vi++) {
          var num = parseFloat(extractText(valPts[vi]));
          values.push(isNaN(num) ? 0 : num);
        }
      }

      series.push({ name: sName, categories: categories, values: values });
    }

    return { title: title, chartType: chartType, barDir: barDir, grouping: grouping, series: series };
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
        var chartJson = JSON.stringify(el.chartData).replace(/"/g, '&quot;');
        var chartStyle = style + 'animation-delay:' + animDelay + 'ms;';
        return '<div class="p-el p-chart ' + animClass + '" data-chart="' + chartJson + '" style="' + chartStyle + '"></div>';
      }
      if (el.tableData) {
        var tblHtml = '<table class="p-table" style="width:100%;height:100%;border-collapse:collapse;">';
        for (var ri = 0; ri < el.tableData.rows.length; ri++) {
          tblHtml += '<tr>';
          var row = el.tableData.rows[ri];
          for (var ci = 0; ci < row.cells.length; ci++) {
            var tag = ri === 0 ? 'th' : 'td';
            tblHtml += '<' + tag + ' style="border:1px solid #ccc;padding:4px 8px;font-size:12px;background:' + (ri === 0 ? '#f5f5f5' : '#fff') + ';">' + escapeHtml(row.cells[ci].text) + '</' + tag + '>';
          }
          tblHtml += '</tr>';
        }
        tblHtml += '</table>';
        var tblStyle = style + 'animation-delay:' + animDelay + 'ms;overflow:auto;';
        return '<div class="p-el p-table-wrap ' + animClass + '" style="' + tblStyle + '">' + tblHtml + '</div>';
      }
      return '<div class="p-el p-placeholder ' + animClass + '" style="' + style + 'background:#f0f0f0;border:1px dashed #ccc;animation-delay:' + animDelay + 'ms;">[' + (el.subType || 'graphic') + ']</div>';
    }
    return '';
  }

  function escapeHtml(text) {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
    var pad = '';
    if (lIns || tIns || rIns || bIns) {
      pad = 'padding:' + (tIns || 0) + 'px ' + (rIns || 7) + 'px ' + (bIns || 0) + 'px ' + (lIns || 7) + 'px;';
    }
    var valign = anchor === 'b' ? 'flex-end' : (anchor === 'ctr' ? 'center' : 'flex-start');
    var html = '<div class="p-txBody" style="width:100%;height:100%;display:flex;flex-direction:column;justify-content:' + valign + ';text-align:' + align + ';' + pad + 'box-sizing:border-box;">';
    for (var i = 0; i < paragraphs.length; i++) {
      var para = paragraphs[i];
      var pAlign = para.align || align;
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

  function buildBaseStyle(xf) {
    var s = 'position:absolute;left:' + xf.x + 'px;top:' + xf.y + 'px;width:' + xf.width + 'px;height:' + xf.height + 'px;';
    if (xf.rotation) s += 'transform:rotate(' + xf.rotation + 'deg);';
    if (xf.flipH) s += 'transform:scaleX(-1);';
    if (xf.flipV) s += 'transform:scaleY(-1);';
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
  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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
                        var mime = mediaName.endsWith('.png') ? 'image/png' : (mediaName.endsWith('.jpg') || mediaName.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream');
                        if (!mediaMap[rid]) {
                          var mp = zip.file(mediaPath).async('blob').then(function (blob) {
                            return blobToDataURL(blob).then(function (url) { mediaMap[rid] = url; });
                          });
                          mediaPromises.push(mp);
                        }
                        resolvedRels[rid] = function (r) { return mediaMap[r]; };
                      } else {
                        resolvedRels[rid] = target;
                      }
                    }
                    return Promise.all(mediaPromises).then(function () {
                      // 解析 rels 中的函数引用转为实际值
                      var finalRels = {};
                      for (var rid in resolvedRels) {
                        finalRels[rid] = typeof resolvedRels[rid] === 'function' ? resolvedRels[rid](rid) : resolvedRels[rid];
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
                              el.chartData = parseChartXml(chartXml);
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
