/**
 * 分类管理页（仅管理员）
 * - 新增 / 重命名 / 删除物料分类
 * - 分类下仍有物料时禁止删除，避免档案变成孤儿数据
 * - 点击分类名称或数量可跳转物料总览并按该分类筛选
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

  await ERP.store.load();

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">分类管理</h1>' +
        '<p class="page-desc">维护物料分类；分类下仍有物料档案时不可删除，可先调整物料分类。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        (isSuper
          ? '<button class="btn btn-primary" type="button" id="addCategoryBtn">' +
              ERP.icon('plus', 15) + '新增分类</button>'
          : '<span class="field-hint" style="align-self:center;">新增/删除分类仅超级管理员可操作</span>') +
        '<a class="btn" href="' + esc(ERP.url('index.html')) + '">' + ERP.icon('grid', 15) + '物料总览</a>' +
      '</div>' +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">分类总数</div>' +
        '<div class="stat-value" data-cat-stat="total">0</div>' +
        '<div class="stat-sub">全部物料分类</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">已使用分类</div>' +
        '<div class="stat-value is-ok" data-cat-stat="used">0</div>' +
        '<div class="stat-sub">已有物料档案的分类</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">空分类</div>' +
        '<div class="stat-value is-muted" data-cat-stat="empty">0</div>' +
        '<div class="stat-sub">可安全删除的分类</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">物料档案</div>' +
        '<div class="stat-value" data-cat-stat="materials">0</div>' +
        '<div class="stat-sub">全部分类下的档案合计</div>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">分类列表</div>' +
          '<div class="card-sub">点击分类名称可查看该分类下的物料</div>' +
        '</div>' +
        '<div class="legend">' +
          '<span class="tag tag-warn">低库存</span>' +
          '<span class="tag tag-empty">空缺</span>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>分类名称</th>' +
            '<th class="col-num">物料数量</th>' +
            '<th class="col-num">低库存预警</th>' +
            '<th class="col-num">空缺</th>' +
            '<th class="col-actions">操作</th>' +
          '</tr></thead>' +
          '<tbody id="catBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span id="catFootText"></span>' +
        '<span class="dim">删除分类前需先清空该分类下的物料档案</span>' +
      '</div>' +
    '</div>';

  var tbody = $('#catBody');
  var expanded = {};

  function materialListHref(categoryId) {
    return ERP.url('index.html?categoryId=' + encodeURIComponent(categoryId));
  }

  function categoryMaterials(categoryId) {
    return ERP.store.materials().filter(function (material) {
      return material.categoryId === categoryId;
    });
  }

  function expandRowHtml(category) {
    var materials = categoryMaterials(category.id);
    var body;
    if (materials.length) {
      body = '<div class="cat-material-list">' + materials.map(function (material) {
        return '<div class="cat-material-item">' +
          '<a class="cat-material-name" href="' +
            esc(ERP.url('pages/material-detail.html?id=' + encodeURIComponent(material.id))) + '">' +
            esc(material.name) + '</a>' +
          '<span class="cat-material-model">' + esc(material.model || '—') + '</span>' +
          ERP.ui.tagMode(material.mode) +
          ERP.ui.tagStatus(material) +
        '</div>';
      }).join('') + '</div>';
    } else {
      body = '<div class="cat-material-empty">该分类下暂无物料，可在「新增物料」时选择此分类。</div>';
    }
    return '<tr class="cat-expand-row" data-expand-of="' + esc(category.id) + '">' +
      '<td colspan="5">' +
        '<div class="cat-expand-panel">' +
          '<div class="cat-expand-head">' +
            '<span>「' + esc(category.name) + '」下的物料 · 共 ' + materials.length + ' 个</span>' +
            '<a class="card-link" href="' + esc(materialListHref(category.id)) + '">去物料总览查看 ›</a>' +
          '</div>' +
          body +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function rowHtml(category) {
    var used = category.count > 0;
    var isOpen = Boolean(expanded[category.id]);
    return '<tr data-cat-row="' + esc(category.id) + '">' +
      '<td>' +
        '<div class="cat-name-cell">' +
          '<button class="cat-toggle' + (isOpen ? ' is-open' : '') + '" type="button" ' +
            'data-toggle-cat="' + esc(category.id) + '" aria-expanded="' + (isOpen ? 'true' : 'false') + '" ' +
            'aria-label="' + (isOpen ? '收起分类' : '展开分类') + '">' +
            ERP.icon('chevronRight', 14) +
          '</button>' +
          '<div>' +
            '<div class="mat-name">' +
              '<a href="' + esc(materialListHref(category.id)) + '">' + esc(category.name) + '</a>' +
            '</div>' +

          '</div>' +
        '</div>' +
      '</td>' +
      '<td class="col-num">' +
        '<a class="btn-link" href="' + esc(materialListHref(category.id)) + '">' +
          category.count + ' 个</a>' +
      '</td>' +
      '<td class="col-num">' +
        (category.warnCount > 0
          ? '<span class="tag tag-warn">' + category.warnCount + ' 项</span>'
          : '<span class="dim">—</span>') +
      '</td>' +
      '<td class="col-num">' +
        (category.emptyCount > 0
          ? '<span class="tag tag-empty">' + category.emptyCount + ' 个</span>'
          : '<span class="dim">—</span>') +
      '</td>' +
      '<td class="col-actions">' +
        '<div class="row-actions">' +
          '<button class="btn-link" type="button" data-rename="' + esc(category.id) + '">重命名</button>' +
          (isSuper
            ? (used
              ? '<span class="btn-link is-disabled" title="该分类下仍有 ' + category.count + ' 个物料，不能删除">删除</span>'
              : '<button class="btn-link text-danger" type="button" data-delete="' + esc(category.id) + '">删除</button>')
            : '') +
        '</div>' +
      '</td>' +
    '</tr>' + (isOpen ? expandRowHtml(category) : '');
  }

  function render() {
    var categories = ERP.store.categories();

    // 同步展开状态，已删除分类的展开记录自动清理
    var nextExpanded = {};
    categories.forEach(function (category) {
      if (expanded[category.id]) nextExpanded[category.id] = true;
    });
    expanded = nextExpanded;

    var used = categories.filter(function (category) { return category.count > 0; }).length;
    var materials = categories.reduce(function (total, category) { return total + category.count; }, 0);

    var stats = {
      total: categories.length,
      used: used,
      empty: categories.length - used,
      materials: materials
    };
    Object.keys(stats).forEach(function (key) {
      var el = page.querySelector('[data-cat-stat="' + key + '"]');
      if (el) el.textContent = stats[key];
    });

    tbody.innerHTML = categories.length
      ? categories.map(rowHtml).join('')
      : '<tr><td colspan="5"><div class="empty" style="padding:40px 16px;">' +
          '<div class="empty-desc">还没有物料分类，点击右上角「新增分类」创建。</div>' +
        '</td></tr>';

    var footText = $('#catFootText');
    if (footText) {
      footText.textContent = '共 ' + categories.length + ' 个分类 · ' +
        used + ' 个已使用 · ' + (categories.length - used) + ' 个空分类';
    }
  }

  function findCategory(id) {
    var found = null;
    ERP.store.categories().forEach(function (category) {
      if (String(category.id) === String(id)) found = category;
    });
    return found;
  }

  /* ---------------- 新增 / 重命名 / 删除 ---------------- */

  function addCategory() {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可新增分类', 'warn');
      return;
    }
    ERP.ui.prompt({
      title: '新增物料分类',
      label: '分类名称',
      placeholder: '如：传感器模块',
      hint: '建议不超过 12 个字，名称不能重复',
      okText: '添加分类'
    }).then(async function (value) {
      if (value === null) return;
      var result = await ERP.store.addCategory(value);
      if (!result.ok) {
        ERP.ui.toast(result.error || '添加失败', 'error');
        return;
      }
      ERP.ui.toast('分类「' + result.category.name + '」已添加', 'ok');
      render();
    });
  }

  function renameCategory(id) {
    var category = findCategory(id);
    if (!category) return;
    ERP.ui.prompt({
      title: '重命名分类',
      label: '分类名称',
      value: category.name,
      hint: '已关联的物料会自动使用新分类名称',
      okText: '保存修改'
    }).then(async function (value) {
      if (value === null) return;
      var result = await ERP.store.renameCategory(id, value);
      if (!result.ok) {
        ERP.ui.toast(result.error || '重命名失败', 'error');
        return;
      }
      ERP.ui.toast('分类已重命名', 'ok');
      render();
    });
  }

  function deleteCategory(id) {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可删除分类', 'warn');
      return;
    }
    var category = findCategory(id);
    if (!category) return;
    if (category.count > 0) {
      ERP.ui.toast('该分类下仍有 ' + category.count + ' 个物料，不能删除', 'warn');
      return;
    }
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
        return;
      }
      ERP.ui.toast('分类已删除', 'ok');
      render();
    });
  }

  page.addEventListener('click', function (event) {
    if (event.target.closest('#addCategoryBtn')) {
      addCategory();
      return;
    }
    var toggleBtn = event.target.closest('[data-toggle-cat]');
    if (toggleBtn) {
      var toggleId = toggleBtn.getAttribute('data-toggle-cat');
      expanded[toggleId] = !expanded[toggleId];
      render();
      return;
    }
    var renameBtn = event.target.closest('[data-rename]');
    if (renameBtn) {
      renameCategory(renameBtn.getAttribute('data-rename'));
      return;
    }
    var deleteBtn = event.target.closest('[data-delete]');
    if (deleteBtn) deleteCategory(deleteBtn.getAttribute('data-delete'));
  });

  render();

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }
})();
