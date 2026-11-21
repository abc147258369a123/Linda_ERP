/**
 * 新增 / 编辑物料页（仅管理员）
 * - 简易模式自动隐藏数量与预警阈值；精确计数模式才显示
 * - 入库时间由系统自动填充，只读不可手改
 * - 新建后跳转到详情页；编辑时复用本页（?id=xxx）
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;

  await ERP.store.load();

  var editingId = ERP.ui.getParam('id');
  var editing = editingId ? ERP.store.getMaterial(editingId) : null;

  var view = ERP.layout.mount({
    active: 'material-new',
    title: editingId ? '编辑物料' : '新增物料'
  });
  if (!view) return;
  var page = view.content;

  function detailHref(id) {
    return ERP.url('pages/material-detail.html?id=' + encodeURIComponent(id));
  }

  if (editingId && !editing) {
    page.innerHTML =
      '<div class="card"><div class="card-bd">' +
        '<div class="empty" style="padding:72px 24px;">' +
          '<div class="empty-title">物料不存在或已被移除</div>' +
          '<div class="empty-desc">请返回物料总览重新选择要编辑的档案。</div>' +
          '<div style="margin-top:16px">' +
            '<a class="btn btn-primary btn-sm" href="' + esc(ERP.url('index.html')) + '">返回物料总览</a>' +
          '</div>' +
        '</div>' +
      '</div></div>';
    return;
  }

  /* ---------------- 初始状态 ---------------- */

  var inboundAt = editing ? editing.inboundAt : ERP.store.now();
  var state = {
    mode: editing ? editing.mode : 'simple',
    status: editing && editing.status === 'empty' ? 'empty' : 'available',
    image: editing && editing.image ? editing.image : 'assets/img/default.svg'
  };

  var IMAGE_PRESETS = [
    { file: 'default.svg', label: '默认' },
    { file: 'esp32.svg', label: 'ESP32' },
    { file: 'arduino.svg', label: 'Arduino' },
    { file: 'stm32.svg', label: 'STM32' },
    { file: 'led.svg', label: 'LED' },
    { file: 'resistor.svg', label: '电阻' },
    { file: 'capacitor.svg', label: '电容' },
    { file: 'oled.svg', label: 'OLED' },
    { file: 'relay.svg', label: '继电器' },
    { file: 'sensor.svg', label: '传感器' },
    { file: 'bluetooth.svg', label: '蓝牙' },
    { file: 'nrf.svg', label: '无线模块' },
    { file: 'battery.svg', label: '电池' },
    { file: 'driver.svg', label: '驱动模块' },
    { file: 'wire.svg', label: '杜邦线' },
    { file: 'breadboard.svg', label: '面包板' },
    { file: 'pin.svg', label: '排针' },
    { file: 'tube.svg', label: '热缩管' },
    { file: 'perfboard.svg', label: '洞洞板' }
  ];

  var categoryOptions = '<option value="">请选择分类</option>' +
    ERP.store.categories().map(function (category) {
      return '<option value="' + esc(category.id) + '"' +
        (editing && editing.categoryId === category.id ? ' selected' : '') + '>' +
        esc(category.name) + '</option>';
    }).join('');

  var sourceList = [];
  ERP.store.materials().forEach(function (material) {
    if (material.source && sourceList.indexOf(material.source) < 0) sourceList.push(material.source);
  });
  var sourceOptions = sourceList.map(function (source) {
    return '<option value="' + esc(source) + '"></option>';
  }).join('');

  var imageOptions = IMAGE_PRESETS.map(function (preset) {
    var selected = state.image === 'assets/img/' + preset.file;
    return '<button type="button" class="image-option" data-image="assets/img/' + esc(preset.file) + '" ' +
      'aria-pressed="' + (selected ? 'true' : 'false') + '" title="' + esc(preset.label) + '">' +
      '<img src="' + esc(ERP.url('assets/img/' + preset.file)) + '" alt="" loading="lazy">' +
      '<span>' + esc(preset.label) + '</span>' +
    '</button>';
  }).join('');

  /* ---------------- 页面结构 ---------------- */

  var formTitle = editingId ? '编辑物料' : '新增物料';
  var formDesc = editingId
    ? '正在编辑 ' + editing.id + ' · 入库时间保持原值，不可修改'
    : '带 * 为必填项 · 入库时间由系统自动填充';

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<a class="back-link" href="' + esc(editingId ? detailHref(editing.id) : ERP.url('index.html')) + '">' +
          ERP.icon('arrowLeft', 14) + (editingId ? '返回物料详情' : '返回物料总览') + '</a>' +
        '<h1 class="page-title">' + esc(formTitle) + '</h1>' +
        '<p class="page-desc">' + esc(formDesc) + '</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<span class="tag tag-brand">管理员操作</span>' +
        '<a class="btn" href="' + esc(ERP.url('index.html')) + '">物料总览</a>' +
      '</div>' +
    '</div>' +

    '<form id="materialForm" novalidate>' +

      '<div class="card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">基本信息</div>' +
            '<div class="card-sub">物料名称与料号 / 型号为必填项，方便后续检索</div>' +
          '</div>' +
          '<span class="tag tag-brand">档案信息</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="form-grid">' +
            '<div class="field">' +
              '<label class="label" for="materialName">物料名称<span class="req">*</span></label>' +
              '<input class="input" id="materialName" type="text" maxlength="40" ' +
                'placeholder="如：ESP32-WROOM-32 开发板" value="' +
                esc(editing ? editing.name : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialModel">料号 / 型号<span class="req">*</span></label>' +
              '<input class="input input-mono" id="materialModel" type="text" maxlength="60" ' +
                'placeholder="如：ESP32-WROOM-32E" value="' +
                esc(editing ? editing.model : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialPackage">封装</label>' +
              '<input class="input" id="materialPackage" type="text" maxlength="40" ' +
                'placeholder="如：SMD-38 / 直插 / 模块" value="' +
                esc(editing ? editing.package : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialBrand">品牌</label>' +
              '<input class="input" id="materialBrand" type="text" maxlength="40" ' +
                'placeholder="如：Espressif / 国产" value="' +
                esc(editing ? editing.brand : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialCategory">物料分类<span class="req">*</span></label>' +
              '<select class="select" id="materialCategory">' + categoryOptions + '</select>' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialSource">来源项目（所属项目）</label>' +
              '<input class="input" id="materialSource" type="text" list="sourceOptions" maxlength="40" ' +
                'placeholder="如：智能小车项目" value="' + esc(editing ? editing.source : '') + '">' +
              '<datalist id="sourceOptions">' + sourceOptions + '</datalist>' +
            '</div>' +
            '<div class="field is-full">' +
              '<label class="label" for="materialSpec">规格参数</label>' +
              '<textarea class="textarea" id="materialSpec" maxlength="200" ' +
                'placeholder="如：双核 240MHz / 4MB Flash / Wi-Fi+BT">' +
                esc(editing ? editing.spec : '') + '</textarea>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card section-gap">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">管理模式与库存</div>' +
            '<div class="card-sub">简易模式只记有货 / 空；精确计数模式记录数量并支持低库存预警</div>' +
          '</div>' +
          '<span class="tag ' + (state.mode === 'precise' ? 'tag-precise' : 'tag-simple') + '" id="modeTag">' +
            (state.mode === 'precise' ? '精确计数' : '简易模式') +
          '</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="mode-picker" role="group" aria-label="管理模式">' +
            '<button type="button" class="mode-option" data-mode="simple" aria-pressed="' +
              (state.mode === 'simple' ? 'true' : 'false') + '">' +
              '<span class="mode-icon">' + ERP.icon('tag', 16) + '</span>' +
              '<span><strong>简易模式</strong>' +
                '<small>LED、电阻等海量小件，只记有货 / 空</small></span>' +
            '</button>' +
            '<button type="button" class="mode-option" data-mode="precise" aria-pressed="' +
              (state.mode === 'precise' ? 'true' : 'false') + '">' +
              '<span class="mode-icon is-blue">' + ERP.icon('chip', 16) + '</span>' +
              '<span><strong>精确计数</strong>' +
                '<small>ESP32、芯片等稀缺器件，记录库存数量</small></span>' +
            '</button>' +
          '</div>' +

          '<div class="form-grid section-gap">' +
            '<div class="field" data-mode-field="precise">' +
              '<label class="label" for="materialQty">库存数量</label>' +
              '<input class="input input-mono" id="materialQty" type="number" min="0" step="1" ' +
                'value="' + esc(editing && editing.mode === 'precise' && editing.qty != null ? editing.qty : 0) + '">' +
              '<span class="field-hint">库存为 0 时自动标记为空</span>' +
            '</div>' +
            '<div class="field" data-mode-field="precise">' +
              '<label class="label" for="materialMinQty">最低库存预警</label>' +
              '<input class="input input-mono" id="materialMinQty" type="number" min="0" step="1" ' +
                'value="' + esc(editing && editing.mode === 'precise' && editing.minQty != null ? editing.minQty : 0) + '">' +
              '<span class="field-hint">库存 ≤ 阈值时进入库存预警</span>' +
            '</div>' +
            '<div class="field" data-mode-field="simple">' +
              '<label class="label">库存状态</label>' +
              '<div class="choice-picker">' +
                '<button type="button" class="choice-option" data-status="available" aria-pressed="' +
                  (state.status === 'available' ? 'true' : 'false') + '">有货</button>' +
                '<button type="button" class="choice-option" data-status="empty" aria-pressed="' +
                  (state.status === 'empty' ? 'true' : 'false') + '">空</button>' +
              '</div>' +
              '<span class="field-hint">用完可标记为空，档案保留，补货后直接复用</span>' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialCabinet">存放柜号</label>' +
              '<input class="input" id="materialCabinet" type="text" maxlength="20" ' +
                'placeholder="如：A 柜" value="' + esc(editing ? editing.cabinet : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialSlot">存放格子</label>' +
              '<input class="input input-mono" id="materialSlot" type="text" maxlength="20" ' +
                'placeholder="如：A-03-2" value="' + esc(editing ? editing.slot : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="materialInbound">入库时间</label>' +
              '<input class="input input-mono" id="materialInbound" type="text" readonly value="' +
                esc(inboundAt) + '">' +
              '<span class="field-hint">系统自动填充，不可手动修改</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card section-gap">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">物料图片与备注</div>' +
            '<div class="card-sub">选择一张示意图作为档案图片，也可保留默认图片</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="field">' +
            '<span class="label">物料图片</span>' +
            '<div class="image-grid" id="imageGrid" role="group" aria-label="物料图片">' +
              imageOptions +
            '</div>' +
          '</div>' +
          '<div class="field section-gap">' +
            '<label class="label" for="materialNote">备注</label>' +
            '<textarea class="textarea" id="materialNote" maxlength="200" ' +
              'placeholder="存放注意事项、使用说明、配件情况等">' +
              esc(editing ? editing.note : '') + '</textarea>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="form-actions">' +
        '<a class="btn" href="' + esc(editingId ? detailHref(editing.id) : ERP.url('index.html')) + '">取消</a>' +
        '<button class="btn btn-primary" type="submit" id="saveBtn">' +
          (editingId ? '保存修改' : '保存物料') +
        '</button>' +
      '</div>' +
    '</form>';

  /* ---------------- 联动与交互 ---------------- */

  var nameInput = $('#materialName');
  var modelInput = $('#materialModel');
  var categorySelect = $('#materialCategory');
  var qtyInput = $('#materialQty');
  var minQtyInput = $('#materialMinQty');
  var form = $('#materialForm');

  function applyMode() {
    ERP.ui.$all('[data-mode-field]').forEach(function (field) {
      field.hidden = field.getAttribute('data-mode-field') !== state.mode;
    });
    ERP.ui.$all('.mode-option').forEach(function (option) {
      option.setAttribute('aria-pressed', String(option.getAttribute('data-mode') === state.mode));
    });
    var modeTag = $('#modeTag');
    modeTag.className = 'tag ' + (state.mode === 'precise' ? 'tag-precise' : 'tag-simple');
    modeTag.textContent = state.mode === 'precise' ? '精确计数' : '简易模式';
  }

  ERP.ui.$all('.mode-option').forEach(function (option) {
    option.addEventListener('click', function () {
      state.mode = option.getAttribute('data-mode');
      applyMode();
    });
  });

  ERP.ui.$all('.choice-option').forEach(function (option) {
    option.addEventListener('click', function () {
      state.status = option.getAttribute('data-status');
      ERP.ui.$all('.choice-option').forEach(function (item) {
        item.setAttribute('aria-pressed', String(item === option));
      });
    });
  });

  var imageGrid = $('#imageGrid');
  imageGrid.addEventListener('click', function (event) {
    var option = event.target.closest('.image-option');
    if (!option) return;
    state.image = option.getAttribute('data-image');
    ERP.ui.$all('.image-option').forEach(function (item) {
      item.setAttribute('aria-pressed', String(item === option));
    });
  });

  applyMode();

  /* ---------------- 校验与保存 ---------------- */

  function clearInvalid() {
    ERP.ui.$all('.field.is-invalid').forEach(function (field) {
      field.classList.remove('is-invalid');
    });
  }
  function markInvalid(input, message) {
    var field = input.closest('.field');
    if (field) field.classList.add('is-invalid');
    return message;
  }

  function collectPayload() {
    clearInvalid();
    var errors = [];

    var name = String(nameInput.value || '').trim();
    if (!name) errors.push(markInvalid(nameInput, '请填写物料名称'));
    if (name.length > 40) errors.push(markInvalid(nameInput, '物料名称不要超过 40 个字'));

    var model = String(modelInput.value || '').trim();
    if (!model) errors.push(markInvalid(modelInput, '请填写料号 / 型号'));

    var categoryId = categorySelect.value;
    if (!categoryId) {
      var categoryField = categorySelect.closest('.field');
      if (categoryField) categoryField.classList.add('is-invalid');
      errors.push('请选择物料分类');
    }

    var qty = 0;
    var minQty = 0;
    if (state.mode === 'precise') {
      var qtyRaw = String(qtyInput.value || '').trim();
      qty = qtyRaw === '' ? 0 : Number(qtyRaw);
      if (!isFinite(qty) || qty < 0 || Math.floor(qty) !== qty) {
        errors.push(markInvalid(qtyInput, '库存数量需为非负整数'));
      }
      var minQtyRaw = String(minQtyInput.value || '').trim();
      minQty = minQtyRaw === '' ? 0 : Number(minQtyRaw);
      if (!isFinite(minQty) || minQty < 0 || Math.floor(minQty) !== minQty) {
        errors.push(markInvalid(minQtyInput, '预警阈值需为非负整数'));
      }
    }

    if (!errors.length) {
      var duplicated = ERP.store.materials().some(function (material) {
        if (editing && material.id === editing.id) return false;
        return String(material.name).trim().toLowerCase() === name.toLowerCase() &&
          String(material.model).trim().toLowerCase() === model.toLowerCase();
      });
      if (duplicated) {
        markInvalid(nameInput, '重复档案');
        errors.push('已存在同名同型号的物料档案，请核对后再提交');
      }
    }

    if (errors.length) {
      ERP.ui.toast(errors[0], 'error');
      var firstInvalid = page.querySelector('.field.is-invalid .input, .field.is-invalid .select, .field.is-invalid .textarea');
      if (firstInvalid && firstInvalid.focus) firstInvalid.focus();
      return null;
    }

    return {
      id: editing ? editing.id : undefined,
      name: name,
      model: model,
      package: String($('#materialPackage').value || '').trim(),
      brand: String($('#materialBrand').value || '').trim(),
      categoryId: categoryId,
      source: String($('#materialSource').value || '').trim(),
      spec: String($('#materialSpec').value || '').trim(),
      mode: state.mode,
      qty: state.mode === 'precise' ? qty : null,
      minQty: state.mode === 'precise' ? minQty : null,
      status: state.mode === 'precise' ? (qty > 0 ? 'available' : 'empty') : state.status,
      cabinet: String($('#materialCabinet').value || '').trim(),
      slot: String($('#materialSlot').value || '').trim(),
      inboundAt: inboundAt,
      image: state.image,
      note: String($('#materialNote').value || '').trim()
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var saveBtn = $('#saveBtn');
    var payload = collectPayload();
    if (!payload) return;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      var saved = await ERP.store.upsertMaterial(payload);
      ERP.ui.toast(editingId ? '物料档案已更新' : '物料已建档，可在详情页查看', 'ok');
      window.setTimeout(function () {
        window.location.href = detailHref(saved.id);
      }, 320);
    } catch (error) {
      ERP.ui.toast(error.message || '保存失败', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = editingId ? '保存修改' : '保存物料';
    }
  });
})();
