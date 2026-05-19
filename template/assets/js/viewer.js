/**
 * PPTX Viewer — 浏览器端交互逻辑
 * 纯静态，所有操作在本地完成
 */
(function () {
  'use strict';

  // ── 配置 ──
  var CONFIG = {
    slideSelector: '.slide',
    stageInnerId: 'stage-inner',
    autoScale: true,
    scalePadding: 40,
    minScale: 0.3,
    maxScale: 3,
  };

  // ── 状态 ──
  var slides = [];
  var current = 0;
  var total = 0;
  var isFullscreen = false;
  var touchStartX = 0;
  var touchStartY = 0;
  var controlsTimer = null;
  var thumbnailsBuilt = false;

  // ── DOM 引用 ──
  var stage = document.getElementById('stage');
  var stageInner = document.getElementById(CONFIG.stageInnerId);
  var btnPrev = document.getElementById('prev');
  var btnNext = document.getElementById('next');
  var btnFullscreen = document.getElementById('btn-fullscreen');
  var pageInfo = document.getElementById('page-info');
  var progressBar = document.getElementById('progress-bar');
  var controls = document.getElementById('controls');
  var thumbnails = document.getElementById('thumbnails');
  var toast = document.getElementById('toast');

  // 上传区域
  var uploadZone = document.getElementById('upload-zone');
  var dropArea = document.getElementById('drop-area');
  var fileInput = document.getElementById('file-input');
  var uploadLoading = document.getElementById('upload-loading');
  var uploadError = document.getElementById('upload-error');

  // ── 初始化 ──
  function init() {
    slides = Array.prototype.slice.call(document.querySelectorAll(CONFIG.slideSelector));
    total = slides.length;
    if (total === 0) return;

    bindEvents();
    applyAutoScale();
    show(0, 0);
  }

  function reinit() {
    slides = Array.prototype.slice.call(document.querySelectorAll(CONFIG.slideSelector));
    total = slides.length;
    current = 0;
    thumbnailsBuilt = false;
    thumbnails.innerHTML = '';
    updateUI();
    applyAutoScale();
    show(0, 0);
  }

  // ── 文件上传 ──
  function bindUploadEvents() {
    if (!dropArea || !fileInput) return;

    dropArea.addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) handleFile(e.target.files[0]);
    });

    dropArea.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropArea.classList.add('dragover');
    });
    dropArea.addEventListener('dragleave', function () {
      dropArea.classList.remove('dragover');
    });
    dropArea.addEventListener('drop', function (e) {
      e.preventDefault();
      dropArea.classList.remove('dragover');
      var files = e.dataTransfer.files;
      if (files && files[0]) handleFile(files[0]);
    });
  }

  function handleFile(file) {
    console.log('[Upload] file selected:', file.name, file.size);
    if (!file.name.endsWith('.pptx')) {
      showUploadError('请选择 .pptx 格式的文件');
      return;
    }
    showUploadError('');
    uploadLoading.classList.add('visible');

    loadPptxFromFile(file).then(function (result) {
      console.log('[Upload] parsed ok, slides:', result.slideCount, 'size:', result.slideW + 'x' + result.slideH);
      uploadLoading.classList.remove('visible');

      // 注入幻灯片
      stageInner.innerHTML = result.slidesHtml;
      stageInner.setAttribute('data-width', String(result.slideW));
      stageInner.setAttribute('data-height', String(result.slideH));

      // 切换视图
      uploadZone.classList.add('hidden');
      stage.style.display = '';
      controls.style.display = '';

      reinit();
    }).catch(function (err) {
      uploadLoading.classList.remove('visible');
      showUploadError('解析失败: ' + (err.message || '未知错误'));
      console.error('[Upload] parse error:', err);
    });
  }

  function showUploadError(msg) {
    if (uploadError) uploadError.textContent = msg;
  }

  // ── 幻灯片切换 ──
  function show(index, direction) {
    if (index < 0 || index >= total) return;
    if (index === current && direction !== 0) return;

    var prev = current;
    current = index;
    if (typeof direction !== 'number') {
      direction = index > prev ? 1 : -1;
    }

    // 只重置上一个活动幻灯片的子元素动画，避免遍历所有幻灯片
    var prevSlide = slides[prev];
    if (prevSlide && prev !== current) {
      prevSlide.classList.remove('active');
      prevSlide.classList.remove('enter-right', 'enter-left', 'enter-up', 'enter-down', 'enter-zoom');
      resetElementAnimations(prevSlide);
    }

    // 确保其他幻灯片状态干净（不触发 reflow）
    slides.forEach(function (s, i) {
      if (i !== prev && i !== current) {
        s.classList.remove('active', 'enter-right', 'enter-left', 'enter-up', 'enter-down', 'enter-zoom');
      }
    });

    // 新幻灯片添加方向类 + active
    var nextSlide = slides[current];
    var enterClass = getEnterClass(direction);
    if (enterClass) nextSlide.classList.add(enterClass);

    // 强制 reflow 确保 CSS transition 触发
    void nextSlide.offsetWidth;
    nextSlide.classList.add('active');

    // 更新 UI
    updateUI();
  }

  function next() {
    if (current < total - 1) show(current + 1, 1);
  }

  function prev() {
    if (current > 0) show(current - 1, -1);
  }

  function getEnterClass(dir) {
    if (dir > 0) return 'enter-right';
    if (dir < 0) return 'enter-left';
    return '';
  }

  function resetElementAnimations(slideEl) {
    var els = slideEl.querySelectorAll('.p-el');
    els.forEach(function (el) {
      var name = el.style.animationName;
      el.style.animationName = 'none';
      void el.offsetWidth;
      el.style.animationName = name || '';
    });
  }

  // ── UI 更新 ──
  function updateUI() {
    if (pageInfo) {
      pageInfo.textContent = (current + 1) + ' / ' + total;
    }
    if (progressBar) {
      progressBar.style.width = ((current + 1) / total * 100) + '%';
    }
    if (btnPrev) btnPrev.disabled = current === 0;
    if (btnNext) btnNext.disabled = current === total - 1;

    // 更新缩略图高亮
    if (thumbnails) {
      var thumbs = thumbnails.querySelectorAll('.thumb');
      thumbs.forEach(function (t, i) {
        t.classList.toggle('active', i === current);
      });
    }
  }

  // ── 自动缩放 ──
  function applyAutoScale() {
    if (!CONFIG.autoScale || !stageInner) return;

    var nativeW = parseInt(stageInner.dataset.width || '960', 10);
    var nativeH = parseInt(stageInner.dataset.height || '540', 10);
    if (!nativeW || !nativeH) return;

    var stageW = stage.clientWidth - CONFIG.scalePadding * 2;
    var controlsH = controls ? controls.offsetHeight : 60;
    var stageH = stage.clientHeight - CONFIG.scalePadding * 2 - controlsH;
    var scaleX = stageW / nativeW;
    var scaleY = stageH / nativeH;
    var scale = Math.min(scaleX, scaleY, CONFIG.maxScale);
    scale = Math.max(scale, CONFIG.minScale);

    stageInner.style.width = nativeW + 'px';
    stageInner.style.height = nativeH + 'px';
    stageInner.style.transform = 'scale(' + scale.toFixed(4) + ')';
  }

  // ── 缩略图 ──
  function buildThumbnails() {
    if (!thumbnails || !stageInner || thumbnailsBuilt) return;
    thumbnailsBuilt = true;
    thumbnails.innerHTML = '';

    slides.forEach(function (slide, i) {
      var thumb = document.createElement('div');
      thumb.className = 'thumb' + (i === 0 ? ' active' : '');
      thumb.setAttribute('role', 'button');
      thumb.setAttribute('tabindex', '0');
      thumb.setAttribute('aria-label', '跳转到第 ' + (i + 1) + ' 页');

      // 轻量缩略图：只复制背景色和少量文本，不复制完整 DOM
      var inner = document.createElement('div');
      inner.className = 'thumb-inner';
      // 提取 slide 的背景色
      var bg = slide.style.background || slide.style.backgroundColor || '#fff';
      inner.style.background = bg;
      inner.style.width = '100%';
      inner.style.height = '100%';

      // 尝试提取第一个文本作为缩略图标签
      var firstText = slide.querySelector('.p-txBody');
      if (firstText) {
        var label = document.createElement('div');
        label.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:90%;';
        label.textContent = firstText.textContent.slice(0, 20);
        inner.appendChild(label);
      }

      thumb.appendChild(inner);
      thumb.addEventListener('click', function () { show(i, i > current ? 1 : -1); });
      thumb.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          show(i, i > current ? 1 : -1);
        }
      });
      thumbnails.appendChild(thumb);
    });
  }

  function toggleThumbnails() {
    if (!thumbnails) return;
    buildThumbnails();
    thumbnails.classList.toggle('visible');
  }

  // ── 全屏 ──
  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen();
    }
  }

  function onFullscreenChange() {
    var wasFullscreen = isFullscreen;
    isFullscreen = !!document.fullscreenElement;
    if (btnFullscreen) {
      btnFullscreen.textContent = isFullscreen ? '退出全屏' : '全屏';
    }
    if (isFullscreen && !wasFullscreen) {
      showToast('已进入全屏模式，按 F 或 Esc 退出');
    }
    setTimeout(applyAutoScale, 100);
  }

  // ── Toast ──
  var toastTimer = null;
  function showToast(msg) {
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toast.classList.remove('visible');
    }, 2000);
  }

  // ── 事件绑定 ──
  function bindEvents() {
    // 按钮
    if (btnPrev) btnPrev.addEventListener('click', prev);
    if (btnNext) btnNext.addEventListener('click', next);
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);

    // 键盘
    document.addEventListener('keydown', onKeyDown);

    // 触摸
    stage.addEventListener('touchstart', onTouchStart, { passive: true });
    stage.addEventListener('touchend', onTouchEnd, { passive: true });

    // 全屏变化
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // 窗口缩放
    window.addEventListener('resize', debounce(applyAutoScale, 150));

    // 鼠标移动显示/隐藏控制栏
    document.addEventListener('mousemove', onMouseMove);
  }

  function onKeyDown(e) {
    // 忽略输入框、文本区、按钮上的按键，避免覆盖控件原生行为
    var tag = e.target.tagName;
    var role = e.target.getAttribute('role');
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON' || role === 'button') return;

    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
      case ' ':
      case 'PageDown':
        e.preventDefault();
        next();
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'PageUp':
        e.preventDefault();
        prev();
        break;
      case 'Home':
        e.preventDefault();
        show(0, -1);
        break;
      case 'End':
        e.preventDefault();
        show(total - 1, 1);
        break;
      case 'f':
      case 'F':
        toggleFullscreen();
        break;
      case 't':
      case 'T':
        toggleThumbnails();
        break;
      case 'Escape':
        if (thumbnails) thumbnails.classList.remove('visible');
        break;
    }
  }

  function onTouchStart(e) {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
  }

  function onTouchEnd(e) {
    var dx = e.changedTouches[0].screenX - touchStartX;
    var dy = e.changedTouches[0].screenY - touchStartY;
    var absDx = Math.abs(dx);
    var absDy = Math.abs(dy);

    if (Math.max(absDx, absDy) < 40) return; // 阈值

    if (absDx > absDy) {
      // 水平滑动
      if (dx < 0) next();
      else prev();
    }
  }

  function onMouseMove() {
    if (controls) {
      controls.classList.remove('hidden');
      clearTimeout(controlsTimer);
      controlsTimer = setTimeout(function () {
        controls.classList.add('hidden');
      }, 3000);
    }
  }

  // ── 工具函数 ──
  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  // ── 启动 ──
  bindUploadEvents();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
