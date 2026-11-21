/**
 * 纯前端 Excel（.xlsx）导出：零依赖
 * ------------------------------------------------------------------
 * 实现要点：把数据写成最小可用的 OOXML 工作簿，再按 ZIP（store 模式，不压缩）
 * 打包，最后用 Blob 触发下载。无需 SheetJS / 后端接口，离线可用。
 *
 * 用法：
 *   ERP.xlsx.download('物料台账_20261121.xlsx', [{
 *     name: '物料台账',
 *     columns: [{ title: '物料名称', width: 24 }, { title: '数量', width: 10 }],
 *     rows: [['ESP32', 5]]
 *   }]);
 */
(function () {
  'use strict';
  window.ERP = window.ERP || {};
  var ERP = window.ERP;

  /* ---------------- 基础工具 ---------------- */

  function encodeUtf8(text) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(String(text));
    var bytes = [];
    var encoded = unescape(encodeURIComponent(String(text)));
    for (var i = 0; i < encoded.length; i++) bytes.push(encoded.charCodeAt(i));
    return new Uint8Array(bytes);
  }

  function xmlEscape(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[n] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function concatBytes(list) {
    var total = 0;
    list.forEach(function (item) { total += item.length; });
    var out = new Uint8Array(total);
    var offset = 0;
    list.forEach(function (item) {
      out.set(item, offset);
      offset += item.length;
    });
    return out;
  }

  function dosDateTime(date) {
    var time = ((date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2 | 0)) & 0xFFFF;
    var day = (((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()) & 0xFFFF;
    return { time: time, date: day };
  }

  /* ---------------- ZIP 打包（store 模式） ---------------- */

  function zipStore(files) {
    var chunks = [];
    var central = [];
    var offset = 0;
    var stamp = dosDateTime(new Date());

    files.forEach(function (file) {
      var nameBytes = encodeUtf8(file.name);
      var data = file.data;
      var crc = crc32(data);

      var local = new Uint8Array(30 + nameBytes.length);
      var ldv = new DataView(local.buffer);
      ldv.setUint32(0, 0x04034b50, true);
      ldv.setUint16(4, 20, true);
      ldv.setUint16(6, 0x0800, true); // UTF-8 文件名
      ldv.setUint16(8, 0, true);      // 0 = store
      ldv.setUint16(10, stamp.time, true);
      ldv.setUint16(12, stamp.date, true);
      ldv.setUint32(14, crc, true);
      ldv.setUint32(18, data.length, true);
      ldv.setUint32(22, data.length, true);
      ldv.setUint16(26, nameBytes.length, true);
      ldv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, data);

      var cent = new Uint8Array(46 + nameBytes.length);
      var cdv = new DataView(cent.buffer);
      cdv.setUint32(0, 0x02014b50, true);
      cdv.setUint16(4, 20, true);
      cdv.setUint16(6, 20, true);
      cdv.setUint16(8, 0x0800, true);
      cdv.setUint16(10, 0, true);
      cdv.setUint16(12, stamp.time, true);
      cdv.setUint16(14, stamp.date, true);
      cdv.setUint32(16, crc, true);
      cdv.setUint32(20, data.length, true);
      cdv.setUint32(24, data.length, true);
      cdv.setUint16(28, nameBytes.length, true);
      cdv.setUint16(30, 0, true);
      cdv.setUint16(32, 0, true);
      cdv.setUint16(34, 0, true);
      cdv.setUint16(36, 0, true);
      cdv.setUint32(38, 0, true);
      cdv.setUint32(42, offset, true);
      cent.set(nameBytes, 46);
      central.push(cent);

      offset += local.length + data.length;
    });

    var centralSize = 0;
    central.forEach(function (item) { centralSize += item.length; });

    var eocd = new Uint8Array(22);
    var edv = new DataView(eocd.buffer);
    edv.setUint32(0, 0x06054b50, true);
    edv.setUint16(8, files.length, true);
    edv.setUint16(10, files.length, true);
    edv.setUint32(12, centralSize, true);
    edv.setUint32(16, offset, true);

    return concatBytes(chunks.concat(central, [eocd]));
  }

  /* ---------------- OOXML 组装 ---------------- */

  function columnLetter(index) {
    var letter = '';
    var n = index + 1;
    while (n > 0) {
      var m = (n - 1) % 26;
      letter = String.fromCharCode(65 + m) + letter;
      n = Math.floor((n - 1) / 26);
    }
    return letter;
  }

  function sheetNameSafe(name, index) {
    var value = String(name || ('Sheet' + (index + 1))).replace(/[\\/:*?\[\]]/g, ' ').trim().slice(0, 31);
    return value || ('Sheet' + (index + 1));
  }

  function cellXml(ref, value, style) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number' && isFinite(value)) {
      return '<c r="' + ref + '" s="' + style + '"><v>' + value + '</v></c>';
    }
    var text = String(value);
    return '<c r="' + ref + '" s="' + style + '" t="inlineStr"><is><t xml:space="preserve">' +
      xmlEscape(text) + '</t></is></c>';
  }

  function sheetXml(sheet) {
    var columns = sheet.columns || [];
    var rows = sheet.rows || [];
    var colsXml = '';
    if (columns.length) {
      colsXml = '<cols>' + columns.map(function (column, index) {
        return '<col min="' + (index + 1) + '" max="' + (index + 1) + '" width="' +
          (column.width || 14) + '" customWidth="1"/>';
      }).join('') + '</cols>';
    }
    var header = '<row r="1">' + columns.map(function (column, index) {
      return cellXml(columnLetter(index) + '1', column.title, 1);
    }).join('') + '</row>';

    var body = rows.map(function (row, rowIndex) {
      var rowNumber = rowIndex + 2;
      var cells = row.map(function (value, columnIndex) {
        return cellXml(columnLetter(columnIndex) + rowNumber, value, 0);
      }).join('');
      return '<row r="' + rowNumber + '">' + cells + '</row>';
    }).join('');

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
        '<sheetViews><sheetView workbookViewId="0">' +
          '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '</sheetView></sheetViews>' +
        colsXml +
        '<sheetData>' + header + body + '</sheetData>' +
        '<autoFilter ref="A1:' + columnLetter(Math.max(columns.length - 1, 0)) + '1"/>' +
      '</worksheet>';
  }

  var STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="2">' +
        '<font><sz val="11"/><name val="等线"/></font>' +
        '<font><b/><sz val="11"/><name val="等线"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
        '<fill><patternFill patternType="none"/></fill>' +
        '<fill><patternFill patternType="gray125"/></fill>' +
        '<fill><patternFill patternType="solid"><fgColor rgb="FFEDF2F5"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
        '<border><left/><right/><top/><bottom/><diagonal/></border>' +
        '<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>' +
          '<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="2">' +
        '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
          '<alignment vertical="center"/></xf>' +
        '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
          '<alignment vertical="center"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function build(sheets) {
    if (!Array.isArray(sheets) || !sheets.length) throw new Error('至少需要一个工作表');
    var sheetNames = sheets.map(function (sheet, index) {
      return sheetNameSafe(sheet.name, index);
    });

    var files = [];
    function addFile(name, text) {
      files.push({ name: name, data: encodeUtf8(text) });
    }

    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (sheet, index) {
          return '<Override PartName="/xl/worksheets/sheet' + (index + 1) + '.xml" ' +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
        }).join('') +
      '</Types>';

    var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';

    var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets>' + sheets.map(function (sheet, index) {
          return '<sheet name="' + xmlEscape(sheetNames[index]) + '" sheetId="' + (index + 1) +
            '" r:id="rId' + (index + 1) + '"/>';
        }).join('') + '</sheets>' +
      '</workbook>';

    var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (sheet, index) {
          return '<Relationship Id="rId' + (index + 1) + '" ' +
            'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
            'Target="worksheets/sheet' + (index + 1) + '.xml"/>';
        }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) + '" ' +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    addFile('[Content_Types].xml', contentTypes);
    addFile('_rels/.rels', rootRels);
    addFile('xl/workbook.xml', workbook);
    addFile('xl/_rels/workbook.xml.rels', workbookRels);
    addFile('xl/styles.xml', STYLES_XML);
    sheets.forEach(function (sheet, index) {
      addFile('xl/worksheets/sheet' + (index + 1) + '.xml', sheetXml(sheet));
    });

    return zipStore(files);
  }

  function download(filename, sheets) {
    var bytes = build(sheets);
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  ERP.xlsx = {
    build: build,
    download: download
  };
})();
