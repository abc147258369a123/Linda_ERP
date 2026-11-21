/**
 * 物料使用车（批量领用）
 * ------------------------------------------------------------------
 * - 数据存 localStorage（键 erp.v1.cart），跨页面共享
 * - 同一物料重复加入会累加数量，精确计数物料数量不超过当前库存
 * - 悬浮面板：清单、数量直接编辑、单条移除、一键清空、去领用登记
 * - 面板支持按住标题栏拖动，位置记忆在 localStorage（erp.v1.cartPanel）
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;
  var KEY = 'erp.v1.cart';
  var POS_KEY = 'erp.v1.cartPanel';
  var listeners = [];

  function readRaw() {
    try {
      var raw = window.localStorage.getItem(KEY);
      var list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch (e) {
      return [];
    }
  }

  function validItems() {
    return readRaw().filter(function (item) {
      return item && item.materialId && ERP.store.getMaterial(item.materialId);
    }).map(function (item) {
      return {
        materialId: item.materialId,
        qty: Math.max(1, Number(item.qty) || 1)
      };
    });
  }

  function write(items) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(items));
    } catch (e) { /* 隐私模式忽略 */ }
    emit();
  }

  function emit() {
    var items = validItems();
    listeners.slice().forEach(function (fn) {
      try { fn(items); } catch (e) { /* ignore */ }
    });
  }

  function loadPanelPos() {
    try {
      var pos = JSON.parse(window.localStorage.getItem(POS_KEY));
      if (pos && isFinite(pos.left) && isFinite(pos.top)) return pos;
    } catch (e) { /* ignore */ }
    return null;
  }

  function savePanelPos(pos) {
    try {
      window.localStorage.setItem(POS_KEY, JSON.stringify(pos));
    } catch (e) { /* ignore */ }
  }

  var cart = {
    key: KEY,

    items: validItems,

    count: function () {
      return validItems().length;
    },

    totalQty: function () {
      return validItems().reduce(function (total, item) { return total + item.qty; }, 0);
    },

    /**
     * 加入使用车（已存在则累加，精确计数物料不超过当前库存）
     */
    add: function (materialId, qty) {
      var material = ERP.store.getMaterial(materialId);
      if (!material) return { ok: false, error: '物料不存在或已被移除' };
      if (material.status === 'empty') return { ok: false, error: '物料为空，补货后才能领用' };
      var amount = Number(qty);
      if (!amount || amount <= 0 || Math.floor(amount) !== amount) {
        return { ok: false, error: '请输入正确的领用数量' };
      }
      if (material.mode === 'precise' && amount > (Number(material.qty) || 0)) {
        return { ok: false, error: '领用数量不能大于当前库存' };
      }

      var items = validItems();
      var existing = null;
      items.forEach(function (item) {
        if (item.materialId === materialId) existing = item;
      });

      if (existing) {
        var cap = material.mode === 'precise' ? (Number(material.qty) || 0) : 99;
        var wanted = existing.qty + amount;
        var merged = Math.min(cap, wanted);
        existing.qty = merged;
        write(items);
        return {
          ok: true,
          merged: true,
          capped: merged < wanted,
          qty: merged,
          material: material
        };
      }

      items.push({ materialId: materialId, qty: amount });
      write(items);
      return { ok: true, merged: false, capped: false, qty: amount, material: material };
    },

    /** 直接修改使用车内数量（校验库存上限） */
    setQty: function (materialId, qty) {
      var material = ERP.store.getMaterial(materialId);
      if (!material) return { ok: false, error: '物料不存在或已被移除' };
      var amount = Number(qty);
      if (!amount || amount <= 0 || Math.floor(amount) !== amount) {
        return { ok: false, error: '请输入正确的领用数量' };
      }
      var cap = material.mode === 'precise' ? (Number(material.qty) || 0) : 99;
      if (amount > cap) {
        return {
          ok: false,
          error: material.mode === 'precise'
            ? '领用数量不能大于当前库存（' + cap + ' 件）'
            : '简易模式单次数量不超过 99'
        };
      }
      var items = validItems();
      var found = false;
      items.forEach(function (item) {
        if (item.materialId === materialId) {
          item.qty = amount;
          found = true;
        }
      });
      if (!found) return { ok: false, error: '该物料不在使用车中' };
      write(items);
      return { ok: true, qty: amount };
    },

    remove: function (materialId) {
      write(validItems().filter(function (item) {
        return item.materialId !== materialId;
      }));
    },

    clear: function () {
      write([]);
    },

    onChange: function (fn) {
      listeners.push(fn);
      return function () {
        var index = listeners.indexOf(fn);
        if (index >= 0) listeners.splice(index, 1);
      };
    },

    /** 在页面右下角挂载悬浮使用车面板（空车时自动隐藏，可拖动） */
    mountPanel: function () {
      if (document.getElementById('erpCartPanel')) return;
      var host = document.createElement('div');
      host.id = 'erpCartPanel';
      host.className = 'cart-panel';
      host.hidden = true;
      document.body.appendChild(host);

      function esc(value) { return ERP.ui.esc(value); }

      function render(items) {
        if (!items.length) {
          host.hidden = true;
          host.innerHTML = '';
          return;
        }
        host.hidden = false;
        var totalQty = items.reduce(function (total, item) { return total + item.qty; }, 0);
        host.innerHTML =
          '<div class="cart-head" title="按住标题栏可拖动面板">' +
            '<div class="cart-title">物料使用车<span class="cart-count">' + items.length + '</span></div>' +
            '<button class="cart-clear" type="button" data-cart="clear">清空</button>' +
          '</div>' +
          '<div class="cart-list">' +
            items.map(function (item) {
              var material = ERP.store.getMaterial(item.materialId);
              var isPrecise = material.mode === 'precise';
              return '<div class="cart-item">' +
                '<div class="cart-item-main">' +
                  '<div class="cart-item-name">' + esc(material.name) + '</div>' +
                  '<div class="cart-item-meta">' + esc(material.model || '—') +
                    (isPrecise
                      ? ' · 库存 ' + (Number(material.qty) || 0) + ' 件'
                      : ' · 简易模式') + '</div>' +
                '</div>' +
                '<div class="cart-item-side">' +
                  '<span class="cart-qty" data-cart-qty="' + esc(item.materialId) +
                    '" title="点击修改数量">×' + item.qty + '</span>' +
                  '<button class="cart-item-remove" type="button" data-cart-remove="' +
                    esc(item.materialId) + '" title="移除该物料" aria-label="移除">×</button>' +
                '</div>' +
              '</div>';
            }).join('') +
          '</div>' +
          '<div class="cart-foot">' +
            '<span class="cart-total">共 ' + items.length + ' 种 / ' + totalQty + ' 件</span>' +
            '<a class="btn btn-primary btn-sm" href="' +
              esc(ERP.url('pages/borrow.html?fromCart=1')) + '">去领用登记</a>' +
          '</div>' +
          '<span class="cart-resize cart-resize-e" data-resize="e" title="拖动调整宽度"></span>' +
          '<span class="cart-resize cart-resize-s" data-resize="s" title="拖动调整高度"></span>' +
          '<span class="cart-resize cart-resize-se" data-resize="se" title="拖动调整面板大小"></span>';
      }

      /* ---------- 数量就地编辑 ---------- */

      function startQtyEdit(span) {
        var materialId = span.getAttribute('data-cart-qty');
        var material = ERP.store.getMaterial(materialId);
        if (!material) return;
        var current = Number(String(span.textContent).replace(/[^\d]/g, '')) || 1;
        var max = material.mode === 'precise' ? (Number(material.qty) || 1) : 99;

        var input = document.createElement('input');
        input.type = 'number';
        input.className = 'cart-qty-input';
        input.min = '1';
        input.max = String(max);
        input.value = String(current);
        input.setAttribute('aria-label', '修改领用数量');
        span.replaceWith(input);
        input.focus();
        if (input.select) input.select();

        var finished = false;

        function finish(commit) {
          if (finished) return;
          finished = true;
          if (!commit) {
            render(cart.items());
            return;
          }
          var result = ERP.cart.setQty(materialId, input.value);
          if (!result.ok) {
            ERP.ui.toast(result.error || '数量无效', 'error');
            render(cart.items());
          }
          // 成功时 write -> emit -> render，由监听器负责重绘
        }

        input.addEventListener('keydown', function (event) {
          if (event.key === 'Enter') {
            event.preventDefault();
            finish(true);
          } else if (event.key === 'Escape') {
            event.preventDefault();
            finish(false);
          }
        });
        input.addEventListener('blur', function () {
          finish(true);
        });
        input.addEventListener('click', function (event) {
          event.stopPropagation();
        });
      }

      host.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-cart-remove]');
        if (removeBtn) {
          cart.remove(removeBtn.getAttribute('data-cart-remove'));
          return;
        }
        var clearBtn = event.target.closest('[data-cart="clear"]');
        if (clearBtn) {
          ERP.ui.confirm({
            title: '清空物料使用车',
            message: '确定移除使用车中的全部物料吗？',
            okText: '清空',
            danger: true
          }).then(function (confirmed) {
            if (confirmed) {
              cart.clear();
              ERP.ui.toast('物料使用车已清空', 'ok');
            }
          });
          return;
        }
        var qtySpan = event.target.closest('[data-cart-qty]');
        if (qtySpan) startQtyEdit(qtySpan);
      });

      /* ---------- 面板位置 / 尺寸持久化 ---------- */

      function saveState() {
        var state = {};
        var left = parseFloat(host.style.left);
        var top = parseFloat(host.style.top);
        var width = parseFloat(host.style.width);
        var height = parseFloat(host.style.height);
        if (isFinite(left)) state.left = left;
        if (isFinite(top)) state.top = top;
        if (isFinite(width)) state.width = width;
        if (isFinite(height)) state.height = height;
        try {
          window.localStorage.setItem(POS_KEY, JSON.stringify(state));
        } catch (e) { /* ignore */ }
      }

      function applyResponsiveSize(width, height) {
        if (width > 0) host.classList.toggle('is-narrow', width < 300);
        if (height > 0) host.classList.toggle('is-short', height < 280);
      }

      function applyPosition() {
        var pos = loadPanelPos();
        if (!pos) {
          applyResponsiveSize(320, 360);
          return;
        }

        var width = isFinite(pos.width) ? Math.min(Math.max(280, pos.width), 620) : null;
        var height = isFinite(pos.height) ? Math.max(240, pos.height) : null;
        if (width) host.style.width = width + 'px';
        if (height) {
          host.style.height = height + 'px';
          host.style.maxHeight = 'none';
        }

        var currentWidth = width || host.offsetWidth || 320;
        var left = Math.min(Math.max(8, pos.left), Math.max(8, window.innerWidth - currentWidth - 8));
        var top = Math.min(Math.max(8, pos.top), Math.max(8, window.innerHeight - 60));
        host.style.left = left + 'px';
        host.style.top = top + 'px';
        host.style.right = 'auto';
        host.style.bottom = 'auto';
        applyResponsiveSize(currentWidth, height || host.offsetHeight || 360);
      }

      /* ---------- 拖动面板（标题栏） ---------- */

      function bindDrag() {
        var dragState = null;
        var moveEvent = 'mousemove';
        var upEvent = 'mouseup';

        function onMove(event) {
          if (!dragState) return;
          if (event.preventDefault) event.preventDefault();
          var width = host.offsetWidth || 320;
          var left = event.clientX - dragState.offsetX;
          var top = event.clientY - dragState.offsetY;
          left = Math.min(Math.max(8, left), Math.max(8, window.innerWidth - width - 8));
          top = Math.min(Math.max(8, top), Math.max(8, window.innerHeight - 60));
          host.style.left = left + 'px';
          host.style.top = top + 'px';
        }

        function onUp() {
          if (!dragState) return;
          dragState = null;
          host.classList.remove('is-dragging');
          document.removeEventListener(moveEvent, onMove);
          document.removeEventListener(upEvent, onUp);
          saveState();
        }

        host.addEventListener('mousedown', function (event) {
          var head = event.target.closest('.cart-head');
          if (!head) return;
          if (event.target.closest('button')) return;
          event.preventDefault();
          var rect = host.getBoundingClientRect();
          dragState = {
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top
          };
          host.style.left = rect.left + 'px';
          host.style.top = rect.top + 'px';
          host.style.right = 'auto';
          host.style.bottom = 'auto';
          host.classList.add('is-dragging');
          document.addEventListener(moveEvent, onMove);
          document.addEventListener(upEvent, onUp);
        });
      }

      /* ---------- 拖拽缩放（右边缘 / 下边缘 / 右下角） ---------- */

      function bindResize() {
        var resizeState = null;

        function onMove(event) {
          if (!resizeState) return;
          if (event.preventDefault) event.preventDefault();
          var dx = event.clientX - resizeState.startX;
          var dy = event.clientY - resizeState.startY;
          var left = parseFloat(host.style.left) || 0;
          var top = parseFloat(host.style.top) || 0;
          var maxWidth = Math.min(620, Math.max(280, window.innerWidth - left - 16));
          var maxHeight = Math.max(240, window.innerHeight - top - 16);
          var width = resizeState.startWidth;
          var height = resizeState.startHeight;

          if (resizeState.dir !== 's') {
            width = Math.min(Math.max(280, resizeState.startWidth + dx), maxWidth);
          }
          if (resizeState.dir !== 'e') {
            height = Math.min(Math.max(240, resizeState.startHeight + dy), maxHeight);
          }

          host.style.width = width + 'px';
          host.style.height = height + 'px';
          host.style.maxHeight = 'none';
          applyResponsiveSize(width, height);
        }

        function onUp() {
          if (!resizeState) return;
          resizeState = null;
          host.classList.remove('is-resizing');
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
          saveState();
        }

        host.addEventListener('mousedown', function (event) {
          var handle = event.target.closest('[data-resize]');
          if (!handle) return;
          event.preventDefault();
          event.stopPropagation();
          var rect = host.getBoundingClientRect();
          var startWidth = rect.width || parseFloat(host.style.width) || 320;
          var startHeight = rect.height || parseFloat(host.style.height) || 360;
          if (host.style.width) startWidth = parseFloat(host.style.width);
          if (host.style.height) startHeight = parseFloat(host.style.height);
          resizeState = {
            dir: handle.getAttribute('data-resize'),
            startX: event.clientX,
            startY: event.clientY,
            startWidth: startWidth,
            startHeight: startHeight
          };
          host.classList.add('is-resizing');
          document.addEventListener('mousemove', onMove);
          document.addEventListener('mouseup', onUp);
        });
      }

      window.addEventListener('resize', function () {
        if (!host.style.left) return;
        var width = host.offsetWidth || 320;
        var left = Math.min(parseFloat(host.style.left) || 8, Math.max(8, window.innerWidth - width - 8));
        var top = Math.min(parseFloat(host.style.top) || 8, Math.max(8, window.innerHeight - 60));
        host.style.left = left + 'px';
        host.style.top = top + 'px';
      });

      cart.onChange(render);
      render(cart.items());
      applyPosition();
      bindDrag();
      bindResize();
    }
  };

  ERP.cart = cart;
})();
