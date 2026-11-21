/**
 * 登录会话（前端模拟）
 * 角色层级：超级管理员(3) > 管理员(2) > 普通成员(1)
 * 后续对接后端时，这里替换为真实登录接口与 token 校验。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var KEY = 'erp.v1.session';
  var RANK = { member: 1, admin: 2, super: 3 };

  function get() {
    try {
      var raw = window.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function set(session) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(session));
    } catch (e) { /* 隐私模式忽略 */ }
  }
  function clear() {
    try {
      window.localStorage.removeItem(KEY);
      window.localStorage.removeItem('erp.token');
    } catch (e) { /* ignore */ }
  }
  function token(session) {
    var current = session || get();
    return current && current.token ? current.token : '';
  }
  function roleOf(session) {
    return session && session.role ? session.role : 'member';
  }
  function rank(role) {
    return RANK[role] || RANK.member;
  }
  function isAdmin(session) {
    return rank(roleOf(session || get())) >= RANK.admin;
  }
  function isSuper(session) {
    return roleOf(session || get()) === 'super';
  }
  function roleLabel(role) {
    var roles = (ERP.config && ERP.config.roles) || {};
    return (roles[role] && roles[role].label) || role;
  }

  /** 角色数组 → 所需最低等级（层级继承：超级管理员可通过管理员校验） */
  function requiredRank(roles) {
    var list = Array.isArray(roles) ? roles : [roles || 'member'];
    if (list.indexOf('super') >= 0) return RANK.super;
    if (list.indexOf('admin') >= 0) return RANK.admin;
    return RANK.member;
  }

  /** 页面守卫：未登录跳登录页；角色等级不足回工作台 */
  function requireLogin() {
    var session = get();
    if (!session || !session.token) {
      clear();
      window.location.replace(ERP.url('login.html'));
      return null;
    }
    return session;
  }
  function requireRole(roles) {
    var session = requireLogin();
    if (!session) return null;
    if (rank(roleOf(session)) < requiredRank(roles)) {
      window.location.replace(ERP.url('dashboard.html') + '?denied=1');
      return null;
    }
    return session;
  }

  ERP.auth = {
    KEY: KEY,
    RANK: RANK,
    get: get,
    set: set,
    clear: clear,
    token: token,
    roleOf: roleOf,
    rank: rank,
    requiredRank: requiredRank,
    roleLabel: roleLabel,
    isAdmin: isAdmin,
    isSuper: isSuper,
    requireLogin: requireLogin,
    requireRole: requireRole
  };
})();
