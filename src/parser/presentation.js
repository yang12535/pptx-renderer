const { parseXml, child, toArray } = require('../core/xml');
const fs = require('fs');
const path = require('path');

function parsePresentation(pptxDir) {
  const presPath = path.join(pptxDir, 'ppt', 'presentation.xml');
  if (!fs.existsSync(presPath)) throw new Error('Missing presentation.xml');

  const xml = fs.readFileSync(presPath, 'utf-8');
  const doc = parseXml(xml);
  const pres = child(doc, 'presentation') || doc['p:presentation'];

  // 幻灯片尺寸（EMU）
  const sldSz = child(pres, 'sldSz') || pres['p:sldSz'];
  const widthEmu = sldSz ? sldSz._cx : 9144000;
  const heightEmu = sldSz ? sldSz._cy : 5143500;

  // 幻灯片列表（只取 id 和 rId，具体路径去 rels 查）
  const sldIdLst = child(pres, 'sldIdLst') || pres['p:sldIdLst'];
  const sldIdArr = toArray(sldIdLst && (sldIdLst['p:sldId'] || sldIdLst.sldId));

  const slides = sldIdArr.map((sldId, idx) => ({
    index: idx,
    id: sldId._id,
    rId: sldId['_r:id'] || sldId._rId || sldId._id,
  }));

  return {
    widthEmu,
    heightEmu,
    slides,
  };
}

module.exports = { parsePresentation };
