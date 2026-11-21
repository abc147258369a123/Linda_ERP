/**
 * 物料详情页
 * - 展示档案完整信息：图片、型号、规格、分类、库存、存放位置、来源项目、入库时间
 * - 库存预警信息（精确计数模式按阈值判断）
 * - 该物料的完整历史领用记录（日志永久保留）
 * 角色：所有登录用户可查看；编辑入口仅管理员可见。
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;
  var isAdmin = ERP.auth.isAdmin(session);

  var materialId = ERP.ui.getParam('id');
  var material = materialId ? ERP.store.getMaterial(materialId) : null;

  var view = ERP.layout.mount({ active: 'materials', title: '物料详情' });
  if (!view) return;
  var page = view.content;

  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }
  function borrowHref(id) {
    return ERP.url('pages/borrow.html?materialId=' + encodeURIComponent(id));
  }
  function editHref(id) {
    return ERP.url('pages/material-new.html?id=' + encodeURIComponent(id));
  }

  if (!material) {
    page.innerHTML =
      '<div class="card"><div class="card-bd">' +
        '<div class="empty" style="padding:72px 24px;">' +
          ERP.icon('search', 40) +
          '<div class="empty-title">物料不存在或已被移除</div>' +
          '<div class="empty-desc">请检查链接是否正确，或返回物料总览重新查找。</div>' +
          '<div style="margin-top:16px">' +
            '<a class="btn btn-primary btn-sm" href="' + esc(ERP.url('index.html')) + '">返回物料总览</a>' +
          '</div>' +
        '</div>' +
      '</div></div>';
    return;
  }

  var logs = ERP.store.logsForMaterial(material.id);
  var borrowLogs = logs.filter(function (log) { return log.action === 'borrow'; });
  var lastBorrow = borrowLogs.length ? borrowLogs[0] : null;

  var category = ERP.store.categoryName(material.categoryId);
  var location = [material.cabinet, material.slot].filter(Boolean).join(' ');
  var isPrecise = material.mode === 'precise';
  var qty = Number(material.qty) || 0;
  var threshold = Number(material.minQty) || 0;
  var gap = Math.max(0, threshold - qty);
  var image = ERP.url(material.image || 'assets/img/default.svg');

  /* ---------------- 顶部操作 ---------------- */

  var actions = '';
  if (material.status === 'available') {
    actions += '<a class="btn btn-primary" href="' + esc(borrowHref(material.id)) + '">' +
      ERP.icon('out', 15) + '领用登记</a>';
  } else {
    actions += '<button class="btn" type="button" disabled>物料为空，暂不可领用</button>';
  }
  if (isAdmin) {
    actions += '<a class="btn" href="' + esc(editHref(material.id)) + '">' +
      ERP.icon('edit', 15) + '编辑物料</a>';
  }

  /* ---------------- 关键指标 ---------------- */

  var statOneLabel = isPrecise ? '当前库存' : '当前状态';
  var statOneValue = isPrecise
    ? '<span>' + qty + '</span><small>件</small>'
    : '<span style="font-size:20px">' + (material.status === 'empty' ? '空' : '有货') + '</span>';
  var statTwoLabel = isPrecise ? '安全预警阈值' : '预警机制';
  var statTwoValue = isPrecise
    ? '<span>' + threshold + '</span><small>件</small>'
    : '<span style="font-size:20px">不适用</span>';
  var lastBorrowText = lastBorrow ? ERP.ui.fmtDate(lastBorrow.borrowAt) : '暂无';

  var statsHtml =
    '<div class="detail-stats">' +
      '<div class="detail-stat">' +
        '<div class="detail-stat-label">' + esc(statOneLabel) + '</div>' +
        '<div class="detail-stat-value">' + statOneValue + '</div>' +
      '</div>' +
      '<div class="detail-stat">' +
        '<div class="detail-stat-label">' + esc(statTwoLabel) + '</div>' +
        '<div class="detail-stat-value">' + statTwoValue + '</div>' +
      '</div>' +
      '<div class="detail-stat">' +
        '<div class="detail-stat-label">历史领用次数</div>' +
        '<div class="detail-stat-value"><span>' + borrowLogs.length + '</span><small>次</small></div>' +
      '</div>' +
      '<div class="detail-stat">' +
        '<div class="detail-stat-label">最近领用时间</div>' +
        '<div class="detail-stat-value"><span style="font-size:15px">' + esc(lastBorrowText) + '</span></div>' +
      '</div>' +
    '</div>';

  /* ---------------- 库存预警信息 ---------------- */

  var warningHtml;
  if (isPrecise) {
    if (qty <= 0) {
      warningHtml =
        '<div class="detail-warning is-empty">' +
          '<div class="detail-warning-main">' +
            '<span class="detail-warning-icon">' + ERP.icon('warn', 17) + '</span>' +
            '<div>' +
              '<div class="detail-warning-title">库存已清零</div>' +
              '<div class="detail-warning-desc">档案保留，补货后可直接复用；补货会自动写入入库日志。</div>' +
            '</div>' +
          '</div>' +
          '<div class="detail-warning-values">' +
            '<div class="detail-warn-item"><div class="v">0</div><div class="k">当前库存</div></div>' +
            '<div class="detail-warn-item"><div class="v">' + threshold + '</div><div class="k">安全阈值</div></div>' +
            '<div class="detail-warn-item"><div class="v">' + gap + '</div><div class="k">缺口</div></div>' +
          '</div>' +
          (isAdmin
            ? '<a class="btn btn-sm" href="' + esc(ERP.url('pages/alerts.html')) + '">前往补货</a>'
            : '') +
        '</div>';
    } else if (qty <= threshold) {
      warningHtml =
        '<div class="detail-warning">' +
          '<div class="detail-warning-main">' +
            '<span class="detail-warning-icon">' + ERP.icon('alert', 17) + '</span>' +
            '<div>' +
              '<div class="detail-warning-title">库存低于安全预警阈值</div>' +
              '<div class="detail-warning-desc">建议尽快补货，避免影响新项目开发；补货记录会自动留痕。</div>' +
            '</div>' +
          '</div>' +
          '<div class="detail-warning-values">' +
            '<div class="detail-warn-item"><div class="v">' + qty + '</div><div class="k">当前库存</div></div>' +
            '<div class="detail-warn-item"><div class="v">' + threshold + '</div><div class="k">安全阈值</div></div>' +
            '<div class="detail-warn-item"><div class="v">' + gap + '</div><div class="k">缺口</div></div>' +
          '</div>' +
          (isAdmin
            ? '<a class="btn btn-sm" href="' + esc(ERP.url('pages/alerts.html')) + '">前往补货</a>'
            : '') +
        '</div>';
    } else {
      warningHtml =
        '<div class="detail-warning is-ok">' +
          '<div class="detail-warning-main">' +
            '<span class="detail-warning-icon">' + ERP.icon('check', 17) + '</span>' +
            '<div>' +
              '<div class="detail-warning-title">库存充足</div>' +
              '<div class="detail-warning-desc">当前库存高于安全预警阈值，可正常领用。</div>' +
            '</div>' +
          '</div>' +
          '<div class="detail-warning-values">' +
            '<div class="detail-warn-item"><div class="v">' + qty + '</div><div class="k">当前库存</div></div>' +
            '<div class="detail-warn-item"><div class="v">' + threshold + '</div><div class="k">安全阈值</div></div>' +
          '</div>' +
        '</div>';
    }
  } else {
    warningHtml =
      '<div class="detail-warning is-ok">' +
        '<div class="detail-warning-main">' +
          '<span class="detail-warning-icon">' + ERP.icon('info', 17) + '</span>' +
          '<div>' +
            '<div class="detail-warning-title">简易模式 · 不参与数量预警</div>' +
            '<div class="detail-warning-desc">海量小件只记录「有货 / 空」，用完由管理员手动标记为空；当前状态：' +
              (material.status === 'empty' ? '空' : '有货') + '。</div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  /* ---------------- 历史领用记录 ---------------- */

  var ACTION_TONE = { borrow: 'tag-brand', empty: 'tag-empty', restock: 'tag-ok' };

  function historyRows() {
    if (!logs.length) {
      return '<tr><td colspan="7"><div class="detail-empty-row">' +
        '该物料暂无领用 / 入库记录。</div></td></tr>';
    }
    return logs.map(function (log) {
      var tone = ACTION_TONE[log.action] || 'tag-simple';
      var actionLabel = (ERP.config.actionLabels || {})[log.action] || log.action;
      var qtyText = '—';
      if (log.qty != null) {
        qtyText = (log.action === 'restock' ? '+' : '') + log.qty + ' 件';
      }
      return '<tr>' +
        '<td><span class="cell-mono">' + esc(log.id) + '</span></td>' +
        '<td><span class="tag ' + tone + ' tag-dot">' + esc(actionLabel) + '</span></td>' +
        '<td>' + esc(log.borrower || '—') + '</td>' +
        '<td>' + esc(log.project || '—') + '</td>' +
        '<td class="col-num"><span class="cell-mono">' + esc(qtyText) + '</span></td>' +
        '<td><span class="cell-mono">' + esc(ERP.ui.fmtDateTime(log.borrowAt)) + '</span></td>' +
        '<td>' + esc(log.operator || '—') + '</td>' +
      '</tr>';
    }).join('');
  }

  /* ---------------- 右侧卡片：最近领用 ---------------- */

  function recentBorrowHtml() {
    var list = logs.filter(function (log) { return log.action === 'borrow'; }).slice(0, 3);
    if (!list.length) {
      return '<div class="detail-recent-empty">暂无领用记录</div>';
    }
    return '<div class="detail-recent-list">' + list.map(function (log) {
      return '<div class="detail-recent-item">' +
        '<span class="detail-recent-dot"></span>' +
        '<div>' +
          '<div class="detail-recent-main">' + esc(log.borrower || '—') +
            (log.project ? ' · ' + esc(log.project) : '') + '</div>' +
          '<div class="detail-recent-sub">' + esc(ERP.ui.fmtDateTime(log.borrowAt)) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- 页面渲染 ---------------- */

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<a class="back-link" href="' + esc(ERP.url('index.html')) + '">' +
          ERP.icon('arrowLeft', 14) + '返回物料总览</a>' +
        '<div class="detail-title-row">' +
          '<h1 class="page-title">' + esc(material.name) + '</h1>' +
          ERP.ui.tagMode(material.mode) +
          ERP.ui.tagStatus(material) +
        '</div>' +
        '<p class="page-desc">档案编号 ' + esc(material.id) +
          ' · 型号 ' + esc(material.model || '—') +
          ' · 分类 ' + esc(category || '—') + '</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<a class="btn" href="' + esc(ERP.url('index.html')) + '">返回列表</a>' +
        actions +
      '</div>' +
    '</div>' +

    '<div class="detail-grid">' +
      '<div class="card detail-media-card">' +
        '<div class="card-bd">' +
          '<div class="detail-media">' +
            '<img src="' + esc(image) + '" alt="' + esc(material.name) + '" loading="lazy">' +
          '</div>' +
          '<div class="detail-side-block">' +
            '<div class="detail-side-title">档案信息</div>' +
            '<dl class="detail-side-list">' +
              '<div><dt>档案编号</dt><dd class="mono">' + esc(material.id) + '</dd></div>' +
              '<div><dt>入库时间</dt><dd>' + esc(ERP.ui.fmtDateTime(material.inboundAt)) + '</dd></div>' +
              '<div><dt>最近更新</dt><dd>' + esc(ERP.ui.fmtDateTime(material.updatedAt)) + '</dd></div>' +
              '<div><dt>存放位置</dt><dd>' + esc(location || '—') + '</dd></div>' +
            '</dl>' +
          '</div>' +
          '<div class="detail-side-block">' +
            '<div class="detail-side-title">存放要求</div>' +
            '<p class="detail-side-text">' + esc(material.note || '无特殊存放要求，按常规元器件保管即可。') + '</p>' +
          '</div>' +
          '<div class="detail-side-block">' +
            '<div class="detail-side-title">规格参数</div>' +
            '<p class="detail-side-text">' + esc(material.spec || '暂无规格参数记录。') + '</p>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card detail-info-card">' +
        '<div class="card-hd">' +
          '<div class="card-title">基本信息</div>' +
          '<span class="tag tag-brand">' + esc(category || '未分类') + '</span>' +
        '</div>' +
        '<div class="card-bd">' +
          statsHtml +
          '<dl class="detail-list">' +
            '<div class="detail-item"><dt>料号 / 型号</dt><dd class="mono">' + esc(material.model || '—') + '</dd></div>' +
            '<div class="detail-item"><dt>封装</dt><dd>' + esc(material.package || '—') + '</dd></div>' +
            '<div class="detail-item"><dt>品牌</dt><dd>' + esc(material.brand || '—') + '</dd></div>' +
            '<div class="detail-item"><dt>物料分类</dt><dd>' + esc(category || '—') + '</dd></div>' +
            '<div class="detail-item"><dt>管理模式</dt><dd>' + (ERP.config.modeLabels || {})[material.mode] + '</dd></div>' +
            '<div class="detail-item"><dt>库存状态</dt><dd>' +
              (material.status === 'empty' ? '空' : '有货') +
              (isPrecise ? '（' + qty + ' 件 / 阈值 ' + threshold + ' 件）' : '') + '</dd></div>' +
            '<div class="detail-item"><dt>来源项目</dt><dd>' + esc(material.source || '—') + '</dd></div>' +
            '<div class="detail-item"><dt>资料归属</dt><dd>' + esc(ERP.config.clubName) + '</dd></div>' +
          '</dl>' +
          '<div class="detail-recent">' +
            '<div class="detail-recent-head">' +
              '<span class="detail-side-title">最近领用</span>' +
              '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">全部日志 ›</a>' +
            '</div>' +
            recentBorrowHtml() +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    warningHtml +

    '<div class="card section-gap detail-history">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">历史领用记录</div>' +
          '<div class="card-sub">共 ' + logs.length + ' 条记录，日志永久保留，仅可追加不可修改</div>' +
        '</div>' +
        '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">查看全部日志 ›</a>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>记录号</th>' +
            '<th>类型</th>' +
            '<th>领用人</th>' +
            '<th>所属项目</th>' +
            '<th class="col-num">数量</th>' +
            '<th>领用 / 入库时间</th>' +
            '<th>经办人</th>' +
          '</tr></thead>' +
          '<tbody>' + historyRows() + '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }
})();
