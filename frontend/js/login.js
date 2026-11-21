/**
 * 登录页：对接后端 /api/auth/login，保存 JWT 与用户信息
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$;

  var accountInput = $('#loginAccount');
  var passwordInput = $('#loginPassword');
  var errorBox = $('#loginError');
  var loginBtn = $('#loginBtn');

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

  $('#loginForm').addEventListener('submit', async function (event) {
    event.preventDefault();
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

    try {
      var data = await ERP.api.login(account, password);
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
    } catch (error) {
      showError(error.message || '登录失败，请检查账号密码');
      loginBtn.disabled = false;
      loginBtn.textContent = '登 录';
      passwordInput.focus();
      passwordInput.select();
    }
  });

  // 已有有效会话：提示可直接进入
  var session = ERP.auth.get();
  if (session && session.token) {
    var box = $('#loginSession');
    $('#loginSessionText').textContent =
      '当前已登录：' + session.name + '（' + ERP.auth.roleLabel(session.role) + '）';
    box.hidden = false;
    $('#loginContinue').addEventListener('click', function (event) {
      event.preventDefault();
      window.location.href = ERP.url('dashboard.html');
    });
    $('#loginSignOut').addEventListener('click', function () {
      ERP.auth.clear();
      box.hidden = true;
    });
  }
})();
