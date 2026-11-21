/**
 * 通用 UI 工具：选择器、转义、Toast、确认框、标签渲染、日期处理
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};

  function $(selector, root) {
    return (root || document).querySelector(selector);
  }
  function $all(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
  }
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  var toastHost = null;
  function toast(message, type) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' is-' + type : '');
    el.textContent = message;
    toastHost.appendChild(el);
    window.setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 2600);
  }

  /** 确认对话框，返回 Promise<boolean> */
  function confirmDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-hd">' + esc(opts.title || '确认操作') + '</div>' +
          '<div class="modal-bd">' + (opts.html || esc(opts.message || '确定要执行该操作吗？')) + '</div>' +
          '<div class="modal-ft">' +
            '<button type="button" class="btn" data-act="cancel">取消</button>' +
            '<button type="button" class="btn ' + (opts.danger ? 'btn-danger' : 'btn-primary') + '" data-act="ok">' +
              esc(opts.okText || '确定') +
            '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mask);

      function close(result) {
        document.removeEventListener('keydown', onKey);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(result);
      }
      function onKey(event) {
        if (event.key === 'Escape') close(false);
      }
      mask.addEventListener('click', function (event) {
        if (event.target === mask) return close(false);
        var btn = event.target.closest('[data-act]');
        if (!btn) return;
        close(btn.getAttribute('data-act') === 'ok');
      });
      document.addEventListener('keydown', onKey);
      var ok = mask.querySelector('[data-act="ok"]');
      if (ok) ok.focus();
    });
  }

  /** 输入对话框，返回 Promise<string|null> */
  function promptDialog(options) {
    var opts = options || {};
    return new Promise(function (resolve) {
      var mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML =
        '<div class="modal" role="dialog" aria-modal="true">' +
          '<div class="modal-hd">' + esc(opts.title || '请输入') + '</div>' +
          '<div class="modal-bd">' +
            '<div class="field">' +
              (opts.label ? '<label class="label" for="erpPromptInput">' + esc(opts.label) + '</label>' : '') +
              '<input class="input" id="erpPromptInput" type="' + esc(opts.type || 'text') + '" value="' +
                esc(opts.value == null ? '' : opts.value) + '" placeholder="' + esc(opts.placeholder || '') + '">' +
              (opts.hint ? '<span class="field-hint">' + esc(opts.hint) + '</span>' : '') +
            '</div>' +
            (opts.message ? '<p class="muted small" style="margin-top:12px">' + esc(opts.message) + '</p>' : '') +
          '</div>' +
          '<div class="modal-ft">' +
            '<button type="button" class="btn" data-act="cancel">取消</button>' +
            '<button type="button" class="btn btn-primary" data-act="ok">' + esc(opts.okText || '确定') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mask);

      var input = mask.querySelector('#erpPromptInput');

      function close(result) {
        document.removeEventListener('keydown', onKey);
        if (mask.parentNode) mask.parentNode.removeChild(mask);
        resolve(result);
      }
      function submit() {
        close(input ? input.value : null);
      }
      function onKey(event) {
        if (event.key === 'Escape') close(null);
        if (event.key === 'Enter' && event.target === input) {
          event.preventDefault();
          submit();
        }
      }
      mask.addEventListener('click', function (event) {
        if (event.target === mask) return close(null);
        var btn = event.target.closest('[data-act]');
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'ok') submit();
        else close(null);
      });
      document.addEventListener('keydown', onKey);
      if (input) {
        input.focus();
        if (input.select) input.select();
      }
    });
  }

  /** 管理模式标签：简易灰色、精确蓝色 */
  function tagMode(mode) {
    var label = (ERP.config.modeLabels || {})[mode] || mode;
    var cls = mode === 'precise' ? 'tag-precise' : 'tag-simple';
    return '<span class="tag ' + cls + '">' + esc(label) + '</span>';
  }

  /** 库存状态标签 */
  function tagStatus(material) {
    if (!material) return '';
    if (material.status === 'empty') {
      return '<span class="tag tag-empty tag-dot">空</span>';
    }
    if (material.mode === 'precise' && Number(material.minQty) > 0 && Number(material.qty) <= Number(material.minQty)) {
      return '<span class="tag tag-warn tag-dot">有货 · 低库存</span>';
    }
    return '<span class="tag tag-ok tag-dot">有货</span>';
  }

  function fmtDateTime(value) {
    if (!value) return '—';
    return String(value).slice(0, 16);
  }
  function fmtDate(value) {
    if (!value) return '—';
    return String(value).slice(0, 10);
  }
  function debounce(fn, wait) {
    var timer = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(self, args); }, wait || 200);
    };
  }
  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name);
    } catch (e) {
      return null;
    }
  }

  /** 取逗号分隔图片路径中的第一张 */
  function firstImage(paths) {
    var parts = String(paths || '').split(',');
    for (var i = 0; i < parts.length; i += 1) {
      var value = parts[i].trim();
      if (value) return value;
    }
    return '';
  }

  /** 列表缩略图 / 任意位置点击查看大图 */
  function previewImage(src, title) {
    if (!src) return;
    var mask = document.createElement('div');
    mask.className = 'image-preview-mask';
    mask.setAttribute('role', 'dialog');
    mask.setAttribute('aria-modal', 'true');
    mask.innerHTML =
      '<div class="image-preview">' +
        '<button class="image-preview-close" type="button" title="关闭">×</button>' +
        '<img src="' + esc(imageUrl(src)) + '" alt="' + esc(title || '物料图片') + '">' +
        (title ? '<div class="image-preview-title">' + esc(title) + '</div>' : '') +
      '</div>';
    document.body.appendChild(mask);
    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }
    function onKey(event) {
      if (event.key === 'Escape') close();
    }
    mask.addEventListener('click', function (event) {
      if (event.target === mask || event.target.closest('.image-preview-close')) close();
    });
    document.addEventListener('keydown', onKey);
  }

  /** 图片路径：/uploads/ 绝对路径直接使用，其余相对路径按项目 base 拼接 */
  function imageUrl(path) {
    var value = String(path || '').trim();
    if (!value) return ERP.url('assets/img/default.svg');
    if (/^(https?:)?\/\//.test(value) || value.charAt(0) === '/') return value;
    return ERP.url(value);
  }

  ERP.ui = {
    $: $,
    $all: $all,
    esc: esc,
    toast: toast,
    confirm: confirmDialog,
    prompt: promptDialog,
    tagMode: tagMode,
    tagStatus: tagStatus,
    fmtDateTime: fmtDateTime,
    fmtDate: fmtDate,
    debounce: debounce,
    getParam: getParam,
    imageUrl: imageUrl,
    firstImage: firstImage,
    previewImage: previewImage
  };
})();
