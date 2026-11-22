/**
 * 站点自定义配置（v1.3.0）：应用名 / 社团名 / Logo / 封面文案
 * ---------------------------------------------------------------------------
 * - GET   /api/settings  读取配置并缓存（登录用户可读，失败时回落到内置默认值）
 * - PATCH /api/settings  保存配置（后端仅超级管理员可改，普通角色 403）
 * - apply()       把配置同步到 ERP.config，并广播 erp:site-changed 事件
 * - save()        保存字段，成功后更新缓存 + apply()
 * - mountBrand()  渲染 .app-brand 品牌区（侧边栏 / 封面页共用），
 *                 超级管理员可双击改名称、点击 Logo 上传图片
 *
 * 依赖顺序：config.js → icons.js → ui.js → auth.js → api.js → site.js → layout.js
 * 说明：所有网络失败都在内部兜底，不抛异常打断页面渲染。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  /** 可编辑字段（与 PATCH /api/settings 一一对应） */
  var FIELDS = ['app_name', 'club_name', 'logo_image', 'cover_title', 'cover_slogan', 'cover_footer'];

  /** 后端不可用时的内置默认值（与 backend/app/routers/settings.py 保持一致） */
  var DEFAULTS = {
    app_name: '硬件物料台账',
    club_name: '校内硬件社团',
    logo_image: '',
    cover_title: '硬件物料台账',
    cover_slogan: '轻量化 ERP · 回收元器件统一台账',
    cover_footer: 'Linda_ERP · 校内硬件社团',
    updated_at: ''
  };

  /** 允许上传的图片类型；前端限制 5MB（后端上限 10MB） */
  var ALLOWED_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true };
  var MAX_LOGO_BYTES = 5 * 1024 * 1024;

  var cache = null;       // 最近一次成功读取 / 保存后的配置
  var loaded = false;     // 是否已成功从后端拿到配置
  var loading = null;     // 进行中的 GET 请求，避免并发重复拉取
  var editingEl = null;   // 当前正在就地编辑的元素（同一时间只允许一个）
  var logoInput = null;   // 复用的 Logo 文件选择框

  function esc(value) {
    return ERP.ui.esc(value);
  }

  /** 归一化为固定字段集合，缺失字段回落默认值 */
  function normalize(source) {
    var out = {};
    FIELDS.forEach(function (field) {
      var value = source ? source[field] : null;
      out[field] = value == null ? DEFAULTS[field] : String(value);
    });
    out.updated_at = source && source.updated_at ? String(source.updated_at) : '';
    return out;
  }

  function defaults() {
    return normalize(null);
  }

  /** 当前登录用户是否超级管理员（未登录返回 false） */
  function isEditable() {
    return !!(ERP.auth && ERP.auth.isSuper && ERP.auth.isSuper());
  }

  /** 同步取缓存；未加载过时返回内置默认值 */
  function get() {
    return cache || defaults();
  }

  /**
   * 读取站点配置并缓存
   * @param {boolean} force 传 true 时忽略缓存强制刷新（封面编辑页使用）
   * @returns {Promise<Object>} 永远 resolve，失败时返回内置默认值 / 已缓存的旧值
   */
  async function load(force) {
    if (!force && loaded) return cache;
    if (loading) return loading;
    loading = (async function () {
      var data = null;
      try {
        data = await ERP.api.get('/settings');
      } catch (error) {
        data = null; // 后端不可用 / 未登录：本次失败不打断页面
      }
      if (data) {
        cache = normalize(data);
        loaded = true;
      } else if (!loaded) {
        cache = defaults(); // 首次加载失败：用内置默认值兜底
      }
      loading = null;
      return get();
    })();
    return loading;
  }

  /** 把缓存写回 ERP.config，并广播 erp:site-changed（layout.js / 封面页监听刷新） */
  function apply() {
    var settings = get();
    var previousName = ERP.config ? String(ERP.config.appName || '') : '';
    if (ERP.config) {
      ERP.config.appName = settings.app_name;
      ERP.config.clubName = settings.club_name;
      ERP.config.logoImage = settings.logo_image;
    }
    // 浏览器标签标题里的旧应用名一并替换（如「工作台 · 硬件物料台账」）
    if (previousName && settings.app_name && previousName !== settings.app_name &&
        document.title.indexOf(previousName) >= 0) {
      document.title = document.title.split(previousName).join(settings.app_name);
    }
    document.dispatchEvent(new CustomEvent('erp:site-changed', { detail: settings }));
    return settings;
  }

  /**
   * 保存站点配置（仅超级管理员；后端会再次校验角色）
   * @param {Object} fields 任意子集：app_name / club_name / logo_image / cover_*
   * @returns {Promise<Object>} 更新后的完整配置
   * @throws {Error} 保存失败时抛出，调用方负责 toast
   */
  async function save(fields) {
    var payload = {};
    FIELDS.forEach(function (field) {
      if (fields && fields[field] !== undefined && fields[field] !== null) {
        payload[field] = String(fields[field]);
      }
    });
    if (!Object.keys(payload).length) return get();

    var data;
    try {
      data = await ERP.api.patch('/settings', payload);
    } catch (error) {
      throw new Error((error && error.message) || '保存失败，请稍后重试');
    }
    cache = normalize(data);
    loaded = true;
    apply();
    return cache;
  }

  /* =========================================================================
     就地编辑：双击 → 输入 → Enter / 失焦保存，Esc 取消
     品牌区名称与封面文案共用同一套逻辑（封面页通过 bindEditable 复用）
     ========================================================================= */

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /** 全选可编辑内容，方便直接覆盖输入 */
  function selectText(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {
      // 老浏览器不支持 Range 时忽略，元素已聚焦即可直接输入
    }
  }

  /** 保存字段；失败时恢复原文本并提示 */
  async function commitField(el, field, value, original) {
    var current = get()[field];
    if (value === current) return; // 内容未变化：不发起请求
    var payload = {};
    payload[field] = value;
    try {
      await save(payload);
      ERP.ui.toast('已保存', 'ok');
      // 品牌区名称变化后重新渲染（保持 Logo / 角色提示一致）
      if (el.closest('.app-brand')) mountBrand(document);
    } catch (error) {
      el.textContent = original;
      ERP.ui.toast((error && error.message) || '保存失败', 'error');
    }
  }

  function beginEdit(el, field) {
    if (!isEditable() || editingEl) return;
    var original = el.textContent;
    editingEl = el;
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-editing', '1');
    el.style.outline = '1px dashed var(--brand)';
    el.style.outlineOffset = '3px';
    el.style.background = 'var(--surface-2)';
    el.style.borderRadius = '4px';
    el.focus();
    selectText(el);

    function cleanup() {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-editing');
      el.style.outline = '';
      el.style.outlineOffset = '';
      el.style.background = '';
      el.style.borderRadius = '';
      if (editingEl === el) editingEl = null;
    }

    function finish() {
      var value = cleanText(el.textContent);
      cleanup();
      if (!value || value === cleanText(original)) {
        el.textContent = original; // 空内容 / 未改动：还原，不入库
        return;
      }
      el.textContent = value;
      commitField(el, field, value, original);
    }

    function onKey(event) {
      if (event.key === 'Enter') {
        event.preventDefault(); // 禁止换行，回车即保存
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        el.textContent = original; // 取消还原
        cleanup();
      }
    }

    function onBlur() {
      finish();
    }

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  /**
   * 给任意文本元素绑定双击就地编辑（封面页复用）
   * @param {HTMLElement} el
   * @param {string} field 站点配置字段名
   */
  function bindEditable(el, field) {
    if (!el || el.getAttribute('data-edit-bound') === '1') return;
    el.setAttribute('data-edit-bound', '1');
    if (isEditable()) {
      // 只有超级管理员才显示「可编辑」光标与提示
      el.title = '双击编辑';
      el.style.cursor = 'text';
    }
    el.addEventListener('dblclick', function (event) {
      if (!isEditable()) return; // 普通角色：双击无任何反应
      event.preventDefault();
      event.stopPropagation();
      beginEdit(el, field);
    });
  }

  /* =========================================================================
     品牌区：Logo + 应用名 + 社团名
     ========================================================================= */

  function logoHtml(settings, editable) {
    var hasImage = !!settings.logo_image;
    var styles = [];
    if (hasImage) styles.push('background:transparent'); // 图片自带圆角，不再叠品牌色底
    if (editable) styles.push('cursor:pointer');
    var styleAttr = styles.length ? ' style="' + styles.join(';') + '"' : '';
    var titleAttr = editable
      ? ' title="' + (hasImage ? '点击更换 Logo' : '点击上传 Logo') + '"'
      : '';
    var inner = hasImage
      ? '<img class="app-brand-logo-img" src="' + esc(ERP.ui.imageUrl(settings.logo_image)) + '" alt="" ' +
          'style="width:30px;height:30px;border-radius:7px;object-fit:cover;display:block">'
      : ERP.icon('logo', 20); // 未设置 Logo：保持原有内置 SVG 图标
    return '<span class="app-brand-logo" aria-hidden="true"' + styleAttr + titleAttr + '>' +
      inner +
    '</span>';
  }

  function brandHtml(settings, editable) {
    var textAttr = editable ? ' title="双击编辑" style="cursor:text"' : '';
    return logoHtml(settings, editable) +
      '<span class="app-brand-text">' +
        '<span class="app-brand-name" data-brand-field="app_name"' + textAttr + '>' +
          esc(settings.app_name) +
        '</span>' +
        '<span class="app-brand-sub" data-brand-field="club_name"' + textAttr + '>' +
          esc(settings.club_name) +
        '</span>' +
      '</span>';
  }

  /** 品牌区事件只绑定一次：内部用事件委托，重新渲染无需重复绑定 */
  function bindBrand(brand) {
    if (brand.getAttribute('data-brand-bound') === '1') return;
    brand.setAttribute('data-brand-bound', '1');

    brand.addEventListener('click', function (event) {
      if (!isEditable()) return; // 普通角色：整块品牌区保持「点击回工作台」
      var target = event.target;
      if (target.closest('.app-brand-logo')) {
        // 点击 Logo：选图上传
        event.preventDefault();
        event.stopPropagation();
        openLogoPicker();
        return;
      }
      var fieldEl = target.closest('[data-brand-field]');
      if (fieldEl) {
        // 品牌区本身是 <a>：单击文字不跳转，把单击让给双击编辑
        // （preventDefault 只拦 <a> 的跳转，不影响点击定位光标）
        event.preventDefault();
      }
    });

    brand.addEventListener('dblclick', function (event) {
      if (!isEditable()) return;
      var fieldEl = event.target.closest('[data-brand-field]');
      if (!fieldEl) return;
      event.preventDefault();
      event.stopPropagation();
      beginEdit(fieldEl, fieldEl.getAttribute('data-brand-field'));
    });
  }

  /**
   * 按当前设置渲染品牌区（侧边栏 / 封面页共用）
   * @param {HTMLElement|Document} scope 默认 document
   */
  function mountBrand(scope) {
    var root = scope && scope.querySelector ? scope : document;
    // 正在编辑时不打断用户输入
    if (editingEl && document.body.contains(editingEl)) return;
    var brand = root.querySelector('.app-brand');
    if (!brand) return;
    var settings = get();
    var editable = isEditable();
    brand.innerHTML = brandHtml(settings, editable);
    bindBrand(brand);
    return brand;
  }

  /* =========================================================================
     Logo 上传：点击 Logo → 选图 → POST /api/uploads → PATCH logo_image
     ========================================================================= */

  function openLogoPicker() {
    if (!isEditable()) {
      ERP.ui.toast('仅超级管理员可更换 Logo', 'warn');
      return;
    }
    if (!logoInput || !logoInput.parentNode) {
      logoInput = document.createElement('input');
      logoInput.type = 'file';
      logoInput.id = 'erpLogoFileInput';
      logoInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
      logoInput.style.display = 'none';
      logoInput.addEventListener('change', function () {
        var file = logoInput.files && logoInput.files[0];
        logoInput.value = ''; // 允许重复选择同一文件
        if (file) uploadLogo(file);
      });
      document.body.appendChild(logoInput);
    }
    logoInput.click();
  }

  async function uploadLogo(file) {
    if (!ALLOWED_TYPES[file.type]) {
      ERP.ui.toast('仅支持 png / jpg / webp / gif 图片', 'error');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      ERP.ui.toast('Logo 图片不能超过 5MB', 'error');
      return;
    }
    ERP.ui.toast('正在上传 Logo…', 'warn');
    try {
      var result = await ERP.api.upload('/uploads', file);
      if (!result || !result.url) throw new Error('上传结果异常');
      await save({ logo_image: result.url });
      mountBrand(document);
      ERP.ui.toast('Logo 已更新', 'ok');
    } catch (error) {
      ERP.ui.toast((error && error.message) || 'Logo 更新失败', 'error');
    }
  }

  ERP.site = {
    FIELDS: FIELDS,
    DEFAULTS: DEFAULTS,
    load: load,
    get: get,
    apply: apply,
    save: save,
    isEditable: isEditable,
    mountBrand: mountBrand,
    /** 额外导出：通用「双击就地编辑」，封面页文案复用 */
    bindEditable: bindEditable
  };
})();
