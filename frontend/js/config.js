/**
 * 全局配置：应用信息、角色、导航、字典
 * 说明：ERP.base / ERP.url() 让页面在 http:// 与 file:// 两种打开方式下都能正确跳转。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};

  var script = document.currentScript;
  var base = './';
  if (script && script.src) {
    var i = script.src.indexOf('/js/config.js');
    if (i >= 0) base = script.src.slice(0, i + 1);
  }
  ERP.base = base;

  ERP.url = function (path) {
    return ERP.base + String(path).replace(/^\.?\//, '');
  };

  ERP.config = {
    appName: '硬件物料台账',
    clubName: '校内硬件社团',
    appDesc: '轻量化 ERP · 回收元器件统一台账',
    version: 'v1.2.3',

    /** 开发期自动刷新（js/dev-reload.js 使用）。树莓派正式部署前改为 false */
    dev: true,

    storageKey: 'erp.v1',
    schema: 2,

    roles: {
      super: { label: '超级管理员', short: '超管' },
      admin: { label: '管理员', short: '管理员' },
      member: { label: '普通成员', short: '成员' }
    },


    modeLabels: { simple: '简易模式', precise: '精确计数' },
    statusLabels: { available: '有货', empty: '空' },
    actionLabels: { borrow: '领用', empty: '标记为空', restock: '补货', create: '建档' },
    actionTones: { borrow: 'tag-brand', empty: 'tag-empty', restock: 'tag-ok', create: 'tag-simple' },

    /** 侧边导航；roles 为可见角色，缺省 = 全部角色 */
    nav: [
      {
        group: '概览',
        items: [
          { id: 'dashboard', label: '工作台', href: 'dashboard.html', icon: 'dashboard' }
        ]
      },
      {
        group: '物料',
        items: [
          { id: 'materials', label: '物料总览', href: 'index.html', icon: 'grid' },
          { id: 'material-new', label: '新增物料', href: 'pages/material-new.html', icon: 'plus', roles: ['admin'] },
          { id: 'borrow', label: '领用登记', href: 'pages/borrow.html', icon: 'out' }
        ]
      },
      {
        group: '记录',
        items: [
          { id: 'logs', label: '领用日志', href: 'pages/logs.html', icon: 'list' },
          { id: 'stock-orders', label: '出入库单', href: 'pages/stock-orders.html', icon: 'box', roles: ['admin'] }
        ]
      },
      {
        group: '管理',
        items: [
          { id: 'alerts', label: '库存预警', href: 'pages/alerts.html', icon: 'alert', roles: ['admin'] },
          { id: 'categories', label: '分类管理', href: 'pages/categories.html', icon: 'tag', roles: ['admin'] },
          { id: 'users', label: '用户管理', href: 'pages/users.html', icon: 'users', roles: ['admin'] }
        ]
      }
    ],

    pageTitles: {
      dashboard: '工作台',
      materials: '物料总览',
      'material-new': '新增物料',
      borrow: '领用登记',
      logs: '领用日志',
      alerts: '库存预警',
      categories: '分类管理',
      users: '用户管理',
      'stock-orders': '出入库单'
    }
  };

  /**
   * 后端 API 地址：
   * - 生产环境（Nginx 同源 8088）：/api
   * - 本地静态预览 8090 / file://：直连树莓派后端 8088
   * - 页面可通过 window.ERP_API_BASE 覆盖
   */
  ERP.config.apiBase = (function () {
    if (window.ERP_API_BASE) return window.ERP_API_BASE;
    if (window.location.protocol === 'file:') return 'http://10.34.126.41:8088/api';
    if (window.location.port === '8090') return 'http://10.34.126.41:8088/api';
    return '/api';
  })();
})();
