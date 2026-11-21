/**
 * 领用登记页
 * - 全员可访问：选择物料 → 填写领用人 / 领用时间 / 所属项目
 * - 精确计数模式：填写领用数量，提交后扣减库存并自动生成日志
 * - 简易模式：只写日志不改状态；管理员的「标记为空」按钮对该物料可见
 * - 提交成功后跳转物料详情页，可在历史记录中看到这条流水
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;
  var isAdmin = ERP.auth.isAdmin(session);

  var view = ERP.layout.mount({ active: 'borrow', title: '领用登记' });
  if (!view) return;
  var page = view.content;

  // 若物料使用车中有物料，自动进入批量领用模式
  if (window.ERP.cart && ERP.cart.items().length) {
    renderBatchMode();
    return;
  }

  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }
  function nowLocalInput() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function imageOf(material) {
    var src = material && material.image ? material.image : 'assets/img/default.svg';
    return src.indexOf('data:') === 0 ? src : ERP.url(src);
  }

  /* ---------------- 数据准备 ---------------- */

  var materials = ERP.store.materials().slice().sort(function (a, b) {
    var ea = a.status === 'empty' ? 1 : 0;
    var eb = b.status === 'empty' ? 1 : 0;
    if (ea !== eb) return ea - eb;
    return String(a.name).localeCompare(String(b.name), 'zh');
  });

  var requestedId = ERP.ui.getParam('materialId');
  var initialMaterial = null;
  if (requestedId) {
    materials.forEach(function (material) {
      if (material.id === requestedId) initialMaterial = material;
    });
    if (initialMaterial && initialMaterial.status === 'empty') {
      initialMaterial = null;
      window.setTimeout(function () {
        ERP.ui.toast('该物料当前为空，补货后才能领用', 'warn');
      }, 120);
    }
  }

  var projectList = [];
  ERP.store.materials().forEach(function (material) {
    if (material.source && projectList.indexOf(material.source) < 0) projectList.push(material.source);
  });
  ERP.store.logs().forEach(function (log) {
    if (log.project && projectList.indexOf(log.project) < 0) projectList.push(log.project);
  });

  var materialOptions = '<option value="">请选择要领用的物料</option>' + materials.map(function (material) {
    var statusText = material.status === 'empty'
      ? '空，暂不可领用'
      : (material.mode === 'precise' ? '库存 ' + (Number(material.qty) || 0) + ' 件' : '有货');
    return '<option value="' + esc(material.id) + '"' +
      (initialMaterial && initialMaterial.id === material.id ? ' selected' : '') +
      (material.status === 'empty' ? ' disabled' : '') + '>' +
      esc(material.name) + ' · ' + esc(material.model || material.id) +
      '（' + esc(statusText) + '）</option>';
  }).join('');

  var projectOptions = projectList.map(function (project) {
    return '<option value="' + esc(project) + '"></option>';
  }).join('');

  /* ---------------- 最近领用动态 ---------------- */

  function recentBorrowHtml() {
    var logs = ERP.store.logs().filter(function (log) {
      return log.action === 'borrow';
    }).slice(0, 5);
    if (!logs.length) {
      return '<div class="borrow-empty">暂无领用记录</div>';
    }
    return '<div class="borrow-recent">' + logs.map(function (log) {
      return '<div class="borrow-recent-item">' +
        '<span class="borrow-recent-dot"></span>' +
        '<div>' +
          '<div class="borrow-recent-main">' + esc(log.materialName) + '</div>' +
          '<div class="borrow-recent-sub">' + esc(log.borrower || '—') +
            (log.project ? ' · ' + esc(log.project) : '') +
            ' · ' + esc(ERP.ui.fmtDateTime(log.borrowAt)) + '</div>' +
        '</div>' +
      '</div>';
    }).join('') + '</div>';
  }

  /* ---------------- 页面结构 ---------------- */

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">领用登记</h1>' +
        '<p class="page-desc">选择物料并填写领用信息，提交后自动写入领用日志；精确计数物料会同步扣减库存。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<a class="btn" href="' + esc(ERP.url('pages/logs.html')) + '">' + ERP.icon('list', 15) + '领用日志</a>' +
        '<a class="btn" href="' + esc(ERP.url('index.html')) + '">' + ERP.icon('grid', 15) + '物料总览</a>' +
      '</div>' +
    '</div>' +

    '<div class="borrow-grid">' +

      '<form class="card" id="borrowForm" novalidate>' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">领用信息</div>' +
            '<div class="card-sub">带 * 为必填项；领用时间默认当前时间，可修改</div>' +
          '</div>' +
          '<span class="tag tag-simple" id="borrowModeTag">未选择物料</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="form-grid">' +
            '<div class="field is-full">' +
              '<label class="label" for="materialSelect">领用物料<span class="req">*</span></label>' +
              '<select class="select" id="materialSelect">' + materialOptions + '</select>' +
              '<span class="field-hint">已空的物料不可领用；精确计数物料会校验领用数量</span>' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="borrowerInput">领用人<span class="req">*</span></label>' +
              '<input class="input" id="borrowerInput" type="text" maxlength="20" ' +
                'placeholder="请输入领用人姓名" value="' + esc(session.name) + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="borrowTimeInput">领用时间<span class="req">*</span></label>' +
              '<input class="input input-mono" id="borrowTimeInput" type="datetime-local" ' +
                'value="' + esc(nowLocalInput()) + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="projectInput">所属项目<span class="req">*</span></label>' +
              '<input class="input" id="projectInput" type="text" list="borrowProjectOptions" maxlength="40" ' +
                'placeholder="如：智能小车项目">' +
              '<datalist id="borrowProjectOptions">' + projectOptions + '</datalist>' +
            '</div>' +
            '<div class="field" data-borrow-field="precise" hidden>' +
              '<label class="label" for="borrowQtyInput">领用数量<span class="req">*</span></label>' +
              '<input class="input input-mono" id="borrowQtyInput" type="number" min="1" step="1" ' +
                'placeholder="请输入领用数量">' +
              '<span class="field-hint" id="borrowQtyHint"></span>' +
            '</div>' +
            '<div class="field is-full">' +
              '<label class="label" for="borrowNoteInput">备注</label>' +
              '<textarea class="textarea" id="borrowNoteInput" maxlength="120" ' +
                'placeholder="用途说明、归还约定等（选填）"></textarea>' +
            '</div>' +
          '</div>' +
          '<div class="form-actions">' +
            '<button class="btn btn-danger" type="button" id="markEmptyBtn" hidden>' +
              ERP.icon('box', 15) + '标记为空</button>' +
            '<button class="btn btn-primary" type="submit" id="submitBorrowBtn">' +
              ERP.icon('out', 15) + '提交领用登记</button>' +
          '</div>' +
        '</div>' +
      '</form>' +

      '<div class="borrow-side">' +
        '<div class="card">' +
          '<div class="card-hd">' +
            '<div class="card-title">物料信息</div>' +
            '<span class="tag tag-simple" id="summaryTag">未选择</span>' +
          '</div>' +
          '<div class="card-bd" id="materialSummary">' +
            '<div class="borrow-empty">请选择要领用的物料，这里会显示库存与存放信息。</div>' +
          '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-hd">' +
            '<div class="card-title">最近领用动态</div>' +
            '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">查看全部 ›</a>' +
          '</div>' +
          '<div class="card-bd">' + recentBorrowHtml() + '</div>' +
        '</div>' +

        '<div class="card">' +
          '<div class="card-hd"><div class="card-title">登记说明</div></div>' +
          '<div class="card-bd">' +
            '<ul class="borrow-tips">' +
              '<li>简易模式只记录领用日志，不扣减数量。</li>' +
              '<li>精确计数模式提交后自动扣减库存，扣到 0 自动标记为空。</li>' +
              '<li>「标记为空」按钮仅管理员可见，操作会写入日志且档案保留。</li>' +
              '<li>所有领用记录永久保留，可在物料详情或领用日志中查看。</li>' +
            '</ul>' +
          '</div>' +
        '</div>' +
      '</div>' +

    '</div>';

  /* ---------------- 选中物料联动 ---------------- */

  var materialSelect = $('#materialSelect');
  var preciseField = page.querySelector('[data-borrow-field="precise"]');
  var qtyInput = $('#borrowQtyInput');
  var qtyHint = $('#borrowQtyHint');
  var markEmptyBtn = $('#markEmptyBtn');
  var summary = $('#materialSummary');
  var summaryTag = $('#summaryTag');
  var modeTag = $('#borrowModeTag');
  var submitBtn = $('#submitBorrowBtn');

  function selectedMaterial() {
    var id = materialSelect.value;
    if (!id) return null;
    var found = null;
    materials.forEach(function (material) { if (material.id === id) found = material; });
    return found;
  }

  function renderSelection() {
    var material = selectedMaterial();
    qtyInput.value = '';
    qtyInput.removeAttribute('max');

    if (!material) {
      preciseField.hidden = true;
      markEmptyBtn.hidden = true;
      summaryTag.className = 'tag tag-simple';
      summaryTag.textContent = '未选择';
      modeTag.className = 'tag tag-simple';
      modeTag.textContent = '未选择物料';
      summary.innerHTML = '<div class="borrow-empty">请选择要领用的物料，这里会显示库存与存放信息。</div>';
      return;
    }

    var isPrecise = material.mode === 'precise';
    var qty = Number(material.qty) || 0;
    var threshold = Number(material.minQty) || 0;
    var category = ERP.store.categoryName(material.categoryId);
    var location = [material.cabinet, material.slot].filter(Boolean).join(' ');

    modeTag.className = 'tag ' + (isPrecise ? 'tag-precise' : 'tag-simple');
    modeTag.textContent = isPrecise ? '精确计数' : '简易模式';
    summaryTag.className = 'tag ' + (material.status === 'empty' ? 'tag-empty' : (isPrecise ? 'tag-precise' : 'tag-simple'));
    summaryTag.textContent = isPrecise ? (material.status === 'empty' ? '空' : '库存 ' + qty + ' 件') : (material.status === 'empty' ? '空' : '有货');

    preciseField.hidden = !isPrecise;
    if (isPrecise) {
      qtyInput.setAttribute('max', String(qty));
      qtyHint.textContent = '当前库存 ' + qty + ' 件，安全阈值 ' + threshold + ' 件';
    }

    markEmptyBtn.hidden = !(isAdmin && material.mode === 'simple' && material.status === 'available');

    var warningHtml = '';
    if (isPrecise && material.status !== 'empty' && threshold > 0 && qty <= threshold) {
      warningHtml = '<div class="notice is-warn" style="margin-top:12px;">' +
        ERP.icon('alert', 15) + '<span>该物料库存已低于安全阈值（' + qty + ' / ' + threshold +
        ' 件），领用后请留意补货。</span></div>';
    }

    summary.innerHTML =
      '<div class="borrow-material-head">' +
        '<div class="borrow-material-thumb">' +
          '<img src="' + esc(imageOf(material)) + '" alt="' + esc(material.name) + '" loading="lazy">' +
        '</div>' +
        '<div>' +
          '<div class="borrow-material-name">' + esc(material.name) + '</div>' +
          '<div class="borrow-material-meta">' + esc(material.model || '—') +
            (category ? ' · ' + esc(category) : '') + '</div>' +
        '</div>' +
      '</div>' +
      '<dl class="detail-list borrow-material-list">' +
        '<div class="detail-item"><dt>管理模式</dt><dd>' +
          ((ERP.config.modeLabels || {})[material.mode] || material.mode) + '</dd></div>' +
        '<div class="detail-item"><dt>当前库存</dt><dd>' +
          (isPrecise ? qty + ' 件' : (material.status === 'empty' ? '空' : '有货')) + '</dd></div>' +
        '<div class="detail-item"><dt>存放位置</dt><dd>' + esc(location || '—') + '</dd></div>' +
        '<div class="detail-item"><dt>来源项目</dt><dd>' + esc(material.source || '—') + '</dd></div>' +
        (isPrecise
          ? '<div class="detail-item"><dt>安全预警阈值</dt><dd>' + threshold + ' 件</dd></div>'
          : '') +
        '<div class="detail-item"><dt>档案编号</dt><dd class="mono">' + esc(material.id) + '</dd></div>' +
      '</dl>' +
      warningHtml;
  }

  materialSelect.addEventListener('change', renderSelection);

  /* ---------------- 提交领用 ---------------- */

  var form = $('#borrowForm');

  function fieldOf(input) {
    return input ? input.closest('.field') : null;
  }
  function markInvalid(input) {
    var field = fieldOf(input);
    if (field) field.classList.add('is-invalid');
  }
  function clearInvalid() {
    ERP.ui.$all('.field.is-invalid').forEach(function (field) {
      field.classList.remove('is-invalid');
    });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    clearInvalid();
    var material = selectedMaterial();
    var errors = [];
    if (!material) {
      markInvalid(materialSelect);
      errors.push('请选择要领用的物料');
    }
    var borrower = String($('#borrowerInput').value || '').trim();
    if (!borrower) {
      markInvalid($('#borrowerInput'));
      errors.push('请填写领用人');
    }
    var timeValue = String($('#borrowTimeInput').value || '').trim();
    if (!timeValue) {
      markInvalid($('#borrowTimeInput'));
      errors.push('请选择领用时间');
    }
    var project = String($('#projectInput').value || '').trim();
    if (!project) {
      markInvalid($('#projectInput'));
      errors.push('请填写所属项目');
    }
    var qty = null;
    if (material && material.mode === 'precise') {
      var qtyRaw = String(qtyInput.value || '').trim();
      qty = Number(qtyRaw);
      if (!qtyRaw || !isFinite(qty) || qty <= 0 || Math.floor(qty) !== qty) {
        markInvalid(qtyInput);
        errors.push('请输入正确的领用数量（正整数）');
      } else if (qty > (Number(material.qty) || 0)) {
        markInvalid(qtyInput);
        errors.push('领用数量不能超过当前库存（' + (Number(material.qty) || 0) + ' 件）');
      }
    }

    if (errors.length) {
      ERP.ui.toast(errors[0], 'error');
      var first = page.querySelector('.field.is-invalid .input, .field.is-invalid .select, .field.is-invalid .textarea');
      if (first && first.focus) first.focus();
      return;
    }

    var result = ERP.store.borrow({
      materialId: material.id,
      borrower: borrower,
      borrowAt: timeValue.replace('T', ' '),
      project: project,
      qty: qty,
      operator: session.name,
      note: String($('#borrowNoteInput').value || '').trim()
    });

    if (!result.ok) {
      ERP.ui.toast(result.error || '领用登记失败', 'error');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = '提交中…';
    ERP.ui.toast('领用登记成功，已写入领用日志', 'ok');
    window.setTimeout(function () {
      window.location.href = detailHref(material.id);
    }, 520);
  });

  /* ---------------- 标记为空（仅管理员 + 简易模式） ---------------- */

  markEmptyBtn.addEventListener('click', function () {
    var material = selectedMaterial();
    if (!material) return;
    ERP.ui.confirm({
      title: '标记为空',
      html: '确认将 <strong>' + esc(material.name) + '</strong> 标记为空吗？<br>' +
        '<span class="muted small">档案会保留，补货后可直接复用；本次操作会写入领用日志。</span>',
      okText: '确认标记为空',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      var result = ERP.store.markEmpty(material.id, session.name);
      if (!result.ok) {
        ERP.ui.toast(result.error || '操作失败', 'error');
        return;
      }
      ERP.layout.refreshAlertsBadge();
      ERP.ui.toast('已标记为空，并写入领用日志', 'ok');
      window.setTimeout(function () {
        window.location.href = detailHref(material.id);
      }, 420);
    });
  });

  renderSelection();

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }

  /* ================= 批量领用模式（物料使用车） ================= */

  function renderBatchMode() {
    var items = ERP.cart.items();
    if (!items.length) {
      window.location.href = ERP.url('pages/borrow.html');
      return;
    }

    var projectList = [];
    ERP.store.materials().forEach(function (material) {
      if (material.source && projectList.indexOf(material.source) < 0) projectList.push(material.source);
    });
    ERP.store.logs().forEach(function (log) {
      if (log.project && projectList.indexOf(log.project) < 0) projectList.push(log.project);
    });
    var projectOptions = projectList.map(function (project) {
      return '<option value="' + esc(project) + '"></option>';
    }).join('');

    page.innerHTML =
      '<div class="page-head">' +
        '<div>' +
          '<h1 class="page-title">领用登记</h1>' +
          '<p class="page-desc">批量登记：已从物料使用车带入 <strong id="batchHeadCount">' +
            items.length + '</strong> 种物料，填写一次领用信息即可提交多条记录。</p>' +
        '</div>' +
        '<div class="page-head-actions">' +
          '<button class="btn btn-danger" type="button" id="clearCartBtn">' +
            ERP.icon('trash', 15) + '清空使用车</button>' +
          '<a class="btn" href="' + esc(ERP.url('index.html')) + '">' +
            ERP.icon('grid', 15) + '物料总览</a>' +
        '</div>' +
      '</div>' +

      '<div class="borrow-grid">' +
        '<form id="batchForm" novalidate>' +
          '<div class="card">' +
            '<div class="card-hd">' +
              '<div>' +
                '<div class="card-title">使用车物料</div>' +
                '<div class="card-sub" id="batchListSub">共 ' + items.length +
                  ' 种物料，可在提交前移除不需要的物料</div>' +
              '</div>' +
              '<span class="tag tag-brand">批量领用</span>' +
            '</div>' +
            '<div class="card-bd">' +
              '<div class="notice" style="margin-bottom:14px;">' +
                ERP.icon('info', 15) +
                '<span>已自动读取物料使用车；提交后逐条生成领用记录，精确计数物料会扣减库存。</span>' +
              '</div>' +
              '<div class="batch-list" id="batchList"></div>' +
            '</div>' +
          '</div>' +

          '<div class="card section-gap">' +
            '<div class="card-hd">' +
              '<div>' +
                '<div class="card-title">领用信息</div>' +
                '<div class="card-sub">以下信息将应用到本次全部领用记录</div>' +
              '</div>' +
            '</div>' +
            '<div class="card-bd">' +
              '<div class="form-grid">' +
                '<div class="field">' +
                  '<label class="label" for="batchBorrower">领用人<span class="req">*</span></label>' +
                  '<input class="input" id="batchBorrower" type="text" maxlength="20" ' +
                    'placeholder="请输入领用人姓名" value="' + esc(session.name) + '">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="label" for="batchTime">领用时间<span class="req">*</span></label>' +
                  '<input class="input input-mono" id="batchTime" type="datetime-local" value="' +
                    esc(nowLocalInput()) + '">' +
                '</div>' +
                '<div class="field">' +
                  '<label class="label" for="batchProject">所属项目<span class="req">*</span></label>' +
                  '<input class="input" id="batchProject" type="text" list="batchProjectOptions" ' +
                    'maxlength="40" placeholder="如：智能小车项目">' +
                  '<datalist id="batchProjectOptions">' + projectOptions + '</datalist>' +
                '</div>' +
                '<div class="field">' +
                  '<label class="label" for="batchOperator">经办人</label>' +
                  '<input class="input" id="batchOperator" type="text" readonly value="' +
                    esc(session.name) + '">' +
                '</div>' +
                '<div class="field is-full">' +
                  '<label class="label" for="batchNote">备注</label>' +
                  '<textarea class="textarea" id="batchNote" maxlength="120" ' +
                    'placeholder="本次批量领用的用途说明（选填）"></textarea>' +
                '</div>' +
              '</div>' +
              '<div class="form-actions">' +
                '<button class="btn" type="button" id="batchCancelBtn">取消批量登记</button>' +
                '<button class="btn btn-primary" type="submit" id="batchSubmitBtn">' +
                  '批量提交领用（' + items.length + ' 条）</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</form>' +

        '<div class="borrow-side">' +
          '<div class="card">' +
            '<div class="card-hd">' +
              '<div class="card-title">最近领用动态</div>' +
              '<a class="card-link" href="' + esc(ERP.url('pages/logs.html')) + '">查看全部 ›</a>' +
            '</div>' +
            '<div class="card-bd">' + recentBorrowHtml() + '</div>' +
          '</div>' +
          '<div class="card">' +
            '<div class="card-hd"><div class="card-title">批量登记说明</div></div>' +
            '<div class="card-bd">' +
              '<ul class="borrow-tips">' +
                '<li>同一批次的领用人、领用时间、所属项目共用。</li>' +
                '<li>精确计数物料按使用车数量扣减库存，提交前会校验库存充足。</li>' +
                '<li>简易模式物料只生成日志，不扣减数量。</li>' +
                '<li>提交成功后使用车自动清空，库存以最新数据为准。</li>' +
              '</ul>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>';

    var batchList = $('#batchList');
    var submitBtn = $('#batchSubmitBtn');

    function renderBatchList(list) {
      batchList.innerHTML = list.map(function (item) {
        var material = ERP.store.getMaterial(item.materialId);
        var isPrecise = material.mode === 'precise';
        return '<div class="batch-item" data-batch-row="' + esc(material.id) + '">' +
          '<div class="batch-item-main">' +
            '<div class="batch-item-name">' + esc(material.name) + '</div>' +
            '<div class="batch-item-meta">' + esc(material.model || '—') + ' · ' +
              (isPrecise
                ? '精确计数 · 当前库存 ' + (Number(material.qty) || 0) + ' 件'
                : '简易模式 · 不扣库存') + '</div>' +
          '</div>' +
          '<div class="batch-item-side">' +
            '<span class="batch-qty">×' + item.qty + '</span>' +
            '<button class="batch-item-remove" type="button" data-batch-remove="' +
              esc(material.id) + '" title="移出本批次">×</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    function refreshBatch() {
      var list = ERP.cart.items();
      if (!list.length) {
        window.location.href = ERP.url('pages/borrow.html');
        return;
      }
      renderBatchList(list);
      var headCount = $('#batchHeadCount');
      if (headCount) headCount.textContent = list.length;
      var sub = $('#batchListSub');
      if (sub) sub.textContent = '共 ' + list.length + ' 种物料，可在提交前移除不需要的物料';
      if (submitBtn) submitBtn.textContent = '批量提交领用（' + list.length + ' 条）';
    }

    renderBatchList(items);

    page.addEventListener('click', function (event) {
      var removeBtn = event.target.closest('[data-batch-remove]');
      if (removeBtn) {
        ERP.cart.remove(removeBtn.getAttribute('data-batch-remove'));
        refreshBatch();
        return;
      }
      if (event.target.closest('#clearCartBtn')) {
        ERP.ui.confirm({
          title: '清空物料使用车',
          message: '清空后将返回单条领用登记页面，确定继续吗？',
          okText: '清空',
          danger: true
        }).then(function (confirmed) {
          if (!confirmed) return;
          ERP.cart.clear();
          window.location.href = ERP.url('pages/borrow.html');
        });
        return;
      }
      if (event.target.closest('#batchCancelBtn')) {
        window.location.href = ERP.url('index.html');
      }
    });

    $('#batchForm').addEventListener('submit', function (event) {
      event.preventDefault();
      ERP.ui.$all('.field.is-invalid').forEach(function (field) {
        field.classList.remove('is-invalid');
      });

      var borrower = String($('#batchBorrower').value || '').trim();
      var timeValue = String($('#batchTime').value || '').trim();
      var project = String($('#batchProject').value || '').trim();
      var note = String($('#batchNote').value || '').trim();
      var errors = [];

      if (!borrower) {
        var borrowerField = $('#batchBorrower').closest('.field');
        if (borrowerField) borrowerField.classList.add('is-invalid');
        errors.push('请填写领用人');
      }
      if (!timeValue) {
        var timeField = $('#batchTime').closest('.field');
        if (timeField) timeField.classList.add('is-invalid');
        errors.push('请选择领用时间');
      }
      if (!project) {
        var projectField = $('#batchProject').closest('.field');
        if (projectField) projectField.classList.add('is-invalid');
        errors.push('请填写所属项目');
      }

      var current = ERP.cart.items();
      var prepared = [];
      current.forEach(function (item) {
        var material = ERP.store.getMaterial(item.materialId);
        var row = page.querySelector('[data-batch-row="' + item.materialId + '"]');
        if (!material) {
          if (row) row.classList.add('is-invalid');
          errors.push('使用车中存在已移除的物料，请刷新后重试');
          return;
        }
        if (material.status === 'empty') {
          if (row) row.classList.add('is-invalid');
          errors.push('「' + material.name + '」已为空，请从使用车移除后再提交');
          return;
        }
        if (material.mode === 'precise' && item.qty > (Number(material.qty) || 0)) {
          if (row) row.classList.add('is-invalid');
          errors.push('「' + material.name + '」库存不足（当前 ' +
            (Number(material.qty) || 0) + ' 件），请调整数量或移除');
          return;
        }
        prepared.push({
          material: material,
          qty: material.mode === 'precise' ? item.qty : null
        });
      });

      if (errors.length) {
        ERP.ui.toast(errors[0], 'error');
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = '提交中…';

      var success = 0;
      var failures = [];
      prepared.forEach(function (entry) {
        var result = ERP.store.borrow({
          materialId: entry.material.id,
          borrower: borrower,
          borrowAt: timeValue.replace('T', ' '),
          project: project,
          qty: entry.qty,
          operator: session.name,
          note: note
        });
        if (result.ok) success++;
        else failures.push(entry.material.name + '：' + (result.error || '提交失败'));
      });

      if (success > 0) {
        ERP.cart.clear();
        ERP.ui.toast('已提交 ' + success + ' 条领用登记', 'ok');
        window.setTimeout(function () {
          window.location.href = ERP.url('index.html') + '?borrowed=' + success;
        }, 600);
      } else {
        submitBtn.disabled = false;
        submitBtn.textContent = '批量提交领用（' + prepared.length + ' 条）';
        ERP.ui.toast(failures[0] || '批量领用提交失败', 'error');
      }
    });
  }
})();
