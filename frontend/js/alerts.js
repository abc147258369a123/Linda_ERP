/**
 * 库存预警页（仅管理员）
 * - 只列出「精确计数模式」且库存 ≤ 安全预警阈值的物料
 * - 支持直接补货：补货后恢复有货并写入补货日志
 * - 简易模式物料（只记有货 / 空）不参与数量预警
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;

  var view = ERP.layout.mount({ active: 'alerts', title: '库存预警' });
  if (!view) return;
  var page = view.content;

  await ERP.store.load();

  function alertList() {
    var list = ERP.store.warnings().filter(function (material) {
      return material.mode === 'precise';
    });
    list.sort(function (a, b) {
      var gapA = Math.max(0, Number(a.minQty) - Number(a.qty));
      var gapB = Math.max(0, Number(b.minQty) - Number(b.qty));
      if (gapB !== gapA) return gapB - gapA;
      return String(a.name).localeCompare(String(b.name), 'zh');
    });
    return list;
  }

  function rowHtml(material) {
    var qty = Number(material.qty) || 0;
    var threshold = Number(material.minQty) || 0;
    var gap = Math.max(0, threshold - qty);
    var category = ERP.store.categoryName(material.categoryId);
    var location = [material.cabinet, material.slot].filter(Boolean).join(' ');
    return '<tr>' +
      '<td>' +
        '<div class="mat-cell">' +
          '<img class="mat-thumb" src="' +
            esc(ERP.url(material.image || 'assets/img/default.svg')) + '" alt="" loading="lazy">' +
          '<div>' +
            '<div class="mat-name">' + esc(material.name) + '</div>' +
            '<div class="mat-model">' + esc(material.model || '—') + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td><span class="cell-text">' + esc(category || '—') + '</span></td>' +
      '<td class="col-num"><span class="warn-qty' + (qty <= 0 ? ' is-zero' : '') + '">' +
        qty + '</span></td>' +
      '<td class="col-num"><span class="warn-threshold">' + threshold + '</span></td>' +
      '<td class="col-num"><span class="tag tag-danger">缺 ' + gap + '</span></td>' +
      '<td><div class="cell-loc"><div class="loc-main">' + esc(material.cabinet || '—') +
        '</div><div class="loc-sub">' + esc(material.slot || '') + '</div></div></td>' +
      '<td><span class="cell-text">' + esc(material.source || '—') + '</span></td>' +
      '<td class="col-actions">' +
        '<div class="row-actions">' +
          '<a class="btn-link" href="' + esc(ERP.url('pages/material-detail.html?id=' +
            encodeURIComponent(material.id))) + '">详情</a>' +
          '<button class="btn-link" type="button" data-restock="' + esc(material.id) + '">补货</button>' +
        '</div>' +
      '</td>' +
    '</tr>';
  }

  function render() {
    var list = alertList();
    var emptyCount = list.filter(function (material) { return Number(material.qty) <= 0; }).length;
    var categoryIds = {};
    list.forEach(function (material) { categoryIds[material.categoryId] = true; });
    var categoryCount = Object.keys(categoryIds).length;

    var tableHtml;
    if (list.length) {
      tableHtml =
        '<div class="table-wrap">' +
          '<table class="table">' +
            '<thead><tr>' +
              '<th>物料</th>' +
              '<th>分类</th>' +
              '<th class="col-num">当前数量</th>' +
              '<th class="col-num">安全预警阈值</th>' +
              '<th class="col-num">缺口</th>' +
              '<th>存放柜位</th>' +
              '<th>来源项目</th>' +
              '<th class="col-actions">操作</th>' +
            '</tr></thead>' +
            '<tbody>' + list.map(rowHtml).join('') + '</tbody>' +
          '</table>' +
        '</div>';
    } else {
      tableHtml =
        '<div class="empty" style="padding: 56px 24px;">' +
          ERP.icon('check', 40) +
          '<div class="empty-title">暂无库存预警</div>' +
          '<div class="empty-desc">所有精确计数物料的库存都高于安全预警阈值。' +
            '补货或增加库存后，预警会自动消除。</div>' +
          '<div style="margin-top:16px"><a class="btn btn-sm" href="' +
            esc(ERP.url('index.html')) + '">返回物料总览</a></div>' +
        '</div>';
    }

    page.innerHTML =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">库存预警</h1>' +
          '<p class="page-desc">仅统计精确计数模式物料；库存低于（含等于）安全预警阈值时进入本列表。</p>' +
        '</div>' +
        '<div class="page-head-actions">' +
          '<a class="btn" href="' + esc(ERP.url('index.html')) + '">' + ERP.icon('grid', 15) +
            '物料总览</a>' +
        '</div>' +
      '</div>' +

      '<div class="stat-grid">' +
        '<div class="stat-card">' +
          '<div class="stat-label">预警物料</div>' +
          '<div class="stat-value is-warn">' + list.length + '</div>' +
          '<div class="stat-sub">低于安全库存需补货</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-label">已空缺</div>' +
          '<div class="stat-value is-muted">' + emptyCount + '</div>' +
          '<div class="stat-sub">库存为 0，档案保留</div>' +
        '</div>' +
        '<div class="stat-card">' +
          '<div class="stat-label">涉及分类</div>' +
          '<div class="stat-value is-muted">' + categoryCount + '</div>' +
          '<div class="stat-sub">按物料分类统计</div>' +
        '</div>' +
      '</div>' +

      '<div class="notice is-warn" style="margin-bottom:16px;">' +
        '<span>' + ERP.icon('warn', 16) + '</span>' +
        '<span><strong>简易模式物料不参与预警。</strong>' +
          'LED、电阻等海量小件只记录「有货 / 空」，用完由管理员手动标记为空。</span>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">预警明细</div>' +
            '<div class="card-sub">按缺口从大到小排序，可直接补货入库</div>' +
          '</div>' +
          '<span class="tag tag-warn">' + list.length + ' 项</span>' +
        '</div>' +
        tableHtml +
        '<div class="card-foot">' +
          '<span>补货后会写入一条补货日志，库存自动恢复为「有货」</span>' +
          '<a class="btn btn-sm" href="' + esc(ERP.url('pages/logs.html')) + '">查看领用日志</a>' +
        '</div>' +
      '</div>';
  }

  function handleRestock(button) {
    var id = button.getAttribute('data-restock');
    var material = ERP.store.getMaterial(id);
    if (!material) {
      ERP.ui.toast('物料不存在或已被移除', 'error');
      return;
    }
    var qty = Number(material.qty) || 0;
    var threshold = Number(material.minQty) || 0;
    var defaultAmount = Math.max(1, threshold - qty);
    ERP.ui.prompt({
      title: '补货入库',
      label: '补货数量（件）',
      type: 'number',
      value: defaultAmount,
      message: material.name + '：当前 ' + qty + ' 件 / 安全阈值 ' + threshold + ' 件',
      hint: '确认后库存增加并生成补货日志，预警状态自动更新。',
      okText: '确认补货'
    }).then(async function (value) {
      if (value === null) return;
      var amount = Number(value);
      if (!amount || amount <= 0 || Math.floor(amount) !== amount) {
        ERP.ui.toast('请输入正整数补货数量', 'error');
        return;
      }
      var result = await ERP.store.restock(id, amount, session.name);
      if (!result.ok) {
        ERP.ui.toast(result.error || '补货失败', 'error');
        return;
      }
      ERP.ui.toast('补货成功，已写入补货日志', 'ok');
      ERP.layout.refreshAlertsBadge();
      render();
    });
  }

  page.addEventListener('click', function (event) {
    var button = event.target.closest('[data-restock]');
    if (button) handleRestock(button);
  });

  render();
})();
