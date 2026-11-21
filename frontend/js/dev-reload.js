/**
 * 开发期自动刷新：文件变化后预览自动重载。
 * 仅在 ERP.config.dev === true 且通过 HTTP 打开时生效；
 * 依赖 tools/dev-server.js 提供的 /__version 指纹接口。
 * 正式部署（树莓派）时：把 js/config.js 中的 dev 改为 false 即可完全停用。
 */
(function () {
  'use strict';
  var ERP = window.ERP || {};
  if (!ERP.config || !ERP.config.dev) return;
  if (!/^https?:$/.test(window.location.protocol)) return;

  var last = null;
  var failures = 0;
  var timer = null;

  function schedule() {
    timer = window.setTimeout(tick, 900);
  }

  function tick() {
    fetch('/__version', { cache: 'no-store' })
      .then(function (response) {
        if (!response.ok) throw new Error('no version endpoint');
        return response.text();
      })
      .then(function (version) {
        failures = 0;
        if (last === null) {
          last = version;
        } else if (version !== last) {
          window.clearTimeout(timer);
          window.location.reload();
          return;
        }
        schedule();
      })
      .catch(function () {
        // 非 dev-server 环境（如 file://、nginx）静默停用
        if (++failures >= 2) return;
        schedule();
      });
  }

  schedule();
})();
