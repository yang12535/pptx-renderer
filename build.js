const fs = require('fs');
const path = require('path');
const os = require('os');
const { extractPptx } = require('./src/core/unzip');
const { parseXml, child, toArray } = require('./src/core/xml');
const { parsePresentation } = require('./src/parser/presentation');
const { parseTheme } = require('./src/parser/theme');
const { parseSlide } = require('./src/parser/slide');
const { renderSlides } = require('./src/render/html-render');

const PATHS = {
  templateDir: path.join(__dirname, 'template'),
  assetsDir: path.join(__dirname, 'template', 'assets'),
};

async function buildUpload(outDir) {
  outDir = path.resolve(outDir);
  console.log('🚀 Build (upload mode):', outDir);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  copyAssets(PATHS.assetsDir, path.join(outDir, 'assets'));

  const templateHtml = fs.readFileSync(path.join(PATHS.templateDir, 'index.html'), 'utf-8');
  let finalHtml = replaceTemplateTokens(templateHtml, {
    '{{SLIDES}}': '',
    '{{SLIDE_COUNT}}': '0',
    '{{SLIDE_WIDTH}}': '0',
    '{{SLIDE_HEIGHT}}': '0',
    '{{UPLOAD_ZONE_CLASS}}': '',
    '{{STAGE_STYLE}}': 'display:none;',
    '{{CONTROLS_STYLE}}': 'display:none;',
  });

  fs.writeFileSync(path.join(outDir, 'index.html'), finalHtml, 'utf-8');

  console.log('✅ Upload mode build complete:', outDir);
  console.log('   Output:');
  console.log('   - index.html');
  console.log('   - assets/css/viewer.css');
  console.log('   - assets/js/viewer.js');
  console.log('   - assets/js/pptx-parser.js');
  console.log('   - assets/vendor/jszip.min.js');
  console.log('   - assets/vendor/echarts.min.js');
}

async function buildStatic(inputPptx, outDir) {
  inputPptx = path.resolve(inputPptx);
  outDir = path.resolve(outDir);
  console.log('🚀 Build (static mode):', inputPptx);

  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pptx-renderer-'));
  try {
    extractPptx(inputPptx, tempDir);

    const pres = parsePresentation(tempDir);
    console.log('  Slides:', pres.slides.length, '| Size:', pres.widthEmu, 'x', pres.heightEmu, 'EMU');

    const themeDir = path.join(tempDir, 'ppt', 'theme');
    let theme = null;
    if (fs.existsSync(themeDir)) {
      const themeFiles = fs.readdirSync(themeDir).filter(f => f.endsWith('.xml'));
      if (themeFiles.length > 0) {
        theme = parseTheme(path.join(themeDir, themeFiles[0]));
      }
    }

    const slidesData = [];
    const mediaOutDir = path.join(outDir, 'media');

    for (const sInfo of pres.slides) {
      const rId = sInfo.rId;
      const slideRelPath = path.join(tempDir, 'ppt', '_rels', 'presentation.xml.rels');
      const relsMap = parseRels(slideRelPath);
      const slideTarget = relsMap[rId];
      if (!slideTarget) {
        console.warn('  ⚠️  Slide not found for rId:', rId);
        continue;
      }

      const slidePath = path.join(tempDir, 'ppt', slideTarget);
      const slideRelsPath = path.join(tempDir, 'ppt', 'slides', '_rels', path.basename(slideTarget) + '.rels');
      const slideRelsMap = fs.existsSync(slideRelsPath) ? parseRels(slideRelsPath) : {};

      const resolvedRels = {};
      for (const [rid, target] of Object.entries(slideRelsMap)) {
        if (target.startsWith('../media/')) {
          const src = path.join(tempDir, 'ppt', target.replace(/^\.\.\//, ''));
          const dstName = path.basename(target);
          const dst = path.join(mediaOutDir, dstName);
          if (fs.existsSync(src)) {
            if (!fs.existsSync(mediaOutDir)) fs.mkdirSync(mediaOutDir, { recursive: true });
            fs.copyFileSync(src, dst);
            resolvedRels[rid] = './media/' + dstName;
          }
        } else {
          resolvedRels[rid] = resolveRelationshipTarget(slidePath, target, tempDir);
        }
      }

      const slideObj = parseSlide(slidePath, theme, resolvedRels);
      if (slideObj) slidesData.push(slideObj);
    }

    const { emuToPx } = require('./src/utils/units');
    const slideW = Math.round(emuToPx(pres.widthEmu));
    const slideH = Math.round(emuToPx(pres.heightEmu));
    const slidesHtml = renderSlides(slidesData, { widthEmu: pres.widthEmu, heightEmu: pres.heightEmu, roundSize: true });

    copyAssets(PATHS.assetsDir, path.join(outDir, 'assets'));

    const templateHtml = fs.readFileSync(path.join(PATHS.templateDir, 'index.html'), 'utf-8');
    let finalHtml = replaceTemplateTokens(templateHtml, {
      '{{SLIDES}}': slidesHtml,
      '{{SLIDE_COUNT}}': String(slidesData.length),
      '{{SLIDE_WIDTH}}': String(slideW),
      '{{SLIDE_HEIGHT}}': String(slideH),
      '{{UPLOAD_ZONE_CLASS}}': 'hidden',
      '{{STAGE_STYLE}}': '',
      '{{CONTROLS_STYLE}}': '',
    });

    fs.writeFileSync(path.join(outDir, 'index.html'), finalHtml, 'utf-8');

    console.log('✅ Static mode build complete:', outDir);
    console.log('   Output:');
    console.log('   - index.html');
    console.log('   - assets/css/viewer.css');
    console.log('   - assets/js/viewer.js');
    if (fs.existsSync(mediaOutDir)) {
      console.log('   - media/ (' + fs.readdirSync(mediaOutDir).length + ' files)');
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseRels(relsPath) {
  if (!fs.existsSync(relsPath)) return {};
  const xml = fs.readFileSync(relsPath, 'utf-8');
  const doc = parseXml(xml);
  const rels = child(doc, 'Relationships') || doc['Relationships'];
  const items = toArray(child(rels, 'Relationship') || rels['Relationship']);
  const map = {};
  for (const r of items) {
    map[r._Id] = r._Target;
  }
  return map;
}

function copyAssets(srcDir, dstDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(dstDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const dstPath = path.join(dstDir, entry.name);
    if (entry.isDirectory()) {
      copyAssets(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function resolveRelationshipTarget(sourcePath, target, packageRoot) {
  if (!target) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  if (target.startsWith('/')) return path.join(packageRoot, target.slice(1));
  return path.resolve(path.dirname(sourcePath), target);
}

function replaceTemplateTokens(template, replacements) {
  let output = template;
  for (const [token, value] of Object.entries(replacements)) {
    if (!output.includes(token)) {
      throw new Error('Template token not found: ' + token);
    }
    output = output.split(token).join(value);
  }
  return output;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const isStatic = args.includes('--static');
  const staticIdx = args.indexOf('--static');
  if (staticIdx !== -1) args.splice(staticIdx, 1);

  const output = args[args.length - 1] || 'dist';

  if (isStatic) {
    const input = args[0];
    if (!input) {
      console.error('❌ Usage: node build.js --static <pptx> [outDir]');
      process.exit(1);
    }
    buildStatic(input, output).catch(err => {
      console.error('❌ Build failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
  } else {
    buildUpload(output).catch(err => {
      console.error('❌ Build failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
  }
}

module.exports = { buildUpload, buildStatic };
