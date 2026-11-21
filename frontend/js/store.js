/**
 * 数据层：后端 REST API（JWT）+ 内存缓存
 * ------------------------------------------------------------------
 * - 页面首次加载调用 ERP.store.load() 拉取物料 / 分类 / 日志 / 统计
 * - 读方法（materials/categories/logs/getMaterial/stats...）同步读缓存
 * - 写方法（物料 / 分类 / 用户 / 领用 / 补货 / 标记为空）调用 API，
 *   成功后刷新缓存并返回 { ok, error?, ... }（upsertMaterial 返回物料）
 * - 不再使用 localStorage 模拟业务数据（仅使用 erp.token / 会话 / 使用车）
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  var cache = {
    materials: [],
    categories: [],
    users: [],
    logs: [],
    stats: {},
    loaded: false
  };

  function pad(value) {
    return value < 10 ? '0' + value : '' + value;
  }

  function nowStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function isWarn(material) {
    if (!material || material.mode !== 'precise') return false;
    var qty = Number(material.qty);
    var min = Number(material.minQty);
    return isFinite(qty) && isFinite(min) && min > 0 && qty <= min;
  }

  function mapMaterial(raw) {
    var qty = raw.qty === null || raw.qty === undefined ? null : Number(raw.qty);
    var minQty = raw.min_qty === null || raw.min_qty === undefined ? null : Number(raw.min_qty);
    return {
      id: raw.code,
      code: raw.code,
      dbId: raw.id,
      name: raw.name,
      model: raw.model || '',
      package: raw.package || '',
      spec: raw.spec || '',
      brand: raw.brand || '',
      mode: raw.mode,
      qty: qty,
      minQty: minQty,
      status: raw.status,
      cabinet: raw.cabinet || '',
      slot: raw.slot || '',
      categoryId: raw.category_id,
      categoryName: raw.category_name || '',
      source: raw.source || '',
      inboundAt: raw.inbound_at || '',
      updatedAt: raw.updated_at || '',
      image: raw.image || 'assets/img/default.svg',
      note: raw.note || '',
      isWarn: Boolean(raw.is_warn) || isWarn({ mode: raw.mode, qty: qty, minQty: minQty }),
      location: [raw.cabinet, raw.slot].filter(Boolean).join(' · ')
    };
  }

  function mapLog(raw) {
    return {
      id: raw.id,
      materialId: raw.material_code || String(raw.material_id || ''),
      dbMaterialId: raw.material_id,
      materialName: raw.material_name || '',
      materialModel: raw.material_model || '',
      mode: raw.mode || 'precise',
      action: raw.action,
      qty: raw.qty === null || raw.qty === undefined ? null : Number(raw.qty),
      orderNo: raw.order_no || '',
      borrower: raw.borrower || '',
      project: raw.project || '',
      operator: raw.operator_name || '',
      note: raw.note || '',
      borrowAt: raw.created_at || '',
      createdAt: raw.created_at || ''
    };
  }

  function mapUser(raw) {
    return {
      id: raw.id,
      dbId: raw.id,
      account: raw.username,
      name: raw.name,
      role: raw.role,
      active: raw.active !== false,
      note: raw.note || '',
      createdAt: raw.created_at || ''
    };
  }

  function mapCategory(raw) {
    return { id: raw.id, name: raw.name, count: 0, warnCount: 0, emptyCount: 0 };
  }

  function rebuildDerived() {
    var categories = cache.categories.map(function (category) {
      var used = cache.materials.filter(function (m) { return m.categoryId === category.id; });
      return {
        id: category.id,
        name: category.name,
        count: used.length,
        warnCount: used.filter(isWarn).length,
        emptyCount: used.filter(function (m) { return m.status === 'empty'; }).length
      };
    });
    cache.categories = categories;

    var precise = cache.materials.filter(function (m) { return m.mode === 'precise'; });
    var simple = cache.materials.filter(function (m) { return m.mode === 'simple'; });
    cache.stats = {
      total: cache.materials.length,
      simple: simple.length,
      precise: precise.length,
      available: cache.materials.filter(function (m) { return m.status === 'available'; }).length,
      empty: cache.materials.filter(function (m) { return m.status === 'empty'; }).length,
      warn: cache.materials.filter(isWarn).length,
      categories: cache.categories.length,
      logs: cache.stats.logs || cache.logs.length,
      users: cache.users.length
    };
  }

  function findMaterial(id) {
    var key = String(id || '');
    var found = null;
    cache.materials.forEach(function (material) {
      if (String(material.id) === key || String(material.dbId) === key) found = material;
    });
    return found;
  }

  function categoryName(categoryId) {
    var found = '';
    cache.categories.forEach(function (category) {
      if (String(category.id) === String(categoryId)) found = category.name;
    });
    return found;
  }

  async function load() {
    var session = ERP.auth.get();
    if (!session || !session.token) return false;

    try {
      var me = await ERP.api.me();
      session.account = me.username;
      session.name = me.name;
      session.role = me.role;
      session.userId = me.id;
      ERP.auth.set(session);
    } catch (error) {
      if (error.status === 401) throw error;
    }

    var requests = [
      ERP.api.get('/materials?page_size=500'),
      ERP.api.get('/categories'),
      ERP.api.get('/inventory/stats'),
      ERP.api.get('/inventory/logs?page_size=200')
    ];
    if (ERP.auth.isAdmin(session)) {
      requests.push(ERP.api.get('/users?page_size=200'));
    }

    var results = await Promise.allSettled(requests);
    var materialResult = results[0];
    var categoryResult = results[1];
    var statsResult = results[2];
    var logResult = results[3];
    var usersResult = results[4];

    cache.materials = materialResult.status === 'fulfilled'
      ? (materialResult.value.items || []).map(mapMaterial)
      : [];
    cache.categories = categoryResult.status === 'fulfilled'
      ? (categoryResult.value.items || []).map(mapCategory)
      : [];
    cache.logs = logResult.status === 'fulfilled'
      ? (logResult.value.items || []).map(mapLog)
      : [];
    cache.users = usersResult && usersResult.status === 'fulfilled'
      ? (usersResult.value.items || []).map(mapUser)
      : [];

    // 后端流水未带物料模式时，从前端缓存的物料档案补齐
    cache.logs.forEach(function (log) {
      var material = findMaterial(log.materialId);
      if (material) log.mode = material.mode;
    });

    var rawStats = statsResult.status === 'fulfilled' ? statsResult.value : {};
    rebuildDerived();
    cache.stats.logs = Number(rawStats.logs || cache.logs.length);
    cache.stats.categories = Number(rawStats.categories || cache.categories.length);
    cache.stats.users = cache.users.length;
    cache.loaded = true;

    if (ERP.layout && ERP.layout.refreshAlertsBadge) ERP.layout.refreshAlertsBadge();
    return true;
  }

  async function refresh() {
    try { return await load(); } catch (e) { return false; }
  }

  function materialPayload(payload) {
    var body = {
      name: payload.name,
      model: payload.model,
      package: payload.package || '',
      spec: payload.spec || '',
      brand: payload.brand || '',
      mode: payload.mode || 'simple',
      cabinet: payload.cabinet || '',
      slot: payload.slot || '',
      category_id: Number(payload.categoryId),
      source: payload.source || '',
      image: payload.image || '',
      note: payload.note || ''
    };
    if (payload.mode === 'precise') {
      body.qty = Number(payload.qty) || 0;
      body.min_qty = Number(payload.minQty) || 0;
    }
    if (payload.inboundAt) body.inbound_at = payload.inboundAt;
    return body;
  }

  var store = {
    load: load,
    refresh: refresh,
    loaded: function () { return cache.loaded; },
    now: nowStr,
    today: todayStr,

    materials: function () { return cache.materials.slice(); },
    getMaterial: function (id) { return findMaterial(id); },
    categoryName: categoryName,
    isWarn: isWarn,

    listMaterials: function (options) {
      var opts = options || {};
      var list = cache.materials.slice();
      var keyword = String(opts.q || '').trim().toLowerCase();
      if (keyword) {
        list = list.filter(function (material) {
          return [material.name, material.model, material.package, material.spec, material.brand,
            material.cabinet, material.slot, material.source, material.note,
            categoryName(material.categoryId)].some(function (field) {
            return field && String(field).toLowerCase().indexOf(keyword) >= 0;
          });
        });
      }
      if (opts.mode && opts.mode !== 'all') list = list.filter(function (m) { return m.mode === opts.mode; });
      if (opts.status && opts.status !== 'all') list = list.filter(function (m) { return m.status === opts.status; });
      if (opts.categoryId && opts.categoryId !== 'all') {
        list = list.filter(function (m) { return String(m.categoryId) === String(opts.categoryId); });
      }
      if (opts.warnOnly) list = list.filter(isWarn);

      var sort = opts.sort || 'updated';
      if (sort === 'name') {
        list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
      } else if (sort === 'qty') {
        list.sort(function (a, b) {
          var pa = a.mode === 'precise';
          var pb = b.mode === 'precise';
          if (pa !== pb) return pa ? -1 : 1;
          if (pa && pb) {
            var diff = Number(a.qty) - Number(b.qty);
            if (diff !== 0) return diff;
          }
          return String(a.name).localeCompare(String(b.name), 'zh');
        });
      } else if (sort === 'inbound') {
        list.sort(function (a, b) { return String(b.inboundAt || '').localeCompare(String(a.inboundAt || '')); });
      } else if (sort === 'warn') {
        list.sort(function (a, b) {
          var diff = Number(isWarn(b)) - Number(isWarn(a));
          if (diff !== 0) return diff;
          return String(a.name).localeCompare(String(b.name), 'zh');
        });
      } else {
        list.sort(function (a, b) { return String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); });
      }
      return list;
    },

    /* ---------------- 物料写操作 ---------------- */

    upsertMaterial: async function (payload) {
      var editing = payload.id ? findMaterial(payload.id) : null;
      var saved = editing
        ? await ERP.api.patch('/materials/' + editing.dbId, materialPayload(payload))
        : await ERP.api.post('/materials', materialPayload(payload));
      await refresh();
      return findMaterial(saved.code) || mapMaterial(saved);
    },

    setStatus: async function (id, status) {
      var material = findMaterial(id);
      if (!material) return { ok: false, error: '物料不存在' };
      try {
        await ERP.api.patch('/materials/' + material.dbId + '/status', { status: status });
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /* ---------------- 领用 / 补货 ---------------- */

    borrow: async function (input) {
      var material = findMaterial(input.materialId);
      if (!material) return { ok: false, error: '物料不存在或已被移除' };
      if (!String(input.borrower || '').trim()) return { ok: false, error: '请填写领用人' };
      if (!String(input.project || '').trim()) return { ok: false, error: '请填写所属项目' };
      var qty = null;
      if (material.mode === 'precise') {
        qty = Number(input.qty);
        if (!qty || qty <= 0 || Math.floor(qty) !== qty) {
          return { ok: false, error: '请输入正确的领用数量（正整数）' };
        }
      }
      try {
        await ERP.api.post('/stock-out', {
          type: 'borrow',
          borrower: String(input.borrower).trim(),
          project: String(input.project).trim(),
          note: String(input.note || ''),
          items: [{ material_id: material.dbId, qty: qty }]
        });
        await refresh();
        return { ok: true, material: findMaterial(material.id) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    borrowBatch: async function (entries, meta) {
      var items = [];
      for (var i = 0; i < entries.length; i += 1) {
        var entry = entries[i];
        var material = findMaterial(entry.materialId);
        if (!material) return { ok: false, error: '物料不存在或已被移除' };
        items.push({
          material_id: material.dbId,
          qty: material.mode === 'precise' ? Number(entry.qty) : null
        });
      }
      try {
        var order = await ERP.api.post('/stock-out', {
          type: 'borrow',
          borrower: String(meta.borrower).trim(),
          project: String(meta.project).trim(),
          note: String(meta.note || ''),
          items: items
        });
        await refresh();
        return { ok: true, order: order, count: items.length };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    markEmpty: async function (id, operator) {
      var material = findMaterial(id);
      if (!material) return { ok: false, error: '物料不存在' };
      if (material.status === 'empty') return { ok: false, error: '该物料已经是空状态' };
      try {
        await ERP.api.patch('/materials/' + material.dbId + '/status', { status: 'empty' });
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    restock: async function (id, qty) {
      var material = findMaterial(id);
      if (!material) return { ok: false, error: '物料不存在' };
      var amount = Number(qty);
      if (!amount || amount <= 0 || Math.floor(amount) !== amount) {
        return { ok: false, error: '补货数量需为正整数' };
      }
      try {
        await ERP.api.post('/stock-in', {
          note: '库存预警补货',
          items: [{ material_id: material.dbId, qty: amount }]
        });
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /* ---------------- 日志 / 分类 / 用户 ---------------- */

    logs: function (options) {
      var opts = options || {};
      var list = cache.logs.slice();
      if (opts.materialId) {
        list = list.filter(function (log) { return String(log.materialId) === String(opts.materialId); });
      }
      if (opts.action && opts.action !== 'all') list = list.filter(function (log) { return log.action === opts.action; });
      var keyword = String(opts.q || '').trim().toLowerCase();
      if (keyword) {
        list = list.filter(function (log) {
          return [log.materialName, log.materialId, log.borrower, log.project, log.operator, log.note]
            .some(function (field) { return field && String(field).toLowerCase().indexOf(keyword) >= 0; });
        });
      }
      list.sort(function (a, b) {
        var byTime = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        return byTime !== 0 ? byTime : String(b.id).localeCompare(String(a.id));
      });
      return list;
    },

    logsForMaterial: function (materialId) {
      return store.logs({ materialId: materialId });
    },

    fetchMaterialLogs: async function (materialId) {
      var material = findMaterial(materialId);
      if (!material) return [];
      var data = await ERP.api.get('/materials/' + material.dbId + '/logs?page_size=200');
      return (data.items || []).map(mapLog);
    },

    fetchLogs: async function (params) {
      var query = [];
      Object.keys(params || {}).forEach(function (key) {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          query.push(encodeURIComponent(key) + '=' + encodeURIComponent(params[key]));
        }
      });
      return ERP.api.get('/inventory/logs' + (query.length ? '?' + query.join('&') : ''));
    },

    categories: function () { return cache.categories.slice(); },

    addCategory: async function (name) {
      var value = String(name || '').trim();
      if (!value) return { ok: false, error: '分类名称不能为空' };
      if (value.length > 30) return { ok: false, error: '分类名称不能超过 30 个字符' };
      try {
        var category = await ERP.api.post('/categories', { name: value });
        await refresh();
        return { ok: true, category: category };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    renameCategory: async function (id, name) {
      var value = String(name || '').trim();
      if (!value) return { ok: false, error: '分类名称不能为空' };
      try {
        await ERP.api.patch('/categories/' + id, { name: value });
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    deleteCategory: async function (id) {
      try {
        await ERP.api.del('/categories/' + id);
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    users: function () { return cache.users.slice(); },
    findUser: function (account) {
      var found = null;
      cache.users.forEach(function (user) {
        if (String(user.account).toLowerCase() === String(account).toLowerCase()) found = user;
      });
      return found;
    },
    displayNameFor: function (account) {
      var user = store.findUser(account);
      if (user) return user.name;
      return account || '未命名用户';
    },

    addUser: async function (payload) {
      try {
        var user = await ERP.api.post('/users', {
          username: payload.account,
          password: payload.password,
          name: payload.name,
          role: payload.role || 'member',
          note: payload.note || ''
        });
        await refresh();
        return { ok: true, user: mapUser(user) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    updateUser: async function (id, payload) {
      var body = {};
      if (payload.account !== undefined) body.username = payload.account;
      if (payload.password) body.password = payload.password;
      if (payload.name !== undefined) body.name = payload.name;
      if (payload.role !== undefined) body.role = payload.role;
      if (payload.note !== undefined) body.note = payload.note;
      if (payload.active !== undefined) body.active = payload.active;
      try {
        await ERP.api.patch('/users/' + id, body);
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    deleteUser: async function (id) {
      try {
        await ERP.api.del('/users/' + id);
        await refresh();
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /* ---------------- 出入库单 ---------------- */

    stockInOrders: async function (page, pageSize) {
      return ERP.api.get('/stock-in?page=' + (page || 1) + '&page_size=' + (pageSize || 20));
    },
    stockInDetail: async function (id) {
      return ERP.api.get('/stock-in/' + id);
    },
    stockOutOrders: async function (page, pageSize) {
      return ERP.api.get('/stock-out?page=' + (page || 1) + '&page_size=' + (pageSize || 20));
    },
    stockOutDetail: async function (id) {
      return ERP.api.get('/stock-out/' + id);
    },
    createStockIn: async function (payload) {
      try {
        var order = await ERP.api.post('/stock-in', payload);
        await refresh();
        return { ok: true, order: order };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },

    /* ---------------- 访问记录 / 统计 ---------------- */

    visits: async function (pageSize) {
      var data = await ERP.api.get('/visits?page_size=' + (pageSize || 50));
      return (data.items || []).map(function (item) {
        return {
          id: item.id,
          account: item.username,
          name: item.name,
          role: item.role,
          at: item.visited_at,
          ip: item.ip || ''
        };
      });
    },

    stats: function () {
      return {
        total: cache.stats.total || 0,
        simple: cache.stats.simple || 0,
        precise: cache.stats.precise || 0,
        available: cache.stats.available || 0,
        empty: cache.stats.empty || 0,
        warn: cache.stats.warn || 0,
        categories: cache.stats.categories || 0,
        logs: cache.stats.logs || 0,
        users: cache.stats.users || cache.users.length
      };
    },
    warnings: function () {
      return cache.materials.filter(isWarn).sort(function (a, b) {
        return (Number(a.qty) - Number(b.minQty)) - (Number(b.qty) - Number(b.minQty));
      });
    }
  };

  ERP.store = store;
})();
