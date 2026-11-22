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
      // v1.4.0：领用次数（后端按 material_logs 实时聚合，缺省为 0）
      borrowCount: Number(raw.borrow_count || 0),
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

  /**
   * 分类映射（v1.3.0 树形多级）：
   * - count / total_count 由后端实时统计，前端不再重算
   * - level 从 1 开始；parent_id=null 表示一级分类
   */
  function mapCategory(raw) {
    return {
      id: raw.id,
      name: raw.name,
      parentId: raw.parent_id === null || raw.parent_id === undefined ? null : raw.parent_id,
      count: Number(raw.count || 0),
      totalCount: Number(raw.total_count === null || raw.total_count === undefined
        ? (raw.count || 0)
        : raw.total_count),
      level: Number(raw.level || 1),
      hasChildren: Boolean(raw.has_children)
    };
  }

  function rebuildDerived() {
    // 只补算本地派生字段（低库存 / 空缺，用于表格展示）；
    // count / totalCount 一律沿用服务端返回值，避免与后端实时统计不一致。
    var categories = cache.categories.map(function (category) {
      var used = cache.materials.filter(function (m) {
        return String(m.categoryId) === String(category.id);
      });
      return {
        id: category.id,
        name: category.name,
        parentId: category.parentId === null || category.parentId === undefined ? null : category.parentId,
        count: category.count,
        totalCount: category.totalCount,
        level: category.level,
        hasChildren: Boolean(category.hasChildren),
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

  function findCategory(id) {
    var found = null;
    cache.categories.forEach(function (category) {
      if (String(category.id) === String(id)) found = category;
    });
    return found;
  }

  /**
   * 完整分类路径（v1.4.0）：基于扁平分类缓存的 parentId 逐级向上回溯，
   * 返回「一级 / 二级 / 三级」形式的字符串；分类不存在时返回空字符串。
   * 例：categoryPath(12) => '电阻 / 贴片电阻 / 0603'
   */
  function categoryPath(categoryId) {
    if (categoryId === null || categoryId === undefined || categoryId === '') return '';
    var byId = {};
    cache.categories.forEach(function (category) {
      byId[String(category.id)] = category;
    });
    var names = [];
    var current = byId[String(categoryId)];
    var guard = 0;
    while (current && guard < 32) {
      names.unshift(current.name);
      var parentId = current.parentId;
      if (parentId === null || parentId === undefined) break;
      var parent = byId[String(parentId)];
      if (!parent || parent === current) break;
      current = parent;
      guard += 1;
    }
    return names.join(' / ');
  }

  /**
   * 从扁平分类缓存构建嵌套树（返回根节点数组）。
   * - 节点字段：id / name / parentId / count / totalCount / level /
   *   hasChildren / warnCount / emptyCount / children
   * - level 以实际挂载深度为准；父分类缺失或成环的节点提升为一级分类，避免节点丢失
   */
  function categoryTree() {
    var nodes = {};
    var order = [];
    var roots = [];

    cache.categories.forEach(function (category) {
      var key = String(category.id);
      nodes[key] = {
        id: category.id,
        name: category.name,
        parentId: category.parentId === null || category.parentId === undefined ? null : category.parentId,
        count: Number(category.count || 0),
        totalCount: Number(category.totalCount === null || category.totalCount === undefined
          ? (category.count || 0)
          : category.totalCount),
        level: Number(category.level || 1),
        hasChildren: Boolean(category.hasChildren),
        warnCount: Number(category.warnCount || 0),
        emptyCount: Number(category.emptyCount || 0),
        children: []
      };
      order.push(key);
    });

    order.forEach(function (key) {
      var node = nodes[key];
      var parentKey = node.parentId === null ? null : String(node.parentId);
      if (parentKey && parentKey !== key && nodes[parentKey]) {
        nodes[parentKey].children.push(node);
      } else {
        node.parentId = null;
        roots.push(node);
      }
    });

    // 防御：父子关系成环时上述节点都挂不上根，这里把不可达节点提升为一级分类
    var reached = {};
    function markReached(list) {
      list.forEach(function (node) {
        var key = String(node.id);
        if (reached[key]) return;
        reached[key] = true;
        markReached(node.children);
      });
    }
    markReached(roots);
    order.forEach(function (key) {
      if (reached[key]) return;
      var node = nodes[key];
      var parentKey = node.parentId === null ? null : String(node.parentId);
      if (parentKey && nodes[parentKey]) {
        nodes[parentKey].children = nodes[parentKey].children.filter(function (child) {
          return child !== node;
        });
      }
      node.parentId = null;
      roots.push(node);
      markReached([node]);
    });

    function decorate(list, level) {
      list.forEach(function (node) {
        node.level = level;
        node.hasChildren = node.children.length > 0;
        decorate(node.children, level + 1);
      });
    }
    decorate(roots, 1);

    return roots;
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
    categoryPath: categoryPath,
    isWarn: isWarn,

    /**
     * 物料筛选 + 排序（内存缓存）
     * 兼容 v1.3.0 参数：q / mode / status('all'|'available'|'empty') /
     *   categoryId（单值）/ warnOnly / sort('updated'|'name'|'qty'|'inbound'|'warn')
     * v1.4.0 新增参数：
     *   - status 追加 'warn'（低库存预警，按 isWarn 判定）
     *   - categoryIds: [id,...] 分类集合过滤（通常传某大类及其全部子孙分类）
     *   - package: ''|值 封装精确过滤
     *   - sort 追加 'qtyAsc'|'qtyDesc'|'borrowDesc'|'borrowAsc'
     */
    listMaterials: function (options) {
      var opts = options || {};
      var list = cache.materials.slice();

      function byName(a, b) {
        return String(a.name || '').localeCompare(String(b.name || ''), 'zh');
      }

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
      if (opts.status && opts.status !== 'all') {
        if (opts.status === 'warn') {
          list = list.filter(isWarn);
        } else {
          list = list.filter(function (m) { return m.status === opts.status; });
        }
      }
      // v1.4.0：分类集合过滤（大类 + 全部子孙分类）
      if (opts.categoryIds && opts.categoryIds.length) {
        var idSet = {};
        opts.categoryIds.forEach(function (id) { idSet[String(id)] = true; });
        list = list.filter(function (m) { return Boolean(idSet[String(m.categoryId)]); });
      }
      // v1.3.0：单值分类过滤（保留原有行为）
      if (opts.categoryId && opts.categoryId !== 'all') {
        list = list.filter(function (m) { return String(m.categoryId) === String(opts.categoryId); });
      }
      // v1.4.0：封装精确过滤
      if (opts.package) {
        var packageValue = String(opts.package);
        list = list.filter(function (m) { return String(m.package || '') === packageValue; });
      }
      if (opts.warnOnly) list = list.filter(isWarn);

      var sort = opts.sort || 'updated';
      if (sort === 'name') {
        list.sort(byName);
      } else if (sort === 'qty') {
        list.sort(function (a, b) {
          var pa = a.mode === 'precise';
          var pb = b.mode === 'precise';
          if (pa !== pb) return pa ? -1 : 1;
          if (pa && pb) {
            var diff = Number(a.qty) - Number(b.qty);
            if (diff !== 0) return diff;
          }
          return byName(a, b);
        });
      } else if (sort === 'qtyAsc' || sort === 'qtyDesc') {
        // 库存排序：qty 升降序，简易模式 qty=null 一律排在最后
        var qtyFactor = sort === 'qtyAsc' ? 1 : -1;
        list.sort(function (a, b) {
          var qa = a.qty === null || a.qty === undefined || a.qty === '' ? null : Number(a.qty);
          var qb = b.qty === null || b.qty === undefined || b.qty === '' ? null : Number(b.qty);
          if (qa !== null && !isFinite(qa)) qa = null;
          if (qb !== null && !isFinite(qb)) qb = null;
          if (qa === null && qb === null) return byName(a, b);
          if (qa === null) return 1;
          if (qb === null) return -1;
          if (qa !== qb) return (qa - qb) * qtyFactor;
          return byName(a, b);
        });
      } else if (sort === 'borrowDesc' || sort === 'borrowAsc') {
        // 领用次数排序：同次数按名称，保证结果稳定
        var borrowFactor = sort === 'borrowDesc' ? -1 : 1;
        list.sort(function (a, b) {
          var diff = Number(a.borrowCount || 0) - Number(b.borrowCount || 0);
          if (diff !== 0) return diff * borrowFactor;
          return byName(a, b);
        });
      } else if (sort === 'inbound') {
        list.sort(function (a, b) { return String(b.inboundAt || '').localeCompare(String(a.inboundAt || '')); });
      } else if (sort === 'warn') {
        list.sort(function (a, b) {
          var diff = Number(isWarn(b)) - Number(isWarn(a));
          if (diff !== 0) return diff;
          return byName(a, b);
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
    categoryTree: categoryTree,

    addCategory: async function (name, parentId) {
      var value = String(name || '').trim();
      if (!value) return { ok: false, error: '分类名称不能为空' };
      if (value.length > 30) return { ok: false, error: '分类名称不能超过 30 个字符' };
      var parent = (parentId === null || parentId === undefined || parentId === '') ? null : Number(parentId);
      if (parent !== null && !(parent > 0)) return { ok: false, error: '父分类不存在' };
      try {
        var saved = await ERP.api.post('/categories', { name: value, parent_id: parent });
        await refresh();
        return { ok: true, category: findCategory(saved.id) || mapCategory(saved) };
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
