/**
 * 登录页（v1.4.0）
 * ---------------------------------------------------------------------------
 * 1. 表单登录：POST /api/auth/login → 保存 JWT 与用户信息 → 跳工作台
 * 2. 文案来自数据库：并行 GET /api/settings + GET /api/ui-settings/login
 *    （两个接口都公开，未登录也能读），失败时静默回退到 login.html 里的默认文案，
 *    绝不阻塞登录。
 * 3. 封面编辑模式（登录页 URL 加 ?cover=1，仅超级管理员）：
 *    - 双击任意 [data-edit] 文本就地编辑：Enter / 失焦保存，Esc 取消
 *    - 点击 .brand-logo 上传 Logo（≤5MB）→ PATCH /api/settings { logo_image }
 *    - 编辑期间阻止登录表单提交，右下角固定「返回主页面」
 *    - 非超管 / 未登录带 ?cover=1 只会看到普通登录页（后端 PATCH 仍会 403 兜底）
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var UI = ERP.ui;
  var $ = UI.$;

  /* ---------------- 常量 ---------------- */

  var PAGE = 'login';             // GET /api/ui-settings/login 的 page
  var ALLOWED_TYPES = { 'image/png': true, 'image/jpeg': true, 'image/webp': true, 'image/gif': true };
  var MAX_LOGO_BYTES = 5 * 1024 * 1024;   // 前端限 5MB（后端上限 10MB）

  /* ---------------- DOM 引用 ---------------- */

  var form = $('#loginForm');
  var accountInput = $('#loginAccount');
  var passwordInput = $('#loginPassword');
  var errorBox = $('#loginError');
  var loginBtn = $('#loginBtn');
  var versionEl = document.getElementById('loginVersion');
  var logoBox = $('.brand-logo');
  var sessionBox = $('#loginSession');
  var sessionTextEl = $('#loginSessionText');

  /* ---------------- 运行状态 ---------------- */

  var session = ERP.auth.get();
  var textValues = {};            // field → 当前生效文案（后端值或 HTML 默认值）
  var btnText = '登 录';           // 登录按钮当前文案（登录中/失败后要还原）
  var defaultLogoHtml = logoBox ? logoBox.innerHTML : '';  // 未设置 Logo 时的内联 SVG
  var logoImage = '';             // 当前生效的 Logo 路径
  var editMode = false;           // 是否处于封面编辑模式
  var editing = null;             // 当前就地编辑状态（同一时间只允许一个）
  var statusEl = null;            // 右下角「已保存 HH:MM」
  var logoInput = null;           // 复用的 Logo 文件选择框

  /* ---------------- 文案工具 ---------------- */

  function cleanText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
  }

  /** placeholder 类字段的真实值放在 input.placeholder 上 */
  function isPlaceholderField(el) {
    return el.getAttribute('data-edit-type') === 'placeholder' ||
      el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
  }

  function readElValue(el) {
    return isPlaceholderField(el) ? cleanText(el.placeholder) : cleanText(el.textContent);
  }

  function setElValue(el, value) {
    if (!el) return;
    if (isPlaceholderField(el)) {
      el.placeholder = value;
      return;
    }
    el.textContent = value;
    if (el === loginBtn) btnText = value;
  }

  /** 首次运行：把 HTML 里的默认文案记成基线（后端不可用时就是它） */
  function cacheDefaults() {
    UI.$all('[data-edit]').forEach(function (el) {
      var field = el.getAttribute('data-edit');
      if (field) textValues[field] = readElValue(el);
    });
    btnText = textValues.login_btn_text || btnText;
  }

  /* ---------------- 后端文案 / 站点配置 ---------------- */

  /** 写入 get /api/ui-settings/login 返回的 values（空值保留 HTML 默认文案） */
  function applyTexts(values) {
    if (!values) return;
    UI.$all('[data-edit]').forEach(function (el) {
      var field = el.getAttribute('data-edit');
      if (!field) return;
      if (el === sessionTextEl) {
        // 已登录提示需要按角色/占位符再加工，单独渲染
        if (values[field] != null && String(values[field]) !== '') {
          textValues[field] = String(values[field]);
        }
        return;
      }
      var next = values[field];
      if (next == null || String(next) === '') return;
      textValues[field] = String(next);
      setElValue(el, String(next));
    });
    renderSessionText();
  }

  /** 已登录提示：支持 {name} / {role} 占位符；编辑模式显示原始模板，避免把账号名写进文案 */
  function renderSessionText() {
    if (!sessionTextEl || !session || !session.token) return;
    var tpl = textValues.login_session_text || '';
    var name = session.name || session.account || '当前账号';
    var role = ERP.auth.roleLabel(session.role);
    var text;
    if (editMode) {
      text = tpl || '当前已登录，可直接进入系统';
    } else if (!tpl) {
      text = '当前已登录：' + name + '（' + role + '）';
    } else if (tpl.indexOf('{name}') >= 0 || tpl.indexOf('{role}') >= 0) {
      text = tpl.replace(/\{name\}/g, name).replace(/\{role\}/g, role);
    } else {
      text = tpl;
    }
    sessionTextEl.textContent = text;
  }

  /** Logo：非空时把内联 SVG 换成同尺寸圆角图片，空串保留内置 SVG */
  function applyLogo(url) {
    if (!logoBox) return;
    var value = String(url == null ? '' : url).trim();
    logoImage = value;
    if (!value) {
      logoBox.classList.remove('has-image');
      logoBox.innerHTML = defaultLogoHtml;
    } else {
      logoBox.classList.add('has-image');
      logoBox.innerHTML = '<img class="brand-logo-img" src="' +
        UI.esc(UI.imageUrl(value)) + '" alt="">';
    }
    syncLogoTitle();
  }

  /** 编辑模式才给 Logo 加「点击上传/更换」提示，普通访客无痕迹 */
  function syncLogoTitle() {
    if (!logoBox) return;
    if (!editMode) {
      logoBox.removeAttribute('title');
      return;
    }
    logoBox.title = logoImage ? '点击更换 Logo' : '点击上传 Logo';
  }

  /**
   * 拉取站点配置 + 登录页文案（都公开，无需登录）。
   * 任一失败都只跳过，不影响登录流程。
   */
  function loadRemote() {
    var settings = null;
    var texts = null;
    return Promise.all([
      ERP.api.get('/settings').then(function (data) {
        settings = data;
      }, function () { /* 静默回退 */ }),
      ERP.api.get('/ui-settings/' + PAGE).then(function (data) {
        texts = data;
      }, function () { /* 静默回退 */ })
    ]).then(function () {
      if (settings) applyLogo(settings.logo_image);
      if (texts) applyTexts(texts.values);
    });
  }

  /* ---------------- 登录表单 ---------------- */

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.hidden = false;
  }
  function hideError() {
    if (!errorBox) return;
    errorBox.hidden = true;
    errorBox.textContent = '';
  }

  [accountInput, passwordInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', hideError);
  });

  if (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      // 封面编辑模式只改文案，绝不执行登录（避免双击按钮误登录）
      if (editMode) {
        UI.toast('封面编辑模式不执行登录', 'warn');
        return;
      }
      doLogin();
    });
  }

  function doLogin() {
    var account = String(accountInput.value || '').trim();
    var password = String(passwordInput.value || '');

    if (!account) {
      showError('请输入账号');
      accountInput.focus();
      return;
    }
    if (!password) {
      showError('请输入密码');
      passwordInput.focus();
      return;
    }

    hideError();
    loginBtn.disabled = true;
    loginBtn.textContent = '登录中…';

    ERP.api.login(account, password).then(function (data) {
      var user = data.user || {};
      try { window.localStorage.setItem('erp.token', data.access_token); } catch (e) { /* ignore */ }
      ERP.auth.set({
        token: data.access_token,
        userId: user.id,
        account: user.username,
        name: user.name,
        role: user.role,
        loginAt: ERP.store ? ERP.store.now() : ''
      });
      window.location.href = ERP.url('dashboard.html');
    }).catch(function (error) {
      showError(error.message || '登录失败，请检查账号密码');
      loginBtn.disabled = false;
      loginBtn.textContent = btnText;
      passwordInput.focus();
      passwordInput.select();
    });
  }

  /* ---------------- 已登录提示块 ---------------- */

  function mountSessionBox() {
    if (!session || !session.token || !sessionBox) return;
    sessionBox.hidden = false;
    renderSessionText();
    var cont = $('#loginContinue');
    if (cont) {
      cont.addEventListener('click', function (event) {
        event.preventDefault();
        window.location.href = ERP.url('dashboard.html');
      });
    }
    var out = $('#loginSignOut');
    if (out) {
      out.addEventListener('click', function () {
        ERP.auth.clear();
        session = null;
        sessionBox.hidden = true;
      });
    }
  }

  /* =========================================================================
     封面编辑模式（?cover=1）：仅超管，双击编辑 + Logo 上传 + 阻止登录
     ========================================================================= */

  function coverRequested() {
    return UI.getParam('cover') === '1';
  }

  function canEditCover() {
    return !!(session && session.token && ERP.auth.isSuper(session));
  }

  function mountEditTip() {
    var tip = document.createElement('div');
    tip.className = 'cover-edit-tip';
    tip.id = 'coverEditTip';
    tip.setAttribute('role', 'status');
    tip.innerHTML = ERP.icon('edit', 14) +
      '<span>封面编辑模式 · 双击文字编辑，Enter 保存 / Esc 取消</span>';
    document.body.appendChild(tip);
  }

  function mountEditActions() {
    var wrap = document.createElement('div');
    wrap.className = 'cover-edit-actions';
    wrap.innerHTML =
      '<span class="cover-edit-status" id="coverEditStatus">封面编辑中</span>' +
      '<button class="btn cover-edit-back" type="button" id="coverEditBack">' +
        ERP.icon('arrowLeft', 15) + '返回主页面' +
      '</button>';
    document.body.appendChild(wrap);
    statusEl = document.getElementById('coverEditStatus');
    var back = document.getElementById('coverEditBack');
    if (back) {
      back.addEventListener('click', function () {
        window.location.href = ERP.url('dashboard.html');
      });
    }
  }

  function setSavedStatus() {
    if (!statusEl) return;
    var now = new Date();
    statusEl.textContent = '已保存 ' +
      ('0' + now.getHours()).slice(-2) + ':' + ('0' + now.getMinutes()).slice(-2);
  }

  /**
   * 保存单个字段：PATCH /api/ui-settings/login { values: { field: value } }
   * @param {string} field    字段 key
   * @param {string} value    新文案
   * @param {Function} revert 失败时还原 DOM 的回调
   */
  function persist(field, value, revert) {
    var payload = { values: {} };
    payload.values[field] = value;
    ERP.api.patch('/ui-settings/' + PAGE, payload).then(function (data) {
      var saved = value;
      if (data && data.values && typeof data.values[field] === 'string' && data.values[field] !== '') {
        saved = data.values[field];
      }
      textValues[field] = saved;
      if (field === 'login_btn_text') btnText = saved;
      if (field === 'login_session_text') renderSessionText();
      setSavedStatus();
      UI.toast('已保存', 'ok');
    }, function (error) {
      if (typeof revert === 'function') revert();
      UI.toast((error && error.message) || '保存失败，请稍后重试', 'error');
    });
  }

  /** 全选可编辑内容，方便直接覆盖输入 */
  function selectContents(el) {
    try {
      var range = document.createRange();
      range.selectNodeContents(el);
      var selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {
      // 不支持 Range 时元素已聚焦，直接输入即可
    }
  }

  /** 普通文本：contenteditable 就地编辑（h1 / p / label / span / div） */
  function beginContentEdit(el, field) {
    var original = textValues[field] != null ? textValues[field] : readElValue(el);
    editing = { el: el, field: field, original: original, type: 'content' };
    el.setAttribute('contenteditable', 'true');
    el.setAttribute('data-editing', '1');
    el.focus();
    selectContents(el);

    function cleanup() {
      el.removeEventListener('keydown', onKey);
      el.removeEventListener('blur', onBlur);
      el.removeAttribute('contenteditable');
      el.removeAttribute('data-editing');
      editing = null;
    }
    function finish() {
      var value = cleanText(el.textContent);
      cleanup();
      if (!value || value === original) {
        el.textContent = original;   // 空内容 / 未改动：还原，不入库
        return;
      }
      el.textContent = value;
      persist(field, value, function () { el.textContent = original; });
    }
    function onKey(event) {
      if (event.key === 'Enter') {
        event.preventDefault();      // 禁止换行，回车即保存
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        el.textContent = original;   // 取消还原
        cleanup();
      }
    }
    function onBlur() { finish(); }

    el.addEventListener('keydown', onKey);
    el.addEventListener('blur', onBlur);
  }

  /** 输入框 placeholder：直接在原输入框里编辑（同尺寸，无额外 DOM） */
  function beginPlaceholderEdit(input, field) {
    var original = textValues[field] != null ? textValues[field] : cleanText(input.placeholder);
    var originalType = input.type;
    editing = { el: input, field: field, original: original, type: 'placeholder' };
    if (originalType === 'password') input.type = 'text';  // 密码框改明文，否则编辑时显示圆点
    input.value = original;
    input.setAttribute('data-editing', '1');
    input.focus();
    if (input.select) input.select();

    function cleanup() {
      input.removeEventListener('keydown', onKey);
      input.removeEventListener('blur', onBlur);
      input.removeAttribute('data-editing');
      input.type = originalType;
      input.value = '';              // 编辑用的临时值不留在登录框里
      editing = null;
    }
    function finish() {
      var value = cleanText(input.value);
      cleanup();
      if (!value || value === original) {
        input.placeholder = original;
        return;
      }
      input.placeholder = value;
      persist(field, value, function () { input.placeholder = original; });
    }
    function onKey(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        input.placeholder = original;
        cleanup();
      }
    }
    function onBlur() { finish(); }

    input.addEventListener('keydown', onKey);
    input.addEventListener('blur', onBlur);
  }

  /** 按钮文字：<button> 不支持 contenteditable，临时换成同尺寸 input 编辑 */
  function beginButtonEdit(btn, field) {
    var original = textValues[field] != null ? textValues[field] : readElValue(btn);
    var swap = document.createElement('input');
    swap.type = 'text';
    swap.className = btn.className + ' cover-edit-swap';
    swap.value = original;
    swap.setAttribute('aria-label', '编辑登录按钮文字');
    btn.parentNode.insertBefore(swap, btn);
    btn.style.display = 'none';
    editing = { el: btn, field: field, original: original, type: 'button' };
    swap.focus();
    if (swap.select) swap.select();

    function cleanup() {
      swap.removeEventListener('keydown', onKey);
      swap.removeEventListener('blur', onBlur);
      if (swap.parentNode) swap.parentNode.removeChild(swap);
      btn.style.display = '';
      editing = null;
    }
    function finish() {
      var value = cleanText(swap.value);
      cleanup();
      if (!value || value === original) return;
      btn.textContent = value;
      persist(field, value, function () { btn.textContent = original; });
    }
    function onKey(event) {
      if (event.key === 'Enter') {
        event.preventDefault();
        finish();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        cleanup();
      }
    }
    function onBlur() { finish(); }

    swap.addEventListener('keydown', onKey);
    swap.addEventListener('blur', onBlur);
  }

  /** 所有 [data-edit] 元素：双击进入就地编辑（只有编辑模式才绑定） */
  function bindTextEditing() {
    UI.$all('[data-edit]').forEach(function (el) {
      var field = el.getAttribute('data-edit');
      if (!field) return;
      el.title = '双击编辑';
      el.addEventListener('dblclick', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (!editMode || editing) return;
        var type = el.getAttribute('data-edit-type') || '';
        if (type === 'placeholder' || (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
          beginPlaceholderEdit(el, field);
        } else if (type === 'button' || el.tagName === 'BUTTON') {
          beginButtonEdit(el, field);
        } else {
          beginContentEdit(el, field);
        }
      });
    });
  }

  /* ---------------- Logo 上传（编辑模式） ---------------- */

  function bindLogoEditing() {
    if (!logoBox) return;
    logoBox.addEventListener('click', function (event) {
      if (!editMode) return;          // 普通访客点击 Logo 无反应
      event.preventDefault();
      event.stopPropagation();
      openLogoPicker();
    });
  }

  function openLogoPicker() {
    if (!logoInput || !logoInput.parentNode) {
      logoInput = document.createElement('input');
      logoInput.type = 'file';
      logoInput.id = 'loginLogoFileInput';
      logoInput.accept = 'image/png,image/jpeg,image/webp,image/gif';
      logoInput.style.display = 'none';
      logoInput.addEventListener('change', function () {
        var file = logoInput.files && logoInput.files[0];
        logoInput.value = '';        // 允许重复选择同一文件
        if (file) uploadLogo(file);
      });
      document.body.appendChild(logoInput);
    }
    logoInput.click();
  }

  function uploadLogo(file) {
    if (!ALLOWED_TYPES[file.type]) {
      UI.toast('仅支持 png / jpg / webp / gif 图片', 'error');
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      UI.toast('Logo 图片不能超过 5MB', 'error');
      return;
    }
    UI.toast('正在上传 Logo…', 'warn');
    ERP.api.upload('/uploads', file).then(function (result) {
      if (!result || !result.url) throw new Error('上传结果异常');
      return ERP.api.patch('/settings', { logo_image: result.url }).then(function () {
        applyLogo(result.url);
        setSavedStatus();
        UI.toast('Logo 已更新', 'ok');
      });
    }).catch(function (error) {
      UI.toast((error && error.message) || 'Logo 更新失败', 'error');
    });
  }

  /** 进入封面编辑模式：浮层提示 + 右下角返回按钮 + 双击绑定 + Logo 上传 */
  function enterCoverEdit() {
    editMode = true;
    document.body.classList.add('is-cover-edit');
    // 按钮改普通按钮：双击按钮文字时不会触发登录（回车提交仍由 submit 拦截兜底）
    if (loginBtn) loginBtn.type = 'button';
    mountEditTip();
    mountEditActions();
    bindTextEditing();
    bindLogoEditing();
    syncLogoTitle();
    renderSessionText();
  }

  /* ---------------- 启动 ---------------- */

  cacheDefaults();
  if (versionEl && ERP.config) versionEl.textContent = ERP.config.version;
  mountSessionBox();

  if (coverRequested()) {
    if (canEditCover()) {
      enterCoverEdit();
    } else {
      // 未登录 / 非超管：按普通登录页展示，仅提示一次（后端 PATCH 仍会 403）
      UI.toast('仅超级管理员可编辑封面', 'warn');
    }
  }

  loadRemote().then(null, function () { /* 兜底：任何异常都不影响登录 */ });
})();
