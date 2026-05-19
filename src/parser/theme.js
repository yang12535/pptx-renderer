const { parseXml, child, toArray } = require('../core/xml');
const fs = require('fs');
const path = require('path');
const { normalizeColor } = require('./color');

function parseTheme(themePath) {
  if (!fs.existsSync(themePath)) return null;
  const xml = fs.readFileSync(themePath, 'utf-8');
  const doc = parseXml(xml);
  const themeElement = child(doc, 'theme') || doc['a:theme'];
  if (!themeElement) return null;

  const themeObj = {
    name: themeElement._name || 'Office Theme',
    scheme: {},
    fonts: {},
  };

  const themeElements = child(themeElement, 'themeElements') || themeElement['a:themeElements'];
  if (!themeElements) return themeObj;

  // 颜色方案
  const clrScheme = child(themeElements, 'clrScheme') || themeElements['a:clrScheme'];
  if (clrScheme) {
    for (const [key, val] of Object.entries(clrScheme)) {
      if (key.startsWith('_')) continue;
      const items = toArray(val);
      for (const item of items) {
        if (item._lastClr) {
          themeObj.scheme[key] = { color: normalizeColor(item._lastClr) };
        } else if (item._val) {
          themeObj.scheme[key] = { color: normalizeColor(item._val) };
        }
      }
    }
  }

  // 字体方案
  const fontScheme = child(themeElements, 'fontScheme') || themeElements['a:fontScheme'];
  if (fontScheme) {
    const majorFont = child(fontScheme, 'majorFont') || fontScheme['a:majorFont'];
    const minorFont = child(fontScheme, 'minorFont') || fontScheme['a:minorFont'];
    if (majorFont) {
      const latin = child(majorFont, 'latin') || majorFont['a:latin'];
      const ea = child(majorFont, 'ea') || majorFont['a:ea'];
      themeObj.fonts.major = latin ? latin._typeface : 'Calibri';
      themeObj.fonts.majorEa = ea ? ea._typeface : 'Microsoft YaHei';
    }
    if (minorFont) {
      const latin = child(minorFont, 'latin') || minorFont['a:latin'];
      const ea = child(minorFont, 'ea') || minorFont['a:ea'];
      themeObj.fonts.minor = latin ? latin._typeface : 'Calibri';
      themeObj.fonts.minorEa = ea ? ea._typeface : 'Microsoft YaHei';
    }
  }

  return themeObj;
}

module.exports = { parseTheme };
