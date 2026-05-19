const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

function extractPptx(pptxPath, outDir) {
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const zip = new AdmZip(pptxPath);
  zip.extractAllTo(outDir, true);
  return outDir;
}

module.exports = { extractPptx };
