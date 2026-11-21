/**
 * 数据层（前端模拟）：localStorage + 初始演示数据
 * ------------------------------------------------------------------
 * 后续对接后端时，只需把本文件的读写函数替换为接口调用，页面无需改动。
 * 所有写操作都会同步写入领用日志，满足「领用留痕、日志永久展示」。
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};

  var KEY = 'erp.v1.data';
  var SCHEMA = 2;
  var VISITS_KEY = 'erp.v1.visits';

  /* ============================ 初始演示数据 ============================ */

  var SEED = {
    schema: SCHEMA,
    categories: [
      { id: 'C-01', name: '基础元件' },
      { id: 'C-02', name: '主控模块' },
      { id: 'C-03', name: '传感器模块' },
      { id: 'C-04', name: '显示与交互' },
      { id: 'C-05', name: '无线通信' },
      { id: 'C-06', name: '电源与电池' },
      { id: 'C-07', name: '驱动与执行器' },
      { id: 'C-08', name: '连接与耗材' },
      { id: 'C-09', name: '工具与辅料' }
    ],
    users: [
      { id: 'U-000', account: 'superadmin', name: '周明', role: 'super', note: '社团指导老师', createdAt: '2026-09-01 09:00' },
      { id: 'U-001', account: 'admin', name: '林晨', role: 'admin', note: '社团硬件管理员', createdAt: '2026-09-01 09:30' },
      { id: 'U-002', account: 'member', name: '王浩', role: 'member', note: '电子组', createdAt: '2026-09-03 14:10' },
      { id: 'U-003', account: 'zhangyu', name: '张宇', role: 'member', note: '嵌入式组', createdAt: '2026-09-05 10:20' },
      { id: 'U-004', account: 'liuxin', name: '刘欣', role: 'member', note: '结构组', createdAt: '2026-09-08 16:40' },
      { id: 'U-005', account: 'chenzimo', name: '陈子墨', role: 'member', note: '机械组', createdAt: '2026-09-15 11:00' }
    ],
    materials: [
      {
        id: 'M-0001', name: 'ESP32-WROOM-32 开发板', model: 'ESP32-WROOM-32E', package: 'SMD-38',
        spec: '双核 240MHz / 4MB Flash / Wi-Fi+BT', brand: 'Espressif', mode: 'precise',
        qty: 5, minQty: 3, status: 'available', cabinet: 'A 柜', slot: 'A-03-2', categoryId: 'C-02',
        source: '智能小车项目', inboundAt: '2026-09-12 10:00', image: 'assets/img/esp32.svg',
        note: '带 USB-C 供电底板，含排针', updatedAt: '2026-11-18 14:22'
      },
      {
        id: 'M-0002', name: 'Arduino UNO R3 兼容板', model: 'ATmega328P', package: 'DIP-28',
        spec: '16MHz / 5V / 14 数字 IO', brand: '国产兼容', mode: 'precise',
        qty: 2, minQty: 2, status: 'available', cabinet: 'A 柜', slot: 'A-02-1', categoryId: 'C-02',
        source: '招新体验项目', inboundAt: '2026-08-20 15:30', image: 'assets/img/arduino.svg',
        note: '其中一块 USB 接口较松，使用前注意', updatedAt: '2026-10-28 13:12'
      },
      {
        id: 'M-0003', name: 'STM32F103C8T6 最小系统板', model: 'STM32F103C8T6', package: 'LQFP-48',
        spec: '72MHz / 64KB Flash / 20KB RAM', brand: 'ST', mode: 'precise',
        qty: 4, minQty: 2, status: 'available', cabinet: 'A 柜', slot: 'A-04-1', categoryId: 'C-02',
        source: '蓝板项目', inboundAt: '2026-07-06 09:20', image: 'assets/img/stm32.svg',
        note: '均已焊接排针，附 ST-Link 转接板', updatedAt: '2026-09-18 10:05'
      },
      {
        id: 'M-0004', name: 'LED 5mm 红色', model: '5mm 红发红', package: '直插',
        spec: '正向压降 2.0-2.2V / 20mA', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'B 柜', slot: 'B-01 元件盒', categoryId: 'C-01',
        source: '灯光装置项目', inboundAt: '2026-03-18 11:00', image: 'assets/img/led.svg',
        note: '整盒散装，约数百只', updatedAt: '2026-11-17 19:06'
      },
      {
        id: 'M-0005', name: '金属膜电阻 10kΩ', model: '1/4W 10KΩ ±1%', package: '直插',
        spec: '1/4W / 精度 1% / 色环标识', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'B 柜', slot: 'B-02 元件盒', categoryId: 'C-01',
        source: '灯光装置项目', inboundAt: '2026-03-18 11:05', image: 'assets/img/resistor.svg',
        note: '海量小件，不记数量', updatedAt: '2026-10-15 18:40'
      },
      {
        id: 'M-0006', name: '电解电容 100μF 25V', model: 'CD11 100uF', package: '直插',
        spec: '25V / 105℃ / 耐压 25V', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'B 柜', slot: 'B-03 元件盒', categoryId: 'C-01',
        source: '电源改造项目', inboundAt: '2026-04-02 14:30', image: 'assets/img/capacitor.svg',
        note: '注意极性，长脚为正', updatedAt: '2026-04-02 14:30'
      },
      {
        id: 'M-0007', name: 'OLED 显示屏 0.96 寸', model: 'SSD1306', package: 'I2C 4Pin 模块',
        spec: '128×64 / 3.3-5V / I2C', brand: '中景园', mode: 'precise',
        qty: 0, minQty: 2, status: 'empty', cabinet: 'C 柜', slot: 'C-01-2', categoryId: 'C-04',
        source: '智能门锁项目', inboundAt: '2026-05-11 16:20', image: 'assets/img/oled.svg',
        note: '已用完，档案保留，补货后直接复用', updatedAt: '2026-11-10 15:42'
      },
      {
        id: 'M-0008', name: '5V 继电器模块', model: 'SRD-05VDC-SL-C 1 路', package: '模块',
        spec: '5V 触发 / 10A 250VAC', brand: '法纳', mode: 'precise',
        qty: 2, minQty: 3, status: 'available', cabinet: 'C 柜', slot: 'C-02-1', categoryId: 'C-07',
        source: '智能门锁项目', inboundAt: '2026-05-11 16:40', image: 'assets/img/relay.svg',
        note: '带光耦隔离', updatedAt: '2026-11-16 10:31'
      },
      {
        id: 'M-0009', name: 'DHT22 温湿度传感器', model: 'AM2302', package: '模块',
        spec: '-40~80℃ / ±0.5℃ / 单总线', brand: 'Aosong', mode: 'precise',
        qty: 3, minQty: 2, status: 'available', cabinet: 'C 柜', slot: 'C-03-1', categoryId: 'C-03',
        source: '环境监测项目', inboundAt: '2026-06-05 10:10', image: 'assets/img/sensor.svg',
        note: '含 10k 上拉电阻', updatedAt: '2026-09-30 16:22'
      },
      {
        id: 'M-0010', name: 'HC-05 蓝牙串口模块', model: 'HC-05', package: '模块',
        spec: '蓝牙 2.0 / 3.3-5V / 串口透传', brand: '国产', mode: 'precise',
        qty: 2, minQty: 1, status: 'available', cabinet: 'C 柜', slot: 'C-04-2', categoryId: 'C-05',
        source: '蓝牙遥控项目', inboundAt: '2026-06-05 10:25', image: 'assets/img/bluetooth.svg',
        note: '默认波特率 9600', updatedAt: '2026-08-22 09:40'
      },
      {
        id: 'M-0011', name: 'NRF24L01+ 无线模块', model: 'NRF24L01+', package: '模块',
        spec: '2.4GHz / SPI / 2Mbps', brand: '国产', mode: 'precise',
        qty: 3, minQty: 2, status: 'available', cabinet: 'C 柜', slot: 'C-04-3', categoryId: 'C-05',
        source: '遥控小车项目', inboundAt: '2026-07-10 15:00', image: 'assets/img/nrf.svg',
        note: '建议配 10uF 退耦电容', updatedAt: '2026-08-01 11:20'
      },
      {
        id: 'M-0012', name: '18650 锂电池', model: '18650 2600mAh', package: '圆柱电池',
        spec: '3.7V / 2600mAh / 带保护板', brand: '力神', mode: 'precise',
        qty: 8, minQty: 4, status: 'available', cabinet: 'D 柜', slot: 'D-01 防火袋', categoryId: 'C-06',
        source: '智能小车项目', inboundAt: '2026-09-12 10:30', image: 'assets/img/battery.svg',
        note: '存放于防火袋，禁止短路、禁止过充', updatedAt: '2026-11-05 16:02'
      },
      {
        id: 'M-0013', name: 'TMC2209 步进驱动模块', model: 'TMC2209', package: '模块',
        spec: '2A 峰值 / UART / 静音驱动', brand: 'BigTreeTech', mode: 'precise',
        qty: 1, minQty: 2, status: 'available', cabinet: 'C 柜', slot: 'C-05-1', categoryId: 'C-07',
        source: '3D 打印机维修项目', inboundAt: '2026-10-08 09:00', image: 'assets/img/driver.svg',
        note: '注意散热片安装', updatedAt: '2026-11-08 09:16'
      },
      {
        id: 'M-0014', name: '杜邦线 20cm 公对母', model: '20cm 公对母', package: '40Pin 排线',
        spec: '2.54mm / 40 根一扎', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'B 柜', slot: 'B-04-1', categoryId: 'C-08',
        source: '招新体验项目', inboundAt: '2026-03-18 11:10', image: 'assets/img/wire.svg',
        note: '多扎混放，按需取用', updatedAt: '2026-03-18 11:10'
      },
      {
        id: 'M-0015', name: '面包板 400 孔', model: 'MB-400', package: '免焊面包板',
        spec: '400 孔 / 白色', brand: '国产', mode: 'precise',
        qty: 3, minQty: 2, status: 'available', cabinet: 'B 柜', slot: 'B-05', categoryId: 'C-08',
        source: '招新体验项目', inboundAt: '2026-03-18 11:15', image: 'assets/img/breadboard.svg',
        note: '含背胶', updatedAt: '2026-06-20 10:00'
      },
      {
        id: 'M-0016', name: '单排排针 2.54mm', model: '1×40', package: '直插',
        spec: '2.54mm 间距 / 单排 40P', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'empty', cabinet: 'B 柜', slot: 'B-06-1', categoryId: 'C-08',
        source: '灯光装置项目', inboundAt: '2026-03-18 11:20', image: 'assets/img/pin.svg',
        note: '已用完，待补货；档案保留', updatedAt: '2026-10-20 11:20'
      },
      {
        id: 'M-0017', name: '热缩管套装', model: 'φ2-φ10 混装', package: '盒装',
        spec: '阻燃 / 五色混装', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'D 柜', slot: 'D-02', categoryId: 'C-09',
        source: '电源改造项目', inboundAt: '2026-04-02 14:35', image: 'assets/img/tube.svg',
        note: '配热风枪使用，用后归位', updatedAt: '2026-04-02 14:35'
      },
      {
        id: 'M-0018', name: '洞洞板 5×7cm', model: '5×7 单面', package: 'PCB 板',
        spec: '单面玻纤 / 2.54mm 孔距', brand: '国产', mode: 'simple',
        qty: null, minQty: null, status: 'available', cabinet: 'B 柜', slot: 'B-07', categoryId: 'C-08',
        source: '招新体验项目', inboundAt: '2026-03-18 11:25', image: 'assets/img/perfboard.svg',
        note: '边角料可回收利用', updatedAt: '2026-10-12 14:32'
      }
    ],
    logs: [
      {
        id: 'L-0001', materialId: 'M-0001', materialName: 'ESP32-WROOM-32 开发板', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '王浩', borrowAt: '2026-11-18 14:20',
        project: '智能小车项目', operator: '林晨', note: '', createdAt: '2026-11-18 14:22'
      },
      {
        id: 'L-0002', materialId: 'M-0004', materialName: 'LED 5mm 红色', mode: 'simple',
        action: 'borrow', qty: null, borrower: '张宇', borrowAt: '2026-11-17 19:05',
        project: '灯光装置项目', operator: '张宇', note: '', createdAt: '2026-11-17 19:06'
      },
      {
        id: 'L-0003', materialId: 'M-0008', materialName: '5V 继电器模块', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '刘欣', borrowAt: '2026-11-16 10:30',
        project: '智能门锁项目', operator: '林晨', note: '', createdAt: '2026-11-16 10:31'
      },
      {
        id: 'L-0004', materialId: 'M-0007', materialName: 'OLED 显示屏 0.96 寸', mode: 'precise',
        action: 'borrow', qty: 2, borrower: '王浩', borrowAt: '2026-11-10 15:40',
        project: '智能门锁项目', operator: '林晨', note: '项目调试用', createdAt: '2026-11-10 15:41'
      },
      {
        id: 'L-0005', materialId: 'M-0007', materialName: 'OLED 显示屏 0.96 寸', mode: 'precise',
        action: 'empty', qty: null, borrower: '', borrowAt: '2026-11-10 15:42',
        project: '', operator: '林晨', note: '库存清零，手动标记为空', createdAt: '2026-11-10 15:42'
      },
      {
        id: 'L-0006', materialId: 'M-0013', materialName: 'TMC2209 步进驱动模块', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '张宇', borrowAt: '2026-11-08 09:15',
        project: '3D 打印机维修项目', operator: '张宇', note: '', createdAt: '2026-11-08 09:16'
      },
      {
        id: 'L-0007', materialId: 'M-0012', materialName: '18650 锂电池', mode: 'precise',
        action: 'borrow', qty: 2, borrower: '刘欣', borrowAt: '2026-11-05 16:00',
        project: '智能小车项目', operator: '林晨', note: '更换电池组', createdAt: '2026-11-05 16:02'
      },
      {
        id: 'L-0008', materialId: 'M-0012', materialName: '18650 锂电池', mode: 'precise',
        action: 'restock', qty: 4, borrower: '', borrowAt: '2026-11-02 10:10',
        project: '', operator: '林晨', note: '补货入库（采购）', createdAt: '2026-11-02 10:10'
      },
      {
        id: 'L-0009', materialId: 'M-0002', materialName: 'Arduino UNO R3 兼容板', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '王浩', borrowAt: '2026-10-28 13:10',
        project: '招新体验项目', operator: '林晨', note: '', createdAt: '2026-10-28 13:12'
      },
      {
        id: 'L-0010', materialId: 'M-0016', materialName: '单排排针 2.54mm', mode: 'simple',
        action: 'empty', qty: null, borrower: '', borrowAt: '2026-10-20 11:20',
        project: '', operator: '林晨', note: '库存耗尽，标记为空', createdAt: '2026-10-20 11:20'
      },
      {
        id: 'L-0011', materialId: 'M-0005', materialName: '金属膜电阻 10kΩ', mode: 'simple',
        action: 'borrow', qty: null, borrower: '张宇', borrowAt: '2026-10-15 18:40',
        project: '灯光装置项目', operator: '张宇', note: '', createdAt: '2026-10-15 18:40'
      },
      {
        id: 'L-0012', materialId: 'M-0018', materialName: '洞洞板 5×7cm', mode: 'simple',
        action: 'borrow', qty: null, borrower: '张宇', borrowAt: '2026-10-12 14:30',
        project: '招新体验项目', operator: '林晨', note: '', createdAt: '2026-10-12 14:32'
      },
      {
        id: 'L-0013', materialId: 'M-0009', materialName: 'DHT22 温湿度传感器', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '刘欣', borrowAt: '2026-09-30 16:20',
        project: '环境监测项目', operator: '林晨', note: '', createdAt: '2026-09-30 16:22'
      },
      {
        id: 'L-0014', materialId: 'M-0009', materialName: 'DHT22 温湿度传感器', mode: 'precise',
        action: 'borrow', qty: 1, borrower: '王浩', borrowAt: '2026-09-28 10:05',
        project: '环境监测项目', operator: '张宇', note: '', createdAt: '2026-09-28 10:06'
      }
    ]
  };

  /* ============================ 内部工具 ============================ */

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }
  function padLeft(num, len) {
    var s = String(num);
    while (s.length < len) s = '0' + s;
    return s;
  }
  function nowStr() {
    var d = new Date();
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
      ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function todayStr() {
    return nowStr().slice(0, 10);
  }
  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data && data.schema === SCHEMA && Array.isArray(data.materials) &&
            Array.isArray(data.categories) && Array.isArray(data.users) && Array.isArray(data.logs)) {
          return data;
        }
      }
    } catch (e) { /* 数据损坏则重置 */ }
    var fresh = clone(SEED);
    save(fresh);
    return fresh;
  }
  function save(data) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      return false;
    }
  }
  function mutate(fn) {
    var data = load();
    var result = fn(data);
    save(data);
    return result;
  }
  function nextId(list, prefix, len) {
    var max = 0;
    list.forEach(function (item) {
      var match = String(item.id || '').match(/(\d+)$/);
      if (match) max = Math.max(max, parseInt(match[1], 10));
    });
    return prefix + padLeft(max + 1, len);
  }
  function isWarn(material) {
    return material.mode === 'precise' &&
      Number(material.minQty) > 0 &&
      Number(material.qty) <= Number(material.minQty);
  }
  var ROLE_RANK = { member: 1, admin: 2, super: 3 };
  function normalizeRole(role) {
    return Object.prototype.hasOwnProperty.call(ROLE_RANK, role) ? role : 'member';
  }
  function privilegedCount(users) {
    return users.filter(function (user) {
      return ROLE_RANK[user.role] >= ROLE_RANK.admin;
    }).length;
  }
  function categoryName(data, categoryId) {
    var found = null;
    data.categories.forEach(function (c) { if (c.id === categoryId) found = c.name; });
    return found || '';
  }
  function pushLog(data, entry) {
    var log = {
      id: nextId(data.logs, 'L-', 4),
      materialId: entry.materialId,
      materialName: entry.materialName,
      mode: entry.mode,
      action: entry.action,
      qty: entry.qty == null ? null : Number(entry.qty),
      borrower: entry.borrower || '',
      borrowAt: entry.borrowAt || nowStr(),
      project: entry.project || '',
      operator: entry.operator || '',
      note: entry.note || '',
      createdAt: nowStr()
    };
    data.logs.unshift(log);
    return log;
  }

  /* ============================ 对外 API ============================ */

  var store = {
    schema: SCHEMA,

    now: nowStr,
    today: todayStr,

    /** 重置为初始演示数据 */
    reset: function () {
      try { window.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      return load();
    },

    /** 原始数据快照 */
    snapshot: function () {
      return clone(load());
    },

    /* ---------------- 物料 ---------------- */

    materials: function () {
      return load().materials.slice();
    },

    getMaterial: function (id) {
      var found = null;
      load().materials.forEach(function (m) { if (m.id === id) found = m; });
      return found;
    },

    categoryName: function (categoryId) {
      return categoryName(load(), categoryId);
    },

    listMaterials: function (options) {
      var opts = options || {};
      var data = load();
      var list = data.materials.slice();
      var keyword = String(opts.q || '').trim().toLowerCase();

      if (keyword) {
        list = list.filter(function (m) {
          return [m.name, m.model, m.package, m.spec, m.brand, m.cabinet, m.slot,
            m.source, m.note, categoryName(data, m.categoryId)].some(function (field) {
            return field && String(field).toLowerCase().indexOf(keyword) >= 0;
          });
        });
      }
      if (opts.mode && opts.mode !== 'all') {
        list = list.filter(function (m) { return m.mode === opts.mode; });
      }
      if (opts.status && opts.status !== 'all') {
        list = list.filter(function (m) { return m.status === opts.status; });
      }
      if (opts.categoryId && opts.categoryId !== 'all') {
        list = list.filter(function (m) { return m.categoryId === opts.categoryId; });
      }
      if (opts.warnOnly) {
        list = list.filter(isWarn);
      }

      var sort = opts.sort || 'updated';
      if (sort === 'name') {
        list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name), 'zh'); });
      } else if (sort === 'qty') {
        list.sort(function (a, b) {
          var pa = a.mode === 'precise';
          var pb = b.mode === 'precise';
          if (pa !== pb) return pa ? -1 : 1;
          if (pa && pb) {
            var diff = Number(a.qty) - Number(b.qty);
            if (diff !== 0) return diff;
          }
          return String(a.name).localeCompare(String(b.name), 'zh');
        });
      } else if (sort === 'inbound') {
        list.sort(function (a, b) {
          return String(b.inboundAt || '').localeCompare(String(a.inboundAt || ''));
        });
      } else if (sort === 'warn') {
        list.sort(function (a, b) {
          var diff = Number(isWarn(b)) - Number(isWarn(a));
          if (diff !== 0) return diff;
          return String(a.name).localeCompare(String(b.name), 'zh');
        });
      } else {
        list.sort(function (a, b) {
          return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
        });
      }
      return list;
    },

    /** 新增或更新物料档案；返回保存后的物料 */
    upsertMaterial: function (payload) {
      return mutate(function (data) {
        var now = nowStr();
        var material = null;
        if (payload.id) {
          data.materials.forEach(function (m) { if (m.id === payload.id) material = m; });
        }
        if (!material) {
          material = { id: nextId(data.materials, 'M-', 4), createdAt: now };
          data.materials.unshift(material);
        }
        ['name', 'model', 'package', 'spec', 'brand', 'mode', 'qty', 'minQty',
          'status', 'cabinet', 'slot', 'categoryId', 'source', 'inboundAt', 'image', 'note'
        ].forEach(function (key) {
          if (Object.prototype.hasOwnProperty.call(payload, key)) material[key] = payload[key];
        });

        if (material.mode === 'simple') {
          material.qty = null;
          material.minQty = null;
        } else {
          material.mode = 'precise';
          material.qty = Math.max(0, Number(material.qty) || 0);
          material.minQty = Math.max(0, Number(material.minQty) || 0);
        }
        if (material.status !== 'empty' && material.mode === 'precise' && Number(material.qty) <= 0) {
          material.status = 'empty';
        }
        if (material.status !== 'empty') material.status = 'available';
        material.updatedAt = now;
        return material;
      });
    },

    /** 修改物料状态（有货 / 空） */
    setStatus: function (id, status) {
      return mutate(function (data) {
        var material = null;
        data.materials.forEach(function (m) { if (m.id === id) material = m; });
        if (!material) return { ok: false, error: '物料不存在' };
        if (status === 'available' && material.mode === 'precise' && Number(material.qty) <= 0) {
          return { ok: false, error: '精确计数模式下库存为 0，请先在编辑页补货并修改数量' };
        }
        material.status = status;
        material.updatedAt = nowStr();
        return { ok: true };
      });
    },

    /* ---------------- 领用 / 补货 ---------------- */

    /**
     * 领用登记：
     *   简易模式 -> 仅记录日志，不改数量；
     *   精确模式 -> 校验并扣减库存，扣减到 0 自动标记为空。
     */
    borrow: function (input) {
      var data = load();
      var material = null;
      data.materials.forEach(function (m) { if (m.id === input.materialId) material = m; });
      if (!material) return { ok: false, error: '物料不存在或已被移除' };
      if (material.status === 'empty') {
        return { ok: false, error: '该物料当前为空，补货后才能领用' };
      }
      if (!String(input.borrower || '').trim()) return { ok: false, error: '请填写领用人' };
      if (!String(input.project || '').trim()) return { ok: false, error: '请填写所属项目' };

      var qty = null;
      if (material.mode === 'precise') {
        qty = Number(input.qty);
        if (!qty || qty <= 0 || Math.floor(qty) !== qty) {
          return { ok: false, error: '请输入正确的领用数量（正整数）' };
        }
        if (qty > Number(material.qty)) {
          return { ok: false, error: '领用数量不能超过当前库存（' + material.qty + '）' };
        }
      }

      var log = mutate(function (data2) {
        var target = null;
        data2.materials.forEach(function (m) { if (m.id === input.materialId) target = m; });
        if (target.mode === 'precise') {
          target.qty = Number(target.qty) - qty;
          if (target.qty <= 0) {
            target.qty = 0;
            target.status = 'empty';
          }
          target.updatedAt = nowStr();
        }
        return pushLog(data2, {
          materialId: target.id,
          materialName: target.name,
          mode: target.mode,
          action: 'borrow',
          qty: qty,
          borrower: String(input.borrower).trim(),
          borrowAt: input.borrowAt || nowStr(),
          project: String(input.project).trim(),
          operator: input.operator || '',
          note: input.note || ''
        });
      });

      return { ok: true, log: log, material: store.getMaterial(material.id) };
    },

    /** 标记为空（仅管理员，简易模式常用） */
    markEmpty: function (id, operator) {
      var data = load();
      var material = null;
      data.materials.forEach(function (m) { if (m.id === id) material = m; });
      if (!material) return { ok: false, error: '物料不存在' };
      if (material.status === 'empty') return { ok: false, error: '该物料已经是空状态' };

      mutate(function (data2) {
        var target = null;
        data2.materials.forEach(function (m) { if (m.id === id) target = m; });
        target.status = 'empty';
        if (target.mode === 'precise') target.qty = 0;
        target.updatedAt = nowStr();
        pushLog(data2, {
          materialId: target.id,
          materialName: target.name,
          mode: target.mode,
          action: 'empty',
          qty: null,
          borrower: '',
          borrowAt: nowStr(),
          project: '',
          operator: operator || '',
          note: '库存清零，手动标记为空'
        });
      });
      return { ok: true };
    },

    /** 补货：精确模式增加数量，简易模式恢复为有货 */
    restock: function (id, qty, operator) {
      var amount = Number(qty);
      if (!amount || amount <= 0 || Math.floor(amount) !== amount) {
        return { ok: false, error: '补货数量需为正整数' };
      }
      var data = load();
      var material = null;
      data.materials.forEach(function (m) { if (m.id === id) material = m; });
      if (!material) return { ok: false, error: '物料不存在' };

      mutate(function (data2) {
        var target = null;
        data2.materials.forEach(function (m) { if (m.id === id) target = m; });
        if (target.mode === 'precise') {
          target.qty = Number(target.qty || 0) + amount;
        }
        target.status = 'available';
        target.updatedAt = nowStr();
        pushLog(data2, {
          materialId: target.id,
          materialName: target.name,
          mode: target.mode,
          action: 'restock',
          qty: target.mode === 'precise' ? amount : null,
          borrower: '',
          borrowAt: nowStr(),
          project: '',
          operator: operator || '',
          note: '补货入库'
        });
      });
      return { ok: true };
    },

    /** 领用日志（默认按登记时间倒序） */
    logs: function (options) {
      var opts = options || {};
      var list = load().logs.slice();
      if (opts.materialId) {
        list = list.filter(function (log) { return log.materialId === opts.materialId; });
      }
      if (opts.action && opts.action !== 'all') {
        list = list.filter(function (log) { return log.action === opts.action; });
      }
      var keyword = String(opts.q || '').trim().toLowerCase();
      if (keyword) {
        list = list.filter(function (log) {
          return [log.materialName, log.materialId, log.borrower, log.project, log.operator, log.note]
            .some(function (field) {
              return field && String(field).toLowerCase().indexOf(keyword) >= 0;
            });
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

    /* ---------------- 分类 ---------------- */

    categories: function () {
      var data = load();
      return data.categories.map(function (category) {
        var used = data.materials.filter(function (m) { return m.categoryId === category.id; });
        return {
          id: category.id,
          name: category.name,
          count: used.length,
          emptyCount: used.filter(function (m) { return m.status === 'empty'; }).length,
          warnCount: used.filter(isWarn).length
        };
      });
    },

    addCategory: function (name) {
      var value = String(name || '').trim();
      if (!value) return { ok: false, error: '分类名称不能为空' };
      if (value.length > 12) return { ok: false, error: '分类名称建议不超过 12 个字' };
      return mutate(function (data) {
        var duplicated = data.categories.some(function (c) {
          return c.name.toLowerCase() === value.toLowerCase();
        });
        if (duplicated) return { ok: false, error: '该分类已存在' };
        var category = { id: nextId(data.categories, 'C-', 2), name: value };
        data.categories.push(category);
        return { ok: true, category: category };
      });
    },

    renameCategory: function (id, name) {
      var value = String(name || '').trim();
      if (!value) return { ok: false, error: '分类名称不能为空' };
      return mutate(function (data) {
        var target = null;
        data.categories.forEach(function (c) { if (c.id === id) target = c; });
        if (!target) return { ok: false, error: '分类不存在' };
        var duplicated = data.categories.some(function (c) {
          return c.id !== id && c.name.toLowerCase() === value.toLowerCase();
        });
        if (duplicated) return { ok: false, error: '该分类名称已存在' };
        target.name = value;
        return { ok: true };
      });
    },

    deleteCategory: function (id) {
      return mutate(function (data) {
        var used = data.materials.filter(function (m) { return m.categoryId === id; }).length;
        if (used > 0) {
          return { ok: false, error: '该分类下仍有 ' + used + ' 个物料档案，不能删除' };
        }
        var before = data.categories.length;
        data.categories = data.categories.filter(function (c) { return c.id !== id; });
        if (data.categories.length === before) return { ok: false, error: '分类不存在' };
        return { ok: true };
      });
    },

    /* ---------------- 用户 ---------------- */

    users: function () {
      return load().users.slice();
    },

    findUser: function (account) {
      var keyword = String(account || '').trim().toLowerCase();
      var found = null;
      load().users.forEach(function (user) {
        if (String(user.account).toLowerCase() === keyword || String(user.name) === account) {
          found = user;
        }
      });
      return found;
    },

    displayNameFor: function (account, role) {
      var user = store.findUser(account);
      if (user) return user.name;
      var demo = (ERP.config.demoAccounts || {})[role];
      if (demo && demo.name) return demo.name;
      var roles = (ERP.config.roles || {})[role];
      return roles ? roles.label : '普通成员';
    },

    addUser: function (payload) {
      var account = String(payload.account || '').trim();
      var name = String(payload.name || '').trim();
      var role = normalizeRole(payload.role);
      if (!account) return { ok: false, error: '请填写账号' };
      if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(account)) {
        return { ok: false, error: '账号需为 3-20 位字母、数字或 _ . -' };
      }
      if (!name) return { ok: false, error: '请填写姓名' };
      return mutate(function (data) {
        var duplicated = data.users.some(function (user) {
          return String(user.account).toLowerCase() === account.toLowerCase();
        });
        if (duplicated) return { ok: false, error: '该账号已存在' };
        var user = {
          id: nextId(data.users, 'U-', 3),
          account: account,
          name: name,
          role: role,
          note: String(payload.note || '').trim(),
          createdAt: nowStr()
        };
        data.users.push(user);
        return { ok: true, user: user };
      });
    },

    updateUser: function (id, payload) {
      return mutate(function (data) {
        var target = null;
        data.users.forEach(function (u) { if (u.id === id) target = u; });
        if (!target) return { ok: false, error: '用户不存在' };

        // 先完成全部校验，再统一写入，避免校验失败时数据已被改动
        var nextAccount = target.account;
        var nextName = target.name;
        var nextRole = target.role;
        var nextNote = target.note;

        if (payload.account != null) {
          nextAccount = String(payload.account).trim();
          if (!nextAccount) return { ok: false, error: '请填写账号' };
          if (!/^[a-zA-Z0-9_.-]{3,20}$/.test(nextAccount)) {
            return { ok: false, error: '账号需为 3-20 位字母、数字或 _ . -' };
          }
          var duplicated = data.users.some(function (u) {
            return u.id !== id && String(u.account).toLowerCase() === nextAccount.toLowerCase();
          });
          if (duplicated) return { ok: false, error: '该账号已存在' };
        }
        if (payload.name != null) {
          nextName = String(payload.name).trim();
          if (!nextName) return { ok: false, error: '请填写姓名' };
        }
        if (payload.role != null) {
          nextRole = normalizeRole(payload.role);
          if (target.role === 'super' && nextRole !== 'super') {
            var supers = data.users.filter(function (u) { return u.role === 'super'; });
            if (supers.length <= 1) return { ok: false, error: '至少需要保留一名超级管理员' };
          }
          if (ROLE_RANK[target.role] >= ROLE_RANK.admin && ROLE_RANK[nextRole] < ROLE_RANK.admin) {
            if (privilegedCount(data.users) <= 1) {
              return { ok: false, error: '至少需要保留一名管理员' };
            }
          }
        }
        if (payload.note != null) nextNote = String(payload.note).trim();

        target.account = nextAccount;
        target.name = nextName;
        target.role = nextRole;
        target.note = nextNote;
        return { ok: true };
      });
    },

    deleteUser: function (id) {
      return mutate(function (data) {
        var target = null;
        data.users.forEach(function (u) { if (u.id === id) target = u; });
        if (!target) return { ok: false, error: '用户不存在' };
        if (target.role === 'super') {
          var supers = data.users.filter(function (u) { return u.role === 'super'; });
          if (supers.length <= 1) return { ok: false, error: '至少需要保留一名超级管理员' };
        }
        if (ROLE_RANK[target.role] >= ROLE_RANK.admin) {
          if (privilegedCount(data.users) <= 1) return { ok: false, error: '至少需要保留一名管理员' };
        }
        data.users = data.users.filter(function (u) { return u.id !== id; });
        return { ok: true };
      });
    },

    /* ---------------- 访问记录（超级管理员通知面板） ---------------- */

    visits: function () {
      try {
        var raw = window.localStorage.getItem(VISITS_KEY);
        var list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch (e) {
        return [];
      }
    },

    addVisit: function (session) {
      if (!session) return;
      var list = store.visits();
      list.unshift({
        account: session.account || '',
        name: session.name || '',
        role: session.role || 'member',
        at: nowStr()
      });
      if (list.length > 200) list = list.slice(0, 200);
      try {
        window.localStorage.setItem(VISITS_KEY, JSON.stringify(list));
      } catch (e) { /* ignore */ }
    },

    clearVisits: function () {
      try {
        window.localStorage.removeItem(VISITS_KEY);
      } catch (e) { /* ignore */ }
    },

    /* ---------------- 统计 ---------------- */

    stats: function () {
      var data = load();
      var materials = data.materials;
      return {
        total: materials.length,
        simple: materials.filter(function (m) { return m.mode === 'simple'; }).length,
        precise: materials.filter(function (m) { return m.mode === 'precise'; }).length,
        available: materials.filter(function (m) { return m.status === 'available'; }).length,
        empty: materials.filter(function (m) { return m.status === 'empty'; }).length,
        warn: materials.filter(isWarn).length,
        categories: data.categories.length,
        logs: data.logs.length,
        users: data.users.length
      };
    },

    warnings: function () {
      var data = load();
      return data.materials.filter(isWarn).sort(function (a, b) {
        return (Number(a.qty) - Number(a.minQty)) - (Number(b.qty) - Number(b.minQty)) ||
          String(a.name).localeCompare(String(b.name), 'zh');
      });
    },

    isWarn: isWarn
  };

  window.ERP.store = store;
})();
