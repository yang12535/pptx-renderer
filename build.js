const fs = require('fs');
const path = require('path');
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

async function build(inputPptx, outDir) {
  console.log('🚀 Build started:', inputPptx);

  // 1. 清理 & 解压
  if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
  }
  fs.mkdirSync(outDir, { recursive: true });

  const tempDir = path.join(outDir, '.temp');
  extractPptx(inputPptx, tempDir);

  // 2. 解析演示文稿
  const pres = parsePresentation(tempDir);
  console.log('  Slides:', pres.slides.length, '| Size:', pres.widthEmu, 'x', pres.heightEmu, 'EMU');

  // 3. 解析主题
  const themeDir = path.join(tempDir, 'ppt', 'theme');
  let theme = null;
  if (fs.existsSync(themeDir)) {
    const themeFiles = fs.readdirSync(themeDir).filter(f => f.endsWith('.xml'));
    if (themeFiles.length > 0) {
      theme = parseTheme(path.join(themeDir, themeFiles[0]));
    }
  }

  // 4. 解析每张幻灯片
  const slidesDir = path.join(tempDir, 'ppt', 'slides');
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

    // 转换 rels 路径并复制媒体资源
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
        resolvedRels[rid] = target;
      }
    }

    const slideObj = parseSlide(slidePath, theme, resolvedRels);
    if (slideObj) slidesData.push(slideObj);
  }

  // 5. 渲染幻灯片 HTML 片段
  const { emuToPx } = require('./src/utils/units');
  const slideW = Math.round(emuToPx(pres.widthEmu));
  const slideH = Math.round(emuToPx(pres.heightEmu));
  const slidesHtml = renderSlides(slidesData, { widthEmu: pres.widthEmu, heightEmu: pres.heightEmu, roundSize: true });

  // 6. 复制静态资源
  copyAssets(PATHS.assetsDir, path.join(outDir, 'assets'));

  // 7. 组装页面
  const templateHtml = fs.readFileSync(path.join(PATHS.templateDir, 'index.html'), 'utf-8');
  const finalHtml = templateHtml
    .replace('{{SLIDES}}', slidesHtml)
    .replace('{{SLIDE_COUNT}}', String(slidesData.length))
    .replace('{{SLIDE_WIDTH}}', String(slideW))
    .replace('{{SLIDE_HEIGHT}}', String(slideH));

  fs.writeFileSync(path.join(outDir, 'index.html'), finalHtml, 'utf-8');

  // 8. 清理临时文件
  fs.rmSync(tempDir, { recursive: true });

  console.log('✅ Build complete:', outDir);
  console.log('   Output:');
  console.log('   - index.html');
  console.log('   - assets/css/viewer.css');
  console.log('   - assets/js/viewer.js');
  if (fs.existsSync(mediaOutDir)) {
    console.log('   - media/ (' + fs.readdirSync(mediaOutDir).length + ' files)');
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

// CLI
const input = process.argv[2] || 'test.pptx';
const output = process.argv[3] || 'dist';
build(input, output).catch(err => {
  console.error('❌ Build failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
