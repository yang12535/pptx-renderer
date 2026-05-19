const { child, toArray } = require('../core/xml');

// 默认主题颜色映射（当没有主题时回退）
const DEFAULT_SCHEME = {
  dk1: { color: '000000' },
  lt1: { color: 'FFFFFF' },
  dk2: { color: '1F497D' },
  lt2: { color: 'EEECE1' },
  accent1: { color: '4F81BD' },
  accent2: { color: 'C0504D' },
  accent3: { color: '9BBB59' },
  accent4: { color: '8064A2' },
  accent5: { color: '4BACC6' },
  accent6: { color: 'F79646' },
  hlink: { color: '0000FF' },
  folHlink: { color: '800080' },
};

function parseColorRef(colorObj, theme) {
  if (!colorObj) return null;

  const scheme = theme && theme.scheme ? theme.scheme : DEFAULT_SCHEME;
  let rgb = null;
  let alpha = 1;

  // 方案颜色: a:schemeClr
  const schemeClr = child(colorObj, 'schemeClr');
  if (schemeClr) {
    const schemeName = schemeClr._val;
    const schemeEntry = scheme[schemeName];
    if (schemeEntry) {
      rgb = schemeEntry.color;
    }
    // 处理 schemeClr 上的变体（如 tint, shade）
    const tint = child(schemeClr, 'tint');
    const shade = child(schemeClr, 'shade');
    if (tint && rgb) rgb = applyTint(rgb, tint._val / 100000);
    if (shade && rgb) rgb = applyShade(rgb, shade._val / 100000);
    const alphaNode = child(schemeClr, 'alpha');
    if (alphaNode) alpha = alphaNode._val / 100000;
  }

  // sRGB: a:srgbClr
  const srgbClr = child(colorObj, 'srgbClr');
  if (srgbClr) {
    rgb = srgbClr._val;
    const alphaNode = child(srgbClr, 'alpha');
    if (alphaNode) alpha = alphaNode._val / 100000;
  }

  // HSL: a:hslClr
  const hslClr = child(colorObj, 'hslClr');
  if (hslClr) {
    rgb = hslToRgb(hslClr._hue / 60000, hslClr._sat / 100000, hslClr._lum / 100000);
    const alphaNode = child(hslClr, 'alpha');
    if (alphaNode) alpha = alphaNode._val / 100000;
  }

  // 系统颜色: a:sysClr
  const sysClr = child(colorObj, 'sysClr');
  if (sysClr) {
    rgb = sysClr._lastClr || '000000';
    const alphaNode = child(sysClr, 'alpha');
    if (alphaNode) alpha = alphaNode._val / 100000;
  }

  if (!rgb) return null;
  return { color: normalizeColor(rgb), alpha };
}

function normalizeColor(c) {
  c = String(c).replace('#', '');
  if (c.length === 3) c = c.split('').map(x => x + x).join('');
  return c.toUpperCase();
}

function applyTint(rgb, tint) {
  // tint: 混合白色
  const r = parseInt(rgb.substr(0, 2), 16);
  const g = parseInt(rgb.substr(2, 2), 16);
  const b = parseInt(rgb.substr(4, 2), 16);
  const nr = Math.round(r + (255 - r) * tint);
  const ng = Math.round(g + (255 - g) * tint);
  const nb = Math.round(b + (255 - b) * tint);
  return [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
}

function applyShade(rgb, shade) {
  // shade: 混合黑色
  const r = parseInt(rgb.substr(0, 2), 16);
  const g = parseInt(rgb.substr(2, 2), 16);
  const b = parseInt(rgb.substr(4, 2), 16);
  const nr = Math.round(r * (1 - shade));
  const ng = Math.round(g * (1 - shade));
  const nb = Math.round(b * (1 - shade));
  return [nr, ng, nb].map(v => v.toString(16).padStart(2, '0')).join('');
}

function hslToRgb(h, s, l) {
  // h: 0-360, s: 0-1, l: 0-1
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  r = Math.round((r + m) * 255);
  g = Math.round((g + m) * 255);
  b = Math.round((b + m) * 255);
  return [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function colorToCss(colorObj, theme) {
  const parsed = parseColorRef(colorObj, theme);
  if (!parsed) return 'transparent';
  if (parsed.alpha >= 0.999) return `#${parsed.color}`;
  const r = parseInt(parsed.color.substr(0, 2), 16);
  const g = parseInt(parsed.color.substr(2, 2), 16);
  const b = parseInt(parsed.color.substr(4, 2), 16);
  return `rgba(${r},${g},${b},${parsed.alpha.toFixed(3)})`;
}

module.exports = {
  parseColorRef,
  colorToCss,
  normalizeColor,
  DEFAULT_SCHEME,
};
