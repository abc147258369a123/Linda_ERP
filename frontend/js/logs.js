/**
 * 领用日志页
 * - 全员可查看全部领用 / 补货 / 标记为空流水（永久保留）
 * - 支持关键词、操作类型、物料分类、日期范围筛选与分页
 * - 管理员可导出当前筛选结果为 Excel
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;
  var isAdmin = ERP.auth.isAdmin(session);

  var view = ERP.layout.mount({ active: 'logs', title: '领用日志' });
  if (!view) return;
  var page = view.content;

  await ERP.store.load();

  var ACTION_TONE = { borrow: 'tag-brand', restock: 'tag-ok', empty: 'tag-empty' };
  var ACTION_LABEL = ERP.config.actionLabels || {};
  var categories = ERP.store.categories();

  var state = {
    q: '',
    action: 'all',
    categoryId: 'all',
    from: '',
    to: '',
    page: 0,
    pageSize: 15
  };
  var filtered = [];

  function materialOf(log) {
    return ERP.store.getMaterial(log.materialId);
  }
  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }
  function qtyText(log) {
    if (log.qty == null) return '—';
    if (log.action === 'restock') return '+' + log.qty + ' 件';
    if (log.mode === 'simple') return '—';
    return log.qty + ' 件';
  }

  /* ---------------- 页面骨架 ---------------- */

  var categoryOptions = '<option value="all">全部分类</option>' + categories.map(function (category) {
    return '<option value="' + esc(category.id) + '">' + esc(category.name) + '</option>';
  }).join('');

  var exportAction = isAdmin
    ? '<button class="btn" type="button" id="exportLogsBtn">' + ERP.icon('download', 15) + '导出 Excel</button>'
    : '';

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">领用日志</h1>' +
        '<p class="page-desc">全部领用、补货与标记为空流水，日志只追加不修改、永久保留。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        exportAction +
        '<a class="btn btn-primary" href="' + esc(ERP.url('pages/borrow.html')) + '">' +
          ERP.icon('out', 15) + '领用登记</a>' +
      '</div>' +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">全部流水</div>' +
        '<div class="stat-value" data-stat="total">0</div>' +
        '<div class="stat-sub">领用 + 补货 + 标记为空</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">领用记录</div>' +
        '<div class="stat-value is-ok" data-stat="borrow">0</div>' +
        '<div class="stat-sub">同学拿走物料的登记</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">补货入库</div>' +
        '<div class="stat-value" data-stat="restock">0</div>' +
        '<div class="stat-sub">管理员补货操作</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">标记为空</div>' +
        '<div class="stat-value is-warn" data-stat="empty">0</div>' +
        '<div class="stat-sub">库存清零，档案保留</div>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">流水列表</div>' +
          '<div class="card-sub">支持按记录号、物料、领用人、项目、经办人、备注搜索</div>' +
        '</div>' +
        '<div class="legend">' +
          '<span class="tag tag-brand">领用</span>' +
          '<span class="tag tag-ok">补货</span>' +
          '<span class="tag tag-empty">标记为空</span>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<input class="input input-search" id="logSearch" type="search" ' +
          'placeholder="搜索记录号、物料、领用人、项目、经办人…" autocomplete="off">' +
        '<select class="select" id="logAction" aria-label="操作类型">' +
          '<option value="all">全部类型</option>' +
          '<option value="borrow">领用</option>' +
          '<option value="restock">补货</option>' +
          '<option value="empty">标记为空</option>' +
        '</select>' +
        '<select class="select" id="logCategory" aria-label="物料分类">' + categoryOptions + '</select>' +
        '<input class="input input-mono" id="logFrom" type="date" aria-label="开始日期" style="width: 140px;">' +
        '<input class="input input-mono" id="logTo" type="date" aria-label="结束日期" style="width: 140px;">' +
        '<button class="btn btn-sm" type="button" id="resetLogsBtn">重置</button>' +
        '<span class="filter-spacer"></span>' +
        '<span class="filter-count" id="logCount"></span>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>记录号</th>' +
            '<th>物料</th>' +
            '<th>类型</th>' +
            '<th>领用人</th>' +
            '<th>所属项目</th>' +
            '<th class="col-num">数量</th>' +
            '<th>领用 / 入库时间</th>' +
            '<th>经办人</th>' +
            '<th>备注</th>' +
          '</tr></thead>' +
          '<tbody id="logBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="list-foot" id="logFoot"></div>' +
    '</div>';

  /* ---------------- 筛选与渲染 ---------------- */

  var searchInput = $('#logSearch');
  var actionSelect = $('#logAction');
  var categorySelect = $('#logCategory');
  var fromInput = $('#logFrom');
  var toInput = $('#logTo');
  var tbody = $('#logBody');
  var foot = $('#logFoot');
  var countEl = $('#logCount');

  function readFilters() {
    state.q = String(searchInput.value || '').trim();
    state.action = actionSelect.value;
    state.categoryId = categorySelect.value;
    state.from = fromInput.value || '';
    state.to = toInput.value || '';
  }

  function matches(log) {
    if (state.action !== 'all' && log.action !== state.action) return false;

    var material = materialOf(log);
    if (state.categoryId !== 'all') {
      if (!material || String(material.categoryId) !== String(state.categoryId)) return false;
    }

    var date = String(log.borrowAt || '').slice(0, 10);
    if (state.from && date && date < state.from) return false;
    if (state.to && date && date > state.to) return false;

    if (state.q) {
      var keyword = state.q.toLowerCase();
      var fields = [log.id, log.materialId, log.materialName, log.borrower,
        log.project, log.operator, log.note, material ? material.model : ''];
      return fields.some(function (field) {
        return field && String(field).toLowerCase().indexOf(keyword) >= 0;
      });
    }
    return true;
  }

  function filtersActive() {
    return Boolean(state.q) || state.action !== 'all' || state.categoryId !== 'all' ||
      Boolean(state.from) || Boolean(state.to);
  }

  function rowHtml(log) {
    var material = materialOf(log);
    var actionLabel = ACTION_LABEL[log.action] || log.action;
    var tone = ACTION_TONE[log.action] || 'tag-simple';
    var model = material ? (material.model || '') : '';
    return '<tr>' +
      '<td><span class="cell-mono">' + esc(log.id) + '</span></td>' +
      '<td>' +
        '<div class="mat-name"><a href="' + esc(detailHref(log.materialId)) + '">' +
          esc(log.materialName) + '</a></div>' +
        (model ? '<div class="mat-sub">' + esc(model) + '</div>' : '') +
      '</td>' +
      '<td><span class="tag ' + tone + ' tag-dot">' + esc(actionLabel) + '</span></td>' +
      '<td>' + esc(log.borrower || '—') + '</td>' +
      '<td>' + esc(log.project || '—') + '</td>' +
      '<td class="col-num"><span class="cell-mono">' + esc(qtyText(log)) + '</span></td>' +
      '<td><span class="cell-mono">' + esc(ERP.ui.fmtDateTime(log.borrowAt)) + '</span></td>' +
      '<td>' + esc(log.operator || '—') + '</td>' +
      '<td>' +
        (log.note
          ? '<span class="log-note" title="' + esc(log.note) + '">' + esc(log.note) + '</span>'
          : '<span class="dim">—</span>') +
      '</td>' +
    '</tr>';
  }

  function emptyRowHtml() {
    return '<tr><td colspan="9">' +
      '<div class="empty">' +
        ERP.icon('list', 40) +
        '<div class="empty-title">没有找到匹配的流水</div>' +
        '<div class="empty-desc">换个关键词，或调整类型 / 分类 / 日期范围后再试。</div>' +
        '<div style="margin-top:14px">' +
          '<button class="btn btn-sm" type="button" id="emptyResetLogsBtn">清空筛选</button>' +
        '</div>' +
      '</div>' +
    '</td></tr>';
  }

  function render() {
    readFilters();
    filtered = ERP.store.logs().filter(matches);
    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages - 1) state.page = pages - 1;
    var start = state.page * state.pageSize;
    var rows = filtered.slice(start, start + state.pageSize);

    tbody.innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyRowHtml();
    countEl.textContent = filtersActive() ? '筛选结果 ' + total + ' 条' : '共 ' + total + ' 条流水';

    var pager =
      '<div class="pager">' +
        '<button class="btn btn-sm" type="button" data-page="' + (state.page - 1) + '"' +
          (state.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
        '<button class="btn btn-sm" type="button" data-page="' + (state.page + 1) + '"' +
          (state.page >= pages - 1 ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    foot.innerHTML =
      '<span>共 <strong>' + total + '</strong> 条' +
        (filtersActive() ? ' · 已按条件筛选' : '') +
        ' · 第 ' + (state.page + 1) + ' / ' + pages + ' 页</span>' + pager;
  }

  function renderStats() {
    var all = ERP.store.logs();
    var counts = { total: all.length, borrow: 0, restock: 0, empty: 0 };
    all.forEach(function (log) {
      if (counts[log.action] != null) counts[log.action]++;
    });
    ['total', 'borrow', 'restock', 'empty'].forEach(function (key) {
      var el = page.querySelector('[data-stat="' + key + '"]');
      if (el) el.textContent = counts[key];
    });
  }

  function resetFilters() {
    searchInput.value = '';
    actionSelect.value = 'all';
    categorySelect.value = 'all';
    fromInput.value = '';
    toInput.value = '';
    state.page = 0;
    render();
  }

  /* ---------------- 事件 ---------------- */

  searchInput.addEventListener('input', ERP.ui.debounce(function () {
    state.page = 0;
    render();
  }, 200));

  [actionSelect, categorySelect, fromInput, toInput].forEach(function (input) {
    input.addEventListener('change', function () {
      state.page = 0;
      render();
    });
  });

  $('#resetLogsBtn').addEventListener('click', resetFilters);

  foot.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page = parseInt(btn.getAttribute('data-page'), 10) || 0;
    render();
  });

  tbody.addEventListener('click', function (event) {
    if (event.target.closest('#emptyResetLogsBtn')) resetFilters();
  });

  /* ---------------- 导出 ---------------- */

  if (isAdmin) {
    var exportBtn = $('#exportLogsBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var list = ERP.store.logs().filter(matches);
        if (!list.length) {
          ERP.ui.toast('当前筛选结果为空，没有可导出的日志', 'warn');
          return;
        }
        var rows = list.map(function (log) {
          var material = materialOf(log);
          return [
            log.id,
            log.materialName,
            material ? material.model || '' : log.materialId,
            material ? ERP.store.categoryName(material.categoryId) : '',
            ACTION_LABEL[log.action] || log.action,
            log.borrower || '',
            log.project || '',
            qtyText(log),
            log.borrowAt || '',
            log.operator || '',
            log.note || '',
            log.createdAt || ''
          ];
        });
        var columns = [
          { title: '记录号', width: 11 },
          { title: '物料名称', width: 26 },
          { title: '料号/型号', width: 22 },
          { title: '物料分类', width: 14 },
          { title: '操作类型', width: 12 },
          { title: '领用人', width: 12 },
          { title: '所属项目', width: 20 },
          { title: '数量', width: 10 },
          { title: '领用/入库时间', width: 17 },
          { title: '经办人', width: 12 },
          { title: '备注', width: 26 },
          { title: '登记时间', width: 17 }
        ];
        ERP.xlsx.download(
          '领用日志_' + ERP.store.today().replace(/-/g, '') + '.xlsx',
          [{ name: '领用日志', columns: columns, rows: rows }]
        );
        ERP.ui.toast('已导出 ' + list.length + ' 条领用日志', 'ok');
      });
    }
  }

  renderStats();
  render();

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }
})();
