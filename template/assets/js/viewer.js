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
  var viewerEventsBound = false;
  var MAX_UPLOAD_SIZE = 100 * 1024 * 1024;

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
    bindEvents();
    refreshSlides();
    if (total === 0) return;

    applyAutoScale();
    show(0, 0);
  }

  function refreshSlides() {
    slides = Array.prototype.slice.call(document.querySelectorAll(CONFIG.slideSelector));
    total = slides.length;
  }

  function reinit() {
    bindEvents();
    refreshSlides();
    current = 0;
    thumbnailsBuilt = false;
    if (thumbnails) thumbnails.innerHTML = '';
    if (total === 0) {
      updateUI();
      return;
    }
    updateUI();
    applyAutoScale();
    show(0, 0);
  }

  // ── 文件上传 ──
  function bindUploadEvents() {
    if (!dropArea || !fileInput) return;

    dropArea.addEventListener('click', function () { fileInput.click(); });
    dropArea.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
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
    if (file.size > MAX_UPLOAD_SIZE) {
      showUploadError('文件过大，请上传小于 100MB 的 PPTX 文件');
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

      if (fileInput) fileInput.blur();
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
    initCharts(nextSlide);
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
    stopCharts(slideEl);
  }

  // ── UI 更新 ──
  function updateUI() {
    if (pageInfo) {
      pageInfo.textContent = total ? (current + 1) + ' / ' + total : '0 / 0';
    }
    if (progressBar) {
      progressBar.style.width = (total ? ((current + 1) / total * 100) : 0) + '%';
    }
    if (btnPrev) btnPrev.disabled = total <= 1 || current === 0;
    if (btnNext) btnNext.disabled = total <= 1 || current >= total - 1;

    // 更新缩略图高亮
    if (thumbnails) {
      var thumbs = thumbnails.querySelectorAll('.thumb');
      thumbs.forEach(function (t, i) {
        t.classList.toggle('active', i === current);
      });
    }
  }

  // ── ECharts 图表 ──
  function initCharts(slideEl) {
    if (typeof echarts === 'undefined') return;
    var charts = slideEl.querySelectorAll('.p-chart');
    charts.forEach(function(container) {
      var dataStr = container.getAttribute('data-chart');
      if (!dataStr) return;
      try {
        var data = JSON.parse(dataStr);
        stopChart(container);
        if (container._echartsInstance) {
          container._echartsInstance.dispose();
        }
        var instance = echarts.init(container);
        instance.setOption(buildEchartsOption(data, 'initial'), true);
        container._echartsInstance = instance;
        container._chartRevealTimeout = window.setTimeout(function () {
          if (container._echartsInstance === instance) {
            if (data.chartType === 'lineChart') {
              animateLineChart(container, instance, data);
            } else {
              instance.setOption(buildEchartsOption(data, 'reveal'), false);
            }
          }
        }, getChartRevealDelay(container));
      } catch (e) {
        console.error('ECharts init error:', e);
      }
    });
  }

  function stopCharts(slideEl) {
    var charts = slideEl.querySelectorAll('.p-chart');
    charts.forEach(stopChart);
  }

  function stopChart(container) {
    if (container._chartRevealTimer) {
      window.clearInterval(container._chartRevealTimer);
      container._chartRevealTimer = null;
    }
    if (container._chartRevealTimeout) {
      window.clearTimeout(container._chartRevealTimeout);
      container._chartRevealTimeout = null;
    }
  }

  function animateLineChart(container, instance, data) {
    var categories = (data.series[0] && data.series[0].categories) || [];
    var pointCount = Math.max(1, categories.length);
    var visiblePoints = 0;

    stopChart(container);
    instance.setOption(buildEchartsOption(data, 'line-step', visiblePoints), false);

    container._chartRevealTimer = window.setInterval(function () {
      if (container._echartsInstance !== instance) {
        stopChart(container);
        return;
      }

      visiblePoints += 1;
      instance.setOption(buildEchartsOption(data, 'line-step', visiblePoints), false);

      if (visiblePoints >= pointCount) {
        stopChart(container);
        container._chartRevealTimeout = window.setTimeout(function () {
          if (container._echartsInstance === instance) {
            instance.setOption(buildEchartsOption(data, 'reveal'), false);
          }
        }, 220);
      }
    }, getLineRevealStepMs(pointCount));
  }

  function getLineRevealStepMs(pointCount) {
    if (pointCount <= 6) return 320;
    if (pointCount <= 10) return 260;
    return 220;
  }

  function getChartRevealDelay(container) {
    var rawDelay = (container.style.animationDelay || '0ms').trim();
    var delay = parseFloat(rawDelay) || 0;
    if (rawDelay.endsWith('s') && !rawDelay.endsWith('ms')) delay *= 1000;
    return Math.max(260, delay + 220);
  }

  function buildEchartsOption(data, phase, visiblePoints) {
    var categories = (data.series[0] && data.series[0].categories) || [];
    var valueScale = buildValueScale(data.series);
    var colors = data.series.map(function (s) { return s.color; }).filter(Boolean);
    var isInitial = phase === 'initial';
    var isLineStep = phase === 'line-step';
    var option = {
      animation: !isInitial,
      animationDuration: 1800,
      animationDurationUpdate: 1500,
      animationEasing: 'cubicOut',
      animationDelay: function (idx) { return Math.min(idx * 100, 900); },
      animationDelayUpdate: function (idx) { return Math.min(idx * 100, 900); },
      color: colors.length ? colors : undefined,
      title: data.title ? { text: data.title, left: 'center', textStyle: { fontSize: 14, color: '#212529', fontWeight: 700 } } : undefined,
      tooltip: { trigger: data.chartType === 'pieChart' ? 'item' : 'axis' },
      legend: data.series.length > 1 ? { bottom: 0, textStyle: { fontSize: 11, color: '#495057' } } : undefined,
      grid: { left: '8%', right: '10%', bottom: '10%', top: data.title ? '18%' : '10%', containLabel: true },
    };

    var series = [];

    if (data.chartType === 'pieChart') {
      var pieData = [];
      if (data.series[0]) {
        for (var i = 0; i < data.series[0].categories.length; i++) {
          pieData.push({ name: data.series[0].categories[i], value: isInitial ? 0 : (data.series[0].values[i] || 0) });
        }
      }
      option.series = [{ type: 'pie', radius: '60%', data: pieData, label: { fontSize: 11, color: '#495057' } }];
      option.xAxis = undefined;
      option.yAxis = undefined;
    } else if (data.chartType === 'barChart' && data.barDir === 'bar') {
      option.grid = { left: '7%', right: '8%', bottom: '12%', top: data.title ? '18%' : '10%', containLabel: true };
      option.xAxis = buildValueAxis(valueScale);
      option.yAxis = buildCategoryAxis(categories);
      for (var i = 0; i < data.series.length; i++) {
        series.push(buildSeries(data.series[i], 'bar', 'right', i, phase));
      }
      option.series = series;
    } else if (data.chartType === 'barChart' && data.barDir === 'col') {
      option.xAxis = buildCategoryAxis(categories);
      option.yAxis = buildValueAxis(valueScale);
      for (var i = 0; i < data.series.length; i++) {
        series.push(buildSeries(data.series[i], 'bar', 'top', i, phase));
      }
      option.series = series;
    } else if (data.chartType === 'lineChart') {
      option.xAxis = buildCategoryAxis(categories);
      option.yAxis = buildValueAxis(valueScale);
      for (var i = 0; i < data.series.length; i++) {
        series.push(buildSeries(data.series[i], 'line', 'top', i, phase, visiblePoints));
      }
      option.series = series;
    } else {
      option.xAxis = buildCategoryAxis(categories);
      option.yAxis = buildValueAxis(valueScale);
      for (var i = 0; i < data.series.length; i++) {
        series.push(buildSeries(data.series[i], 'bar', 'top', i, phase));
      }
      option.series = series;
    }

    if (isLineStep) {
      option.animationDuration = 260;
      option.animationDurationUpdate = 260;
      option.animationDelay = 0;
      option.animationDelayUpdate = 0;
    }

    return option;
  }

  function buildSeries(source, type, labelPosition, seriesIndex, phase, visiblePoints) {
    var isInitial = phase === 'initial';
    var isLineStep = phase === 'line-step';
    var values = source.values || [];
    var revealData = values.map(function (v, idx) {
      if (type === 'line' && isLineStep) return idx < visiblePoints ? v : null;
      if (!isInitial) return v;
      if (type === 'line') return null;
      return 0;
    });
    var duration = type === 'line' ? 2400 : 1700;
    var delayStep = type === 'line' ? 95 : 150;
    return {
      name: source.name,
      type: type,
      data: revealData,
      smooth: type === 'line' ? false : undefined,
      showSymbol: type === 'line' ? true : undefined,
      symbolSize: type === 'line' ? 6 : undefined,
      connectNulls: type === 'line' ? false : undefined,
      barMaxWidth: type === 'bar' ? 32 : undefined,
      itemStyle: source.color ? { color: source.color } : undefined,
      lineStyle: source.color ? { color: source.color, width: 2 } : undefined,
      animation: !isInitial,
      animationDuration: isLineStep ? 260 : duration,
      animationDurationUpdate: isLineStep ? 260 : duration,
      animationDelay: isLineStep ? 0 : function (idx) { return (seriesIndex || 0) * 180 + idx * delayStep; },
      animationDelayUpdate: isLineStep ? 0 : function (idx) { return (seriesIndex || 0) * 180 + idx * delayStep; },
      animationEasing: type === 'bar' ? 'backOut' : 'cubicOut',
      label: source.showVal && !isInitial && !isLineStep ? {
        show: true,
        position: labelPosition,
        color: '#495057',
        fontSize: 12,
        formatter: function (params) { return formatChartNumber(params.value); }
      } : undefined
    };
  }

  function buildCategoryAxis(categories) {
    return {
      type: 'category',
      data: categories,
      axisLabel: { fontSize: 12, color: '#495057' },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#adb5bd' } }
    };
  }

  function buildValueAxis(scale) {
    return {
      type: 'value',
      min: 0,
      max: scale.max,
      interval: scale.interval,
      axisLabel: { fontSize: 12, color: '#868e96', formatter: formatChartNumber },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#adb5bd' } },
      splitLine: { lineStyle: { color: '#e9ecef' } }
    };
  }

  function buildValueScale(series) {
    var max = 0;
    series.forEach(function (s) {
      (s.values || []).forEach(function (v) {
        var n = Number(v);
        if (!isNaN(n)) max = Math.max(max, n);
      });
    });

    if (max <= 0) return { max: 1, interval: 0.2 };

    var padded = max * 1.15;
    var target = padded / 5.5;
    var interval = niceInterval(target);
    return {
      max: Math.ceil(padded / interval) * interval,
      interval: interval
    };
  }

  function niceInterval(target) {
    var exponent = Math.floor(Math.log(target) / Math.LN10);
    var base = Math.pow(10, exponent);
    var steps = [1, 2, 5, 10];
    for (var i = 0; i < steps.length; i++) {
      var interval = steps[i] * base;
      if (target <= interval) return interval;
    }
    return 10 * base;
  }

  function formatChartNumber(value) {
    var n = Number(value);
    if (isNaN(n)) return value;
    if (Math.abs(n - Math.round(n)) < 0.0001) return String(Math.round(n));
    return String(Math.round(n * 10) / 10);
  }

  function resizeCharts() {
    if (typeof echarts === 'undefined') return;
    slides.forEach(function(s) {
      var charts = s.querySelectorAll('.p-chart');
      charts.forEach(function(c) {
        if (c._echartsInstance) c._echartsInstance.resize();
      });
    });
  }

  // ── 自动缩放 ──
  function applyAutoScale() {
    if (!CONFIG.autoScale || !stage || !stageInner) return;

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
    resizeCharts();
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
    if (viewerEventsBound) return;
    viewerEventsBound = true;

    // 按钮
    if (btnPrev) btnPrev.addEventListener('click', prev);
    if (btnNext) btnNext.addEventListener('click', next);
    if (btnFullscreen) btnFullscreen.addEventListener('click', toggleFullscreen);

    // 键盘
    document.addEventListener('keydown', onKeyDown);

    // 触摸
    if (stage) {
      stage.addEventListener('touchstart', onTouchStart, { passive: true });
      stage.addEventListener('touchend', onTouchEnd, { passive: true });
    }

    // 全屏变化
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);

    // 窗口缩放
    window.addEventListener('resize', debounce(applyAutoScale, 150));

    // 鼠标移动显示/隐藏控制栏
    document.addEventListener('mousemove', onMouseMove);
  }

  function onKeyDown(e) {
    if (shouldIgnoreKey(e)) return;

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

  function shouldIgnoreKey(e) {
    var target = e.target;
    if (!target || !target.tagName) return false;
    var tag = target.tagName;
    var role = target.getAttribute('role');

    if (target.isContentEditable || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if ((tag === 'BUTTON' || role === 'button') && (e.key === ' ' || e.key === 'Enter')) return true;
    if (tag !== 'INPUT') return false;

    var type = (target.type || '').toLowerCase();
    return type !== 'button' &&
      type !== 'submit' &&
      type !== 'reset' &&
      type !== 'checkbox' &&
      type !== 'radio' &&
      type !== 'file' &&
      type !== 'hidden';
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
