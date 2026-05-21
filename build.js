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
  outDir = prepareOutputDirectory(outDir);
  console.log('🚀 Build (upload mode):', outDir);

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
  outDir = prepareOutputDirectory(outDir);
  console.log('🚀 Build (static mode):', inputPptx);

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
    const presentationPath = path.join(tempDir, 'ppt', 'presentation.xml');

    for (const sInfo of pres.slides) {
      const rId = sInfo.rId;
      const slideRelPath = path.join(tempDir, 'ppt', '_rels', 'presentation.xml.rels');
      const relsMap = parseRels(slideRelPath);
      const slideTarget = relsMap[rId];
      if (!slideTarget) {
        console.warn('  ⚠️  Slide not found for rId:', rId);
        continue;
      }

      const slidePath = resolveRelationshipTarget(presentationPath, slideTarget, tempDir);
      if (!slidePath || !fs.existsSync(slidePath)) {
        console.warn('  ⚠️  Slide file not found:', slideTarget, '->', slidePath);
        continue;
      }
      const slideRelsPath = path.join(path.dirname(slidePath), '_rels', path.basename(slidePath) + '.rels');
      const slideRelsMap = fs.existsSync(slideRelsPath) ? parseRels(slideRelsPath) : {};

      const resolvedRels = {};
      for (const [rid, target] of Object.entries(slideRelsMap)) {
        const resolvedTarget = resolveRelationshipTarget(slidePath, target, tempDir);
        if (resolvedTarget && isMediaPath(resolvedTarget) && fs.existsSync(resolvedTarget)) {
          const dstName = path.basename(resolvedTarget);
          const dst = path.join(mediaOutDir, dstName);
          if (!fs.existsSync(mediaOutDir)) fs.mkdirSync(mediaOutDir, { recursive: true });
          fs.copyFileSync(resolvedTarget, dst);
          resolvedRels[rid] = './media/' + dstName;
        } else {
          resolvedRels[rid] = resolvedTarget;
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

function prepareOutputDirectory(outDir) {
  const resolved = path.resolve(outDir);
  assertSafeOutputDirectory(resolved);
  if (fs.existsSync(resolved)) {
    const stat = fs.lstatSync(resolved);
    if (!stat.isDirectory()) {
      throw new Error('Output path exists and is not a directory: ' + resolved);
    }
    fs.rmSync(resolved, { recursive: true });
  }
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function assertSafeOutputDirectory(outputPath) {
  const resolved = path.resolve(outputPath);
  const root = path.parse(resolved).root;
  if (samePath(resolved, root)) {
    throw new Error('Refusing to use a filesystem root as output directory: ' + resolved);
  }

  const protectedPaths = [
    path.resolve(__dirname),
    path.resolve(process.cwd()),
    path.resolve(os.homedir()),
  ];
  for (const protectedPath of protectedPaths) {
    if (isSameOrAncestorPath(resolved, protectedPath)) {
      throw new Error('Refusing to clean protected output directory: ' + resolved);
    }
  }
}

function isSameOrAncestorPath(candidate, target) {
  const relative = path.relative(candidate, target);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

function samePath(left, right) {
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
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

function isMediaPath(targetPath) {
  return /\.(png|jpe?g|gif|bmp|svg|emf|wmf|webp|tiff?)$/i.test(targetPath || '');
}

function resolveRelationshipTarget(sourcePath, target, packageRoot) {
  if (!target) return target;
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return target;
  var resolved;
  if (target.startsWith('/')) {
    resolved = path.join(packageRoot, target.slice(1));
  } else {
    resolved = path.resolve(path.dirname(sourcePath), target);
  }
  var realPackageRoot = path.resolve(packageRoot);
  var realResolved = path.resolve(resolved);
  if (!realResolved.startsWith(realPackageRoot + path.sep) && realResolved !== realPackageRoot) {
    console.warn('Path traversal blocked:', target, '->', resolved);
    return '';
  }
  return resolved;
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

  if (isStatic) {
    const input = args[0];
    const output = args[1] || 'dist';
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
    const output = args[0] || 'dist';
    if (args.length > 0 && args[0].toLowerCase().endsWith('.pptx')) {
      console.error('❌ Upload mode does not accept a .pptx file.');
      console.error('   To build static output: node build.js --static <pptx> [outDir]');
      console.error('   To build upload mode:   node build.js [outDir]');
      process.exit(1);
    }
    buildUpload(output).catch(err => {
      console.error('❌ Build failed:', err.message);
      console.error(err.stack);
      process.exit(1);
    });
  }
}

module.exports = { buildUpload, buildStatic };
