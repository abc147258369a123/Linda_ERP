/**
 * 物料总览列表页
 * - 关键词搜索 + 管理模式 / 状态 / 分类 / 排序 多条件筛选
 * - 简易模式显示「有货 / 空」，精确计数模式显示数量 + 状态
 * - 管理员：新增物料、导出 Excel、编辑入口；普通成员：仅查询 / 领用 / 详情
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;
  var isAdmin = ERP.auth.isAdmin(session);

  var view = ERP.layout.mount({ active: 'materials', title: '物料总览' });
  if (!view) return;

  await ERP.store.load();

  var state = {
    q: '',
    mode: 'all',
    status: 'all',
    categoryId: 'all',
    sort: 'updated',
    page: 0,
    pageSize: 12
  };
  var filtered = [];

  var stats = ERP.store.stats();
  var categories = ERP.store.categories();

  /* ---------------- 页面骨架 ---------------- */

  var adminActions = isAdmin
    ? '<button class="btn" type="button" id="exportBtn">' + ERP.icon('download', 15) + '导出 Excel</button>' +
      '<a class="btn btn-primary" href="' + esc(ERP.url('pages/material-new.html')) + '">' +
        ERP.icon('plus', 15) + '新增物料</a>'
    : '';

  var fourthCard = isAdmin
    ? '<div class="stat-card">' +
        '<div class="stat-label">低库存预警</div>' +
        '<div class="stat-value is-warn">' + stats.warn + '</div>' +
        '<div class="stat-sub">精确计数低于阈值 · <a href="' + esc(ERP.url('pages/alerts.html')) + '">查看预警</a></div>' +
      '</div>'
    : '<div class="stat-card">' +
        '<div class="stat-label">精确计数物料</div>' +
        '<div class="stat-value is-muted">' + stats.precise + '</div>' +
        '<div class="stat-sub">按数量管理，领用需填写数量</div>' +
      '</div>';

  var categoryOptions = '<option value="all">全部分类</option>' + categories.map(function (category) {
    return '<option value="' + esc(category.id) + '">' + esc(category.name) +
      '（' + category.count + '）</option>';
  }).join('');

  view.content.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">物料总览</h1>' +
        '<p class="page-desc">统一查看社团物料档案与库存状态，支持关键字与多条件筛选。</p>' +
      '</div>' +
      '<div class="page-head-actions">' + adminActions + '</div>' +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">物料档案</div>' +
        '<div class="stat-value">' + stats.total + '</div>' +
        '<div class="stat-sub">简易 ' + stats.simple + ' · 精确 ' + stats.precise + '</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">有货</div>' +
        '<div class="stat-value is-ok">' + stats.available + '</div>' +
        '<div class="stat-sub">当前可直接领用</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">空 / 待补货</div>' +
        '<div class="stat-value is-muted">' + stats.empty + '</div>' +
        '<div class="stat-sub">档案保留，补货后直接复用</div>' +
      '</div>' +
      fourthCard +
    '</div>' +

    '<div class="card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">物料列表</div>' +
          '<div class="card-sub">支持按名称 / 型号 / 规格 / 品牌 / 存放位置 / 来源项目搜索</div>' +
        '</div>' +
        '<div class="legend">' +
          '<span class="tag tag-simple">简易模式</span><span>只记有货 / 空</span>' +
          '<span class="tag tag-precise">精确计数</span><span>记录数量</span>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<input class="input input-search" id="searchInput" type="search" ' +
          'placeholder="搜索物料名称、型号、规格、品牌、存放位置…" autocomplete="off">' +
        '<select class="select" id="filterMode" aria-label="管理模式">' +
          '<option value="all">全部模式</option>' +
          '<option value="simple">简易模式</option>' +
          '<option value="precise">精确计数</option>' +
        '</select>' +
        '<select class="select" id="filterStatus" aria-label="库存状态">' +
          '<option value="all">全部状态</option>' +
          '<option value="available">有货</option>' +
          '<option value="empty">空</option>' +
        '</select>' +
        '<select class="select" id="filterCategory" aria-label="物料分类">' + categoryOptions + '</select>' +
        '<select class="select" id="filterSort" aria-label="排序方式">' +
          '<option value="updated">最近更新</option>' +
          '<option value="inbound">入库时间</option>' +
          '<option value="name">名称排序</option>' +
          '<option value="qty">库存从低到高</option>' +
          '<option value="warn">预警优先</option>' +
        '</select>' +
        '<button class="btn btn-sm" type="button" id="resetBtn">重置</button>' +
        '<span class="filter-spacer"></span>' +
        '<span class="filter-count" id="resultCount"></span>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>物料</th>' +
            '<th>分类</th>' +
            '<th>管理模式</th>' +
            '<th>库存 / 状态</th>' +
            '<th>存放位置</th>' +
            '<th>来源项目</th>' +
            '<th>入库时间</th>' +
            '<th class="col-actions">操作</th>' +
          '</tr></thead>' +
          '<tbody id="materialBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="list-foot" id="listFoot"></div>' +
    '</div>';

  /* ---------------- 渲染 ---------------- */

  var searchInput = $('#searchInput');
  // 顶栏全局搜索跳转：index.html?q=关键词
  var initialQuery = ERP.ui.getParam('q');
  if (initialQuery) {
    state.q = initialQuery;
    searchInput.value = initialQuery;
  }
  var filterMode = $('#filterMode');
  var filterStatus = $('#filterStatus');
  var filterCategory = $('#filterCategory');
  // 分类管理页跳转：index.html?categoryId=C-01
  var initialCategory = ERP.ui.getParam('categoryId');
  if (initialCategory) {
    var categoryExists = ERP.store.categories().some(function (category) {
      return String(category.id) === String(initialCategory);
    });
    if (categoryExists) {
      state.categoryId = initialCategory;
      filterCategory.value = initialCategory;
    }
  }
  var filterSort = $('#filterSort');
  var tbody = $('#materialBody');
  var listFoot = $('#listFoot');
  var resultCount = $('#resultCount');

  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }
  function borrowHref(id) {
    return ERP.url('pages/borrow.html?materialId=' + encodeURIComponent(id));
  }
  function editHref(id) {
    return ERP.url('pages/material-new.html?id=' + encodeURIComponent(id));
  }

  function stockCell(material) {
    if (material.mode === 'simple') {
      return '<div class="cell-stock">' + ERP.ui.tagStatus(material) + '</div>';
    }
    var qty = Number(material.qty) || 0;
    return '<div class="cell-stock">' +
      '<span class="qty' + (qty <= 0 ? ' is-zero' : '') + '">' + qty + '</span>' +
      '<span class="qty-unit">件</span>' +
      ERP.ui.tagStatus(material) +
      '</div>';
  }

  function actionsCell(material) {
    var html = '<a class="btn-link" href="' + esc(detailHref(material.id)) + '">详情</a>';
    if (material.status === 'available') {
      html += '<button class="btn-link" type="button" data-borrow-pick="' +
        esc(material.id) + '" title="选择数量后加入物料使用车">领用</button>';
    } else {
      html += '<span class="btn-link is-disabled" title="物料为空，补货后可领用">领用</span>';
    }
    if (isAdmin) {
      html += '<a class="btn-link" href="' + esc(editHref(material.id)) + '">编辑</a>';
    }
    return '<div class="row-actions">' + html + '</div>';
  }

  function rowHtml(material) {
    var category = ERP.store.categoryName(material.categoryId);
    var subParts = [material.package, material.brand].filter(Boolean);
    return '<tr data-id="' + esc(material.id) + '">' +
      '<td>' +
        '<div class="mat-cell">' +
          '<div>' +
            '<div class="mat-name">' +
              '<a href="' + esc(detailHref(material.id)) + '">' + esc(material.name) + '</a>' +
            '</div>' +
            '<div class="mat-model">' +
              '<a href="' + esc(detailHref(material.id)) + '">' + esc(material.model || '—') + '</a>' +
            '</div>' +
            '<div class="mat-sub">' + esc(subParts.join(' · ') || '—') + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td><span class="cell-text">' + esc(category || '—') + '</span></td>' +
      '<td>' + ERP.ui.tagMode(material.mode) + '</td>' +
      '<td>' + stockCell(material) + '</td>' +
      '<td>' +
        '<div class="cell-loc">' +
          '<div class="loc-main">' + esc(material.cabinet || '—') + '</div>' +
          '<div class="loc-sub">' + esc(material.slot || '') + '</div>' +
        '</div>' +
      '</td>' +
      '<td><span class="cell-text">' + esc(material.source || '—') + '</span></td>' +
      '<td><span class="cell-mono">' + esc(ERP.ui.fmtDate(material.inboundAt)) + '</span></td>' +
      '<td class="col-actions">' + actionsCell(material) + '</td>' +
    '</tr>';
  }

  function emptyRowHtml() {
    return '<tr><td colspan="8">' +
      '<div class="empty">' +
        ERP.icon('search', 40) +
        '<div class="empty-title">没有找到匹配的物料</div>' +
        '<div class="empty-desc">换个关键词，或调整筛选条件；当前筛选无结果时也可以清空条件重新查看。</div>' +
        '<div style="margin-top:14px"><button class="btn btn-sm" type="button" id="emptyResetBtn">清空筛选</button></div>' +
      '</div>' +
    '</td></tr>';
  }

  function filtersActive() {
    return Boolean(state.q) || state.mode !== 'all' || state.status !== 'all' ||
      state.categoryId !== 'all' || state.sort !== 'updated';
  }

  function render() {
    filtered = ERP.store.listMaterials({
      q: state.q,
      mode: state.mode,
      status: state.status,
      categoryId: state.categoryId,
      sort: state.sort
    });

    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages - 1) state.page = pages - 1;
    var start = state.page * state.pageSize;
    var rows = filtered.slice(start, start + state.pageSize);

    tbody.innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyRowHtml();

    resultCount.textContent = filtersActive()
      ? '筛选结果 ' + total + ' 条'
      : '共 ' + total + ' 条档案';

    var pager =
      '<div class="pager">' +
        '<button class="btn btn-sm" type="button" data-page="' + (state.page - 1) + '"' +
          (state.page <= 0 ? ' disabled' : '') + '>上一页</button>' +
        '<button class="btn btn-sm" type="button" data-page="' + (state.page + 1) + '"' +
          (state.page >= pages - 1 ? ' disabled' : '') + '>下一页</button>' +
      '</div>';

    listFoot.innerHTML =
      '<span>共 <strong>' + total + '</strong> 条' +
        (filtersActive() ? ' · 已按条件筛选' : '') +
        ' · 第 ' + (state.page + 1) + ' / ' + pages + ' 页</span>' + pager;
  }

  function readFilters() {
    state.q = searchInput.value.trim();
    state.mode = filterMode.value;
    state.status = filterStatus.value;
    state.categoryId = filterCategory.value;
    state.sort = filterSort.value;
  }

  function resetFilters() {
    searchInput.value = '';
    filterMode.value = 'all';
    filterStatus.value = 'all';
    filterCategory.value = 'all';
    filterSort.value = 'updated';
    state.q = '';
    state.mode = 'all';
    state.status = 'all';
    state.categoryId = 'all';
    state.sort = 'updated';
    state.page = 0;
    render();
  }

  /* ---------------- 事件 ---------------- */

  searchInput.addEventListener('input', ERP.ui.debounce(function () {
    readFilters();
    state.page = 0;
    render();
  }, 200));

  [filterMode, filterStatus, filterCategory, filterSort].forEach(function (select) {
    select.addEventListener('change', function () {
      readFilters();
      state.page = 0;
      render();
    });
  });

  $('#resetBtn').addEventListener('click', resetFilters);

  if (isAdmin) {
    var exportBtn = $('#exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var list = ERP.store.listMaterials({
          q: state.q,
          mode: state.mode,
          status: state.status,
          categoryId: state.categoryId,
          sort: state.sort
        });
        if (!list.length) {
          ERP.ui.toast('当前筛选结果为空，没有可导出的数据', 'warn');
          return;
        }
        var rows = list.map(function (material) {
          var statusText = material.status === 'empty'
            ? '空'
            : (ERP.store.isWarn(material) ? '有货（低库存）' : '有货');
          return [
            material.name,
            material.model || '',
            material.package || '',
            material.spec || '',
            material.brand || '',
            (ERP.config.modeLabels || {})[material.mode] || material.mode,
            material.mode === 'precise' ? Number(material.qty) || 0 : '',
            statusText,
            [material.cabinet, material.slot].filter(Boolean).join(' '),
            ERP.store.categoryName(material.categoryId),
            material.source || '',
            ERP.ui.fmtDate(material.inboundAt),
            material.mode === 'precise' ? Number(material.minQty) || 0 : '',
            material.note || '',
            material.id
          ];
        });
        var columns = [
          { title: '物料名称', width: 26 },
          { title: '料号/型号', width: 22 },
          { title: '封装', width: 15 },
          { title: '规格参数', width: 30 },
          { title: '品牌', width: 15 },
          { title: '管理模式', width: 12 },
          { title: '库存数量', width: 10 },
          { title: '状态', width: 15 },
          { title: '存放位置', width: 18 },
          { title: '物料分类', width: 14 },
          { title: '来源项目', width: 18 },
          { title: '入库时间', width: 13 },
          { title: '预警阈值', width: 10 },
          { title: '备注', width: 28 },
          { title: '档案编号', width: 11 }
        ];
        ERP.xlsx.download(
          '物料台账_' + ERP.store.today().replace(/-/g, '') + '.xlsx',
          [{ name: '物料台账', columns: columns, rows: rows }]
        );
        ERP.ui.toast('已导出 ' + list.length + ' 条物料', 'ok');
      });
    }
  }

  listFoot.addEventListener('click', function (event) {
    var btn = event.target.closest('[data-page]');
    if (!btn || btn.disabled) return;
    state.page = parseInt(btn.getAttribute('data-page'), 10) || 0;
    render();
    view.content.scrollIntoView({ block: 'start' });
  });

  tbody.addEventListener('click', function (event) {
    if (event.target.closest('#emptyResetBtn')) {
      resetFilters();
      return;
    }
    var pickBtn = event.target.closest('[data-borrow-pick]');
    if (pickBtn) {
      openBorrowPicker(pickBtn.getAttribute('data-borrow-pick'));
      return;
    }
    // 整行可点击：点击行内空白区域跳转详情；链接/按钮/输入框保持原有行为
    if (event.target.closest('a, button, input, select, textarea, label')) return;
    var row = event.target.closest('tr[data-id]');
    if (!row) return;
    var selected = window.getSelection ? String(window.getSelection()) : '';
    if (selected) return;
    window.location.href = detailHref(row.getAttribute('data-id'));
  });

  render();

  /* ---------------- 领用数量弹窗（加入物料使用车） ---------------- */

  function openBorrowPicker(materialId) {
    var material = ERP.store.getMaterial(materialId);
    if (!material) {
      ERP.ui.toast('物料不存在或已被移除', 'error');
      return;
    }
    if (material.status === 'empty') {
      ERP.ui.toast('物料为空，补货后才能领用', 'warn');
      return;
    }
    var isPrecise = material.mode === 'precise';
    var stock = isPrecise ? (Number(material.qty) || 0) : 99;
    var maxQty = isPrecise ? stock : 99;
    var qty = 1;

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal modal-borrow" role="dialog" aria-modal="true">' +
        '<div class="modal-hd">领用物料</div>' +
        '<div class="modal-bd borrow-pick-body">' +
          '<div class="borrow-pick-head">' +
            '<div class="borrow-pick-name">' + esc(material.name) + '</div>' +
            '<div class="borrow-pick-meta">' + esc(material.model || '—') +
              ' · 档案 ' + esc(material.id) + '</div>' +
            '<div class="borrow-pick-tags">' + ERP.ui.tagMode(material.mode) +
              ERP.ui.tagStatus(material) + '</div>' +
          '</div>' +
          '<div class="borrow-pick-stock">' +
            '<div class="borrow-pick-stock-item">' +
              '<span class="k">' + (isPrecise ? '当前库存' : '当前状态') + '</span>' +
              '<span class="v">' + (isPrecise ? stock + '<small>件</small>' : '有货') + '</span>' +
            '</div>' +
            '<div class="borrow-pick-stock-item">' +
              '<span class="k">' + (isPrecise ? '安全阈值' : '预警机制') + '</span>' +
              '<span class="v' + (isPrecise ? '' : ' is-text') + '">' +
                (isPrecise ? (Number(material.minQty) || 0) + '<small>件</small>' : '不参与') +
              '</span>' +
            '</div>' +
            '<div class="borrow-pick-stock-item">' +
              '<span class="k">管理模式</span>' +
              '<span class="v is-text">' + (isPrecise ? '精确计数' : '简易模式') + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="borrow-qty-block">' +
            '<div class="borrow-qty-head">' +
              '<span class="label">领用数量</span>' +
              '<span class="borrow-qty-limit">' +
                (isPrecise ? '库存上限 ' + stock + ' 件' : '单次上限 99') +
              '</span>' +
            '</div>' +
            '<div class="qty-picker">' +
              '<button class="qty-btn" type="button" data-step="-1" aria-label="减少数量">−</button>' +
              '<input class="input qty-input" id="borrowPickQty" type="number" min="1" max="' +
                maxQty + '" step="1" value="1" aria-label="领用数量">' +
              '<button class="qty-btn" type="button" data-step="1" aria-label="增加数量">+</button>' +
            '</div>' +
            '<span class="field-hint">' +
              (isPrecise
                ? '领用数量不能大于当前库存（' + stock + ' 件）'
                : '简易模式只登记日志，数量仅供参考') +
            '</span>' +
          '</div>' +
        '</div>' +
        '<div class="modal-ft">' +
          '<button class="btn" type="button" data-act="cancel">取消</button>' +
          '<button class="btn btn-primary" type="button" data-act="add">' +
            ERP.icon('out', 15) + '加入物料使用车</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    var input = mask.querySelector('#borrowPickQty');
    var minusBtn = mask.querySelector('[data-step="-1"]');
    var plusBtn = mask.querySelector('[data-step="1"]');

    function setQty(value) {
      qty = Math.min(maxQty, Math.max(1, Number(value) || 1));
      input.value = qty;
      minusBtn.disabled = qty <= 1;
      plusBtn.disabled = qty >= maxQty;
    }

    setQty(1);
    minusBtn.addEventListener('click', function () { setQty(qty - 1); });
    plusBtn.addEventListener('click', function () { setQty(qty + 1); });
    input.addEventListener('input', function () {
      input.value = input.value.replace(/[^\d]/g, '');
    });
    input.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setQty(qty + 1);
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        setQty(qty - 1);
      }
    });

    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }
    function addToCart() {
      var amount = Number(input.value);
      if (!amount || amount < 1 || Math.floor(amount) !== amount) {
        ERP.ui.toast('请输入正确的领用数量', 'error');
        return;
      }
      if (isPrecise && amount > stock) {
        ERP.ui.toast('领用数量不能大于当前库存（' + stock + ' 件）', 'error');
        return;
      }
      if (!isPrecise && amount > 99) {
        ERP.ui.toast('简易模式单次登记数量不超过 99', 'error');
        return;
      }
      if (!window.ERP.cart) {
        ERP.ui.toast('物料使用车组件未加载', 'error');
        return;
      }
      var result = ERP.cart.add(material.id, amount);
      if (!result.ok) {
        ERP.ui.toast(result.error || '加入物料使用车失败', 'error');
        return;
      }
      close();
      ERP.ui.toast(
        '已加入物料使用车：' + material.name + ' ×' + result.qty,
        'ok'
      );
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
      if (event.key === 'Enter' && event.target === input) {
        event.preventDefault();
        addToCart();
      }
    }

    mask.addEventListener('click', function (event) {
      if (event.target === mask) return close();
      var actionBtn = event.target.closest('[data-act]');
      if (!actionBtn) return;
      if (actionBtn.getAttribute('data-act') === 'add') addToCart();
      else close();
    });
    document.addEventListener('keydown', onKey);
    input.focus();
    if (input.select) input.select();
  }

  // 挂载悬浮使用车面板
  if (window.ERP.cart && ERP.cart.mountPanel) {
    ERP.cart.mountPanel();
  }

  // 批量提交后回到总览时的提示
  var borrowedCount = ERP.ui.getParam('borrowed');
  if (borrowedCount) {
    ERP.ui.toast('已批量提交 ' + borrowedCount + ' 条领用登记', 'ok');
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, '',
        window.location.pathname + window.location.hash);
    }
  }

  // 普通成员访问管理员页面被重定向回来时的提示
  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权访问该页面', 'warn');
  }
})();
