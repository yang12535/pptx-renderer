/**
 * 单位转换工具
 * PPTX 使用 EMU (English Metric Units): 914400 EMU = 1 inch
 * 渲染目标：CSS px，假设 96 DPI
 */

const EMU_PER_INCH = 914400;
const PX_PER_INCH = 96;
const EMU_TO_PX = PX_PER_INCH / EMU_PER_INCH;
const PT_PER_INCH = 72;
const EMU_TO_PT = PT_PER_INCH / EMU_PER_INCH;

function emuToPx(emu) {
  return Math.round(emu * EMU_TO_PX * 100) / 100;
}

function emuToPt(emu) {
  return Math.round(emu * EMU_TO_PT * 100) / 100;
}

// 字体大小：PPTX 中以百分之一磅为单位（如 1800 = 18pt）
function fontSizeToPt(hundredthPt) {
  return hundredthPt / 100;
}

// 角度：PPTX 以 1/60000 度为单位
function angleToDegrees(angle60000) {
  return angle60000 / 60000;
}

// 百分比：PPTX 以 1/100000 为单位（如 100000 = 100%）
function percentToFloat(percent100000) {
  return percent100000 / 100000;
}

module.exports = {
  emuToPx,
  emuToPt,
  fontSizeToPt,
  angleToDegrees,
  percentToFloat,
  EMU_PER_INCH,
  PX_PER_INCH,
};
