/**
 * 后端 API 客户端（JWT）
 * - 所有请求带 Authorization: Bearer <token>
 * - 401 自动清理会话并回登录页
 * - 统一 JSON 解析与错误提示
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  function base() {
    var value = (ERP.config && ERP.config.apiBase) || '/api';
    return String(value).replace(/\/+$/, '');
  }

  function token() {
    var session = ERP.auth ? ERP.auth.get() : null;
    if (session && session.token) return session.token;
    try {
      return window.localStorage.getItem('erp.token') || '';
    } catch (e) {
      return '';
    }
  }

  function messageFrom(data, status) {
    if (data && data.detail) {
      if (typeof data.detail === 'string') return data.detail;
      if (Array.isArray(data.detail)) {
        return data.detail.map(function (item) {
          return (item.loc ? item.loc.join('.') + '：' : '') + (item.msg || '');
        }).join('；');
      }
      return JSON.stringify(data.detail);
    }
    if (status === 403) return '当前账号没有该操作权限';
    if (status === 404) return '请求的数据不存在';
    if (status >= 500) return '服务器异常，请稍后重试';
    return '请求失败（' + status + '）';
  }

  async function request(path, options) {
    var opts = options || {};
    var headers = Object.assign({}, opts.headers || {});
    if (!(opts.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }
    var currentToken = token();
    if (currentToken) headers.Authorization = 'Bearer ' + currentToken;

    var response;
    try {
      response = await fetch(base() + path, {
        method: opts.method || 'GET',
        cache: 'no-store',
        headers: headers,
        body: opts.body instanceof FormData ? opts.body : (opts.body !== undefined ? JSON.stringify(opts.body) : undefined)
      });
    } catch (error) {
      throw new Error('无法连接后端服务，请检查网络或稍后重试');
    }

    if (response.status === 401 && path.indexOf('/auth/login') < 0) {
      if (ERP.auth) ERP.auth.clear();
      try { window.localStorage.removeItem('erp.token'); } catch (e) { /* ignore */ }
      var onLoginPage = window.location.pathname.indexOf('login.html') >= 0;
      if (!onLoginPage) {
        window.location.href = ERP.url('login.html');
      }
      throw new Error('登录已过期，请重新登录');
    }

    var data = null;
    try { data = await response.json(); } catch (e) { data = null; }
    if (!response.ok) {
      var error = new Error(messageFrom(data, response.status));
      error.status = response.status;
      error.data = data;
      throw error;
    }
    return data;
  }

  function get(path) { return request(path); }
  function post(path, body) { return request(path, { method: 'POST', body: body }); }
  function patch(path, body) { return request(path, { method: 'PATCH', body: body }); }
  function del(path) { return request(path, { method: 'DELETE' }); }
  function upload(path, file) {
    var form = new FormData();
    form.append('file', file);
    return request(path, { method: 'POST', body: form });
  }

  ERP.api = {
    base: base,
    token: token,
    request: request,
    get: get,
    post: post,
    patch: patch,
    del: del,
    upload: upload,
    login: function (username, password) {
      return post('/auth/login', { username: username, password: password });
    },
    me: function () { return get('/auth/me'); }
  };
})();
