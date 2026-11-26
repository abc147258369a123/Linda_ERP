/**
 * 分类管理页（v1.3.0：树形多级分类；v1.5.0：选中末级分类加载物料列表；
 * v1.6.0：分类树头部「新建分类」按钮，按选中态决定建一级还是建子分类）
 * - 按 ERP.store.categoryTree() 递归渲染分类树，默认全部展开，可逐级折叠
 * - 每一级行右侧展示「物料总数」（total_count = 自身 + 所有后代分类的物料数）
 * - 超级管理员：新增一级分类 / 重命名 / 右键菜单（新建子分类、删除当前分类）
 * - 删除前本地校验：有子分类 → 请先删除子分类；分类下有物料 → 弹窗告知数量并禁止删除
 * - 非超级管理员：仅查看分类树，不出现任何写操作入口
 * - v1.5.0：点击分类名称选中该分类（Ctrl / Cmd + 点击仍在新窗口打开物料总览）；
 *   选中的是末级分类时，在分类表格下方加载该分类的物料列表（ERP.materialList，
 *   列 / 字段 / 操作与物料总览一致，带分页）；非末级分类只提示选择末级分类。
 * - v1.6.0：分类树卡片头部「新建分类」（仅超级管理员）：未选中分类 → 新建一级分类；
 *   已选中分类 → 在该分类下新建子分类。成功后刷新分类树、展开全部祖先并自动选中
 *   新建的分类（末级分类会在下方带出物料列表）。
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;
  var isSuper = ERP.auth.isSuper(session);

  var view = ERP.layout.mount({ active: 'categories', title: '分类管理' });
  if (!view) return;
  var page = view.content;

  // v1.5.0：选中态。selectedCategoryId 为当前选中分类（null 表示未选中）；
  // materialPage 记忆下方物料列表的页码，只在新选中分类时重置为 1
  var state = {
    selectedCategoryId: null,
    materialPage: 1
  };

  await ERP.store.load();

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">分类管理</h1>' +
        '<p class="page-desc">树形多级分类：每一级右侧实时展示该分类下的物料总数（含所有子分类）；' +
          '分类下仍有子分类或物料档案时不可删除。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        (isSuper
          ? '<button class="btn btn-primary" type="button" id="addCategoryBtn">' +
              ERP.icon('plus', 15) + '新增分类</button>'
          : '') +
        '<a class="btn" href="' + esc(ERP.url('index.html')) + '">' + ERP.icon('grid', 15) + '物料总览</a>' +
      '</div>' +
    '</div>' +

    (isSuper
      ? ''
      : '<div class="notice cat-permission-tip">' + ERP.icon('info', 16) +
          '<span>新增/编辑/删除分类仅超级管理员可操作，当前账号可查看分类树。</span></div>') +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">分类总数</div>' +
        '<div class="stat-value" data-cat-stat="total">0</div>' +
        '<div class="stat-sub">含所有层级分类</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">已使用</div>' +
        '<div class="stat-value is-ok" data-cat-stat="used">0</div>' +
        '<div class="stat-sub">自身或子分类下有物料</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">空分类</div>' +
        '<div class="stat-value is-muted" data-cat-stat="empty">0</div>' +
        '<div class="stat-sub">自身与子分类下都无物料</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">物料档案</div>' +
        '<div class="stat-value" data-cat-stat="materials">0</div>' +
        '<div class="stat-sub">各一级分类物料总数之和</div>' +
      '</div>' +
    '</div>' +

    '<div class="card cat-tree-card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">分类树</div>' +
          '<div class="card-sub">点击末级分类名称，在下方查看该分类的物料；点击左侧箭头展开 / 收起子分类' +
            (isSuper ? '；未选中分类时新建一级分类，选中分类后新建其子分类' : '') + '</div>' +
        '</div>' +
        // v1.6.0：右侧「新建分类」按钮（仅超级管理员渲染），与图例同一行
        '<div class="cat-tree-hd-side" ' +
          'style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;justify-content:flex-end;">' +
          '<div class="legend">' +
            '<span class="tag tag-warn">低库存</span>' +
            '<span class="tag tag-empty">空缺</span>' +
            '<span class="tag tag-brand">子分类</span>' +
          '</div>' +
          (isSuper
            ? '<button class="btn btn-sm btn-primary" type="button" id="addCategoryTreeBtn" ' +
                'title="当前未选中分类，将新建一级分类">' +
                ERP.icon('plus', 14) + '新建分类</button>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table cat-tree-table">' +
          '<thead><tr>' +
            '<th class="cat-col-name">分类名称</th>' +
            '<th class="col-num" title="该分类自身与所有子分类的物料数合计">物料总数</th>' +
            '<th class="col-num" title="仅统计直接挂在该分类下的物料">本级物料</th>' +
            '<th class="col-num">低库存</th>' +
            '<th class="col-num">空缺</th>' +
            '<th class="col-actions">操作</th>' +
          '</tr></thead>' +
          '<tbody id="catBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span id="catFootText"></span>' +
        '<span class="dim">' +
          (isSuper
            ? '右键分类行可新建子分类或删除当前分类'
            : '分类树由管理员维护，删除前需先清空子分类与物料档案') +
        '</span>' +
      '</div>' +
    '</div>' +

    // v1.5.0：选中末级分类后，在此加载该分类的物料列表（由 ERP.materialList 渲染）
    '<div id="catMaterialSection" class="section-gap"></div>';

  var tbody = $('#catBody');
  // v1.6.0：分类树卡片头部的「新建分类」按钮（非超级管理员时不存在该节点）
  var treeAddBtn = $('#addCategoryTreeBtn');

  // 折叠状态只存内存，刷新页面后恢复「全部展开」
  var collapsed = {};

  function keyOf(id) {
    return String(id);
  }

  function findCategory(id) {
    var found = null;
    ERP.store.categories().forEach(function (category) {
      if (String(category.id) === String(id)) found = category;
    });
    return found;
  }

  function categoryHref(categoryId) {
    return ERP.url('index.html?categoryId=' + encodeURIComponent(categoryId));
  }

  /* ---------------- 选中分类 + 下方物料列表（v1.5.0） ---------------- */

  var materialSection = $('#catMaterialSection');

  /** 在分类树里递归查找节点（找不到返回 null） */
  function findNode(nodes, categoryId) {
    var found = null;
    nodes.forEach(function (node) {
      if (found) return;
      if (String(node.id) === String(categoryId)) {
        found = node;
        return;
      }
      found = findNode(node.children || [], categoryId);
    });
    return found;
  }

  /** 末级分类判定：没有子分类（以 categoryTree() 为准，兼容 hasChildren 与扁平 parentId） */
  function isLeafCategory(categoryId) {
    var node = findNode(ERP.store.categoryTree(), categoryId);
    return node ? !(node.children && node.children.length) : false;
  }

  /** 该分类下的物料：按 updatedAt 倒序（最近更新的排在前面） */
  function materialsOfCategory(categoryId) {
    return ERP.store.materials().filter(function (material) {
      return String(material.categoryId) === String(categoryId);
    }).sort(function (a, b) {
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
  }

  /** 选中的分类已被删除（或数据刷新后不存在）时清除选中，避免下方列表残留 */
  function syncSelection() {
    if (state.selectedCategoryId === null) return;
    if (findCategory(state.selectedCategoryId)) return;
    state.selectedCategoryId = null;
    state.materialPage = 1;
  }

  /** 选中分类：切换分类时下方物料列表重置到第 1 页 */
  function selectCategory(categoryId) {
    var changed = state.selectedCategoryId === null ||
      String(state.selectedCategoryId) !== String(categoryId);
    state.selectedCategoryId = categoryId;
    if (changed) state.materialPage = 1;
    render();
  }

  /**
   * v1.6.0：把某分类的所有祖先逐级展开（只改折叠状态，不动选中态），
   * 保证新建 / 选中的节点在分类树里立即可见。基于扁平缓存的 parentId 向上回溯。
   */
  function expandAncestors(categoryId) {
    var byId = {};
    ERP.store.categories().forEach(function (category) {
      byId[String(category.id)] = category;
    });
    var current = byId[String(categoryId)];
    var guard = 0;
    while (current && guard < 32) {
      var parentId = current.parentId;
      if (parentId === null || parentId === undefined || String(parentId) === '') break;
      collapsed[keyOf(parentId)] = false;
      var parent = byId[String(parentId)];
      if (!parent || parent === current) break;
      current = parent;
      guard += 1;
    }
  }

  /** 渲染分类表格下方的「物料列表」区块：末级分类出列表，非末级只给提示 */
  function renderMaterialSection() {
    if (!materialSection) return;

    var selectedId = state.selectedCategoryId;
    var category = selectedId === null ? null : findCategory(selectedId);
    if (!category) {
      materialSection.hidden = true;
      materialSection.innerHTML = '';
      return;
    }

    materialSection.hidden = false;
    var path = ERP.store.categoryPath(selectedId) || category.name;

    // 非末级分类：不加载物料，提示先选择末级分类
    if (!isLeafCategory(selectedId)) {
      materialSection.innerHTML =
        '<div class="card cat-material-card">' +
          '<div class="cat-material-head">' +
            '<div class="cat-material-head-main">' +
              '<div class="cat-material-title">分类物料 · ' + esc(path) + '</div>' +
              '<div class="cat-material-sub">该分类下还有子分类，不直接挂物料</div>' +
            '</div>' +
          '</div>' +
          '<div class="empty">' +
            ERP.icon('tag', 40) +
            '<div class="empty-title">该分类包含子分类，请选择末级分类查看物料</div>' +
            '<div class="empty-desc">点击左侧箭头展开子分类，再点击没有子分类的分类名称，即可在下方查看该分类的物料列表。</div>' +
          '</div>' +
        '</div>';
      return;
    }

    if (!ERP.materialList || typeof ERP.materialList.render !== 'function') {
      materialSection.innerHTML =
        '<div class="card cat-material-card">' +
          '<div class="empty">' +
            '<div class="empty-title">物料列表组件未加载</div>' +
            '<div class="empty-desc">请检查 material-list.js 是否已在分类管理页正确引入。</div>' +
          '</div>' +
        '</div>';
      return;
    }

    // 物料列表组件按容器独立渲染：切换分类时传入新数据并重置到第 1 页
    var host = document.createElement('div');
    host.className = 'cat-material-host';
    materialSection.innerHTML = '';
    materialSection.appendChild(host);

    var info = ERP.materialList.render(host, {
      materials: materialsOfCategory(selectedId),
      categoryName: path,
      categoryId: selectedId,
      pageSize: 12,
      page: state.materialPage,
      onPageChange: function (page) {
        // 组件内部已重绘，这里只记住页码，下次重新渲染时保持在同一页
        state.materialPage = page;
      }
    });
    // 数据变少导致页码收敛时，把记忆的页码同步到真实页码
    if (info) state.materialPage = info.page;
  }

  /** 按折叠状态把树展开成待渲染的行数组 */
  function visibleNodes(nodes, out) {
    nodes.forEach(function (node) {
      out.push(node);
      if (node.children && node.children.length && !collapsed[keyOf(node.id)]) {
        visibleNodes(node.children, out);
      }
    });
    return out;
  }

  function treeDepth(nodes) {
    var depth = 0;
    nodes.forEach(function (node) {
      depth = Math.max(depth, 1 + treeDepth(node.children || []));
    });
    return depth;
  }

  function countBadgeHtml(node) {
    if (!node.children || !node.children.length) return '';
    return '<span class="cat-child-badge" title="包含 ' + node.children.length + ' 个直接子分类">' +
      node.children.length + ' 个子分类</span>';
  }

  function rowHtml(node) {
    var key = keyOf(node.id);
    var hasChildren = node.children && node.children.length > 0;
    var isOpen = hasChildren && !collapsed[key];
    var level = node.level || 1;
    var indent = 12 * (level - 1);
    // v1.5.0：当前选中的分类行高亮（样式见 category-materials.css）
    var isSelected = state.selectedCategoryId !== null &&
      String(state.selectedCategoryId) === String(node.id);

    return '<tr class="cat-row' + (level > 1 ? ' is-child' : '') +
        (isSelected ? ' is-selected' : '') + '"' +
        ' data-cat-row="' + esc(node.id) + '"' +
        ' data-level="' + level + '"' +
        ' data-cat-name="' + esc(node.name) + '">' +

      '<td class="cat-name-col">' +
        '<div class="cat-name-cell" data-level="' + level + '" style="padding-left:' + indent + 'px;">' +
          (hasChildren
            ? '<button class="cat-toggle' + (isOpen ? ' is-open' : '') + '" type="button" ' +
                'data-toggle-cat="' + esc(node.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" ' +
                'aria-label="' + (isOpen ? '收起子分类' : '展开子分类') + '" ' +
                'title="' + (isOpen ? '收起子分类' : '展开子分类') + '">' +
                ERP.icon('chevronRight', 13) +
              '</button>'
            : '<span class="cat-toggle-spacer" aria-hidden="true"></span>') +
          '<a class="cat-name-link" href="' + esc(categoryHref(node.id)) + '" ' +
            'title="' + (hasChildren
              ? '选中该分类；点击左侧箭头展开 / 收起子分类'
              : '在下方查看该分类的物料；Ctrl / ⌘ + 点击可在物料总览中打开') + '">' +
            esc(node.name) + '</a>' +
          countBadgeHtml(node) +
        '</div>' +
      '</td>' +

      '<td class="col-num">' +
        '<span class="cat-total' + (node.totalCount > 0 ? '' : ' is-zero') + '">' +
          node.totalCount + '</span><span class="cat-unit">个</span>' +
      '</td>' +

      '<td class="col-num">' +
        (node.count > 0
          ? '<span class="cat-count">' + node.count + '</span><span class="cat-unit">个</span>'
          : '<span class="dim">—</span>') +
      '</td>' +

      '<td class="col-num">' +
        (node.warnCount > 0
          ? '<span class="tag tag-warn">' + node.warnCount + ' 项</span>'
          : '<span class="dim">—</span>') +
      '</td>' +

      '<td class="col-num">' +
        (node.emptyCount > 0
          ? '<span class="tag tag-empty">' + node.emptyCount + ' 个</span>'
          : '<span class="dim">—</span>') +
      '</td>' +

      '<td class="col-actions">' +
        '<div class="row-actions">' +
          (isSuper
            ? '<button class="btn-link" type="button" data-rename="' + esc(node.id) + '">重命名</button>'
            : '<span class="dim">—</span>') +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  /**
   * v1.6.0：同步分类树「新建分类」按钮的 title / aria-label，
   * 鼠标悬停即可看出点击后是建一级分类还是建某分类的子分类。
   */
  function syncTreeAddButton() {
    if (!treeAddBtn) return;
    var category = state.selectedCategoryId === null ? null : findCategory(state.selectedCategoryId);
    var tip = category
      ? '在「' + category.name + '」下新建子分类'
      : '当前未选中分类，将新建一级分类';
    treeAddBtn.title = tip;
    treeAddBtn.setAttribute('aria-label', tip);
  }

  function render() {
    closeContextMenu();
    // 分类被删除 / 数据刷新后，先校正选中态（保留仍存在的选中项）
    syncSelection();
    // v1.6.0：选中态变化后刷新「新建分类」按钮的提示文案
    syncTreeAddButton();

    var categories = ERP.store.categories();
    var roots = ERP.store.categoryTree();
    var nodes = visibleNodes(roots, []);

    var used = categories.filter(function (category) { return category.totalCount > 0; }).length;
    var materialsTotal = roots.reduce(function (sum, node) { return sum + node.totalCount; }, 0);
    if (!roots.length) materialsTotal = ERP.store.stats().total;

    var stats = {
      total: categories.length,
      used: used,
      empty: categories.length - used,
      materials: materialsTotal
    };
    Object.keys(stats).forEach(function (key) {
      var el = page.querySelector('[data-cat-stat="' + key + '"]');
      if (el) el.textContent = stats[key];
    });

    tbody.innerHTML = nodes.length
      ? nodes.map(rowHtml).join('')
      : '<tr><td colspan="6">' +
          '<div class="empty" style="padding:40px 16px;">' +
            '<div class="empty-title">还没有物料分类</div>' +
            '<div class="empty-desc">' +
              (isSuper
                ? '点击右上角「新增分类」创建一级分类；创建后可在分类行上右键新建子分类。'
                : '请联系超级管理员创建分类。') +
            '</div>' +
          '</div>' +
        '</td></tr>';

    var footText = $('#catFootText');
    if (footText) {
      footText.textContent = '共 ' + categories.length + ' 个分类 · ' +
        roots.length + ' 个一级分类 · ' + used + ' 个已使用 · ' +
        (categories.length - used) + ' 个空分类 · 最深 ' + treeDepth(roots) + ' 级';
    }

    // 分类树重绘后同步刷新下方物料列表（保留当前选中项与页码）
    renderMaterialSection();
  }

  /* ---------------- 右键菜单（仅超级管理员） ---------------- */

  var menuEl = null;
  var menuRow = null;

  function onDocumentMouseDown(event) {
    if (menuEl && menuEl.contains(event.target)) return;
    closeContextMenu();
  }

  function onDocumentKeyDown(event) {
    if (event.key === 'Escape') closeContextMenu();
  }

  function closeContextMenu() {
    if (!menuEl) return;
    if (menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
    if (menuRow && menuRow.classList) menuRow.classList.remove('is-context');
    menuRow = null;
    document.removeEventListener('mousedown', onDocumentMouseDown, true);
    document.removeEventListener('keydown', onDocumentKeyDown, true);
    window.removeEventListener('scroll', closeContextMenu, true);
    window.removeEventListener('resize', closeContextMenu);
  }

  function openContextMenu(event, category, row) {
    closeContextMenu();

    var menu = document.createElement('div');
    menu.className = 'cat-context-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', '分类操作');
    menu.innerHTML =
      '<div class="cat-context-head">' +
        '<span class="cat-context-head-name" title="' + esc(category.name) + '">' +
          esc(category.name) + '</span>' +
        '<span class="cat-context-head-sub">' +
          (category.level > 1 ? '第 ' + category.level + ' 级' : '一级分类') + '</span>' +
      '</div>' +
      '<button type="button" class="cat-context-item" role="menuitem" data-menu-act="add-child">' +
        ERP.icon('plus', 15) + '<span>新建子分类</span>' +
      '</button>' +
      '<button type="button" class="cat-context-item is-danger" role="menuitem" data-menu-act="delete">' +
        ERP.icon('trash', 15) + '<span>删除当前分类</span>' +
      '</button>';
    document.body.appendChild(menu);

    // 菜单跟随鼠标，并保证不超出视口
    var gap = 8;
    var width = menu.offsetWidth;
    var height = menu.offsetHeight;
    var left = event.clientX;
    var top = event.clientY;
    if (left + width + gap > window.innerWidth) left = window.innerWidth - width - gap;
    if (top + height + gap > window.innerHeight) top = window.innerHeight - height - gap;
    if (left < gap) left = gap;
    if (top < gap) top = gap;
    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';

    menu.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    menu.addEventListener('click', function (e) {
      var item = e.target.closest('[data-menu-act]');
      if (!item) return;
      var action = item.getAttribute('data-menu-act');
      var id = category.id;
      closeContextMenu();
      if (action === 'add-child') addChildCategory(id);
      else if (action === 'delete') requestDeleteCategory(id);
    });

    menuEl = menu;
    menuRow = row || null;
    if (menuRow) menuRow.classList.add('is-context');

    document.addEventListener('mousedown', onDocumentMouseDown, true);
    document.addEventListener('keydown', onDocumentKeyDown, true);
    window.addEventListener('scroll', closeContextMenu, true);
    window.addEventListener('resize', closeContextMenu);
  }

  /* ---------------- 新增 / 重命名 / 删除 ---------------- */

  function addRootCategory() {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可新增分类', 'warn');
      return;
    }
    ERP.ui.prompt({
      title: '新增一级分类',
      label: '分类名称',
      placeholder: '如：电阻',
      hint: '将创建为一级分类（顶级），同一层级下名称不能重复',
      okText: '创建分类'
    }).then(async function (value) {
      if (value === null) return;
      var name = String(value || '').trim();
      if (!name) {
        ERP.ui.toast('分类名称不能为空', 'warn');
        return;
      }
      var result = await ERP.store.addCategory(name, null);
      if (!result.ok) {
        ERP.ui.toast(result.error || '新增分类失败', 'error');
        return;
      }
      ERP.ui.toast('分类「' + result.category.name + '」已创建', 'ok');
      render();
    });
  }

  function addChildCategory(parentId) {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可新建子分类', 'warn');
      return;
    }
    var parent = findCategory(parentId);
    if (!parent) {
      ERP.ui.toast('父分类不存在或已被删除', 'warn');
      return;
    }
    ERP.ui.prompt({
      title: '新建子分类',
      label: '分类名称',
      placeholder: '如：贴片电阻',
      hint: '将添加到「' + parent.name + '」下',
      okText: '创建子分类'
    }).then(async function (value) {
      if (value === null) return;
      var name = String(value || '').trim();
      if (!name) {
        ERP.ui.toast('分类名称不能为空', 'warn');
        return;
      }
      var result = await ERP.store.addCategory(name, parent.id);
      if (!result.ok) {
        ERP.ui.toast(result.error || '创建子分类失败', 'error');
        return;
      }
      // 展开父级，确保新建的子分类立即可见
      collapsed[keyOf(parent.id)] = false;
      ERP.ui.toast('子分类「' + result.category.name + '」已创建', 'ok');
      render();
    });
  }

  /**
   * v1.6.0：分类树卡片头部的「新建分类」，按当前选中态决定创建层级：
   * - 未选中分类（或选中分类已被删除）→ 新建一级分类（parentId = null）
   * - 已选中分类 → 在该分类下新建子分类（parentId = 选中分类 id）
   * 成功后刷新分类树、展开全部祖先并自动选中新建的分类；
   * 新分类是末级分类时，下方物料列表随之刷新（空分类给出空列表提示）。
   */
  function addCategoryFromTree() {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可新增分类', 'warn');
      return;
    }

    // 选中分类可能已被删除：先校正选中态，自动回退为「新建一级分类」
    syncSelection();
    var parent = state.selectedCategoryId === null ? null : findCategory(state.selectedCategoryId);
    if (!parent) {
      state.selectedCategoryId = null;
      state.materialPage = 1;
    }

    ERP.ui.prompt({
      title: parent ? '新建子分类' : '新建一级分类',
      label: '分类名称',
      placeholder: parent ? '如：0603' : '如：电容',
      hint: parent ? '将添加到「' + parent.name + '」下' : '未选中分类时创建一级分类',
      okText: parent ? '创建子分类' : '创建分类'
    }).then(async function (value) {
      if (value === null) return; // 取消：不提交请求
      var name = String(value || '').trim();
      if (!name) {
        ERP.ui.toast('分类名称不能为空', 'warn');
        return;
      }

      var result = await ERP.store.addCategory(name, parent ? parent.id : null);
      if (!result.ok) {
        // 后端文案（如同父级重名 409）直接提示
        ERP.ui.toast(result.error || '新增分类失败', 'error');
        return;
      }

      var created = result.category || null;
      ERP.ui.toast('分类「' + (created && created.name ? created.name : name) + '」已创建', 'ok');
      if (!created || created.id === null || created.id === undefined) {
        // 极端情况：后端未返回分类对象，只刷新树，不做自动选中
        render();
        return;
      }
      // 展开新分类的所有祖先，再自动选中它（selectCategory 内部会 render 并刷新下方物料列表）
      expandAncestors(created.id);
      selectCategory(created.id);
    });
  }

  function renameCategory(id) {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可重命名分类', 'warn');
      return;
    }
    var category = findCategory(id);
    if (!category) {
      ERP.ui.toast('分类不存在或已被删除', 'warn');
      return;
    }
    ERP.ui.prompt({
      title: '重命名分类',
      label: '分类名称',
      value: category.name,
      hint: '同一父分类下名称不能重复；已关联的物料会自动使用新分类名称',
      okText: '保存修改'
    }).then(async function (value) {
      if (value === null) return;
      var name = String(value || '').trim();
      if (!name) {
        ERP.ui.toast('分类名称不能为空', 'warn');
        return;
      }
      var result = await ERP.store.renameCategory(id, name);
      if (!result.ok) {
        ERP.ui.toast(result.error || '重命名失败', 'error');
        return;
      }
      ERP.ui.toast('分类已重命名', 'ok');
      render();
    });
  }

  function requestDeleteCategory(id) {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可删除分类', 'warn');
      return;
    }
    var category = findCategory(id);
    if (!category) {
      ERP.ui.toast('分类不存在或已被删除', 'warn');
      return;
    }

    // 本地校验 1：仍有子分类时禁止删除
    if (category.hasChildren) {
      ERP.ui.toast('请先删除子分类', 'warn');
      return;
    }

    // 本地校验 2：分类下存在物料时弹窗明确告知数量并禁止删除，防止丢数据
    if (category.totalCount > 0) {
      ERP.ui.toast('分类下存在物料，禁止删除', 'warn');
      ERP.ui.confirm({
        title: '禁止删除：分类下存在物料',
        html:
          '<p>分类「' + esc(category.name) + '」下仍有 <strong>' + category.totalCount +
            '</strong> 个物料。</p>' +
          '<p style="margin-top:8px">为防止物料档案丢失，禁止直接删除该分类。' +
            '请先在物料总览中把这些物料调整到其它分类，再回来删除。</p>',
        okText: '我知道了'
      });
      return;
    }

    // 通过校验后再二次确认
    ERP.ui.confirm({
      title: '删除分类',
      message: '确定删除空分类「' + category.name + '」吗？删除后不可恢复。',
      okText: '删除分类',
      danger: true
    }).then(async function (confirmed) {
      if (!confirmed) return;
      var result = await ERP.store.deleteCategory(id);
      if (!result.ok) {
        ERP.ui.toast(result.error || '删除失败', 'error');
        // 后端可能已产生新的物料 / 子分类，刷新树以同步最新状态
        await ERP.store.refresh();
        render();
        return;
      }
      ERP.ui.toast('分类已删除', 'ok');
      render();
    });
  }

  /* ---------------- 事件绑定 ---------------- */

  page.addEventListener('click', function (event) {
    // v1.6.0：分类树卡片头部「新建分类」→ 按选中态决定建一级分类还是子分类
    if (event.target.closest('#addCategoryTreeBtn')) {
      addCategoryFromTree();
      return;
    }

    if (event.target.closest('#addCategoryBtn')) {
      addRootCategory();
      return;
    }

    // v1.5.0：点击分类名称 → 选中该分类，末级分类在下方加载物料列表；
    // 按住 Ctrl / Cmd / Shift 时保留默认行为（在新窗口打开物料总览）
    var nameLink = event.target.closest('.cat-name-link');
    if (nameLink) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      event.preventDefault();
      var nameRow = nameLink.closest('[data-cat-row]');
      if (!nameRow) return;
      selectCategory(nameRow.getAttribute('data-cat-row'));
      return;
    }

    var toggleBtn = event.target.closest('[data-toggle-cat]');
    if (toggleBtn) {
      // 展开 / 收起只折叠，不改变选中态
      var toggleKey = keyOf(toggleBtn.getAttribute('data-toggle-cat'));
      collapsed[toggleKey] = !collapsed[toggleKey];
      render();
      return;
    }

    var renameBtn = event.target.closest('[data-rename]');
    if (renameBtn) {
      renameCategory(renameBtn.getAttribute('data-rename'));
    }
  });

  tbody.addEventListener('contextmenu', function (event) {
    if (!isSuper) return; // 非超级管理员不提供右键菜单
    var row = event.target.closest('[data-cat-row]');
    if (!row) return;
    var category = findCategory(row.getAttribute('data-cat-row'));
    if (!category) return;
    event.preventDefault();
    openContextMenu(event, category, row);
  });

  // 物料列表里的「领用」会加入物料使用车，这里挂载悬浮使用车面板
  // （categories.html 已引入 cart.js；未引入时静默跳过）
  if (window.ERP && ERP.cart && typeof ERP.cart.mountPanel === 'function') {
    ERP.cart.mountPanel();
  }

  render();

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }
})();
