/**
 * 应用外壳：侧边导航 + 顶栏 + 内容区
 * 用法：var view = ERP.layout.mount({ active: 'materials', title: '物料总览' });
 *       view.content 即内容容器（.app-content）
 * 导航与按钮按登录角色自动裁剪，避免普通成员看到管理员入口。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  function esc(value) {
    return ERP.ui.esc(value);
  }

  function roleAllowed(item, role) {
    if (!item.roles) return true;
    var need = ERP.auth.requiredRank(item.roles);
    return ERP.auth.rank(role) >= need;
  }

  function isPrivileged(role) {
    return ERP.auth.rank(role) >= ERP.auth.RANK.admin;
  }

  function roleTagHtml(role) {
    var tone = role === 'super' ? 'tag-super' : (role === 'admin' ? 'tag-brand' : 'tag-simple');
    return '<span class="tag ' + tone + '">' + esc(ERP.auth.roleLabel(role)) + '</span>';
  }

  function visitRowHtml(visit) {
    return '<div class="visit-item">' +
      '<span class="visit-avatar">' + esc(String(visit.name || '?').slice(0, 1)) + '</span>' +
      '<div class="visit-main">' +
        '<div class="visit-name">' + esc(visit.name || '—') + ' ' + roleTagHtml(visit.role) + '</div>' +
        '<div class="visit-meta">账号：' + esc(visit.account || '—') + '</div>' +
      '</div>' +
      '<span class="visit-time">' + esc(visit.at || '') + '</span>' +
    '</div>';
  }

  /** 超级管理员：成员访问记录面板 */
  function openVisitsPanel() {
    var visits = ERP.store.visits();
    var mask = document.createElement('div');
    mask.className = 'modal-mask';
    mask.innerHTML =
      '<div class="modal visit-modal" role="dialog" aria-modal="true">' +
        '<div class="modal-hd">成员访问通知</div>' +
        '<div class="modal-bd">' +
          (visits.length
            ? '<div class="visit-list">' + visits.slice(0, 50).map(visitRowHtml).join('') + '</div>'
            : '<div class="empty" style="padding:28px 12px;">' +
                '<div class="empty-desc">暂无成员访问记录，成员登录后会出现在这里。</div>' +
              '</div>') +
        '</div>' +
        '<div class="modal-ft">' +
          '<span class="dim small" style="margin-right:auto">共 ' + visits.length + ' 条访问记录</span>' +
          '<button class="btn" type="button" data-act="close">关闭</button>' +
        '</div>' +
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
      if (event.target === mask) return close();
      if (event.target.closest('[data-act="close"]')) close();
    });
    document.addEventListener('keydown', onKey);
  }

  function findActiveItem(activeId) {
    var found = null;
    (ERP.config.nav || []).forEach(function (group) {
      group.items.forEach(function (item) {
        if (item.id === activeId) found = { item: item, group: group };
      });
    });
    return found;
  }

  function navItemHtml(item, active, role) {
    var isActive = item.id === active;
    var badge = '';
    if (item.id === 'alerts' && isPrivileged(role)) {
      var warnCount = ERP.store.stats().warn;
      if (warnCount > 0) badge = '<span class="nav-badge" title="低库存物料">' + warnCount + '</span>';
    }
    return '<a class="nav-item' + (isActive ? ' is-active' : '') + '" href="' +
      esc(ERP.url(item.href)) + '"' + (isActive ? ' aria-current="page"' : '') + '>' +
      ERP.icon(item.icon, 16) +
      '<span>' + esc(item.label) + '</span>' +
      badge +
      '</a>';
  }

  function navHtml(session, active) {
    return (ERP.config.nav || []).map(function (group) {
      var items = group.items.filter(function (item) {
        return roleAllowed(item, session.role);
      });
      if (!items.length) return '';
      return '<div class="nav-group">' +
        (group.group ? '<div class="nav-group-title">' + esc(group.group) + '</div>' : '') +
        items.map(function (item) { return navItemHtml(item, active, session.role); }).join('') +
        '</div>';
    }).join('');
  }

  var layout = {
    /**
     * 渲染外壳
     * @param {Object} options { active, title, desc, rootId }
     * @returns {{ root: HTMLElement, content: HTMLElement, session: Object }|null}
     */
    mount: function (options) {
      var opts = options || {};
      var session = ERP.auth.get();
      if (!session) {
        window.location.replace(ERP.url('login.html'));
        return null;
      }
      var roleLabel = ERP.auth.roleLabel(session.role);
      var active = opts.active || '';
      var activeInfo = findActiveItem(active);
      var pageTitle = opts.title || (activeInfo ? activeInfo.item.label : '');
      var topbarActions = opts.topbarActions || '';

      var root = document.getElementById(opts.rootId || 'app');
      if (!root) return null;

      var bellHtml = '';
      if (session.role === 'super') {
        bellHtml =
          '<button class="topbar-icon-btn" type="button" id="erpBellBtn" title="成员访问通知">' +
            ERP.icon('bell', 17) +
          '</button>';
      } else if (session.role === 'admin') {
        bellHtml =
          '<a class="topbar-icon-btn" id="erpBellLink" href="' + esc(ERP.url('pages/alerts.html')) + '" ' +
            'title="库存预警">' +
            ERP.icon('bell', 17) +
          '</a>';
      }

      root.innerHTML =
        '<div class="app">' +
          '<aside class="app-sidebar">' +
            '<a class="app-brand" href="' + esc(ERP.url('dashboard.html')) + '" title="返回工作台">' +
              '<span class="app-brand-logo" aria-hidden="true">' + ERP.icon('logo', 20) + '</span>' +
              '<span>' +
                '<span class="app-brand-name">' + esc(ERP.config.appName) + '</span>' +
                '<span class="app-brand-sub">' + esc(ERP.config.clubName) + '</span>' +
              '</span>' +
            '</a>' +
            '<nav class="app-nav" aria-label="主导航">' + navHtml(session, active) + '</nav>' +
            '<div class="app-sidebar-foot">' + esc(ERP.config.version) + ' · 静态前端演示</div>' +
          '</aside>' +
          '<div class="app-main">' +
            '<header class="app-topbar">' +
              '<div class="app-topbar-left">' +
                '<span class="app-topbar-title">' + esc(pageTitle) + '</span>' +
                '<span class="app-topbar-sub">' + esc(ERP.config.clubName) + '</span>' +
              '</div>' +
              '<div class="app-topbar-right">' +
                topbarActions +
                '<div class="topbar-search">' +
                  ERP.icon('search', 15) +
                  '<input type="search" id="erpGlobalSearch" placeholder="搜索物料、型号、位置…" ' +
                    'aria-label="搜索物料" autocomplete="off">' +
                '</div>' +
                '<span class="topbar-status" title="演示数据保存在浏览器本地"><span class="status-dot"></span>本地数据正常</span>' +
                bellHtml +
                '<span class="topbar-sep"></span>' +
                '<div class="app-user">' +
                  '<span class="app-user-avatar">' +
                    esc(String(session.name || '?').slice(0, 1)) +
                  '</span>' +
                  '<span class="app-user-meta">' +
                    '<span class="app-user-name">' + esc(session.name) + '</span>' +
                    '<span class="app-user-sub">' + esc(roleLabel) + '</span>' +
                  '</span>' +
                  '<button class="topbar-icon-btn" type="button" id="erpLogoutBtn" title="退出登录">' +
                    ERP.icon('logout', 16) +
                  '</button>' +
                '</div>' +
              '</div>' +
            '</header>' +
            '<main class="app-content" id="erpPageContent"></main>' +
          '</div>' +
        '</div>';

      var logoutBtn = document.getElementById('erpLogoutBtn');
      if (logoutBtn) {
        logoutBtn.addEventListener('click', function () {
          ERP.auth.clear();
          window.location.href = ERP.url('login.html');
        });
      }

      var globalSearch = document.getElementById('erpGlobalSearch');
      if (globalSearch) {
        globalSearch.addEventListener('keydown', function (event) {
          if (event.key !== 'Enter') return;
          var keyword = globalSearch.value.trim();
          window.location.href = ERP.url('index.html') +
            (keyword ? '?q=' + encodeURIComponent(keyword) : '');
        });
      }

      var bellBtn = document.getElementById('erpBellBtn');
      if (bellBtn) {
        bellBtn.addEventListener('click', openVisitsPanel);
      }

      return {
        root: root,
        content: document.getElementById('erpPageContent'),
        session: session
      };
    },

    /** 页面无权限时统一提示 */
    denied: function (content) {
      content.innerHTML =
        '<div class="card"><div class="card-bd"><div class="empty">' +
          '<div class="empty-title">没有访问权限</div>' +
          '<div class="empty-desc">当前账号权限不足，本页面仅管理员及以上角色可访问。</div>' +
          '<div style="margin-top:16px"><a class="btn btn-sm" href="' + esc(ERP.url('dashboard.html')) + '">返回工作台</a></div>' +
        '</div></div></div>';
    },

    /** 刷新侧边栏「库存预警」角标（补货后调用） */
    refreshAlertsBadge: function () {
      var count = ERP.store.stats().warn;
      var link = null;
      ERP.ui.$all('.app-nav .nav-item').forEach(function (item) {
        var href = item.getAttribute('href') || '';
        if (href.indexOf('alerts.html') >= 0) link = item;
      });
      if (!link) return;
      var badge = link.querySelector('.nav-badge');
      if (count > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'nav-badge';
          badge.title = '低库存物料';
          link.appendChild(badge);
        }
        badge.textContent = count;
      } else if (badge) {
        badge.parentNode.removeChild(badge);
      }
    }
  };

  ERP.layout = layout;
})();
