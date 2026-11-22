/**
 * 封面编辑页（v1.3.0，仅超级管理员可进入）
 * ---------------------------------------------------------------------------
 * - 整屏封面：左上角品牌区（复用 ERP.site.mountBrand）、中间大字标题、标语、页脚
 * - 所有文案（cover_title / cover_slogan / cover_footer / app_name / club_name）
 *   双击就地编辑：Enter / 失焦保存，Esc 取消，保存成功 toast
 * - 右下角固定「返回主页面」按钮 + 保存状态提示
 * - 非超级管理员进入时立即回工作台
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var esc = ERP.ui.esc;

  var session = ERP.auth.requireLogin();
  if (!session) return;

  // 仅超级管理员；其余角色（含依赖脚本缺失）立即回工作台，不渲染任何内容
  if (!ERP.auth.isSuper(session) || !ERP.site || !ERP.site.bindEditable) {
    window.location.replace(ERP.url('dashboard.html'));
    return;
  }

  var root = document.getElementById('app');
  if (!root) return;

  /** 封面可编辑文案（品牌区 app_name / club_name 由 site.js 处理） */
  var COVER_FIELDS = ['cover_title', 'cover_slogan', 'cover_footer'];

  var ready = false;     // 首次配置加载完成前，不把 erp:site-changed 当成「已保存」
  var statusEl = null;

  /** 用当前设置渲染整页（先用缓存 / 默认值，避免后端慢时白屏） */
  function render(settings) {
    root.innerHTML =
      '<div class="cover-page">' +
        '<div class="cover-tip">双击文字编辑 · Enter 保存 / Esc 取消</div>' +

        '<div class="cover-brand">' +
          '<a class="app-brand" href="' + esc(ERP.url('dashboard.html')) + '" title="返回工作台"></a>' +
        '</div>' +

        '<div class="cover-center">' +
          '<h1 class="cover-title" data-edit="cover_title" title="双击编辑">' +
            esc(settings.cover_title) +
          '</h1>' +
          '<div class="cover-rule" aria-hidden="true"></div>' +
          '<p class="cover-slogan" data-edit="cover_slogan" title="双击编辑">' +
            esc(settings.cover_slogan) +
          '</p>' +
        '</div>' +

        '<footer class="cover-footer">' +
          '<span class="cover-footer-text" data-edit="cover_footer" title="双击编辑">' +
            esc(settings.cover_footer) +
          '</span>' +
        '</footer>' +

        '<div class="cover-actions">' +
          '<span class="cover-status" id="coverStatus">已同步</span>' +
          '<button class="btn cover-back" type="button" id="coverBackBtn">' +
            ERP.icon('arrowLeft', 15) + '返回主页面' +
          '</button>' +
        '</div>' +
      '</div>';
  }

  /** 绑定：品牌区（Logo 上传 + 名称编辑）+ 封面三段文案双击编辑 + 返回按钮 */
  function bind() {
    ERP.site.mountBrand(root);

    COVER_FIELDS.forEach(function (field) {
      ERP.site.bindEditable(root.querySelector('[data-edit="' + field + '"]'), field);
    });

    statusEl = root.querySelector('#coverStatus');

    var backBtn = root.querySelector('#coverBackBtn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        window.location.href = ERP.url('dashboard.html');
      });
    }
  }

  /** 配置加载完成后刷新文案；正在编辑的字段保持不动 */
  function syncTexts(settings) {
    COVER_FIELDS.forEach(function (field) {
      var el = root.querySelector('[data-edit="' + field + '"]');
      if (!el || el.getAttribute('data-editing') === '1') return;
      el.textContent = settings[field] || '';
    });
  }

  render(ERP.site.get());
  bind();

  // 强制拉取最新配置（失败时 site.js 回落到缓存 / 内置默认值，不阻塞页面）
  ERP.site.load(true).then(function (next) {
    ERP.site.apply();
    syncTexts(next);
    ERP.site.mountBrand(root); // 品牌区刷新 Logo / 名称
    ready = true;
  }).catch(function () {
    ready = true;
  });

  // 保存状态提示（可选）：任意字段保存成功后刷新时间戳
  document.addEventListener('erp:site-changed', function () {
    if (!ready || !statusEl) return;
    var now = new Date();
    var hh = ('0' + now.getHours()).slice(-2);
    var mm = ('0' + now.getMinutes()).slice(-2);
    statusEl.textContent = '已保存 · ' + hh + ':' + mm;
  });
})();
