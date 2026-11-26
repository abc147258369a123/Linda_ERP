/**
 * 分类物料列表组件（v1.5.0）
 * ------------------------------------------------------------------
 * 用途：分类管理页选中「末级分类」后，在页面下方展示该分类的物料列表；
 *      表格列 / 字段 / 行操作与「物料总览」(materials.js) 完全一致：
 *      - 物料（封面缩略图 + 名称 + 型号 + 封装·品牌 + 领用次数）
 *      - 分类路径（完整路径，最后一级加深）/ 管理模式 / 库存·状态
 *      - 存放位置 / 来源项目 / 入库时间 / 操作（详情、领用、编辑）
 *      - 分页：上一页 / 下一页 + 底部「共 N 个物料 · 第 x / y 页」
 *      - 领用：移植物料总览的数量弹窗（库存上限 / 简易模式 99 上限）→ ERP.cart.add
 *
 * 用法：
 *   ERP.materialList.render(container, {
 *     materials: [],                          // 调用方已过滤好的物料数组
 *     categoryName: '电阻 / 贴片电阻 / 0805',  // 区块标题里显示的分类路径
 *     categoryId: 12,                         // 可选：有值时显示「在物料总览中查看」
 *     pageSize: 12,                           // 每页条数，默认 12
 *     page: 1,                                // 页码（从 1 开始），默认 1
 *     onPageChange: function (page, info) {}  // 可选：翻页后的回调
 *   });
 *   render() 返回 { page, pages, total, pageSize }，页码已收敛到有效范围。
 *
 * 依赖：ERP.ui / ERP.store / ERP.auth；领用时还需要 ERP.cart（cart.js）。
 * 风格：ES5 IIFE、无第三方库，便于后续独立维护。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  var DEFAULT_PAGE_SIZE = 12;

  function esc(value) {
    return ERP.ui.esc(value);
  }

  /* ---------------- 链接 / 会话辅助 ---------------- */

  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }
  function editHref(id) {
    return ERP.url('pages/material-new.html?id=' + encodeURIComponent(id));
  }
  function overviewHref(categoryId) {
    return ERP.url('index.html?categoryId=' + encodeURIComponent(categoryId));
  }

  /** 当前会话是否管理员（决定「编辑」入口是否出现） */
  function sessionIsAdmin() {
    if (!ERP.auth || typeof ERP.auth.isAdmin !== 'function') return false;
    var session = typeof ERP.auth.get === 'function' ? ERP.auth.get() : null;
    return Boolean(ERP.auth.isAdmin(session));
  }

  /* ---------------- 单元格渲染（与物料总览保持一致） ---------------- */

  /** 库存 / 状态：简易模式只显示有货 / 空，精确计数显示数量 + 状态 */
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

  /** 操作列：详情 / 领用（空物料置灰）/ 编辑（仅管理员） */
  function actionsCell(material, isAdmin) {
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

  /** 领用次数小标签：与物料总览一起展示，方便核对领用情况 */
  function borrowBadge(material) {
    var count = Number(material.borrowCount) || 0;
    return '<span class="mat-borrow' + (count > 0 ? '' : ' is-zero') +
      '" title="累计领用次数">领用 ' + count + ' 次</span>';
  }

  function rowHtml(material, isAdmin) {
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
      '<td class="col-actions">' + actionsCell(material, isAdmin) + '</td>' +
    '</tr>';
  }

  /** 空状态：与物料总览一致的 .empty 结构，文案针对分类场景 */
  function emptyRowHtml(state) {
    return '<tr><td colspan="8">' +
      '<div class="empty">' +
        ERP.icon('search', 40) +
        '<div class="empty-title">该分类下暂无物料</div>' +
        '<div class="empty-desc">该分类还没有物料档案；在物料总览中新增物料时选择此分类，即可在这里看到。</div>' +
        (state.categoryId !== null
          ? '<div style="margin-top:14px">' +
              '<a class="btn btn-sm" href="' + esc(overviewHref(state.categoryId)) + '">前往物料总览</a>' +
            '</div>'
          : '') +
      '</div>' +
    '</td></tr>';
  }

  /* ---------------- 区块标题 / 分页 ---------------- */

  function headHtml(state, total) {
    var title = state.categoryName ? '分类物料 · ' + state.categoryName : '物料列表';
    return '<div class="cat-material-head">' +
      '<div class="cat-material-head-main">' +
        '<div class="cat-material-title">' + esc(title) + '</div>' +
        '<div class="cat-material-sub">字段与「物料总览」一致 · 按最近更新时间倒序</div>' +
      '</div>' +
      '<div class="cat-material-head-side">' +
        '<span class="cat-material-count">共 <strong>' + total + '</strong> 个物料</span>' +
        (state.categoryId !== null
          ? '<a class="btn-link" href="' + esc(overviewHref(state.categoryId)) + '">在物料总览中查看 ›</a>'
          : '') +
      '</div>' +
    '</div>';
  }

  function pagerHtml(state, pages) {
    return '<div class="pager">' +
      '<button class="btn btn-sm" type="button" data-page="' + (state.page - 1) + '"' +
        (state.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
      '<button class="btn btn-sm" type="button" data-page="' + (state.page + 1) + '"' +
        (state.page >= pages ? ' disabled' : '') + '>下一页</button>' +
    '</div>';
  }

  function footHtml(state, total, pages) {
    return '<span>共 <strong>' + total + '</strong> 个物料 · 第 ' +
      state.page + ' / ' + pages + ' 页</span>' + pagerHtml(state, pages);
  }

  /* ---------------- 渲染状态（按容器记忆，可重复 render 覆盖） ---------------- */

  function ensureState(container) {
    if (!container.__materialListState) {
      container.__materialListState = {
        materials: [],
        pageSize: DEFAULT_PAGE_SIZE,
        page: 1,
        categoryName: '',
        categoryId: null,
        onPageChange: null
      };
    }
    if (!container.__materialListBound) {
      container.__materialListBound = true;
      container.addEventListener('click', function (event) {
        onContainerClick(container, event);
      });
    }
    return container.__materialListState;
  }

  /** 按当前状态重绘（分页在内部完成，不依赖调用方） */
  function paint(container) {
    var state = ensureState(container);
    var total = state.materials.length;
    var pages = Math.max(1, Math.ceil(total / state.pageSize));

    // 页码越界自动收敛到有效范围
    if (state.page > pages) state.page = pages;
    if (state.page < 1) state.page = 1;

    var start = (state.page - 1) * state.pageSize;
    var rows = state.materials.slice(start, start + state.pageSize);
    var isAdmin = sessionIsAdmin();

    container.innerHTML =
      '<div class="card cat-material-card">' +
        headHtml(state, total) +
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
            '<tbody>' +
              (rows.length
                ? rows.map(function (material) { return rowHtml(material, isAdmin); }).join('')
                : emptyRowHtml(state)) +
            '</tbody>' +
          '</table>' +
        '</div>' +
        '<div class="list-foot">' + footHtml(state, total, pages) + '</div>' +
      '</div>';

    return {
      page: state.page,
      pages: pages,
      total: total,
      pageSize: state.pageSize
    };
  }

  /**
   * 渲染物料列表
   * @param {HTMLElement} container 挂载容器（会被整体重绘）
   * @param {Object} options { materials, categoryName, categoryId, pageSize, page, onPageChange }
   * @returns {{page:number, pages:number, total:number, pageSize:number}|null}
   */
  function render(container, options) {
    if (!container) return null;
    var opts = options || {};
    var state = ensureState(container);

    var pageSize = parseInt(opts.pageSize, 10);
    state.pageSize = pageSize > 0 ? pageSize : DEFAULT_PAGE_SIZE;
    state.materials = Array.isArray(opts.materials) ? opts.materials.slice() : [];
    state.categoryName = opts.categoryName === null || opts.categoryName === undefined
      ? '' : String(opts.categoryName);
    state.categoryId = opts.categoryId === null || opts.categoryId === undefined
      ? null : opts.categoryId;

    if (typeof opts.onPageChange === 'function') state.onPageChange = opts.onPageChange;

    var page = parseInt(opts.page, 10);
    state.page = page > 0 ? page : 1;

    return paint(container);
  }

  /* ---------------- 容器内事件（图片预览 / 领用 / 分页 / 整行进详情） ---------------- */

  function onContainerClick(container, event) {
    var state = ensureState(container);
    var target = event.target;

    // 缩略图：查看大图
    var previewBtn = target.closest('[data-preview-image]');
    if (previewBtn) {
      event.preventDefault();
      event.stopPropagation();
      ERP.ui.previewImage(
        previewBtn.getAttribute('data-preview-image'),
        previewBtn.getAttribute('data-preview-title')
      );
      return;
    }

    // 领用：打开数量弹窗 → 加入物料使用车
    var pickBtn = target.closest('[data-borrow-pick]');
    if (pickBtn) {
      openBorrowPicker(pickBtn.getAttribute('data-borrow-pick'));
      return;
    }

    // 分页：组件内部重绘并把新页码回传给调用方
    var pageBtn = target.closest('.pager [data-page]');
    if (pageBtn) {
      if (pageBtn.disabled) return;
      var nextPage = parseInt(pageBtn.getAttribute('data-page'), 10);
      if (!nextPage || nextPage === state.page) return;
      state.page = nextPage;
      var info = paint(container);
      if (typeof state.onPageChange === 'function') state.onPageChange(info.page, info);
      // 翻页后把列表头部带回视口，避免停在页面底部
      if (container.scrollIntoView) container.scrollIntoView({ block: 'start' });
      return;
    }

    // 整行空白区域点击进入详情；链接 / 按钮 / 输入框保持自身行为
    if (target.closest('a, button, input, select, textarea, label')) return;
    var row = target.closest('tr[data-id]');
    if (!row) return;
    var selectedText = window.getSelection ? String(window.getSelection()) : '';
    if (selectedText) return;
    window.location.href = detailHref(row.getAttribute('data-id'));
  }

  /* ---------------- 领用数量弹窗（移植自物料总览 materials.js） ---------------- */

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

  ERP.materialList = {
    render: render,
    /** 单独复用领用数量弹窗（例如其它页面需要同一套交互） */
    openBorrowPicker: openBorrowPicker,
    defaultPageSize: DEFAULT_PAGE_SIZE
  };
})();
