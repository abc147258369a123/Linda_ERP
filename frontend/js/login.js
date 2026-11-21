/**
 * 登录页交互
 * - 前端模拟：不校验密码内容（真实校验交给后端），只校验非空
 * - 角色由登录页显式选择，写入 localStorage 会话
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$;

  var accountInput = $('#loginAccount');
  var passwordInput = $('#loginPassword');
  var errorBox = $('#loginError');
  var loginBtn = $('#loginBtn');
  var roleOptions = ERP.ui.$all('.role-option');
  var currentRole = 'admin';

  function setRole(role) {
    currentRole = role;
    roleOptions.forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(btn.getAttribute('data-role') === role));
    });
  }

  roleOptions.forEach(function (btn) {
    btn.addEventListener('click', function () {
      setRole(btn.getAttribute('data-role'));
      hideError();
    });
  });

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

  // 演示账号快捷填入
  ERP.ui.$all('.demo-chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      accountInput.value = chip.getAttribute('data-account');
      passwordInput.value = chip.getAttribute('data-password');
      setRole(chip.getAttribute('data-role'));
      hideError();
      accountInput.focus();
    });
  });

  // 账号 / 密码输入时清除错误
  [accountInput, passwordInput].forEach(function (input) {
    if (!input) return;
    input.addEventListener('input', hideError);
  });

  $('#loginForm').addEventListener('submit', function (event) {
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
    loginBtn.textContent = '验证中…';

    var session = {
      account: account,
      role: currentRole,
      name: ERP.store.displayNameFor(account, currentRole),
      loginAt: ERP.store.now()
    };
    ERP.auth.set(session);
    // 记录登录访问（超级管理员通知面板展示）
    if (ERP.store && ERP.store.addVisit) ERP.store.addVisit(session);

    // 模拟接口耗时，避免点击后页面无反馈
    window.setTimeout(function () {
      window.location.href = ERP.url('dashboard.html');
    }, 240);
  });

  // 已有会话：提示可直接进入
  var session = ERP.auth.get();
  if (session) {
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
