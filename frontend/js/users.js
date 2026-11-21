/**
 * 用户管理页（管理员及以上）
 * 角色层级：超级管理员 > 管理员 > 普通成员
 * - 超级管理员：查看并管理全部账号、分配任意角色、查看/切换管理员
 * - 管理员：仅可新增/编辑/删除普通成员，不能分配管理员及以上角色
 * - 保护规则：最后一个超级管理员/管理员不可降级或删除；不能删除当前登录账号
 */
(function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['admin']);
  if (!session) return;
  var isSuper = ERP.auth.isSuper(session);

  var view = ERP.layout.mount({ active: 'users', title: '用户管理' });
  if (!view) return;
  var page = view.content;

  function roleTag(role) {
    var tone = role === 'super' ? 'tag-super' : (role === 'admin' ? 'tag-brand' : 'tag-simple');
    return '<span class="tag ' + tone + '">' + esc(ERP.auth.roleLabel(role)) + '</span>';
  }

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">用户管理</h1>' +
        '<p class="page-desc">' + (isSuper
          ? '超级管理员可查看并管理所有账号、分配任意角色。'
          : '管理员可管理普通成员账号；管理员及以上账号由超级管理员维护。') + '</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<button class="btn btn-primary" type="button" id="addUserBtn">' +
          ERP.icon('plus', 15) + '新增用户</button>' +
      '</div>' +
    '</div>' +

    '<div class="stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">用户总数</div>' +
        '<div class="stat-value" data-user-stat="total">0</div>' +
        '<div class="stat-sub">社团全部账号</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">超级管理员</div>' +
        '<div class="stat-value is-warn" data-user-stat="super">0</div>' +
        '<div class="stat-sub">可管理所有账号与角色</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">管理员</div>' +
        '<div class="stat-value" data-user-stat="admin">0</div>' +
        '<div class="stat-sub">管理物料、分类与成员</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">普通成员</div>' +
        '<div class="stat-value is-muted" data-user-stat="member">0</div>' +
        '<div class="stat-sub">仅查询与领用登记</div>' +
      '</div>' +
    '</div>' +

    '<div class="card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">用户列表</div>' +
          '<div class="card-sub">账号唯一；角色层级：超级管理员 › 管理员 › 普通成员</div>' +
        '</div>' +
        '<div class="legend">' +
          '<span class="tag tag-super">超级管理员</span>' +
          '<span class="tag tag-brand">管理员</span>' +
          '<span class="tag tag-simple">普通成员</span>' +
        '</div>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table">' +
          '<thead><tr>' +
            '<th>用户</th>' +
            '<th>角色</th>' +
            '<th>备注</th>' +
            '<th>创建时间</th>' +
            '<th class="col-actions">操作</th>' +
          '</tr></thead>' +
          '<tbody id="userBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<div class="card-foot">' +
        '<span id="userFootText"></span>' +
        '<span class="dim">当前登录：' + esc(session.name) +
          '（' + esc(ERP.auth.roleLabel(session.role)) + '）</span>' +
      '</div>' +
    '</div>';

  var tbody = $('#userBody');

  function users() {
    return ERP.store.users();
  }
  function countRole(role) {
    return users().filter(function (user) { return user.role === role; }).length;
  }
  function privilegedCount() {
    return users().filter(function (user) { return ERP.auth.rank(user.role) >= ERP.auth.RANK.admin; }).length;
  }
  function isSelf(user) {
    return String(user.account).toLowerCase() === String(session.account).toLowerCase();
  }
  /** 当前登录者能否管理该账号（超管可管全部，管理员仅可管普通成员） */
  function canManage(user) {
    return isSuper || user.role === 'member';
  }

  function rowHtml(user) {
    var self = isSelf(user);
    var manage = canManage(user);
    var superCount = countRole('super');
    var adminCount = countRole('admin');
    var lastSuper = user.role === 'super' && superCount <= 1;
    var lastPrivileged = privilegedCount() <= 1 && ERP.auth.rank(user.role) >= ERP.auth.RANK.admin;

    var editAction = manage
      ? '<button class="btn-link" type="button" data-edit-user="' + esc(user.id) + '">编辑</button>'
      : '<span class="btn-link is-disabled" data-disabled="perm" ' +
        'title="仅超级管理员可管理管理员及以上账号">编辑</span>';

    var roleToggle = '';
    if (isSuper && user.role !== 'super') {
      if (user.role === 'admin') {
        roleToggle = lastPrivileged
          ? '<span class="btn-link is-disabled" data-disabled="role" ' +
            'title="至少需要保留一名管理员">设为成员</span>'
          : '<button class="btn-link" type="button" data-toggle-role="member" data-user-id="' +
            esc(user.id) + '">设为成员</button>';
      } else {
        roleToggle = '<button class="btn-link" type="button" data-toggle-role="admin" data-user-id="' +
          esc(user.id) + '">设为管理员</button>';
      }
    }

    var deleteAction;
    if (self) {
      deleteAction = '<span class="btn-link is-disabled" data-disabled="self" ' +
        'title="不能删除当前登录账号">删除</span>';
    } else if (!manage) {
      deleteAction = '<span class="btn-link is-disabled" data-disabled="perm" ' +
        'title="仅超级管理员可管理管理员及以上账号">删除</span>';
    } else if (lastSuper) {
      deleteAction = '<span class="btn-link is-disabled" data-disabled="last-super" ' +
        'title="至少需要保留一名超级管理员">删除</span>';
    } else if (lastPrivileged) {
      deleteAction = '<span class="btn-link is-disabled" data-disabled="last-admin" ' +
        'title="至少需要保留一名管理员">删除</span>';
    } else {
      deleteAction = '<button class="btn-link text-danger" type="button" data-delete-user="' +
        esc(user.id) + '">删除</button>';
    }

    return '<tr>' +
      '<td>' +
        '<div class="user-cell">' +
          '<span class="user-avatar' + (user.role === 'super' ? ' is-super' : '') + '">' +
            esc(String(user.name || '?').slice(0, 1)) + '</span>' +
          '<div>' +
            '<div class="user-name">' + esc(user.name) +
              (self ? ' <span class="tag tag-ok" style="height:18px;font-size:10.5px;">当前账号</span>' : '') +
            '</div>' +
            '<div class="user-account">' + esc(user.account) + '</div>' +
          '</div>' +
        '</div>' +
      '</td>' +
      '<td>' + roleTag(user.role) + '</td>' +
      '<td><span class="cell-text">' + esc(user.note || '—') + '</span></td>' +
      '<td><span class="cell-mono">' + esc(ERP.ui.fmtDateTime(user.createdAt)) + '</span></td>' +
      '<td class="col-actions">' +
        '<div class="row-actions">' + editAction + roleToggle + deleteAction + '</div>' +
      '</td>' +
    '</tr>';
  }

  function render() {
    var list = users();
    var stats = {
      total: list.length,
      super: countRole('super'),
      admin: countRole('admin'),
      member: countRole('member')
    };
    Object.keys(stats).forEach(function (key) {
      var el = page.querySelector('[data-user-stat="' + key + '"]');
      if (el) el.textContent = stats[key];
    });

    tbody.innerHTML = list.length
      ? list.map(rowHtml).join('')
      : '<tr><td colspan="5"><div class="empty" style="padding:40px 16px;">' +
          '<div class="empty-desc">还没有用户，点击右上角「新增用户」创建。</div>' +
        '</td></tr>';

    var footText = $('#userFootText');
    if (footText) {
      footText.textContent = '共 ' + list.length + ' 个账号 · ' +
        stats.super + ' 名超级管理员 · ' + stats.admin + ' 名管理员 · ' +
        stats.member + ' 名普通成员';
    }
  }

  /* ---------------- 新增 / 编辑用户弹窗 ---------------- */

  function rolePickHtml(role) {
    if (!isSuper) {
      return '<div class="role-readonly">普通成员' +
        '<span class="field-hint" style="display:block;margin-top:4px;">仅超级管理员可分配管理员及以上角色</span>' +
        '</div>';
    }
    return '<div class="choice-picker" role="group" aria-label="角色">' +
      ['super', 'admin', 'member'].map(function (item) {
        return '<button type="button" class="choice-option" data-user-role="' + item +
          '" aria-pressed="' + (role === item ? 'true' : 'false') + '">' +
          esc(ERP.auth.roleLabel(item)) + '</button>';
      }).join('') +
    '</div>';
  }

  function openUserModal(user) {
    var isEdit = Boolean(user);
    var role = user ? user.role : 'member';
    if (!isSuper && !isEdit) role = 'member';

    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal user-modal" role="dialog" aria-modal="true">' +
        '<div class="modal-hd">' + (isEdit ? '编辑用户' : '新增用户') + '</div>' +
        '<div class="modal-bd">' +
          '<div class="user-form">' +
            '<div class="field">' +
              '<label class="label" for="userAccount">账号<span class="req">*</span></label>' +
              '<input class="input input-mono" id="userAccount" type="text" maxlength="20" ' +
                'placeholder="3-20 位字母、数字或 _ . -" value="' +
                esc(user ? user.account : '') + '">' +
              '<span class="field-hint">用于登录，保存后不可与现有账号重复</span>' +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="userName">姓名<span class="req">*</span></label>' +
              '<input class="input" id="userName" type="text" maxlength="20" ' +
                'placeholder="如：王浩" value="' + esc(user ? user.name : '') + '">' +
            '</div>' +
            '<div class="field">' +
              '<span class="label">角色</span>' +
              rolePickHtml(role) +
            '</div>' +
            '<div class="field">' +
              '<label class="label" for="userNote">备注</label>' +
              '<input class="input" id="userNote" type="text" maxlength="30" ' +
                'placeholder="如：嵌入式组" value="' + esc(user ? user.note : '') + '">' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="modal-ft">' +
          '<button class="btn" type="button" data-act="cancel">取消</button>' +
          '<button class="btn btn-primary" type="button" data-act="save">' +
            (isEdit ? '保存修改' : '添加用户') +
          '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    ERP.ui.$all('[data-user-role]', mask).forEach(function (btn) {
      btn.addEventListener('click', function () {
        role = btn.getAttribute('data-user-role');
        ERP.ui.$all('[data-user-role]', mask).forEach(function (item) {
          item.setAttribute('aria-pressed', String(item === btn));
        });
      });
    });

    var accountInput = mask.querySelector('#userAccount');
    var nameInput = mask.querySelector('#userName');
    var noteInput = mask.querySelector('#userNote');

    function close() {
      document.removeEventListener('keydown', onKey);
      if (mask.parentNode) mask.parentNode.removeChild(mask);
    }

    function save() {
      var account = String(accountInput.value || '').trim();
      var name = String(nameInput.value || '').trim();
      var note = String(noteInput.value || '').trim();

      if (!account) {
        ERP.ui.toast('请填写账号', 'error');
        accountInput.focus();
        return;
      }
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(account)) {
        ERP.ui.toast('账号需为 3-20 位字母、数字或 _ . -', 'error');
        accountInput.focus();
        return;
      }
      if (!name) {
        ERP.ui.toast('请填写姓名', 'error');
        nameInput.focus();
        return;
      }

      var payload = {
        account: account,
        name: name,
        role: isSuper ? role : 'member',
        note: note
      };
      var result = isEdit
        ? ERP.store.updateUser(user.id, payload)
        : ERP.store.addUser(payload);
      if (!result.ok) {
        ERP.ui.toast(result.error || '保存失败', 'error');
        return;
      }
      close();
      ERP.ui.toast(isEdit ? '用户信息已更新' : '用户「' + name + '」已添加', 'ok');
      render();
    }

    function onKey(event) {
      if (event.key === 'Escape') close();
      if (event.key === 'Enter' && event.target !== noteInput) {
        event.preventDefault();
        save();
      }
    }

    mask.addEventListener('click', function (event) {
      if (event.target === mask) return close();
      var btn = event.target.closest('[data-act]');
      if (!btn) return;
      if (btn.getAttribute('data-act') === 'save') save();
      else close();
    });
    document.addEventListener('keydown', onKey);
    accountInput.focus();
    if (accountInput.select) accountInput.select();
  }

  /* ---------------- 角色切换 / 删除 ---------------- */

  function findUserById(id) {
    var found = null;
    users().forEach(function (item) { if (item.id === id) found = item; });
    return found;
  }

  function toggleRole(id, nextRole) {
    if (!isSuper) {
      ERP.ui.toast('仅超级管理员可分配角色', 'warn');
      return;
    }
    var user = findUserById(id);
    if (!user) return;
    var result = ERP.store.updateUser(id, { role: nextRole });
    if (!result.ok) {
      ERP.ui.toast(result.error || '角色修改失败', 'error');
      return;
    }
    ERP.ui.toast('「' + user.name + '」已设为' + ERP.auth.roleLabel(nextRole), 'ok');
    render();
  }

  function deleteUser(id) {
    var user = findUserById(id);
    if (!user) return;
    if (!canManage(user)) {
      ERP.ui.toast('仅超级管理员可管理管理员及以上账号', 'warn');
      return;
    }
    if (isSelf(user)) {
      ERP.ui.toast('不能删除当前登录账号', 'warn');
      return;
    }
    if (user.role === 'super' && countRole('super') <= 1) {
      ERP.ui.toast('至少需要保留一名超级管理员', 'warn');
      return;
    }
    if (privilegedCount() <= 1 && ERP.auth.rank(user.role) >= ERP.auth.RANK.admin) {
      ERP.ui.toast('至少需要保留一名管理员', 'warn');
      return;
    }
    ERP.ui.confirm({
      title: '删除用户',
      message: '确定删除用户「' + user.name + '（' + user.account + '）」吗？删除后不可恢复。',
      okText: '删除用户',
      danger: true
    }).then(function (confirmed) {
      if (!confirmed) return;
      var result = ERP.store.deleteUser(id);
      if (!result.ok) {
        ERP.ui.toast(result.error || '删除失败', 'error');
        return;
      }
      ERP.ui.toast('用户已删除', 'ok');
      render();
    });
  }

  page.addEventListener('click', function (event) {
    if (event.target.closest('#addUserBtn')) {
      openUserModal(null);
      return;
    }
    var editBtn = event.target.closest('[data-edit-user]');
    if (editBtn) {
      var target = findUserById(editBtn.getAttribute('data-edit-user'));
      if (target) openUserModal(target);
      return;
    }
    var roleBtn = event.target.closest('[data-toggle-role]');
    if (roleBtn) {
      toggleRole(roleBtn.getAttribute('data-user-id'), roleBtn.getAttribute('data-toggle-role'));
      return;
    }
    var deleteBtn = event.target.closest('[data-delete-user]');
    if (deleteBtn) deleteUser(deleteBtn.getAttribute('data-delete-user'));
  });

  render();

  if (ERP.ui.getParam('denied') === '1') {
    ERP.ui.toast('当前角色无权执行该操作', 'warn');
  }
})();
