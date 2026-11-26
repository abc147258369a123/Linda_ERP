/**
 * 新增 / 编辑物料页（仅管理员）
 * - 简易模式自动隐藏数量与预警阈值；精确计数模式才显示
 * - 入库时间由系统自动填充，只读不可手改
 * - 新建后跳转到详情页；编辑时复用本页（?id=xxx）
 * - 物料分类使用一 / 二 / 三级级联下拉，始终绑定最深一级（叶子）分类 id
 * - 实拍图支持两种方式上传：点「选择图片上传」或直接 Ctrl+V 粘贴剪贴板里的图片
 *   （两条入口共用同一套校验与 /api/uploads 接口，数据库仍只存逗号分隔的相对路径）
 * - 编辑已有物料时，超级管理员可在底部操作区直接删除该物料（不可恢复）
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;
  var isSuper = ERP.auth.isSuper(session);

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

  // 是否为「编辑已有物料」模式：新增模式不出现删除入口
  var isEditing = Boolean(editingId && editing);

  var inboundAt = editing ? editing.inboundAt : ERP.store.now();
  var editingImages = editing && editing.image
    ? String(editing.image).split(',').map(function (item) { return item.trim(); })
        .filter(function (item) { return item && item.indexOf('/uploads/') === 0; })
    : [];
  var state = {
    mode: editing ? editing.mode : 'simple',
    status: editing && editing.status === 'empty' ? 'empty' : 'available',
    image: editing && editing.image && editingImages.length === 0 ? editing.image : 'assets/img/default.svg',
    images: editingImages.slice(0, 5)
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

  /* ---------------- 物料分类：三级级联下拉（v1.4.0） ---------------- */

  // 分类树层级不固定，按实际 children 动态展开；最多展示 3 级，
  // 超过 3 级的分类只取前 3 级（第 3 级即视为末级分类）。
  var MAX_CATEGORY_LEVEL = 3;
  var LEVEL_LABELS = ['一', '二', '三'];

  // 分类树快照（ERP.store.categoryTree()），每次渲染前刷新
  var categoryTreeCache = ERP.store.categoryTree();
  // 已选分类节点链：categoryChain[0] 一级、[1] 二级、[2] 三级；未选为 null
  var categoryChain = [];
  // 编辑模式下原分类已不在分类树中时的提示文案（非空即显示）
  var categoryMissingTip = '';

  // 三个级联下拉对所有角色使用同一套逻辑；超级管理员额外多一个「新建子分类」按钮
  // 布局：占满表单整行 + 弹性排布，桌面同一行、窄屏自动换行，沿用页面 .select 样式
  // ---------------------------------------------------------------------------
  // v1.6.0：一 / 二 / 三级「可输入下拉」组件
  //   - 可下拉选择已有分类，也可直接输入分类名称；
  //   - 输入系统里不存在的分类名称时，提交物料时自动创建对应层级分类
  //     （后端 POST /api/categories 仅超级管理员可用，普通管理员会被拦截提示）；
  //   - 级联逻辑保留：上级变化 / 输入变化会清空更深层级。
  // ---------------------------------------------------------------------------
  function comboLevelHtml(level) {
    var label = LEVEL_LABELS[level - 1];
    return '<div class="combo" data-combo-level="' + level + '" style="flex:1 1 170px;min-width:0">' +
      '<div class="combo-control">' +
        '<input class="input combo-input" id="categoryLevel' + level + '" type="text" ' +
          'autocomplete="off" spellcheck="false" ' +
          'placeholder="选择或输入' + label + '级分类" aria-label="' + label + '级分类" ' +
          'aria-autocomplete="list" aria-controls="categoryLevel' + level + 'Menu" ' +
          (level > 1 ? 'disabled ' : '') + '>' +
        '<button class="combo-toggle" type="button" tabindex="-1" ' +
          'aria-label="展开' + label + '级分类备选" aria-haspopup="listbox">' +
          ERP.icon('chevronRight', 12) +
        '</button>' +
      '</div>' +
      '<div class="combo-menu" id="categoryLevel' + level + 'Menu" role="listbox" hidden></div>' +
    '</div>';
  }

  var categoryFieldHtml =
    '<div class="combo-row">' +
      comboLevelHtml(1) + comboLevelHtml(2) + comboLevelHtml(3) +
    '</div>' +
    '<span class="field-hint" id="categoryHint">可下拉选择已有分类，也可直接输入分类名称；输入不存在的分类时，提交物料会自动创建（仅超级管理员可自动新建）</span>' +
    '<span class="field-hint" id="categoryPathTip" style="color:var(--warn);display:none"></span>' +
    (isSuper
      ? '<div style="margin-top:2px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<button class="btn btn-sm" type="button" id="addChildCategoryBtn">' +
            ERP.icon('plus', 14) + '新建子分类' +
          '</button>' +
          '<span class="field-hint">在当前选中的分类下新建；未选分类时新建一级分类</span>' +
        '</div>'
      : '');

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

  // 删除入口：只在「编辑已有物料 + 超级管理员」时渲染，普通管理员不输出该节点（不用 CSS 隐藏）
  var deleteButtonHtml = isEditing && isSuper
    ? '<button class="btn btn-danger" type="button" id="deleteMaterialBtn" style="margin-right:auto">' +
        ERP.icon('trash', 15) + '删除物料' +
      '</button>'
    : '';

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
              '<label class="label" for="materialJlcNo">嘉立创编号</label>' +
              '<input class="input input-mono" id="materialJlcNo" type="text" maxlength="64" ' +
                'placeholder="选填，如：C123456" value="' +
                esc(editing ? (editing.jlcNo || '') : '') + '">' +
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
            '<div class="field is-full" id="categoryCascadeField">' +
              '<label class="label" for="categoryLevel1">物料分类<span class="req">*</span></label>' +
              categoryFieldHtml +
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
            '<div class="card-sub">可上传多张实拍图（jpg / png，单张 ≤ 5MB，最多 5 张）；也可复制图片后按 Ctrl+V 粘贴上传；图片存服务器本地目录，数据库只保存相对路径</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="field">' +
            '<span class="label">实拍图片</span>' +
            '<div class="upload-row">' +
              '<label class="btn btn-sm" for="materialImages">' + ERP.icon('upload', 14) + '选择图片上传</label>' +
              '<input class="upload-input" id="materialImages" type="file" accept="image/jpeg,image/png" multiple>' +
              '<span class="field-hint" id="uploadHint">未选择图片</span>' +
              '<span class="field-hint">支持 Ctrl+V 粘贴图片</span>' +
            '</div>' +
            '<div class="uploaded-grid" id="uploadedGrid"></div>' +
          '</div>' +
          '<div class="field section-gap">' +
            '<span class="label">示意图 / 默认图片</span>' +
            '<div class="image-grid" id="imageGrid" role="group" aria-label="物料图片">' +
              imageOptions +
            '</div>' +
            '<span class="field-hint">未上传实拍图时使用这里选中的示意图作为档案封面</span>' +
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
        deleteButtonHtml +
        '<a class="btn" href="' + esc(editingId ? detailHref(editing.id) : ERP.url('index.html')) + '">取消</a>' +
        '<button class="btn btn-primary" type="submit" id="saveBtn">' +
          (editingId ? '保存修改' : '保存物料') +
        '</button>' +
      '</div>' +
    '</form>';

  /* ---------------- 物料分类：级联渲染 / 联动 / 回填 ---------------- */

  var categoryField = $('#categoryCascadeField');
  var categoryLevel1 = $('#categoryLevel1');
  var categoryLevel2 = $('#categoryLevel2');
  var categoryLevel3 = $('#categoryLevel3');
  var categoryHint = $('#categoryHint');
  var categoryPathTip = $('#categoryPathTip');
  var addChildCategoryBtn = $('#addChildCategoryBtn');

  /* =========================================================================
     v1.6.0 分类「可输入下拉」组件逻辑
     ========================================================================= */

  var comboState = { openLevel: 0, activeIndex: -1 };

  function levelInput(level) { return $('#categoryLevel' + level); }
  function levelMenu(level) { return $('#categoryLevel' + level + 'Menu'); }
  function levelCombo(level) {
    var input = levelInput(level);
    return input && input.closest ? input.closest('.combo') : null;
  }

  function hasChildren(node) {
    return Boolean(node && node.children && node.children.length);
  }

  /** 已选链截断到 level 级（丢弃更深层级的选择） */
  function truncateChain(level) {
    if (categoryChain.length > level) categoryChain.length = level;
  }

  /**
   * 从分类树自底向上找完整路径（父 → … → 自身）。
   * 找不到（分类已删除 / 不在树中）返回空数组。
   */
  function resolvePath(categoryId) {
    var target = String(categoryId === null || categoryId === undefined ? '' : categoryId);
    var path = [];
    if (!target) return path;
    function walk(nodes, chain) {
      for (var i = 0; i < nodes.length; i += 1) {
        var node = nodes[i];
        var next = chain.concat([node]);
        if (String(node.id) === target) {
          path = next;
          return true;
        }
        if (hasChildren(node) && walk(node.children, next)) return true;
      }
      return false;
    }
    walk(categoryTreeCache, []);
    return path;
  }

  /** 按 id 在分类树中递归查找节点 */
  function findNodeById(nodes, id) {
    if (!nodes) return null;
    for (var i = 0; i < nodes.length; i += 1) {
      if (String(nodes[i].id) === String(id)) return nodes[i];
      var found = findNodeById(nodes[i].children || [], id);
      if (found) return found;
    }
    return null;
  }

  /** 某一级的候选分类：一级取根节点，二 / 三级取上一级已选节点的 children */
  function candidatesOf(level) {
    if (level === 1) return categoryTreeCache;
    var parent = categoryChain[level - 2];
    return hasChildren(parent) ? parent.children : [];
  }

  /** 按路径（根 → 叶）整体预选，用于编辑回填与新建分类后自动选中 */
  function setCategoryChain(path) {
    var list = path || [];
    categoryChain = [];
    for (var i = 0; i < list.length && i < MAX_CATEGORY_LEVEL; i += 1) {
      categoryChain[i] = list[i];
    }
  }

  /** 上一级是否已填写（已选节点或输入了文本）→ 决定下一级是否可输入 */
  function previousFilled(level) {
    if (level === 1) return true;
    var prev = levelInput(level - 1);
    return Boolean(prev && String(prev.value || '').trim());
  }

  /** 输入框文本是否与已选链节点同名 */
  function chainNodeForText(level, text) {
    var node = categoryChain[level - 1];
    if (node && String(node.name).trim().toLowerCase() === text.toLowerCase()) return node;
    return null;
  }

  /** 在当前父级的候选里按名称找已有分类（不区分大小写） */
  function candidateByName(level, text) {
    var found = null;
    candidatesOf(level).forEach(function (node) {
      if (!found && String(node.name).trim().toLowerCase() === text.toLowerCase()) found = node;
    });
    return found;
  }

  /** 清空 level 以下的输入值与节点链（级联联动） */
  function clearLevelsAbove(level) {
    for (var i = level + 1; i <= MAX_CATEGORY_LEVEL; i += 1) {
      var input = levelInput(i);
      if (input) input.value = '';
      categoryChain[i - 1] = null;
    }
    truncateChain(level);
  }

  /** 下拉候选（按输入文本过滤）与空状态文案 */
  function menuData(level) {
    var input = levelInput(level);
    var text = String(input ? input.value : '').trim().toLowerCase();
    var pool = candidatesOf(level);
    var items = pool.filter(function (node) {
      if (!text) return true;
      return String(node.name).toLowerCase().indexOf(text) >= 0;
    });
    var emptyText = '';
    if (!items.length) {
      if (!pool.length) {
        if (level === 1) {
          emptyText = '暂无一级分类，可直接输入名称新建' + (isSuper ? '' : '（仅超级管理员可新建）');
        } else if (!previousFilled(level)) {
          emptyText = '请先填写' + LEVEL_LABELS[level - 2] + '级分类';
        } else {
          emptyText = '该分类下暂无子分类，可直接输入名称新建' + (isSuper ? '' : '（仅超级管理员可新建）');
        }
      } else {
        emptyText = '没有匹配的分类，可直接输入名称' + (isSuper ? '新建' : '（仅超级管理员可新建）');
      }
    }
    return { items: items, emptyText: emptyText };
  }

  /** 重绘某一级的下拉面板 */
  function paintMenu(level) {
    var menu = levelMenu(level);
    if (!menu) return;
    var data = menuData(level);
    var html;
    if (data.items.length) {
      html = data.items.map(function (node, index) {
        var active = index === comboState.activeIndex;
        return '<button type="button" class="combo-item' + (active ? ' is-active' : '') + '"' +
          ' role="option" aria-selected="' + (active ? 'true' : 'false') + '"' +
          ' data-combo-option="' + esc(node.id) + '">' +
          '<span class="combo-item-name">' + esc(node.name) + '</span>' +
          (hasChildren(node)
            ? '<span class="combo-item-tag">' + node.children.length + ' 个子分类</span>'
            : '') +
        '</button>';
      }).join('');
    } else {
      html = '<div class="combo-empty">' + esc(data.emptyText) + '</div>';
    }
    menu.innerHTML = html;
    menu.hidden = false;
  }

  function openMenu(level) {
    var input = levelInput(level);
    if (!input || input.disabled) return;
    if (comboState.openLevel && comboState.openLevel !== level) closeMenu(comboState.openLevel);
    comboState.openLevel = level;
    comboState.activeIndex = -1;
    var combo = levelCombo(level);
    if (combo) combo.classList.add('is-open');
    paintMenu(level);
  }

  function closeMenu(level) {
    var target = level || comboState.openLevel;
    var menu = levelMenu(target);
    if (menu) menu.hidden = true;
    var combo = levelCombo(target);
    if (combo) combo.classList.remove('is-open');
    if (comboState.openLevel === target) {
      comboState.openLevel = 0;
      comboState.activeIndex = -1;
    }
  }

  function closeAllMenus() {
    [1, 2, 3].forEach(function (level) { closeMenu(level); });
  }

  function moveActive(level, step) {
    var data = menuData(level);
    if (!data.items.length) return;
    var next = comboState.activeIndex + step;
    if (next < 0) next = data.items.length - 1;
    if (next >= data.items.length) next = 0;
    comboState.activeIndex = next;
    paintMenu(level);
    var active = levelMenu(level) ? levelMenu(level).querySelector('.combo-item.is-active') : null;
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest' });
  }

  /** 选择某个候选项：回填名称、写入节点链、清空更深层级、自动聚焦下一级 */
  function chooseComboNode(level, node) {
    var input = levelInput(level);
    if (!input || !node) return;
    input.value = node.name;
    categoryChain[level - 1] = node;
    categoryMissingTip = '';
    clearLevelsAbove(level);
    closeMenu(level);
    refreshCombos('keep-text');
    var next = level < MAX_CATEGORY_LEVEL ? levelInput(level + 1) : null;
    if (next && !next.disabled) {
      next.focus();
      openMenu(level + 1);
    }
  }

  /** 输入变化：同步节点链（同名则绑定）并级联清空更深层级 */
  function onComboInput(level) {
    var input = levelInput(level);
    var text = String(input ? input.value : '').trim();
    categoryMissingTip = '';
    if (!text) {
      categoryChain[level - 1] = null;
    } else {
      var matched = chainNodeForText(level, text) || candidateByName(level, text);
      categoryChain[level - 1] = matched || null;
    }
    clearLevelsAbove(level);
    refreshCombos('keep-text');
    openMenu(level);
  }

  /**
   * 刷新三级的可输入状态 / 占位文案 / 名称回填（不重建 DOM，避免打断输入）。
   * preserveText = 'keep-text' 时保留用户正在输入但尚未匹配的文本。
   */
  function refreshCombos(preserveText) {
    for (var level = 1; level <= MAX_CATEGORY_LEVEL; level += 1) {
      var input = levelInput(level);
      if (!input) continue;
      var node = categoryChain[level - 1] || null;
      var editable = previousFilled(level);
      if (level > 1) {
        input.disabled = !editable;
      }
      if (!editable && level > 1) {
        input.value = '';
        categoryChain[level - 1] = null;
        node = null;
      }
      if (preserveText === 'keep-text') {
        if (node && String(input.value || '').trim() === '') input.value = node.name;
      } else {
        input.value = node ? node.name : '';
      }
      var placeholder;
      if (level === 1) {
        placeholder = '选择或输入一级分类';
      } else if (!editable) {
        placeholder = '请先填写' + LEVEL_LABELS[level - 2] + '级分类';
      } else {
        placeholder = '选择或输入' + LEVEL_LABELS[level - 1] + '级分类';
      }
      input.placeholder = placeholder;
      var combo = levelCombo(level);
      if (combo) combo.classList.toggle('is-disabled', Boolean(input.disabled));
    }
    if (comboState.openLevel) paintMenu(comboState.openLevel);
    updateCategoryHint();
  }

  function renderAllLevels() { refreshCombos(); }

  /** 最深一级已选分类：叶子或第 3 级时它就是最终分类 */
  function deepestSelected() {
    for (var i = MAX_CATEGORY_LEVEL - 1; i >= 0; i -= 1) {
      var node = categoryChain[i];
      if (node) return { node: node, level: i + 1 };
    }
    return null;
  }

  /** 是否已选到末级：叶子分类，或已达到第 3 级（最多只支持 3 级） */
  function categoryComplete() {
    var deepest = deepestSelected();
    if (!deepest) return false;
    if (deepest.level >= MAX_CATEGORY_LEVEL) return true;
    return !hasChildren(deepest.node);
  }

  /** 已选路径文案：基础元件 / 电阻 / 贴片电阻 */
  function categoryPathText() {
    var names = [];
    for (var i = 0; i < categoryChain.length; i += 1) {
      if (categoryChain[i]) names.push(categoryChain[i].name);
    }
    return names.join(' / ');
  }

  /** 底部提示：未选 / 未选到末级 / 当前分类路径 + 历史分类缺失提示 */
  function updateCategoryHint() {
    var deepest = deepestSelected();
    if (categoryPathTip) {
      categoryPathTip.style.display = categoryMissingTip ? '' : 'none';
      categoryPathTip.textContent = categoryMissingTip;
    }
    if (categoryHint) {
      if (!deepest) {
        categoryHint.textContent = '可下拉选择已有分类，也可直接输入分类名称；选到最末一级分类即可保存';
      } else if (!categoryComplete()) {
        categoryHint.textContent = '「' + deepest.node.name + '」下还有子分类，请继续选择或在下一级输入名称';
      } else {
        categoryHint.textContent = '当前分类：' + categoryPathText();
      }
    }
    if (categoryComplete() && categoryField) categoryField.classList.remove('is-invalid');
  }

  /** 编辑模式：按 editing.categoryId 自底向上找路径并逐级预填 */
  function applyEditingCategory() {
    categoryChain = [];
    categoryMissingTip = '';
    if (!editing) return;
    var raw = editing.categoryId;
    if (raw === null || raw === undefined || String(raw) === '') return;

    var path = resolvePath(raw);
    if (!path.length) {
      categoryMissingTip = '原有分类「' + (editing.categoryName || raw) +
        '」已不在分类树中，请重新选择或输入分类后再保存';
      return;
    }
    if (path.length > MAX_CATEGORY_LEVEL) {
      categoryMissingTip = '原有分类超过 ' + MAX_CATEGORY_LEVEL + ' 级，已取前 ' + MAX_CATEGORY_LEVEL + ' 级：' +
        path.slice(0, MAX_CATEGORY_LEVEL).map(function (node) { return node.name; }).join(' / ');
    }
    setCategoryChain(path.slice(0, MAX_CATEGORY_LEVEL));
  }

  /** 渲染级联：刷新分类树 → 编辑回填 → 刷新三级控件 → 更新提示 */
  function renderCategoryCascade() {
    categoryTreeCache = ERP.store.categoryTree();
    applyEditingCategory();
    refreshCombos();
    closeAllMenus();
  }

  /** 超管：在当前选中分类下新建子分类（未选分类则新建一级分类） */
  function addChildCategory() {
    if (!isSuper) return;
    var deepest = deepestSelected();
    if (deepest && deepest.level >= MAX_CATEGORY_LEVEL) {
      ERP.ui.toast('最多支持 ' + MAX_CATEGORY_LEVEL + ' 级分类，请在更浅的层级上新建子分类', 'warn');
      return;
    }
    var parent = deepest ? deepest.node : null;
    ERP.ui.prompt({
      title: parent ? '新建子分类' : '新建一级分类',
      label: '分类名称',
      placeholder: parent ? '如：贴片电阻' : '如：电阻',
      hint: parent ? '将添加到「' + parent.name + '」下' : '当前未选择父级分类，将创建为一级分类',
      okText: '创建分类'
    }).then(async function (value) {
      if (value === null) return;
      var name = String(value || '').trim();
      if (!name) {
        ERP.ui.toast('分类名称不能为空', 'warn');
        return;
      }
      if (addChildCategoryBtn) addChildCategoryBtn.disabled = true;
      var result;
      try {
        result = await ERP.store.addCategory(name, parent ? parent.id : null);
      } catch (error) {
        result = { ok: false, error: error.message };
      }
      if (addChildCategoryBtn) addChildCategoryBtn.disabled = false;
      if (!result.ok) {
        ERP.ui.toast(result.error || '新建分类失败', 'error');
        return;
      }
      categoryTreeCache = ERP.store.categoryTree();
      setCategoryChain(resolvePath(result.category.id));
      categoryMissingTip = '';
      refreshCombos();
      ERP.ui.toast('分类「' + result.category.name + '」已创建', 'ok');
    });
  }

  /* ---------------- 三级可输入下拉：事件绑定 ---------------- */

  [1, 2, 3].forEach(function (level) {
    var input = levelInput(level);
    var menu = levelMenu(level);
    var combo = levelCombo(level);
    if (!input) return;

    input.addEventListener('focus', function () { openMenu(level); });
    input.addEventListener('click', function () { openMenu(level); });
    input.addEventListener('input', function () { onComboInput(level); });
    input.addEventListener('keydown', function (event) {
      var menuEl = levelMenu(level);
      var menuOpen = comboState.openLevel === level && menuEl && !menuEl.hidden;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (!menuOpen) openMenu(level); else moveActive(level, 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        if (menuOpen) moveActive(level, -1);
        return;
      }
      if (event.key === 'Escape') {
        if (menuOpen) {
          event.preventDefault();
          closeMenu(level);
        }
        return;
      }
      if (event.key === 'Enter' && menuOpen) {
        var data = menuData(level);
        if (data.items.length) {
          event.preventDefault();
          var index = comboState.activeIndex >= 0 ? comboState.activeIndex : 0;
          chooseComboNode(level, data.items[index]);
        }
      }
    });
    input.addEventListener('blur', function () {
      // 延迟关闭：让面板上的 mousedown/click 先拿到事件
      window.setTimeout(function () { closeMenu(level); }, 140);
    });

    if (combo) {
      var toggle = combo.querySelector('.combo-toggle');
      if (toggle) {
        toggle.addEventListener('mousedown', function (event) { event.preventDefault(); });
        toggle.addEventListener('click', function (event) {
          event.preventDefault();
          if (input.disabled) return;
          if (comboState.openLevel === level) {
            closeMenu(level);
          } else {
            input.focus();
            openMenu(level);
          }
        });
      }
    }

    if (menu) {
      menu.addEventListener('mousedown', function (event) { event.preventDefault(); });
      menu.addEventListener('click', function (event) {
        var item = event.target.closest('[data-combo-option]');
        if (!item) return;
        var node = findNodeById(categoryTreeCache, item.getAttribute('data-combo-option'));
        if (node) chooseComboNode(level, node);
      });
    }
  });

  // 点击组件外部时收起所有下拉面板
  document.addEventListener('mousedown', function (event) {
    if (event.target.closest && event.target.closest('.combo')) return;
    closeAllMenus();
  });

  if (addChildCategoryBtn) addChildCategoryBtn.addEventListener('click', addChildCategory);

  // 分类缓存为空（数据还没加载完）时补一次加载再渲染；页面原有的 await ERP.store.load() 时机不变
  if (ERP.store.categories().length) {
    renderCategoryCascade();
  } else {
    ERP.store.load().then(renderCategoryCascade, renderCategoryCascade);
  }

  /* ---------------- 联动与交互 ---------------- */

  var nameInput = $('#materialName');
  var modelInput = $('#materialModel');
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

  /* ---------------- 多图上传（前端上传到 /api/uploads，数据库只存相对路径） ---------------- */

  var uploadInput = $('#materialImages');
  var uploadedGrid = $('#uploadedGrid');
  var uploadHint = $('#uploadHint');

  function renderUploadedImages() {
    if (!state.images.length) {
      uploadedGrid.innerHTML = '<div class="uploaded-empty">尚未上传实拍图片，保存后使用下方示意图作为封面</div>';
      if (uploadHint) uploadHint.textContent = '未选择图片';
      return;
    }
    uploadedGrid.innerHTML = state.images.map(function (path, index) {
      return '<div class="uploaded-item">' +
        '<img src="' + esc(ERP.ui.imageUrl(path)) + '" alt="实拍图 ' + (index + 1) + '" loading="lazy">' +
        '<button class="uploaded-remove" type="button" data-remove-image="' + index + '" title="移除图片">' + ERP.icon('x', 12) + '</button>' +
      '</div>';
    }).join('');
    if (uploadHint) uploadHint.textContent = '已上传 ' + state.images.length + ' / 5 张';
  }

  // 上传校验规则集中定义：选择图片与 Ctrl+V 粘贴两条入口共用，避免规则漂移
  var ALLOWED_IMAGE_TYPES = { 'image/jpeg': true, 'image/png': true };
  var MAX_IMAGE_COUNT = 5;
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  /**
   * 多图入库的唯一入口：file input 的 change 与 document 的 paste 都调用它。
   * 沿用既有的校验顺序与提示文案（上限 / 格式 / 单张大小），复用同一个
   * ERP.api.upload('/uploads') 接口，成功后 push 进 state.images 并刷新预览；
   * 保存时仍写入 materials.image 的逗号分隔相对路径，数据库字段不变。
   * @param {FileList|File[]} files 待上传文件（空则直接返回）
   * @param {{source: string}} [options] source 为 'paste' 时上传成功额外给出粘贴提示
   * @returns {Promise<{uploaded: number}>} uploaded 为本次成功上传的张数
   */
  async function addImageFiles(files, options) {
    var list = Array.prototype.slice.call(files || []);
    if (!list.length) return { uploaded: 0 };
    var source = (options && options.source) || 'pick';
    var uploaded = 0;
    for (var i = 0; i < list.length; i += 1) {
      var file = list[i];
      if (state.images.length >= MAX_IMAGE_COUNT) {
        ERP.ui.toast('每个物料最多上传 5 张图片', 'warn');
        break;
      }
      if (!ALLOWED_IMAGE_TYPES[file.type]) {
        ERP.ui.toast('仅支持 jpg / png 格式图片', 'error');
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        ERP.ui.toast('单张图片不能超过 5MB', 'error');
        continue;
      }
      if (uploadHint) uploadHint.textContent = '正在上传 ' + (i + 1) + ' / ' + list.length + ' …';
      try {
        var result = await ERP.api.upload('/uploads', file);
        state.images.push(result.url);
        uploaded += 1;
      } catch (error) {
        // 失败沿用后端返回的文案
        ERP.ui.toast(error.message || '图片上传失败', 'error');
      }
    }
    renderUploadedImages();
    if (uploaded && source === 'paste') {
      ERP.ui.toast('已粘贴上传 ' + uploaded + ' 张图片', 'ok');
    }
    return { uploaded: uploaded };
  }

  uploadInput.addEventListener('change', async function () {
    var files = Array.prototype.slice.call(uploadInput.files || []);
    uploadInput.value = '';
    await addImageFiles(files);
  });

  /* ---------------- Ctrl+V 粘贴上传（与「选择图片上传」共用校验 / 接口 / state.images） ---------------- */

  /**
   * 判断事件目标是否位于可编辑控件内（备注 textarea、名称 / 型号等 input、contenteditable）。
   * 这些位置必须保留浏览器默认的文本粘贴行为，一律不拦截、不 preventDefault。
   * 例外：input[type=file]（隐藏的图片选择框）不承载文本，不算可编辑，
   * 否则刚用「选择图片上传」选完图、焦点还停在它上面时 Ctrl+V 会失效。
   */
  function isEditableTarget(target) {
    if (!target || target.nodeType !== 1) return false;
    var node = target;
    while (node && node.nodeType === 1) {
      var tag = String(node.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (tag === 'input' && String(node.type || '').toLowerCase() !== 'file') return true;
      if (node.isContentEditable) return true;
      // 兼容 jsdom / 旧环境：直接看 contenteditable 属性（含嵌套在内部的情况）
      var editable = node.getAttribute ? node.getAttribute('contenteditable') : null;
      if (editable !== null && editable !== undefined &&
          String(editable).toLowerCase() !== 'false') {
        return true;
      }
      node = node.parentNode;
    }
    return false;
  }

  /** 从剪贴板里挑出图片文件；没有图片就返回空数组（纯文本粘贴由此静默走默认行为） */
  function clipboardImageFiles(event) {
    var clipboard = event.clipboardData || window.clipboardData;
    if (!clipboard) return [];
    var files = [];
    var items = clipboard.items;
    if (items && items.length) {
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!item || item.kind !== 'file') continue;
        if (String(item.type || '').indexOf('image/') !== 0) continue;
        var file = typeof item.getAsFile === 'function' ? item.getAsFile() : null;
        if (file) files.push(file);
      }
      return files;
    }
    // 兜底：部分浏览器（截图粘贴）只填 files 不填 items
    var raw = clipboard.files;
    if (raw && raw.length) {
      for (var j = 0; j < raw.length; j += 1) {
        if (raw[j] && String(raw[j].type || '').indexOf('image/') === 0) files.push(raw[j]);
      }
    }
    return files;
  }

  /** 本页的粘贴监听：剪贴板里有图片才接管，纯文本 / 非图片一律不打扰 */
  async function handleDocumentPaste(event) {
    // 正在输入框 / 备注框里打字时不处理（尤其是 textarea 的普通文本粘贴）
    if (isEditableTarget(event.target)) return;
    var files = clipboardImageFiles(event);
    if (!files.length) return; // 没有图片文件：静默忽略，不提示
    // 剪贴板里确实有图片，阻止默认行为，避免图片被粘贴到页面其它位置
    if (typeof event.preventDefault === 'function') event.preventDefault();
    if (state.images.length >= MAX_IMAGE_COUNT) {
      ERP.ui.toast('每个物料最多上传 5 张图片', 'warn');
      return;
    }
    // 复用选择图片时的同一套校验 / 上传 / 预览逻辑
    await addImageFiles(files, { source: 'paste' });
  }

  document.addEventListener('paste', function (event) {
    handleDocumentPaste(event);
  });

  uploadedGrid.addEventListener('click', function (event) {
    var button = event.target.closest('[data-remove-image]');
    if (!button) return;
    var index = Number(button.getAttribute('data-remove-image'));
    state.images.splice(index, 1);
    renderUploadedImages();
  });

  renderUploadedImages();

  applyMode();

  /* ---------------- 校验与保存 ---------------- */

  function clearInvalid() {
    ERP.ui.$all('.field.is-invalid').forEach(function (field) {
      field.classList.remove('is-invalid');
    });
  }
  function markInvalid(input, message) {
    var field = input && input.closest ? input.closest('.field') : null;
    if (field) field.classList.add('is-invalid');
    return message;
  }

  /**
   * 解析分类：直接读取三级级联的最终选中值（最深一级已选中的分类 id）。
   * 原「按输入名称查找 / 自动新建分类」的逻辑已删除，改由级联选择器 + 「新建子分类」按钮承担。
   */
  /**
   * v1.6.0：提交时解析分类（支持「可输入下拉」+ 自动创建缺失分类）：
   *   1) 逐级读取输入框文本（一 → 二 → 三，遇到空即停止）；
   *   2) 优先使用已绑定的同名节点，其次在当前父级的子分类里按名称匹配；
   *   3) 仍不存在：超级管理员调用 ERP.store.addCategory(name, 父级id|null) 自动创建
   *      （即 POST /api/categories），普通管理员直接返回「不存在」提示；
   *   4) 校验：必须有分类、最深分类必须是末级（叶子或第 3 级）。
   * 自动创建只发生在提交时，打字过程不调接口。
   */
  async function resolveCategoryId() {
    // 分类缓存为空（例如数据还没加载完）时补一次加载，再按空树提示
    if (!ERP.store.categories().length) {
      try { await ERP.store.load(); } catch (error) { /* 忽略：下面按空树提示 */ }
      categoryTreeCache = ERP.store.categoryTree();
      refreshCombos();
    }

    var parent = null;
    var resolved = null;

    for (var level = 1; level <= MAX_CATEGORY_LEVEL; level += 1) {
      var input = levelInput(level);
      var text = String(input ? input.value : '').trim();
      if (!text) break;

      var node = chainNodeForText(level, text) || candidateByName(level, text);

      if (!node) {
        if (!isSuper) {
          markInvalid(input, '分类不存在');
          return { error: '分类「' + text + '」不存在，仅超级管理员可新建分类' };
        }
        var result;
        try {
          result = await ERP.store.addCategory(text, parent ? parent.id : null);
        } catch (error) {
          result = { ok: false, error: error.message };
        }
        if (!result || !result.ok) {
          markInvalid(input, (result && result.error) || '新建分类失败');
          return { error: (result && result.error) || '新建分类失败' };
        }
        categoryTreeCache = ERP.store.categoryTree();
        node = findNodeById(categoryTreeCache, result.category.id);
        if (!node) {
          return { error: '分类创建后读取失败，请刷新页面后重试' };
        }
      }

      categoryChain[level - 1] = node;
      truncateChain(level);
      parent = node;
      resolved = node;
    }

    if (!resolved) {
      markInvalid(levelInput(1), '请选择物料分类');
      return { error: '请选择物料分类' };
    }

    var deepest = deepestSelected();
    if (!categoryComplete()) {
      markInvalid(levelInput(deepest.level), '请选择完整的分类');
      return { error: '请选择完整的分类' };
    }

    // 把解析结果回填到控件（自动新建的分类名称可能与输入的大小写不同）
    refreshCombos();
    updateCategoryHint();
    return { id: resolved.id, name: resolved.name };
  }

  function collectPayload(resolvedCategoryId) {
    clearInvalid();
    var errors = [];

    var name = String(nameInput.value || '').trim();
    if (!name) errors.push(markInvalid(nameInput, '请填写物料名称'));
    if (name.length > 40) errors.push(markInvalid(nameInput, '物料名称不要超过 40 个字'));

    var model = String(modelInput.value || '').trim();
    if (!model) errors.push(markInvalid(modelInput, '请填写料号 / 型号'));

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
      jlcNo: String($('#materialJlcNo').value || '').trim(),
      package: String($('#materialPackage').value || '').trim(),
      brand: String($('#materialBrand').value || '').trim(),
      categoryId: resolvedCategoryId,
      source: String($('#materialSource').value || '').trim(),
      spec: String($('#materialSpec').value || '').trim(),
      mode: state.mode,
      qty: state.mode === 'precise' ? qty : null,
      minQty: state.mode === 'precise' ? minQty : null,
      status: state.mode === 'precise' ? (qty > 0 ? 'available' : 'empty') : state.status,
      cabinet: String($('#materialCabinet').value || '').trim(),
      slot: String($('#materialSlot').value || '').trim(),
      inboundAt: inboundAt,
      image: state.images.length ? state.images.join(',') : state.image,
      note: String($('#materialNote').value || '').trim()
    };
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    var saveBtn = $('#saveBtn');
    var payload = collectPayload(null);
    if (!payload) return;

    saveBtn.disabled = true;
    saveBtn.textContent = '保存中…';

    try {
      var categoryResult = await resolveCategoryId();
      if (categoryResult.error) {
        ERP.ui.toast(categoryResult.error, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = editingId ? '保存修改' : '保存物料';
        return;
      }
      payload.categoryId = categoryResult.id;
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

  /* ---------------- 删除物料（仅编辑已有物料 + 超级管理员） ---------------- */

  /**
   * 删除确认弹窗正文：物料名称 / 档案编号 / 型号 + 连带删除范围说明。
   * 本页只加载了全局最近日志，条数不可靠，因此这里不写具体流水数字，只给通用提示。
   */
  function deleteConfirmHtml() {
    return '<dl class="detail-list">' +
        '<div class="detail-item is-full">' +
          '<dt>物料名称</dt><dd>' + esc(editing.name || '—') + '</dd>' +
        '</div>' +
        '<div class="detail-item">' +
          '<dt>档案编号</dt><dd class="mono">' + esc(editing.id || '—') + '</dd>' +
        '</div>' +
        '<div class="detail-item">' +
          '<dt>型号</dt><dd class="mono">' + esc(editing.model || '—') + '</dd>' +
        '</div>' +
      '</dl>' +
      '<p style="margin:14px 0 0; color:var(--danger); font-weight:600; line-height:1.6">' +
        '删除后不可恢复；该物料的领用 / 入库流水与出入库单明细会一并删除。' +
      '</p>' +
      '<p class="small muted" style="margin:6px 0 0">' +
        '删除会同时清理因此变空的出入库单；本页尚未保存的表单修改也会一同放弃，请谨慎操作。' +
      '</p>';
  }

  // deleting 标记用于防重复点击：确认后按钮立即禁用，成功跳转前不再响应点击
  var deleting = false;

  async function deleteEditingMaterial() {
    if (!isEditing || !isSuper || deleting) return;
    var button = $('#deleteMaterialBtn');
    if (!button) return;
    var originalHtml = button.innerHTML;

    var confirmed = await ERP.ui.confirm({
      title: '删除物料',
      html: deleteConfirmHtml(),
      okText: '确认删除',
      danger: true
    });
    if (!confirmed) return;

    deleting = true;
    button.disabled = true;
    button.innerHTML = ERP.icon('trash', 15) + '删除中…';

    try {
      // 删除成功即跳转物料总览，不再走表单保存流程
      await ERP.api.del('/materials/' + editing.dbId);
      // 缓存刷新失败不影响已经完成的删除，随后整页跳转会重新拉取数据
      try {
        await ERP.store.refresh();
      } catch (refreshError) { /* 忽略刷新失败 */ }
      ERP.ui.toast('物料已删除', 'ok');
      window.setTimeout(function () {
        window.location.href = ERP.url('index.html');
      }, 320);
    } catch (error) {
      ERP.ui.toast(error.message || '删除失败，请稍后重试', 'error');
      deleting = false;
      button.disabled = false;
      button.innerHTML = originalHtml;
    }
  }

  var deleteButton = $('#deleteMaterialBtn');
  if (deleteButton) {
    deleteButton.addEventListener('click', function () {
      deleteEditingMaterial();
    });
  }
})();
