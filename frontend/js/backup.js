/**
 * 数据库备份（仅超级管理员）
 * - 导出：全量 MariaDB .sql 文本快照到独立备份目录
 * - 推送：选中本地 .sql，提交并推送到独立私有 Git 仓库
 * - 配置 / 预检 / 备份列表 / 操作日志 / 恢复指引
 */
(async function () {
  'use strict';
  var ERP = window.ERP;
  var $ = ERP.ui.$, esc = ERP.ui.esc;

  var session = ERP.auth.requireRole(['super']);
  if (!session) return;

  var view = ERP.layout.mount({ active: 'backup', title: '数据库备份' });
  if (!view) return;
  var page = view.content;

  var state = {
    status: null,
    list: [],
    logs: [],
    busy: false
  };
  var API = '/admin/backup';

  function call(path, options) {
    return ERP.api.request(API + path, options);
  }

  function setText(selector, value) {
    var el = $(selector);
    if (el) el.textContent = value;
  }

  function setBusy(busy) {
    state.busy = busy;
    ERP.ui.$all('[data-busy-disable]', page).forEach(function (el) {
      if ('disabled' in el) el.disabled = busy;
    });
    var refresh = $('#refreshBackup');
    if (refresh) refresh.classList.toggle('is-loading', busy);
  }

  function showNotice(message, type) {
    var box = $('#backupNotice');
    if (!box) return;
    var icon = type === 'ok' ? 'check' : (type === 'error' ? 'x' : (type === 'warn' ? 'warn' : 'info'));
    box.className = 'backup-notice is-' + (type || 'info');
    box.innerHTML = '<span class="backup-notice-icon">' + ERP.icon(icon, 16) + '</span>' +
      '<div class="backup-notice-text">' + esc(message) + '</div>';
    box.hidden = false;
  }

  function hideNotice() {
    var box = $('#backupNotice');
    if (box) box.hidden = true;
  }

  function checkIcon(level) {
    if (level === 'ok') return 'check';
    if (level === 'warn') return 'warn';
    return 'x';
  }

  page.innerHTML =
    '<div class="page-head">' +
      '<div>' +
        '<h1 class="page-title">数据库备份</h1>' +
        '<p class="page-desc">导出 MariaDB 全量 SQL 快照，并推送到与 ERP 源码仓库完全独立的私有 Git 仓库。' +
          '本页仅超级管理员可见，所有导出、推送和配置变更都会记录操作人。</p>' +
      '</div>' +
      '<div class="page-head-actions">' +
        '<button class="btn" type="button" id="refreshBackup" data-busy-disable>' +
          ERP.icon('refresh', 15) + '重新检查</button>' +
        '<button class="btn btn-primary" type="button" id="exportBackup" data-busy-disable>' +
          ERP.icon('database', 15) + '导出数据库备份</button>' +
      '</div>' +
    '</div>' +

    '<div class="backup-notice" id="backupNotice" hidden></div>' +

    '<div class="stat-grid backup-stat-grid">' +
      '<div class="stat-card">' +
        '<div class="stat-label">本地备份</div>' +
        '<div class="stat-value" id="backupCount">—</div>' +
        '<div class="stat-sub">只保存 .sql 文本快照</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">最近一次导出</div>' +
        '<div class="stat-value backup-stat-time" id="backupLast">—</div>' +
        '<div class="stat-sub" id="backupLastSize">等待首次导出</div>' +
      '</div>' +
      '<div class="stat-card">' +
        '<div class="stat-label">独立仓库状态</div>' +
        '<div class="stat-value backup-stat-state" id="backupRepoState">检查中</div>' +
        '<div class="stat-sub" id="backupRepoHint">配置后自动检查免密连通性</div>' +
      '</div>' +
    '</div>' +

    '<div class="backup-two-col">' +
      '<div class="card backup-config-card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">独立备份仓库</div>' +
            '<div class="card-sub">仓库地址与本地目录均独立于 ERP 源码仓库，互不影响。</div>' +
          '</div>' +
          '<span class="tag tag-super">仅超管</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="field">' +
            '<label class="label" for="backupRepoUrl">Git 仓库地址</label>' +
            '<input class="input input-mono" id="backupRepoUrl" type="text" maxlength="500" ' +
              'placeholder="git@github.com:用户名/linda-erp-db-backup.git" autocomplete="off" spellcheck="false">' +
            '<span class="field-hint">推荐使用 SSH 地址；请使用空仓库或专用私有仓库，不要填写 ERP 源码仓库。' +
              'HTTPS 地址只适合公开测试仓库，容器内不会保存账号密码。</span>' +
          '</div>' +
          '<div class="backup-config-actions">' +
            '<button class="btn btn-primary" type="button" id="saveBackupConfig" data-busy-disable>' +
              ERP.icon('check', 15) + '保存配置并预检</button>' +
            '<span class="dim small" id="backupDirText">备份目录加载中…</span>' +
          '</div>' +
          '<div class="backup-key-box">' +
            '<div class="backup-key-head">' +
              '<span>专用部署公钥</span>' +
              '<button class="btn-link" type="button" id="copySshKey">复制公钥</button>' +
            '</div>' +
            '<code class="backup-key" id="backupSshKey">加载中…</code>' +
            '<p class="backup-key-tip">在备份仓库的 <strong>Settings → Deploy keys</strong> 中添加此公钥，' +
              '并勾选 <strong>Allow write access</strong>。该密钥只挂载给备份模块，不会修改 ERP 源码仓库的 Git 配置。</p>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div class="card backup-check-card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">环境预检</div>' +
            '<div class="card-sub">Git、导出工具、独立目录、SSH 密钥与远端连通性。</div>' +
          '</div>' +
          '<span class="tag tag-simple" id="backupReadyTag">检查中</span>' +
        '</div>' +
        '<div class="card-bd">' +
          '<div class="backup-checks" id="backupChecks">' +
            '<div class="backup-check is-warn"><span class="backup-check-icon">' + ERP.icon('clock', 14) + '</span>' +
              '<div><div class="backup-check-label">正在检查运行环境…</div></div></div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="card backup-table-card">' +
      '<div class="card-hd">' +
        '<div>' +
          '<div class="card-title">本地备份文件</div>' +
          '<div class="card-sub">每个文件都是可独立恢复的全量 SQL 快照；推送后状态会标记为「已推送」。</div>' +
        '</div>' +
        '<span class="tag tag-brand" id="backupListCount">0 个文件</span>' +
      '</div>' +
      '<div class="table-wrap">' +
        '<table class="table backup-table">' +
          '<thead><tr>' +
            '<th>备份文件</th>' +
            '<th>备份时间</th>' +
            '<th>大小</th>' +
            '<th>推送状态</th>' +
            '<th class="col-actions">操作</th>' +
          '</tr></thead>' +
          '<tbody id="backupTableBody">' +
            '<tr><td colspan="5"><div class="backup-empty">正在读取本地备份…</div></td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +

    '<div class="backup-two-col backup-bottom-col">' +
      '<div class="card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">恢复说明</div>' +
            '<div class="card-sub">树莓派 SD 卡或硬件损坏时，无需登录原服务器即可从备份仓库恢复。</div>' +
          '</div>' +
        '</div>' +
        '<div class="card-bd">' +
          '<ol class="backup-steps">' +
            '<li>在任意电脑克隆<strong>独立备份仓库</strong>（不是 ERP 源码仓库）：' +
              '<code>git clone &lt;备份仓库地址&gt; linda_erp_backup</code></li>' +
            '<li>进入目录，按修改时间选择最新备份：' +
              '<code>ls -lh linda_erp_*.sql</code></li>' +
            '<li>先导出一份当前数据库快照，再执行覆盖恢复。下面的命令在 ERP 项目目录执行：' +
              '<code>docker exec -i linda_erp_db sh -c \'exec mariadb -uroot -p"$MARIADB_ROOT_PASSWORD" linda_erp_v2\' &lt; linda_erp_xxx.sql</code></li>' +
            '<li>恢复完成后刷新 ERP，并核对物料总数、最近出入库记录是否正常。</li>' +
          '</ol>' +
          '<p class="backup-warn-text">恢复会覆盖现有同名表数据，请务必确认目标数据库和备份文件后再执行。</p>' +
        '</div>' +
      '</div>' +

      '<div class="card">' +
        '<div class="card-hd">' +
          '<div>' +
            '<div class="card-title">操作日志</div>' +
            '<div class="card-sub">最近 30 条导出、推送和配置变更记录。</div>' +
          '</div>' +
        '</div>' +
        '<div class="backup-log-list" id="backupLogList">' +
          '<div class="backup-empty">正在读取操作日志…</div>' +
        '</div>' +
      '</div>' +
    '</div>';

  var repoInput = $('#backupRepoUrl');

  function actionLabel(action) {
    return { config: '保存配置', export: '导出备份', push: '推送备份' }[action] || action;
  }

  function renderChecks() {
    var box = $('#backupChecks');
    if (!box) return;
    var status = state.status;
    if (!status) return;
    var checks = status.checks || [];
    box.innerHTML = checks.map(function (item) {
      return '<div class="backup-check is-' + esc(item.level || 'error') + '">' +
        '<span class="backup-check-icon">' + ERP.icon(checkIcon(item.level), 14) + '</span>' +
        '<div class="backup-check-main">' +
          '<div class="backup-check-label">' + esc(item.label) + '</div>' +
          '<div class="backup-check-msg" title="' + esc(item.message) + '">' + esc(item.message) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    var readyTag = $('#backupReadyTag');
    if (readyTag) {
      readyTag.className = 'tag ' + (status.ready ? 'tag-ok' : 'tag-warn');
      readyTag.textContent = status.ready ? '可以导出与推送' : '需要处理';
    }
  }

  function renderSummary() {
    var status = state.status;
    if (!status) return;
    var list = state.list || [];
    setText('#backupCount', String(list.length));
    setText('#backupListCount', list.length + ' 个文件');
    setText('#backupDirText', '本地目录：' + (status.backup_dir || '—'));

    var last = status.last_backup;
    setText('#backupLast', last ? last.created_at : '—');
    setText('#backupLastSize', last ? (last.filename + ' · ' + last.size_text) : '等待首次导出');

    var connect = (status.checks || []).filter(function (item) { return item.key === 'connect'; })[0];
    var stateText = !status.repo_url ? '未配置仓库' : (connect && connect.ok ? '已连接' : '连接异常');
    var stateEl = $('#backupRepoState');
    if (stateEl) {
      stateEl.textContent = stateText;
      stateEl.classList.remove('is-ok', 'is-warn');
      stateEl.classList.add(status.repo_url && connect && connect.ok ? 'is-ok' : 'is-warn');
    }
    setText('#backupRepoHint', status.repo_url || '请先填写独立备份仓库地址');

    if (document.activeElement !== repoInput) {
      repoInput.value = status.repo_url || '';
    }
    var keyEl = $('#backupSshKey');
    if (keyEl) {
      keyEl.textContent = status.ssh_public_key || '未找到部署公钥，请检查备份 SSH 密钥挂载';
      keyEl.classList.toggle('is-missing', !status.ssh_public_key);
    }
  }

  function renderBackups() {
    var body = $('#backupTableBody');
    if (!body) return;
    var items = state.list || [];
    if (!items.length) {
      body.innerHTML = '<tr><td colspan="5"><div class="backup-empty">' +
        '还没有本地备份，点击右上角「导出数据库备份」生成第一份 .sql 快照。</div></td></tr>';
      return;
    }
    body.innerHTML = items.map(function (item) {
      var stateTag;
      if (item.pushed) stateTag = '<span class="tag tag-ok">已推送</span>';
      else if (item.state === 'committed') stateTag = '<span class="tag tag-brand">已提交待推送</span>';
      else stateTag = '<span class="tag tag-simple">未提交</span>';

      var action = item.pushed
        ? '<span class="dim small">已同步</span>'
        : '<button class="btn btn-sm" type="button" data-push="' + esc(item.filename) + '" data-busy-disable>' +
            ERP.icon('upload', 14) + '推送</button>';

      return '<tr>' +
        '<td>' +
          '<div class="backup-file-name">' + esc(item.filename) + '</div>' +
          (item.commit ? '<div class="backup-file-meta">commit ' + esc(item.commit) + '</div>' : '') +
        '</td>' +
        '<td><span class="cell-mono">' + esc(item.created_at) + '</span></td>' +
        '<td><span class="cell-mono">' + esc(item.size_text) + '</span></td>' +
        '<td>' + stateTag + '</td>' +
        '<td class="col-actions"><div class="row-actions">' + action + '</div></td>' +
      '</tr>';
    }).join('');
    setBusy(state.busy);
  }

  function renderLogs() {
    var box = $('#backupLogList');
    if (!box) return;
    var logs = state.logs || [];
    if (!logs.length) {
      box.innerHTML = '<div class="backup-empty">暂无操作日志。导出、推送或保存配置后会在这里留痕。</div>';
      return;
    }
    box.innerHTML = logs.map(function (item) {
      var ok = item.status === 'success';
      return '<div class="backup-log-item">' +
        '<span class="backup-log-dot ' + (ok ? 'is-ok' : 'is-fail') + '"></span>' +
        '<div class="backup-log-main">' +
          '<div class="backup-log-title">' + esc(actionLabel(item.action)) +
            '<span class="backup-log-target">' + esc(item.target || '—') + '</span></div>' +
          '<div class="backup-log-detail" title="' + esc(item.detail || '') + '">' + esc(item.detail || '') + '</div>' +
        '</div>' +
        '<div class="backup-log-side">' +
          '<div class="backup-log-operator">' + esc(item.name || item.account || '—') + '</div>' +
          '<div class="backup-log-time">' + esc(item.time || '') + '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderAll() {
    renderSummary();
    renderChecks();
    renderBackups();
    renderLogs();
  }

  async function loadAll() {
    var status = await call('/status');
    state.status = status;
    var results = await Promise.all([
      call('/list').catch(function (error) {
        return { items: [], error: '备份列表读取失败：' + error.message };
      }),
      call('/logs?limit=30').catch(function (error) {
        return { items: [], error: '操作日志读取失败：' + error.message };
      })
    ]);
    state.list = results[0].items || [];
    state.logs = results[1].items || [];
    renderAll();
    var errors = [];
    if (results[0].error) errors.push(results[0].error);
    if (results[1].error) errors.push(results[1].error);
    if (errors.length) showNotice(errors.join('；'), 'warn');
  }

  async function refresh(showSuccess) {
    if (state.busy) return;
    setBusy(true);
    try {
      await loadAll();
      if (showSuccess) {
        ERP.ui.toast('环境预检已更新', 'ok');
        hideNotice();
      }
    } catch (error) {
      showNotice(error.message || '环境预检失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function saveConfig() {
    if (state.busy) return;
    var value = String(repoInput.value || '').trim();
    if (!value && state.status && state.status.repo_url) {
      var confirmed = await ERP.ui.confirm({
        title: '清空备份仓库配置',
        message: '清空后仍可导出本地 .sql，但无法推送。确定清空仓库地址吗？',
        okText: '清空配置',
        danger: true
      });
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      var result = await call('/config', { method: 'PUT', body: { repo_url: value } });
      ERP.ui.toast(result.message || '备份仓库配置已保存', 'ok');
      await loadAll();
      showNotice(result.message || '备份仓库配置已保存', 'ok');
    } catch (error) {
      showNotice(error.message || '保存备份仓库配置失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function exportBackup() {
    if (state.busy) return;
    setBusy(true);
    showNotice('正在导出 MariaDB 全量快照，数据库较大时可能需要几十秒，请勿刷新页面…', 'info');
    try {
      var result = await call('/export', { method: 'POST' });
      await loadAll();
      ERP.ui.toast(result.message || '数据库备份已导出', 'ok');
      showNotice('已导出 ' + result.backup.filename + '（' + result.backup.size_text + '）。下一步可推送到独立 Git 仓库。', 'ok');
    } catch (error) {
      showNotice(error.message || '数据库导出失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function pushBackup(filename) {
    if (state.busy) return;
    var confirmed = await ERP.ui.confirm({
      title: '推送备份到独立仓库',
      message: '将把 ' + filename + ' 提交并推送到已配置的独立私有 Git 仓库。' +
        '请确认该仓库不是 ERP 源码仓库。',
      okText: '提交并推送'
    });
    if (!confirmed) return;
    setBusy(true);
    showNotice('正在提交并推送 ' + filename + '…', 'info');
    try {
      var result = await call('/push', { method: 'POST', body: { filename: filename } });
      await loadAll();
      ERP.ui.toast(result.message || '备份已推送', 'ok');
      showNotice('推送成功：' + filename + ' · commit ' + result.commit + ' · 分支 ' + result.branch, 'ok');
    } catch (error) {
      showNotice(error.message || '推送失败', 'error');
    } finally {
      setBusy(false);
    }
  }

  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', 'readonly');
    area.style.position = 'fixed';
    area.style.left = '-9999px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }

  async function copyPublicKey() {
    var text = state.status && state.status.ssh_public_key;
    if (!text) {
      ERP.ui.toast('当前没有可复制的部署公钥', 'warn');
      return;
    }
    var ok = false;
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch (e) {
        ok = fallbackCopy(text);
      }
    } else {
      ok = fallbackCopy(text);
    }
    ERP.ui.toast(ok ? '部署公钥已复制，请添加到备份仓库 Deploy keys' : '复制失败，请手动选择公钥复制', ok ? 'ok' : 'error');
  }

  page.addEventListener('click', function (event) {
    if (event.target.closest('#refreshBackup')) {
      refresh(true);
      return;
    }
    if (event.target.closest('#exportBackup')) {
      exportBackup();
      return;
    }
    if (event.target.closest('#saveBackupConfig')) {
      saveConfig();
      return;
    }
    if (event.target.closest('#copySshKey')) {
      copyPublicKey();
      return;
    }
    var pushBtn = event.target.closest('[data-push]');
    if (pushBtn) {
      pushBackup(pushBtn.getAttribute('data-push'));
    }
  });

  try {
    await loadAll();
  } catch (error) {
    showNotice(error.message || '备份页面加载失败，请检查后端服务与权限', 'error');
  } finally {
    setBusy(false);
  }
})();
