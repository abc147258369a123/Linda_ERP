/**
 * 工作台（仪表盘）
 * ------------------------------------------------------------------
 * 布局参考 x.erp 工作台，业务替换为硬件物料台账：
 *   欢迎横幅 → 4 张 KPI → 进出物料趋势 + 待办/快捷入口
 *   → 分类占比 / 近 30 天领用排行 / 库存预警（管理员）
 *   → 最近进出库记录（替代「最近销售订单」）
 *
 * 数据说明：
 *   - KPI 与趋势全部来自 /api/dashboard/summary（MariaDB 实时聚合），切换统计周期立即重新拉取；
 *   - 趋势口径（v1.3.0）：inbound = 新建物料入库（materials.inbound_at）+ 真实补货流水，
 *     outbound = 领用流水；因此直接批量入库、没有流水的物料也能在图上体现；
 *   - 图表使用本地 vendor/chart.umd.min.js（v1.4.0 起不再走 CDN）：
 *     仍未拿不到 window.Chart 时降级为提示文案；
 *   - 分类环形图口径（v1.4.0）：只统计一级大类（tree roots），
 *     数值取 totalCount（本级 + 全部子孙），避免父子重复计数。
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;
  var isAdmin = ERP.auth.isAdmin(session);

  await ERP.store.load();

  var stats = ERP.store.stats();
  var warnings = ERP.store.warnings();

  // 分类卡片「共 N 个分类」的初值：与环形图同口径，只数一级大类（roots）
  var categoryRootCount = 0;
  try {
    categoryRootCount = storeCategoryRoots().length;
  } catch (error) {
    categoryRootCount = 0;
  }

  var state = { period: 'month' };
  var trendChart = null;
  var categoryChart = null;

  /* ============================ 模拟数据 ============================ */

  var WEEK_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
  var MONTH_LABELS = ['1月', '2月', '3月', '4月', '5月', '6月',
    '7月', '8月', '9月', '10月', '11月', '12月'];

  function dayLabels(count) {
    var labels = [];
    for (var i = 1; i <= count; i++) labels.push(i + '日');
    return labels;
  }

  var PERIODS = {
    all: { label: '近12个月' },
    week: { label: '本周' },
    month: { label: '本月' },
    quarter: { label: '本季度' },
    half: { label: '半年' },
    year: { label: '本年' }
  };

  function formatNumber(value) {
    return Number(value).toLocaleString('zh-CN');
  }

  /** 控制台告警（刷新失败只记录，不清空已有图表） */
  function warnLog(message, error) {
    if (window.console && console.warn) {
      console.warn('[dashboard] ' + message, error);
    }
  }

  function deltaHtml(value, suffix) {
    if (value === null || value === undefined) {
      return '<span class="kpi-delta is-flat">累计</span><span>历史数据</span>';
    }
    var tail = suffix || '较上期';
    if (value === 0) {
      return '<span class="kpi-delta is-flat">持平</span><span>' + esc(tail) + '</span>';
    }
    var up = value > 0;
    return '<span class="kpi-delta ' + (up ? 'is-up' : 'is-down') + '">' +
      (up ? '↑' : '↓') + ' ' + Math.abs(value).toFixed(1) + '%</span>' +
      '<span>' + esc(tail) + '</span>';
  }

  /* ============================ 问候与日期 ============================ */

  function greeting() {
    var hour = new Date().getHours();
    if (hour < 6) return '凌晨好';
    if (hour < 9) return '早上好';
    if (hour < 12) return '上午好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  function dateText() {
    var now = new Date();
    var week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
    return now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() +
      '日 星期' + week;
  }

  /* ============================ 顶栏与骨架 ============================ */

  var periodOptions = [
    { value: 'all', label: '近12个月' },
    { value: 'week', label: '本周' },
    { value: 'month', label: '本月' },
    { value: 'quarter', label: '本季度' },
    { value: 'half', label: '半年' },
    { value: 'year', label: '本年' }
  ].map(function (option) {
    return '<option value="' + option.value + '"' +
      (option.value === state.period ? ' selected' : '') + '>' +
      esc(option.label) + '</option>';
  }).join('');

  var topbarActions =
    '<div class="period-picker">' + ERP.icon('clock', 14) +
      '<span>统计周期</span>' +
      '<select class="select" id="periodSelect" aria-label="统计周期">' + periodOptions + '</select>' +
    '</div>';

  var view = ERP.layout.mount({
    active: 'dashboard',
    title: '工作台',
    topbarActions: topbarActions
  });
  if (!view) return;
  var page = view.content;

  /* ============================ 数据片段 ============================ */

  var warningGap = warnings.reduce(function (total, material) {
    return total + Math.max(0, Number(material.minQty) - Number(material.qty));
  }, 0);

  var pendingText = isAdmin
    ? (warnings.length > 0
      ? '今天是 ' + dateText() + '，您有 ' + warnings.length + ' 项库存预警待处理。'
      : '今天是 ' + dateText() + '，暂无库存预警，库存状态良好。')
    : '今天是 ' + dateText() + '，共 ' + stats.total + ' 个物料档案 · ' +
      stats.categories + ' 个分类，领用前记得先查一下库存。';

  var bannerButtons = isAdmin
    ? '<a class="banner-btn" href="' + esc(ERP.url('pages/material-new.html')) + '">' +
        ERP.icon('plus', 15) + '新增物料</a>' +
      '<a class="banner-btn is-primary" href="' + esc(ERP.url('pages/borrow.html')) + '">' +
        ERP.icon('out', 15) + '领用登记</a>'
    : '<a class="banner-btn" href="' + esc(ERP.url('index.html')) + '">' +
        ERP.icon('search', 15) + '查看物料总览</a>' +
      '<a class="banner-btn is-primary" href="' + esc(ERP.url('pages/borrow.html')) + '">' +
        ERP.icon('out', 15) + '领用登记</a>';

  function kpiCard(options) {
    return '<div class="kpi-card">' +
      '<span class="kpi-icon ' + (options.iconClass || '') + '">' +
        ERP.icon(options.icon, 18) +
      '</span>' +
      '<div class="kpi-main">' +
        '<div class="kpi-label">' + esc(options.label) + '</div>' +
        '<div class="kpi-value">' +
          '<span data-kpi="' + options.key + '">0</span>' +
          '<span class="kpi-unit">' + esc(options.unit) + '</span>' +
        '</div>' +
        '<div class="kpi-foot" data-delta="' + options.key + '"></div>' +
      '</div>' +
    '</div>';
  }

  var kpiHtml =
    kpiCard({ key: 'types', label: '物料总种类', unit: '种', icon: 'box', iconClass: '' }) +
    kpiCard({ key: 'inbound', label: '当期入库物料次数', unit: '次', icon: 'upload', iconClass: 'is-green' }) +
    kpiCard({ key: 'borrow', label: '当期领用物料次数', unit: '次', icon: 'out', iconClass: 'is-blue' }) +
    kpiCard({ key: 'items', label: '当期涉及物料条目数量', unit: '条', icon: 'file', iconClass: 'is-amber' });

  /* ---------- 待办 / 速览 ---------- */

  var todoTitle = isAdmin ? '待办事项' : '数据速览';
  var todoItems = isAdmin
    ? [
      { icon: 'alert', tone: 'is-amber', value: warnings.length, unit: '项', label: '库存预警', href: ERP.url('pages/alerts.html') },
      { icon: 'box', tone: 'is-blue', value: stats.empty, unit: '项', label: '空缺物料', href: ERP.url('pages/alerts.html') },
      { icon: 'download', tone: 'is-green', value: warningGap, unit: '件', label: '待补货缺口', href: ERP.url('pages/alerts.html') },
      { icon: 'out', tone: 'is-purple', value: 0, unit: '次', label: '本期领用', href: ERP.url('pages/logs.html'), key: 'periodBorrow' }
    ]
    : [
      { icon: 'box', tone: '', value: stats.total, unit: '种', label: '物料档案', href: ERP.url('index.html') },
      { icon: 'chip', tone: 'is-green', value: stats.precise, unit: '种', label: '精确计数', href: ERP.url('index.html') },
      { icon: 'tag', tone: 'is-amber', value: stats.categories, unit: '类', label: '物料分类', href: ERP.url('index.html') },
      { icon: 'list', tone: 'is-blue', value: stats.logs, unit: '条', label: '领用流水', href: ERP.url('pages/logs.html') }
    ];

  function todoHtml(item) {
    return '<a class="todo-item" href="' + esc(item.href) + '">' +
      '<span class="todo-top">' +
        '<span class="todo-icon ' + item.tone + '">' + ERP.icon(item.icon, 14) + '</span>' +
        '<span class="todo-value"' + (item.key ? ' data-todo="' + item.key + '"' : '') + '>' +
          (item.key ? '0' : item.value) +
          '<small>' + esc(item.unit) + '</small>' +
        '</span>' +
      '</span>' +
      '<span class="todo-label">' + esc(item.label) + '</span>' +
    '</a>';
  }

  /* ---------- 快捷入口 ---------- */

  var quickItems = isAdmin
    ? [
      { icon: 'plus', label: '新增物料', href: ERP.url('pages/material-new.html') },
      { icon: 'out', label: '领用登记', href: ERP.url('pages/borrow.html') },
      { icon: 'list', label: '领用日志', href: ERP.url('pages/logs.html') },
      { icon: 'alert', label: '库存预警', href: ERP.url('pages/alerts.html') }
    ]
    : [
      { icon: 'grid', label: '物料总览', href: ERP.url('index.html') },
      { icon: 'out', label: '领用登记', href: ERP.url('pages/borrow.html') },
      { icon: 'list', label: '领用日志', href: ERP.url('pages/logs.html') }
    ];

  function quickHtml(item) {
    return '<a class="quick-item" href="' + esc(item.href) + '">' +
      '<span class="quick-icon">' + ERP.icon(item.icon, 17) + '</span>' +
      '<span>' + esc(item.label) + '</span>' +
    '</a>';
  }

  /* ---------- 近 30 天领用排行（模拟） ---------- */

  var RANKING = [
    { id: 'M-0004', times: 12 },
    { id: 'M-0005', times: 9 },
    { id: 'M-0014', times: 7 },
    { id: 'M-0001', times: 6 },
    { id: 'M-0007', times: 4 }
  ];

  function rankingHtml() {
    var max = RANKING[0].times || 1;
    return RANKING.map(function (item, index) {
      var material = ERP.store.getMaterial(item.id);
      var name = material ? material.name : item.id;
      var width = Math.round((item.times / max) * 100);
      return '<div class="rank-row">' +
        '<div class="rank-head">' +
          '<span class="rank-name">' + esc(name) + '</span>' +
          '<span class="rank-value">' + item.times + ' 次</span>' +
        '</div>' +
        '<div class="rank-bar"><span class="' + (index % 2 ? 'is-alt' : '') +
          '" style="width:' + width + '%"></span></div>' +
      '</div>';
    }).join('');
  }

  /* ---------- 库存预警（管理员） ---------- */

  function warningMiniHtml() {
    var list = warnings.slice(0, 4);
    var rows = list.length
      ? list.map(function (material) {
        var qty = Number(material.qty) || 0;
        var statusTag = qty <= 0
          ? '<span class="tag tag-danger tag-dot">缺货</span>'
          : '<span class="tag tag-warn tag-dot">预警</span>';
        return '<tr>' +
          '<td>' +
            '<div class="record-mat">' + esc(material.name) + '</div>' +
            '<div class="record-sub">' + esc(material.model || '—') + '</div>' +
          '</td>' +
          '<td class="col-num"><span class="warn-qty' + (qty <= 0 ? ' is-zero' : '') + '">' +
            qty + '</span></td>' +
          '<td class="col-num"><span class="warn-threshold">' +
            (Number(material.minQty) || 0) + '</span></td>' +
          '<td>' + statusTag + '</td>' +
        '</tr>';
      }).join('')
      : '<tr><td colspan="4"><div class="empty" style="padding:20px 12px;">' +
          '<div class="empty-desc">暂无预警物料</div></div></td></tr>';

    return '<div class="card">' +
      '<div class="card-hd">' +
        '<div class="card-title">库存预警</div>' +
        '<a class="card-link" href="' + esc(ERP.url('pages/alerts.html')) + '">去处理 ›</a>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table is-compact">' +
          '<thead><tr>' +
            '<th>物料</th>' +
            '<th class="col-num">库存</th>' +
            '<th class="col-num">安全</th>' +
            '<th>状态</th>' +
          '</tr></thead>' +
          '<tbody>' + rows + '</tbody>' +
        '</table>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span>精确计数 · 低于安全阈值</span>' +
        '<a class="card-link" href="' + esc(ERP.url('pages/alerts.html')) + '">前往库存预警页面 ›</a>' +
      '</div>' +
    '</div>';
  }

  /* ---------- 最近进出库记录 ---------- */

  function recordStatus(log) {
    if (log.action === 'borrow') return '<span class="tag tag-brand tag-dot">已领用</span>';
    if (log.action === 'restock') return '<span class="tag tag-ok tag-dot">已入库</span>';
    return '<span class="tag tag-empty tag-dot">已清零</span>';
  }

  function recordPerson(log) {
    if (log.action === 'borrow') {
      return '<div>' + esc(log.borrower || '—') + '</div>' +
        (log.project ? '<div class="record-sub">' + esc(log.project) + '</div>' : '');
    }
    return '<div>' + esc(log.operator || '—') + '</div>' +
      '<div class="record-sub">' + (log.action === 'restock' ? '补货入库' : '标记为空') + '</div>';
  }

  function recordQty(log) {
    if (log.action === 'borrow') {
      return log.mode === 'precise' ? esc(String(log.qty)) + ' 件' : '—';
    }
    if (log.action === 'restock') {
      return log.qty != null ? '+' + esc(String(log.qty)) + ' 件' : '—';
    }
    return '—';
  }

  function recentRecordsHtml() {
    var logs = ERP.store.logs().slice(0, 8);
    if (!logs.length) {
      return '<tr><td colspan="6"><div class="empty" style="padding:32px 16px;">' +
        '<div class="empty-desc">暂无进出库记录</div></div></td></tr>';
    }
    return logs.map(function (log) {
      return '<tr>' +
        '<td><span class="record-id">' + esc(log.id) + '</span></td>' +
        '<td>' +
          '<div class="record-mat">' + esc(log.materialName) + '</div>' +
          '<div class="record-sub">' + esc(log.materialId) + '</div>' +
        '</td>' +
        '<td>' + recordPerson(log) + '</td>' +
        '<td><span class="cell-mono">' + esc(ERP.ui.fmtDate(log.borrowAt)) + '</span></td>' +
        '<td class="col-num"><span class="record-qty">' + recordQty(log) + '</span></td>' +
        '<td>' + recordStatus(log) + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ============================ 页面结构 ============================ */

  page.innerHTML =
    '<div class="welcome-banner">' +
      '<div>' +
        '<div class="welcome-title">' + esc(greeting()) + '，' + esc(session.name) +
          '<span class="wave" aria-hidden="true">👋</span></div>' +
        '<div class="welcome-sub">' + esc(pendingText) + '</div>' +
      '</div>' +
      '<div class="welcome-actions">' + bannerButtons + '</div>' +
    '</div>' +

    '<div class="kpi-grid">' + kpiHtml + '</div>' +

    '<div class="dash-grid">' +
      '<div class="card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title" id="chartTitle">进出物料趋势（本月）</div>' +
            '<div class="card-sub" id="chartSub">入库与领用次数 · 单位：次 · 数据来自 MariaDB 实时统计</div>' +
          '</div>' +
          '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">查看日志 ›</a>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="chart-box">' +
            '<canvas id="trendChart" role="img" aria-label="进出物料趋势折线图"></canvas>' +
            '<div class="chart-fallback" id="chartFallback" hidden>' +
              '图表库（Chart.js）加载失败，请刷新页面重试。' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="dash-side">' +
        '<div class="card">' +
          '<div class="card-hd"><div class="card-title">' + esc(todoTitle) + '</div></div>' +
          '<div class="card-bd"><div class="todo-grid">' +
            todoItems.map(todoHtml).join('') +
          '</div></div>' +
        '</div>' +
        '<div class="card">' +
          '<div class="card-hd"><div class="card-title">快捷入口</div></div>' +
          '<div class="card-bd"><div class="quick-grid">' +
            quickItems.map(quickHtml).join('') +
          '</div></div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="dash-row ' + (isAdmin ? 'is-3' : 'is-2') + '">' +
      '<div class="card">' +
        '<div class="card-hd">' +
          '<div class="card-title">物料分类占比</div>' +
          '<span class="card-link" id="categoryCount" style="color:var(--text-3)">共 ' +
            categoryRootCount + ' 个分类</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="donut-box">' +
            '<canvas id="categoryChart" role="img" aria-label="物料分类占比环形图"></canvas>' +
            '<div class="chart-fallback" id="categoryFallback" hidden>' +
              '图表库加载失败，请检查网络后刷新页面。' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-hd">' +
          '<div class="card-title">近 30 天领用排行</div>' +
          '<span class="card-link" style="color:var(--text-3)">模拟数据</span>' +
        '</div>' +
        '<div class="card-bd"><div class="rank-list">' + rankingHtml() + '</div></div>' +
      '</div>' +

      (isAdmin ? warningMiniHtml() : '') +
    '</div>' +
    '<div class="card recent-card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">最近进出库记录</div>' +
          '<div class="card-sub">最近 8 条领用 / 补货 / 标记为空记录</div>' +
        '</div>' +
        '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">查看全部记录 ›</a>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>记录号</th>' +
            '<th>物料</th>' +
            '<th>领用人 / 经办</th>' +
            '<th>日期</th>' +
            '<th class="col-num">数量</th>' +
            '<th>状态</th>' +
          '</tr></thead>' +
          '<tbody>' + recentRecordsHtml() + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  /* ============================ 图表 ============================ */

  /** 图表降级：隐藏 canvas，显示图表库加载失败提示 */
  function showChartFallback(canvas, fallback) {
    if (fallback) fallback.hidden = false;
    if (canvas) canvas.style.display = 'none';
  }

  /**
   * 等 window.Chart 就绪再初始化图表（最多轮询 ~5s）。
   * Chart.js 已改为本地 vendor/chart.umd.min.js，理论上同步可用，
   * 但仍保留晚到重试：脚本被推迟/被拦截时等它就绪后自动补建，5s 仍不到才降级为文字提示。
   */
  var chartWaiters = [];
  var chartWaitTimer = null;
  var chartWaitDeadline = 0;

  function flushChartWaiters(ready) {
    if (chartWaitTimer) {
      window.clearInterval(chartWaitTimer);
      chartWaitTimer = null;
    }
    var waiters = chartWaiters;
    chartWaiters = [];
    waiters.forEach(function (callback) { callback(ready); });
  }

  function onChartReady(callback) {
    if (typeof window.Chart !== 'undefined') {
      callback(true);
      return;
    }
    chartWaiters.push(callback);
    if (chartWaitTimer) return;
    chartWaitDeadline = Date.now() + 5000;
    chartWaitTimer = window.setInterval(function () {
      if (typeof window.Chart !== 'undefined') flushChartWaiters(true);
      else if (Date.now() > chartWaitDeadline) flushChartWaiters(false);
    }, 100);
  }

  /** DOM 就绪后执行（脚本在 body 末尾时立即执行，避免 document 尚未解析完就取 canvas） */
  function whenDomReady(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { callback(); });
    } else {
      callback();
    }
  }

  // 最近一次成功拉取的趋势数据：图表可能比数据晚就绪（脚本晚到 / 缓存恢复），先暂存、图建好后再补写
  var trendData = null;
  var trendMismatchWarned = false;
  var trendInitFailed = false;

  function seriesToLength(source, length) {
    var list = Array.isArray(source) ? source : [];
    var series = [];
    for (var i = 0; i < length; i++) series.push(Number(list[i]) || 0);
    return series;
  }

  /** 把 trendData 写入趋势图；labels 与 inbound/outbound 长度不一致时按 labels 对齐，不抛错 */
  function applyTrendData() {
    if (!trendChart || !trendData) return;
    var labels = Array.isArray(trendData.labels) ? trendData.labels.slice() : [];
    var inbound = Array.isArray(trendData.inbound) ? trendData.inbound : [];
    var outbound = Array.isArray(trendData.outbound) ? trendData.outbound : [];

    if (labels.length !== inbound.length || labels.length !== outbound.length) {
      if (!trendMismatchWarned) {
        trendMismatchWarned = true;
        warnLog('趋势图 labels 与 inbound/outbound 长度不一致，已按 labels 长度对齐', {
          labels: labels.length, inbound: inbound.length, outbound: outbound.length
        });
      }
    }

    var length = labels.length || Math.max(inbound.length, outbound.length);
    if (!labels.length) {
      for (var i = 0; i < length; i++) labels.push(String(i + 1));
    }

    trendChart.data.labels = labels;
    trendChart.data.datasets[0].data = seriesToLength(inbound, length);
    trendChart.data.datasets[1].data = seriesToLength(outbound, length);
    trendChart.update('none');
  }

  /** 图表补建成功后恢复 canvas 显示，并隐藏图表库失败提示 */
  function showChartCanvas(canvas, fallback) {
    if (fallback) fallback.hidden = true;
    if (canvas) canvas.style.display = '';
  }

  function initTrendChart() {
    var canvas = $('#trendChart');
    var fallback = $('#chartFallback');
    if (!canvas) return;
    if (trendChart) {
      applyTrendData();
      return;
    }
    if (typeof window.Chart === 'undefined') {
      // 图表库尚未加载完成：等它就绪后再初始化，超时才降级
      onChartReady(function (ready) {
        if (ready) initTrendChart();
        else showChartFallback(canvas, fallback);
      });
      return;
    }
    try {
      window.Chart.defaults.font.family =
        '"Segoe UI","PingFang SC","Microsoft YaHei",system-ui,sans-serif';
      window.Chart.defaults.color = '#5b6b7f';
      trendChart = new window.Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: '入库',
              data: [],
              borderColor: '#2f855a',
              backgroundColor: 'rgba(47, 133, 90, 0.08)',
              borderWidth: 2,
              fill: true,
              tension: 0.32,
              pointRadius: 2,
              pointHoverRadius: 4,
              pointBackgroundColor: '#2f855a'
            },
            {
              label: '领用',
              data: [],
              borderColor: '#2c6e8f',
              backgroundColor: 'rgba(44, 110, 143, 0.08)',
              borderWidth: 2,
              fill: true,
              tension: 0.32,
              pointRadius: 2,
              pointHoverRadius: 4,
              pointBackgroundColor: '#2c6e8f'
            }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              position: 'top',
              align: 'end',
              labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 8,
                boxHeight: 8,
                padding: 16,
                font: { size: 12 }
              }
            },
            tooltip: {
              backgroundColor: '#1e293b',
              titleColor: '#f1f5f9',
              bodyColor: '#e2e8f0',
              padding: 10,
              usePointStyle: true,
              callbacks: {
                label: function (context) {
                  return ' ' + context.dataset.label + '：' + context.parsed.y + ' 次';
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                color: '#94a3b8',
                font: { size: 11 },
                maxRotation: 0,
                autoSkip: true,
                maxTicksLimit: 12
              }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#eef2f6' },
              ticks: { color: '#94a3b8', font: { size: 11 }, precision: 0 },
              title: { display: true, text: '次数', color: '#94a3b8', font: { size: 11 } }
            }
          }
        }
      });
    } catch (error) {
      trendChart = null;
      trendInitFailed = true;
      showChartFallback(canvas, fallback);
      warnLog('趋势图初始化失败，已降级为文字提示', error);
      return;
    }

    showChartCanvas(canvas, fallback);
    // 图表可能晚于首次 refreshSummary 就绪，这里补写最近一次数据
    applyTrendData();
  }

  var PALETTE = ['#2c6e8f', '#2f855a', '#b7791f', '#7c6bb0', '#b3413a',
    '#4a8db3', '#8f9e6b', '#6b8f8a', '#a08a6b'];

  var categoryInitFailed = false;
  // 空态提示元素（懒创建，与 #categoryFallback 的「图表库加载失败」提示分开，避免互相覆盖）
  var categoryEmptyBox = null;
  var categoryEmptyShown = false;

  /**
   * 取一级大类（tree 的 roots）。
   * v1.4.0 起物料会挂到 2/3 级子分类上，直接隶属一级大类的物料可能为 0，
   * 因此环形图一律按一级大类统计，不按子分类/封装展开。
   */
  function storeCategoryRoots() {
    if (typeof ERP.store.categoryTree === 'function') {
      return ERP.store.categoryTree() || [];
    }
    // 兜底：store 还没提供 categoryTree（旧缓存）时，按 parentId 找出一级分类
    return ERP.store.categories().filter(function (category) {
      return category.parentId === null || category.parentId === undefined;
    });
  }

  /**
   * 环形图数据快照（每次现读 store 缓存，刷新后自然是最新数据）：
   * - roots：全部一级大类，用于「共 N 个分类」文案，与图例口径一致；
   * - rows：totalCount > 0 的一级大类，0 值不画扇区也不进图例。
   * 数值只取 totalCount（本级 + 所有子孙），因此不会父子重复计数。
   */
  function categoryChartData() {
    var roots;
    try {
      roots = storeCategoryRoots();
    } catch (error) {
      warnLog('分类树读取失败，环形图按空数据处理', error);
      roots = [];
    }
    var rows = [];
    roots.forEach(function (node) {
      if (!node) return;
      var value = Number(node.totalCount);
      if (!isFinite(value)) value = Number(node.count) || 0;
      if (value <= 0) return;
      rows.push({ id: node.id, name: node.name, value: value });
    });
    return { roots: roots, rows: rows };
  }

  /** 分类卡片右上角「共 N 个分类」：只数一级大类，与环形图保持一致 */
  function renderCategoryCount(count) {
    var el = document.getElementById('categoryCount');
    if (!el) return;
    var text = '共 ' + count + ' 个分类';
    if (el.textContent !== text) el.textContent = text;
  }

  /** 空态提示元素：动态创建在 .donut-box 内，样式复用 .chart-fallback（居中提示） */
  function ensureCategoryEmptyBox(canvas) {
    if (categoryEmptyBox && categoryEmptyBox.parentNode) return categoryEmptyBox;
    var host = canvas && canvas.parentNode;
    if (!host || !host.appendChild) return null;
    var box = document.createElement('div');
    box.className = 'chart-fallback';
    box.id = 'categoryEmpty';
    box.textContent = '暂无分类数据';
    host.appendChild(box);
    categoryEmptyBox = box;
    return box;
  }

  /**
   * 空态切换：数据全为 0 时隐藏 canvas、显示「暂无分类数据」，避免留一块空白画布。
   * 图表库降级（#categoryFallback）优先，避免同屏出现两条提示。
   * 返回是否从「空态」切回「有数据」，用于恢复显示后重算画布尺寸。
   */
  function setCategoryEmptyState(canvas, isEmpty) {
    if (categoryInitFailed) {
      if (categoryEmptyBox) categoryEmptyBox.hidden = true;
      return false;
    }
    var wasEmpty = categoryEmptyShown;
    categoryEmptyShown = isEmpty;
    var box = ensureCategoryEmptyBox(canvas);
    if (box) box.hidden = !isEmpty;
    if (canvas) canvas.style.display = isEmpty ? 'none' : '';
    return wasEmpty && !isEmpty;
  }

  /**
   * 唯一写入口：把最新一级大类数据写入环形图。
   * 初始化、15s 轮询、focus、visibilitychange、统计周期切换后的刷新都走这里，
   * 保证 store 缓存一更新，环形图与「共 N 个分类」文案就同步更新。
   */
  function applyCategoryData() {
    var canvas = $('#categoryChart');
    var data = categoryChartData();

    // 文案先更新：Chart.js 还没就绪时，分类数量也不该停留在旧值
    renderCategoryCount(data.roots.length);

    if (!categoryChart) {
      // 图表还没建（数据先到 / Chart.js 晚到）：借这次刷新补建，建好后 init 会再写一次
      if (!categoryInitFailed && typeof window.Chart !== 'undefined') initCategoryChart();
      return;
    }

    var dataset = categoryChart.data.datasets[0];
    categoryChart.data.labels = data.rows.map(function (row) { return row.name; });
    dataset.data = data.rows.map(function (row) { return row.value; });
    // 分类数量变化时按索引重算颜色，保证图例与扇区颜色一一对应
    dataset.backgroundColor = data.rows.map(function (row, index) {
      return PALETTE[index % PALETTE.length];
    });

    var restored = setCategoryEmptyState(canvas, data.rows.length === 0);
    categoryChart.update('none');
    // 空态期间 canvas 是隐藏的，恢复数据后重算一次尺寸，避免扇区画在 0 尺寸画布上
    if (restored && typeof categoryChart.resize === 'function') categoryChart.resize();
  }

  function initCategoryChart() {
    var canvas = $('#categoryChart');
    var fallback = $('#categoryFallback');
    if (!canvas) return;
    if (categoryChart) {
      applyCategoryData();
      return;
    }
    if (typeof window.Chart === 'undefined') {
      // Chart.js 尚未加载完成：等它就绪后再初始化，超时才降级（最长 5s）
      onChartReady(function (ready) {
        if (ready) initCategoryChart();
        else showChartFallback(canvas, fallback);
      });
      return;
    }
    try {
      categoryChart = new window.Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
          labels: [],
          datasets: [{
            data: [],
            backgroundColor: [],
            borderColor: '#ffffff',
            borderWidth: 2,
            hoverOffset: 2
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: false,
          cutout: '62%',
          plugins: {
            legend: {
              // 图例只显示一级大类：labels 直接就是 roots 的名字
              position: 'bottom',
              labels: {
                usePointStyle: true,
                pointStyle: 'circle',
                boxWidth: 8,
                boxHeight: 8,
                padding: 10,
                font: { size: 11 }
              }
            },
            tooltip: {
              backgroundColor: '#1e293b',
              padding: 8,
              usePointStyle: true,
              callbacks: {
                // 分类名：N 种（占比 X.X%），百分比按当前数据合计实时计算
                label: function (context) {
                  var values = (context.dataset && context.dataset.data) || [];
                  var total = 0;
                  for (var i = 0; i < values.length; i++) total += Number(values[i]) || 0;
                  var value = Number(context.parsed) || 0;
                  var percent = total > 0 ? (value / total) * 100 : 0;
                  return ' ' + context.label + '：' + formatNumber(value) +
                    ' 种（占比 ' + percent.toFixed(1) + '%）';
                }
              }
            }
          }
        }
      });
    } catch (error) {
      categoryChart = null;
      categoryInitFailed = true;
      showChartFallback(canvas, fallback);
      warnLog('分类环形图初始化失败，已降级为文字提示', error);
      return;
    }

    // 建图后立刻写入当前一级大类；之后每次数据刷新都由 applyCategoryData() 同步
    showChartCanvas(canvas, fallback);
    applyCategoryData();
  }

  /* ============================ 更新 ============================ */

  // 请求序号：切换统计周期时，丢弃后到的旧响应，避免覆盖当前周期的图表
  var summarySeq = 0;

  /**
   * 拉取后端 MariaDB 聚合数据并刷新 KPI / 趋势图。
   * 失败时直接抛出，由调用方决定提示方式；此处不清空图表，保留上一次数据。
   */
  async function refreshSummary() {
    var seq = ++summarySeq;
    var period = state.period;
    var data = await ERP.api.get('/dashboard/summary?period=' + encodeURIComponent(period));
    if (seq !== summarySeq) return data;
    renderSummary(data);
    return data;
  }

  function pad2(value) {
    return (value < 10 ? '0' : '') + value;
  }

  /** 从 updated_at（"YYYY-MM-DD HH:MM:SS"）取时间；取不到则用本地时间兜底 */
  function updatedClock(value) {
    var match = /(\d{2}:\d{2}:\d{2})/.exec(String(value || ''));
    if (match) return match[1];
    var now = new Date();
    return pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + ':' + pad2(now.getSeconds());
  }

  function renderSummary(data) {
    if (!data) return;
    var values = {
      types: Number(data.total_materials) || 0,
      inbound: Number(data.inbound_count) || 0,
      borrow: Number(data.borrow_count) || 0,
      items: Number(data.material_entries) || 0
    };
    var periodLabel = data.period_label || (PERIODS[state.period] && PERIODS[state.period].label) || '';

    ['types', 'inbound', 'borrow', 'items'].forEach(function (key) {
      var valueEl = page.querySelector('[data-kpi="' + key + '"]');
      if (valueEl) valueEl.textContent = formatNumber(values[key]);
      var deltaEl = page.querySelector('[data-delta="' + key + '"]');
      if (deltaEl) {
        deltaEl.innerHTML = '<span class="kpi-delta is-flat">实时</span><span>' + esc(periodLabel) + '</span>';
      }
    });

    var periodBorrow = page.querySelector('[data-todo="periodBorrow"]');
    if (periodBorrow) periodBorrow.innerHTML = formatNumber(values.borrow) + '<small>次</small>';

    var chartTitle = $('#chartTitle');
    if (chartTitle) chartTitle.textContent = '进出物料趋势（' + periodLabel + '）';
    var chartSub = $('#chartSub');
    if (chartSub) {
      chartSub.textContent = '入库与领用次数 · 单位：次 · 数据来自 MariaDB 实时统计 · ' +
        updatedClock(data.updated_at) + ' 更新';
    }

    // 先暂存最新数据，再由 applyTrendData() 写入图表：
    // 图表实例未就绪（Chart.js 还在加载）也不会丢数据，init 完成后会补写
    trendData = data;
    applyTrendData();
    // Chart.js 若晚于 5s 超时才到达，借下一次刷新补建趋势图（降级提示会自动隐藏）
    if (!trendChart && !trendInitFailed && typeof window.Chart !== 'undefined') initTrendChart();
  }

  var refreshTimer = null;
  var refreshPending = false;
  async function refreshDashboard() {
    if (refreshPending) return;
    refreshPending = true;
    try {
      // 物料 / 分类数据变化后同步环形图；store 失败不影响趋势图刷新
      try {
        var loaded = await ERP.store.load();
        if (loaded !== false) {
          stats = ERP.store.stats();
          applyCategoryData();
        }
      } catch (storeError) {
        warnLog('物料缓存刷新失败，分类环形图保留上一次数据', storeError);
      }
      await refreshSummary();
    } catch (error) {
      // 自动刷新失败不打断页面，保留上一次数据
      warnLog('自动刷新失败，图表保留上一次数据', error);
    } finally {
      refreshPending = false;
    }
  }

  /* ============================ 事件 ============================ */

  // Chart.js 用本地 vendor 文件，脚本先于 dashboard.js 执行；仍保留「等 DOM + window.Chart 就绪」
  // 的兜底，图表也可能晚于首次数据返回，因此两处都用「数据暂存 + 图表就绪后补写」解耦时序。
  whenDomReady(function () {
    initTrendChart();
    initCategoryChart();
  });

  // 首屏兜底：whenDomReady 可能在 store.load() 之后才跑（DOMContentLoaded 延后），
  // 这里用当前缓存再写一次分类图，保证「数据已加载但图还没画」的时序也能上图（幂等）。
  applyCategoryData();

  var periodSelect = document.getElementById('periodSelect');
  if (periodSelect) {
    periodSelect.addEventListener('change', function () {
      state.period = periodSelect.value;
      // 统计周期不影响分类占比，但周期切换同样算一次数据刷新，统一走唯一写入口同步环形图
      applyCategoryData();
      // 切换周期立即重新请求，不等 15s 轮询
      refreshSummary().catch(function (error) {
        warnLog('切换统计周期后拉取失败，图表保留上一次数据', error);
        ERP.ui.toast(error.message || '工作台数据加载失败', 'error');
      });
    });
  }

  try {
    await refreshSummary();
  } catch (error) {
    ERP.ui.toast(error.message || '工作台数据加载失败', 'error');
  }

  // 新增物料 / 入库 / 出库后自动刷新：定时 + 回到页面时刷新
  refreshTimer = window.setInterval(refreshDashboard, 15000);
  window.addEventListener('focus', refreshDashboard);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) refreshDashboard();
  });
  window.addEventListener('beforeunload', function () {
    if (refreshTimer) window.clearInterval(refreshTimer);
    if (chartWaitTimer) window.clearInterval(chartWaitTimer);
  });

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权访问该页面', 'warn');
  }

  // 调试 / 自动化测试用
  ERP.dashboardDebug = {
    PERIODS: PERIODS,
    refresh: refreshDashboard
  };
})();
