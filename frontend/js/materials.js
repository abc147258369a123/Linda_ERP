/**
 * 物料总览列表页（v1.5.0）
 * - 关键词搜索 + 物料状态 / 物料分类（一级大类）/ 封装大小（联动分类）/ 排序
 * - v1.5.0：搜索支持「精确匹配（整词）」/「模糊包含」两种模式，默认精确匹配
 * - 分类列显示完整分类路径；物料名称旁显示累计领用次数，便于核对领用排序结果
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
    status: 'all',            // all | available | empty | warn
    categoryId: 'all',        // 选中的一级大类，'all' 表示全部分类
    packageValue: '',         // 选中的封装，'' 表示全部封装
    sort: 'inbound',          // inbound | qtyAsc | qtyDesc | borrowDesc | borrowAsc
    match: 'exact',           // v1.5.0：exact 精确匹配（默认）| contains 模糊包含
    page: 0,
    pageSize: 12,
    // 分类管理页跳转到子分类时：分类下拉选中的是其一级大类，这里记录子分类做精确过滤
    pinnedCategoryId: null
  };
  var filtered = [];

  var stats = ERP.store.stats();
  // v1.4.0：分类下拉只列一级大类（tree roots），数量显示含子级合计的 totalCount
  var categoryRoots = ERP.store.categoryTree();

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

  // 分类下拉：只列一级大类，括号内为「本级 + 全部子孙分类」的物料合计
  var categoryOptions = '<option value="all">全部分类</option>' + categoryRoots.map(function (root) {
    return '<option value="' + esc(root.id) + '">' + esc(root.name) +
      '（' + Number(root.totalCount || 0) + '）</option>';
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
          '<div class="card-sub">支持按名称 / 型号 / 规格 / 嘉立创编号 / 品牌 / 存放位置 / 来源项目搜索</div>' +
        '</div>' +
        '<div class="legend">' +
          '<span class="tag tag-simple">简易模式</span><span>只记有货 / 空</span>' +
          '<span class="tag tag-precise">精确计数</span><span>记录数量</span>' +
        '</div>' +
      '</div>' +
      '<div class="filter-bar">' +
        '<input class="input input-search" id="searchInput" type="search" ' +
          'placeholder="精确匹配：输入 1K 只匹配 1K 电阻" autocomplete="off">' +
        // v1.5.0：搜索模式切换（默认精确匹配；两种模式共用同一关键词与其它筛选）
        '<div class="search-mode" id="searchMode" role="group" aria-label="搜索匹配模式">' +
          '<button class="search-mode-btn' + (state.match === 'exact' ? ' is-active' : '') + '" ' +
            'type="button" data-match="exact" aria-pressed="' + (state.match === 'exact') + '" ' +
            'title="精确匹配：关键词需与字段某个整词完全相同">精确匹配</button>' +
          '<button class="search-mode-btn' + (state.match === 'contains' ? ' is-active' : '') + '" ' +
            'type="button" data-match="contains" aria-pressed="' + (state.match === 'contains') + '" ' +
            'title="模糊包含：字段中包含关键词即命中">模糊包含</button>' +
        '</div>' +
        '<select class="select" id="filterStatus" aria-label="物料状态">' +
          '<option value="all">全部状态</option>' +
          '<option value="available">有货</option>' +
          '<option value="empty">无货</option>' +
          '<option value="warn">低库存预警</option>' +
        '</select>' +
        '<select class="select" id="filterCategory" aria-label="物料分类">' + categoryOptions + '</select>' +
        '<select class="select" id="filterPackage" aria-label="封装大小">' +
          '<option value="">全部封装</option>' +
        '</select>' +
        '<select class="select" id="filterSort" aria-label="排序方式">' +
          '<option value="inbound">入库时间</option>' +
          '<option value="qtyAsc">库存最少</option>' +
          '<option value="qtyDesc">库存最多</option>' +
          '<option value="borrowDesc">领用最多</option>' +
          '<option value="borrowAsc">领用最少</option>' +
        '</select>' +
        '<button class="btn btn-sm" type="button" id="resetBtn">重置</button>' +
        '<span class="filter-spacer"></span>' +
        '<span class="filter-count" id="resultCount"></span>' +
      '</div>' +
      // 子分类精确过滤提示（URL 带 categoryId 且为子分类时显示）
      '<div class="filter-pin" id="filterPin" hidden ' +
        'style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:8px 18px;' +
        'border-bottom:1px solid var(--border);background:var(--brand-weak);' +
        'font-size:12.5px;color:var(--text-2)">' +
        '<span class="tag tag-brand">子分类</span>' +
        '<span id="filterPinText"></span>' +
        '<button class="btn-link" type="button" id="clearPinBtn">查看该大类全部物料</button>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>物料</th>' +
            '<th>分类路径</th>' +
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
  var searchMode = $('#searchMode');
  var filterStatus = $('#filterStatus');
  var filterCategory = $('#filterCategory');
  var filterPackage = $('#filterPackage');
  var filterSort = $('#filterSort');
  var filterPin = $('#filterPin');
  var filterPinText = $('#filterPinText');
  var tbody = $('#materialBody');
  var listFoot = $('#listFoot');
  var resultCount = $('#resultCount');

  /* ---------------- v1.5.0：搜索匹配模式（精确 / 模糊） ---------------- */

  var MATCH_MODES = {
    exact: {
      label: '精确匹配',
      placeholder: '精确匹配：输入 1K / 嘉立创编号只匹配对应物料'
    },
    contains: {
      label: '模糊包含',
      placeholder: '模糊包含：匹配名称、型号、规格、嘉立创编号中含关键词的物料'
    }
  };

  function matchLabel() {
    return (MATCH_MODES[state.match] || MATCH_MODES.exact).label;
  }

  /** 同步分段按钮选中态（class + aria-pressed）与搜索框提示文案 */
  function syncSearchMode() {
    if (searchMode) {
      Array.prototype.forEach.call(searchMode.querySelectorAll('[data-match]'), function (btn) {
        var active = btn.getAttribute('data-match') === state.match;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    if (searchInput) {
      searchInput.placeholder = (MATCH_MODES[state.match] || MATCH_MODES.exact).placeholder;
    }
  }

  /** 切换匹配模式：保留当前关键词与其它筛选，回到第一页重新渲染 */
  function setMatchMode(mode) {
    state.match = mode === 'contains' ? 'contains' : 'exact';
    state.page = 0;
    readFilters(); // 把输入框里尚未触发 debounce 的关键词一并带上
    syncSearchMode();
    render();
  }

  /* ---------------- 分类 / 封装辅助（v1.4.0） ---------------- */

  function findCategoryById(categoryId) {
    var found = null;
    ERP.store.categories().forEach(function (category) {
      if (String(category.id) === String(categoryId)) found = category;
    });
    return found;
  }

  /** 取某个分类所属的一级大类 id（基于扁平分类的 parentId 逐级向上回溯） */
  function rootIdOfCategory(category) {
    var byId = {};
    ERP.store.categories().forEach(function (item) { byId[String(item.id)] = item; });
    var node = category;
    var guard = 0;
    while (node && guard < 32) {
      var parentId = node.parentId;
      if (parentId === null || parentId === undefined) return node.id;
      var parent = byId[String(parentId)];
      if (!parent || parent === node) return null;
      node = parent;
      guard += 1;
    }
    return null;
  }

  /** 分类自身 + 全部子孙分类的 id 列表（大类筛选要包含子分类下的物料） */
  function subtreeIds(categoryId) {
    var all = ERP.store.categories();
    var ids = [];
    var pending = [String(categoryId)];
    while (pending.length) {
      var current = pending.shift();
      if (ids.indexOf(current) >= 0) continue;
      ids.push(current);
      all.forEach(function (category) {
        if (category.parentId === null || category.parentId === undefined) return;
        if (String(category.parentId) !== current) return;
        if (ids.indexOf(String(category.id)) < 0) pending.push(String(category.id));
      });
    }
    return ids;
  }

  /** 分类下拉视角的筛选范围：选中大类 + 全部子孙分类；全部分类返回 null */
  function dropdownCategoryIds() {
    if (state.categoryId !== 'all') return subtreeIds(state.categoryId);
    return null;
  }

  /** 物料实际过滤范围：URL 带入的子分类精确过滤优先，其次分类下拉选中的大类 */
  function scopeCategoryIds() {
    if (state.pinnedCategoryId !== null) return subtreeIds(state.pinnedCategoryId);
    return dropdownCategoryIds();
  }

  /** 封装自然排序：字符串含数字时按数字比较（0402 < 0603 < 0805） */
  function naturalCompare(a, b) {
    var ax = String(a).match(/(\d+|\D+)/g) || [];
    var bx = String(b).match(/(\d+|\D+)/g) || [];
    var len = Math.min(ax.length, bx.length);
    for (var i = 0; i < len; i += 1) {
      var aIsNum = /^\d+$/.test(ax[i]);
      var bIsNum = /^\d+$/.test(bx[i]);
      if (aIsNum && bIsNum) {
        var diff = Number(ax[i]) - Number(bx[i]);
        if (diff !== 0) return diff;
        // 数值相同（如 0603 与 603）时短写法在前，保证排序稳定
        if (ax[i].length !== bx[i].length) return ax[i].length - bx[i].length;
      } else if (aIsNum !== bIsNum) {
        return aIsNum ? -1 : 1;
      } else {
        var textDiff = ax[i].toLowerCase().localeCompare(bx[i].toLowerCase());
        if (textDiff !== 0) return textDiff;
      }
    }
    if (ax.length !== bx.length) return ax.length - bx.length;
    return String(a).localeCompare(String(b));
  }

  /** 分类下拉范围内出现过的封装（去重 + 自然排序） */
  function packageValues() {
    var scoped = ERP.store.listMaterials({ categoryIds: dropdownCategoryIds() });
    var seen = {};
    var values = [];
    scoped.forEach(function (material) {
      var value = String(material.package || '').trim();
      if (!value || seen[value]) return;
      seen[value] = true;
      values.push(value);
    });
    values.sort(naturalCompare);
    return values;
  }

  /** 重建封装下拉选项：分类切换后旧封装不在新列表里时自动回到「全部封装」 */
  function refreshPackageOptions() {
    if (!filterPackage) return;
    var values = packageValues();
    var keep = state.packageValue && values.indexOf(state.packageValue) >= 0 ? state.packageValue : '';
    var html = '<option value="">全部封装</option>';
    values.forEach(function (value) {
      html += '<option value="' + esc(value) + '">' + esc(value) + '</option>';
    });
    filterPackage.innerHTML = html;
    filterPackage.value = keep;
    state.packageValue = keep;
  }

  /** 分类下拉取值与 state 对齐（URL 带入的分类可能已不存在） */
  function syncCategorySelect() {
    var exists = categoryRoots.some(function (root) {
      return String(root.id) === String(state.categoryId);
    });
    state.categoryId = exists ? String(state.categoryId) : 'all';
    filterCategory.value = state.categoryId;
  }

  /** 子分类精确过滤提示条 */
  function renderFilterPin() {
    if (!filterPin || !filterPinText) return;
    if (state.pinnedCategoryId === null) {
      filterPin.hidden = true;
      filterPinText.textContent = '';
      return;
    }
    var path = ERP.store.categoryPath(state.pinnedCategoryId) ||
      ERP.store.categoryName(state.pinnedCategoryId) || '未知分类';
    filterPinText.textContent = '已按子分类精确过滤：' + path + '（分类下拉显示其所属一级大类）';
    filterPin.hidden = false;
  }

  /* ---------------- 初始条件（URL 参数） ---------------- */

  // 顶栏全局搜索跳转：index.html?q=关键词
  // v1.5.0：带关键词进入时默认「精确匹配」模式（state.match 初值即 exact）
  var initialQuery = ERP.ui.getParam('q');
  if (initialQuery) {
    state.q = initialQuery;
    state.match = 'exact';
    searchInput.value = initialQuery;
  }
  // 分类管理页跳转：index.html?categoryId=ID
  // - 一级分类：直接选中该大类
  // - 子分类：选中其所属一级大类，并保留子分类作为精确过滤（结果提示条会说明）
  var initialCategory = ERP.ui.getParam('categoryId');
  if (initialCategory) {
    var initialNode = findCategoryById(initialCategory);
    if (initialNode) {
      if (initialNode.parentId === null || initialNode.parentId === undefined) {
        state.categoryId = String(initialNode.id);
      } else {
        var initialRootId = rootIdOfCategory(initialNode);
        if (initialRootId !== null) {
          state.categoryId = String(initialRootId);
          state.pinnedCategoryId = String(initialNode.id);
        }
      }
    }
  }
  syncCategorySelect();
  filterSort.value = state.sort;
  refreshPackageOptions();
  syncSearchMode();

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

  /** 完整分类路径（一级 / 二级 / 三级），路径为空时回退单级分类名 */
  function categoryPathHtml(categoryId) {
    var path = ERP.store.categoryPath(categoryId);
    if (!path) {
      return '<span class="cell-text">' + esc(ERP.store.categoryName(categoryId) || '—') + '</span>';
    }
    var parts = path.split(' / ');
    var nodes = parts.map(function (part, index) {
      var isLeaf = index === parts.length - 1;
      return '<span class="path-node' + (isLeaf ? ' is-leaf' : '') + '">' + esc(part) + '</span>';
    }).join(' / ');
    return '<div class="cell-path" title="' + esc(path) + '">' + nodes + '</div>';
  }

  /** 领用次数小标签：让「领用最多 / 最少」的排序结果可以直接核对 */
  function borrowBadge(material) {
    var count = Number(material.borrowCount) || 0;
    return '<span class="mat-borrow' + (count > 0 ? '' : ' is-zero') +
      '" title="累计领用次数">领用 ' + count + ' 次</span>';
  }

  function rowHtml(material) {
    var subParts = [material.package, material.brand].filter(Boolean);
    return '<tr data-id="' + esc(material.id) + '">' +
      '<td>' +
        '<div class="mat-cell">' +
          (function () {
            var image = ERP.ui.firstImage(material.image);
            if (!image) {
              return '<span class="mat-thumb is-empty" title="暂无图片">' + ERP.icon('image', 16) + '</span>';
            }
            return '<button class="mat-thumb" type="button" title="查看大图" ' +
              'data-preview-image="' + esc(ERP.ui.imageUrl(image)) + '" ' +
              'data-preview-title="' + esc(material.name) + '">' +
              '<img src="' + esc(ERP.ui.imageUrl(image)) + '" alt="" loading="lazy">' +
            '</button>';
          })() +
          '<div>' +
            '<div class="mat-name">' +
              '<a href="' + esc(detailHref(material.id)) + '">' + esc(material.name) + '</a>' +
              borrowBadge(material) +
            '</div>' +
            '<div class="mat-model">' +
              '<a href="' + esc(detailHref(material.id)) + '">' + esc(material.model || '—') + '</a>' +
            '</div>' +
            '<div class="mat-sub">' + esc(subParts.join(' · ') || '—') + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + categoryPathHtml(material.categoryId) + '</td>' +
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
    // 空结果时按当前模式给出可操作的提示（仅在有关键词时区分，避免文案冗余）
    var emptyDesc = state.q && state.match === 'exact'
      ? '精确匹配要求关键词与某个字段的整词完全相同；可缩短关键词，或切换到「模糊包含」再试。'
      : '换个关键词，或调整筛选条件；当前筛选无结果时也可以清空条件重新查看。';
    return '<tr><td colspan="8">' +
      '<div class="empty">' +
        ERP.icon('search', 40) +
        '<div class="empty-title">没有找到匹配的物料</div>' +
        '<div class="empty-desc">' + emptyDesc + '</div>' +
        '<div style="margin-top:14px"><button class="btn btn-sm" type="button" id="emptyResetBtn">清空筛选</button></div>' +
      '</div>' +
    '</td></tr>';
  }

  function filtersActive() {
    return Boolean(state.q) || state.status !== 'all' ||
      state.categoryId !== 'all' || Boolean(state.packageValue) ||
      state.sort !== 'inbound' || state.pinnedCategoryId !== null;
  }

  /** 统一的筛选 / 排序参数：列表渲染与导出共用，保证导出内容与当前条件一致 */
  function currentQuery() {
    return {
      q: state.q,
      // v1.5.0：搜索模式同样进入统一查询参数，导出严格跟随当前模式
      match: state.match,
      status: state.status,
      categoryIds: scopeCategoryIds(),
      package: state.packageValue,
      sort: state.sort
    };
  }

  function render() {
    filtered = ERP.store.listMaterials(currentQuery());

    var total = filtered.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.page > pages - 1) state.page = pages - 1;
    var start = state.page * state.pageSize;
    var rows = filtered.slice(start, start + state.pageSize);

    tbody.innerHTML = rows.length ? rows.map(rowHtml).join('') : emptyRowHtml();

    resultCount.textContent = (filtersActive()
      ? '筛选结果 ' + total + ' 条'
      : '共 ' + total + ' 条档案') + (state.q ? '（' + matchLabel() + '）' : '');

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
        (state.q ? ' · ' + matchLabel() : '') +
        ' · 第 ' + (state.page + 1) + ' / ' + pages + ' 页</span>' + pager;

    renderFilterPin();
  }

  function readFilters() {
    state.q = searchInput.value.trim();
    state.status = filterStatus.value;
    state.categoryId = filterCategory.value;
    state.packageValue = filterPackage.value;
    state.sort = filterSort.value;
  }

  function resetFilters() {
    searchInput.value = '';
    filterStatus.value = 'all';
    filterCategory.value = 'all';
    filterSort.value = 'inbound';
    state.q = '';
    state.status = 'all';
    state.categoryId = 'all';
    state.packageValue = '';
    state.sort = 'inbound';
    // v1.5.0：重置恢复默认搜索模式（精确匹配）
    state.match = 'exact';
    state.pinnedCategoryId = null;
    state.page = 0;
    refreshPackageOptions();
    syncSearchMode();
    render();
  }

  /* ---------------- 事件 ---------------- */

  searchInput.addEventListener('input', ERP.ui.debounce(function () {
    readFilters();
    state.page = 0;
    render();
  }, 200));

  // 搜索模式切换：只改匹配规则，关键词与其它筛选保持不动
  if (searchMode) {
    searchMode.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-match]');
      if (!btn) return;
      var mode = btn.getAttribute('data-match');
      if (mode !== 'exact' && mode !== 'contains') return;
      if (mode === state.match) return;
      setMatchMode(mode);
    });
  }

  [filterStatus, filterPackage, filterSort].forEach(function (select) {
    select.addEventListener('change', function () {
      readFilters();
      state.page = 0;
      render();
    });
  });

  // 分类联动：切换大类时重算封装可选项，并把封装重置为「全部封装」
  filterCategory.addEventListener('change', function () {
    readFilters();
    state.pinnedCategoryId = null;
    state.packageValue = '';
    filterPackage.value = '';
    state.page = 0;
    refreshPackageOptions();
    render();
  });

  // 提示条：清除子分类精确过滤，只看该大类全部物料
  if (filterPin) {
    filterPin.addEventListener('click', function (event) {
      if (!event.target.closest('#clearPinBtn')) return;
      state.pinnedCategoryId = null;
      state.page = 0;
      render();
    });
  }

  $('#resetBtn').addEventListener('click', resetFilters);

  if (isAdmin) {
    var exportBtn = $('#exportBtn');
    if (exportBtn) {
      exportBtn.addEventListener('click', function () {
        var list = ERP.store.listMaterials(currentQuery());
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
            Number(material.borrowCount) || 0,
            statusText,
            [material.cabinet, material.slot].filter(Boolean).join(' '),
            ERP.store.categoryPath(material.categoryId) ||
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
          { title: '领用次数', width: 10 },
          { title: '状态', width: 15 },
          { title: '存放位置', width: 18 },
          { title: '分类路径', width: 22 },
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
    var previewBtn = event.target.closest('[data-preview-image]');
    if (previewBtn) {
      event.preventDefault();
      event.stopPropagation();
      ERP.ui.previewImage(previewBtn.getAttribute('data-preview-image'), previewBtn.getAttribute('data-preview-title'));
      return;
    }
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
