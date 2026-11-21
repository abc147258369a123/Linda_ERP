/**
 * 出入库单页（管理员）：查询入库单 / 出库单，创建入库单、查看单据明细
 * 数据全部来自后端 API + MariaDB
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;

  await ERP.store.load();

  var view = ERP.layout.mount({ active: 'stock-orders', title: '出入库单' });
  if (!view) return;
  var page = view.content;

  var state = { tab: 'in', page: 1, pageSize: 15 };

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">出入库单</h1>' +
        '<p class="page-desc">入库单 / 出库单均写入 MariaDB；这里有完整单据与明细，库存流水可在领用日志查看。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<button class="btn btn-primary" type="button" id="newInboundBtn">' +
          ERP.icon('plus', 15) + '新建入库单</button>' +
        '<a class="btn" href="' + esc(ERP.url('pages/borrow.html')) + '">' +
          ERP.icon('out', 15) + '去领用登记</a>' +
      '</div>' +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">入库单</div>' +
        '<div class="stat-value" id="inOrderStat">0</div>' +
        '<div class="stat-sub">补货 / 入库单据</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">出库单</div>' +
        '<div class="stat-value" id="outOrderStat">0</div>' +
        '<div class="stat-sub">领用 / 标记为空单据</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">物料档案</div>' +
        '<div class="stat-value" id="materialStat">0</div>' +
        '<div class="stat-sub">当前台账物料</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">当前页面</div>' +
        '<div class="stat-value" id="pageStat">1</div>' +
        '<div class="stat-sub">每页 ' + state.pageSize + ' 条</div>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">单据列表</div>' +
          '<div class="card-sub">点击「明细」查看该单据包含的物料与数量</div>' +
        '</div>' +
        '<div class="legend">' +
          '<button class="btn btn-sm" type="button" data-tab="in">入库单</button>' +
          '<button class="btn btn-sm" type="button" data-tab="out">出库单</button>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead id="orderHead"></thead>' +
          '<tbody id="orderBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span id="orderFootText"></span>' +
        '<span class="pager" id="orderPager"></span>' +
      '</div>' +
    '</div>';

  function fmt(value) { return value ? String(value).replace('T', ' ').slice(0, 16) : '—'; }

  function setStats(inCount, outCount) {
    var materialEl = $('#materialStat');
    var inEl = $('#inOrderStat');
    var outEl = $('#outOrderStat');
    if (materialEl) materialEl.textContent = ERP.store.materials().length;
    if (inEl) inEl.textContent = inCount;
    if (outEl) outEl.textContent = outCount;
    var pageEl = $('#pageStat');
    if (pageEl) pageEl.textContent = state.page;
  }

  async function loadCounts() {
    try {
      var inData = await ERP.api.get('/stock-in?page=1&page_size=1');
      var outData = await ERP.api.get('/stock-out?page=1&page_size=1');
      setStats(inData.total || 0, outData.total || 0);
    } catch (error) {
      /* 统计失败不阻塞列表 */
    }
  }

  async function loadList() {
    var tbody = $('#orderBody');
    var head = $('#orderHead');
    if (!tbody || !head) return;
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty" style="padding:28px;">加载中…</div></td></tr>';

    try {
      var data = state.tab === 'in'
        ? await ERP.store.stockInOrders(state.page, state.pageSize)
        : await ERP.store.stockOutOrders(state.page, state.pageSize);
      var items = data.items || [];

      if (state.tab === 'in') {
        head.innerHTML = '<tr><th>入库单号</th><th>经办人</th><th>备注</th><th>入库时间</th><th class="col-actions">操作</th></tr>';
        tbody.innerHTML = items.length ? items.map(function (order) {
          return '<tr>' +
            '<td><span class="cell-mono">' + esc(order.order_no) + '</span></td>' +
            '<td>' + esc(order.operator_name || '—') + '</td>' +
            '<td><span class="cell-text">' + esc(order.note || '—') + '</span></td>' +
            '<td><span class="cell-mono">' + esc(fmt(order.created_at)) + '</span></td>' +
            '<td class="col-actions"><button class="btn-link" type="button" data-detail-in="' + order.id + '">明细</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty" style="padding:28px;">暂无入库单</div></td></tr>';
      } else {
        head.innerHTML = '<tr><th>出库单号</th><th>类型</th><th>领用人</th><th>项目</th><th>经办人</th><th>出库时间</th><th class="col-actions">操作</th></tr>';
        tbody.innerHTML = items.length ? items.map(function (order) {
          var typeLabel = order.type === 'empty' ? '标记为空' : (order.type === 'borrow' ? '领用' : order.type);
          return '<tr>' +
            '<td><span class="cell-mono">' + esc(order.order_no) + '</span></td>' +
            '<td><span class="tag ' + (order.type === 'empty' ? 'tag-empty' : 'tag-brand') + '">' + esc(typeLabel) + '</span></td>' +
            '<td>' + esc(order.borrower || '—') + '</td>' +
            '<td>' + esc(order.project || '—') + '</td>' +
            '<td>' + esc(order.operator_name || '—') + '</td>' +
            '<td><span class="cell-mono">' + esc(fmt(order.created_at)) + '</span></td>' +
            '<td class="col-actions"><button class="btn-link" type="button" data-detail-out="' + order.id + '">明细</button></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="7"><div class="empty" style="padding:28px;">暂无出库单</div></td></tr>';
      }

      var total = data.total || 0;
      var pages = Math.max(1, Math.ceil(total / state.pageSize));
      if (state.page > pages) state.page = pages;
      var foot = $('#orderFootText');
      if (foot) foot.textContent = '共 ' + total + ' 条 · 第 ' + state.page + ' / ' + pages + ' 页';
      var pager = $('#orderPager');
      if (pager) {
        pager.innerHTML =
          '<button class="btn btn-sm" type="button" data-order-page="' + (state.page - 1) + '"' +
            (state.page <= 1 ? ' disabled' : '') + '>上一页</button>' +
          '<button class="btn btn-sm" type="button" data-order-page="' + (state.page + 1) + '"' +
            (state.page >= pages ? ' disabled' : '') + '>下一页</button>';
      }
      var pageEl = $('#pageStat');
      if (pageEl) pageEl.textContent = state.page;
    } catch (error) {
      tbody.innerHTML = '<tr><td colspan="7"><div class="empty" style="padding:28px;">' + esc(error.message || '加载失败') + '</div></td></tr>';
    }
  }

  function switchTab(tab) {
    state.tab = tab === 'out' ? 'out' : 'in';
    state.page = 1;
    page.querySelectorAll('[data-tab]').forEach(function (button) {
      button.classList.toggle('btn-primary', button.getAttribute('data-tab') === state.tab);
    });
    loadList();
  }

  async function showOrderDetail(kind, id) {
    try {
      var data = kind === 'in'
        ? await ERP.store.stockInDetail(id)
        : await ERP.store.stockOutDetail(id);
      var rows = (data.items || []).map(function (item) {
        return '<tr>' +
          '<td><span class="cell-mono">' + esc(item.material_code || '') + '</span></td>' +
          '<td>' + esc(item.material_name || '') + '</td>' +
          '<td class="col-num">' + esc(item.qty == null ? '—' : item.qty) + '</td>' +
        '</tr>';
      }).join('');
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-hd">' + (kind === 'in' ? '入库单明细' : '出库单明细') + ' · ' + esc(data.order_no) + '</div>' +
          '<div class="modal-bd">' +
            '<div class="detail-recent-head" style="margin-bottom:10px;">' +
              '<span>经办人：' + esc(data.operator_name || '—') + '</span>' +
              '<span>时间：' + esc(fmt(data.created_at)) + '</span>' +
            '</div>' +
            (data.borrower ? '<p class="small" style="margin-bottom:10px;">领用人：' + esc(data.borrower) +
              ' · 项目：' + esc(data.project || '—') + '</p>' : '') +
            '<div class="table-wrap"><table class="table">' +
              '<thead><tr><th>物料编号</th><th>物料名称</th><th class="col-num">数量</th></tr></thead>' +
              '<tbody>' + (rows || '<tr><td colspan="3"><div class="empty" style="padding:20px;">无明细</div></td></tr>') + '</tbody>' +
            '</table></div>' +
          '</div>' +
          '<div class="modal-ft"><button class="btn" type="button" data-act="close">关闭</button></div>' +
        '</div>';
      document.body.appendChild(mask);
      function close() { mask.remove(); }
      mask.addEventListener('click', function (event) {
        if (event.target === mask) return close();
        if (event.target.closest('[data-act="close"]')) close();
      });
    } catch (error) {
      ERP.ui.toast(error.message || '明细加载失败', 'error');
    }
  }

  function openInboundModal() {
    var materials = ERP.store.materials().slice().sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), 'zh');
    });
    var options = '<option value="">请选择物料</option>' + materials.map(function (material) {
      return '<option value="' + esc(material.id) + '">' + esc(material.name) +
        ' · ' + esc(material.model || '—') + '（' + esc(material.mode === 'precise' ? '库存 ' + (material.qty || 0) : '简易') + '）</option>';
    }).join('');

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true">' +
        '<div class="modal-hd">新建入库单</div>' +
        '<div class="modal-bd">' +
          '<div class="field"><label class="label" for="inboundMaterial">物料<span class="req">*</span></label>' +
            '<select class="select" id="inboundMaterial">' + options + '</select></div>' +
          '<div class="field"><label class="label" for="inboundQty">入库数量<span class="req">*</span></label>' +
            '<input class="input" id="inboundQty" type="number" min="1" value="1"></div>' +
          '<div class="field"><label class="label" for="inboundNote">备注</label>' +
            '<input class="input" id="inboundNote" type="text" maxlength="60" placeholder="如：新采购到货 / 补货"></div>' +
        '</div>' +
        '<div class="modal-ft">' +
          '<button class="btn" type="button" data-act="cancel">取消</button>' +
          '<button class="btn btn-primary" type="button" data-act="save">提交入库</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    function close() { mask.remove(); }
    mask.addEventListener('click', async function (event) {
      if (event.target === mask) return close();
      var act = event.target.closest('[data-act]');
      if (!act) return;
      if (act.getAttribute('data-act') !== 'save') return close();

      var materialId = mask.querySelector('#inboundMaterial').value;
      var qty = Number(mask.querySelector('#inboundQty').value);
      var note = String(mask.querySelector('#inboundNote').value || '').trim();
      var material = ERP.store.getMaterial(materialId);
      if (!material) {
        ERP.ui.toast('请选择物料', 'error');
        return;
      }
      if (!qty || qty <= 0 || Math.floor(qty) !== qty) {
        ERP.ui.toast('入库数量需为正整数', 'error');
        return;
      }
      var button = mask.querySelector('[data-act="save"]');
      button.disabled = true;
      button.textContent = '提交中…';
      var result = await ERP.store.createStockIn({
        note: note || '手动入库',
        items: [{ material_id: material.dbId, qty: qty }]
      });
      if (!result.ok) {
        ERP.ui.toast(result.error || '入库失败', 'error');
        button.disabled = false;
        button.textContent = '提交入库';
        return;
      }
      close();
      ERP.ui.toast('入库单已创建，库存已更新', 'ok');
      await loadCounts();
      await loadList();
      if (ERP.layout) ERP.layout.refreshAlertsBadge();
    });
  }

  page.addEventListener('click', function (event) {
    if (event.target.closest('#newInboundBtn')) {
      openInboundModal();
      return;
    }
    var tabBtn = event.target.closest('[data-tab]');
    if (tabBtn) {
      switchTab(tabBtn.getAttribute('data-tab'));
      return;
    }
    var pageBtn = event.target.closest('[data-order-page]');
    if (pageBtn) {
      state.page = Math.max(1, Number(pageBtn.getAttribute('data-order-page')) || 1);
      loadList();
      return;
    }
    var inDetail = event.target.closest('[data-detail-in]');
    if (inDetail) {
      showOrderDetail('in', inDetail.getAttribute('data-detail-in'));
      return;
    }
    var outDetail = event.target.closest('[data-detail-out]');
    if (outDetail) showOrderDetail('out', outDetail.getAttribute('data-detail-out'));
  });

  page.querySelectorAll('[data-tab]').forEach(function (button) {
    button.classList.toggle('btn-primary', button.getAttribute('data-tab') === 'in');
  });
  await loadCounts();
  await loadList();
})();
