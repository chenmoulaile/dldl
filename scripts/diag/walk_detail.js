// walk_detail.js — 按 reading 真实序列走查 vserver 序列化的登录详情字节
(function () {
  var V = window.__DLDL_VSERVER__;
  var ser = V.buildLoginDetail(V.save);
  var b = ser.bytes;
  var pos = 0;
  function u8() { return b[pos++]; }
  function varint() {
    var r = 0, s = 0, by;
    do { by = b[pos++]; r |= (by & 0x7f) << s; s += 7; } while (by & 0x80 && pos <= b.length);
    return r >>> 0;
  }
  function i32() { var u = varint(); return (u >>> 1) ^ -(u & 1); }
  function i64() { var u = 0n, s = 0n, by; do { by = BigInt(b[pos++]); u |= (by & 0x7fn) << s; s += 7n; } while (by & 0x80n); return Number((u >> 1n) ^ (-(u & 1n) & 0xFFFFFFFFFFFFFFFFn)); }
  function str() { var n = i32(); pos += n; return 'str(' + n + ')'; }
  function arr(itype) { var m = u8(); if (m === 0xff) return 'null'; var n = i32(); for (var i = 0; i < n; i++) val(itype); return 'arr(' + n + ')'; }
  function dif(keyType, valType) {
    var m = u8(); if (m === 0xff) return 'null';
    var n = i32();
    for (var i = 0; i < n; i++) {
      val(keyType);
      if (valType === 'bean') { var pm = u8(); if (pm === 0xff) continue; var tid = i32(); var bm = u8(); beanFields(); }
      else val(valType);
    }
    return 'dif(' + n + ')';
  }
  var ItemFields = 10;
  function beanFields() {
    // 通用: 按 Item 的 10 字段 (itemModeId int, num int, state int, present int, deprecatedTime long, trade int, createTime long, activityGain int, isSelfCreate bool, onlyId long)
    i32(); i32(); i32(); i32(); i64(); i32(); i64(); i32(); u8(); i64();
  }
  function val(t) {
    if (t === 'int') i32();
    else if (t === 'long') i64();
    else if (t === 'string') str();
    else if (t === 'boolean') u8();
    else if (t === 'bean') { var m = u8(); if (m !== 0xff) beanFields(); }
  }
  // 主体字段表 (从 gold 开始): [name, type]
  var Cls = Laya.__classmap['com.protocol.login.ResLoginPlayerDetailInfo'];
  var src = Cls.prototype.reading.toString();
  var re = /this\.(\w+)\s*=\s*this\.(read\w+)\(([^)]*)\)/g;
  var fields = [];
  var m;
  while ((m = re.exec(src))) fields.push({ f: m[1], op: m[2], args: m[3] });
  var startIdx = 0;
  for (var i = 0; i < fields.length; i++) if (fields[i].f === 'gold') { startIdx = i; break; }
  var out = [];
  for (var i = startIdx; i < fields.length; i++) {
    var fl = fields[i];
    var st = pos;
    var desc = '';
    try {
      if (fl.op === 'readInt') { var v = i32(); desc = v; }
      else if (fl.op === 'readLong') { var v = i64(); desc = v; }
      else if (fl.op === 'readString') desc = str();
      else if (fl.op === 'readBoolean') desc = u8();
      else if (fl.op === 'readByte') desc = u8();
      else if (fl.op === 'readBean') { var mk = u8(); desc = mk === 0xff ? 'null' : (mk === 0 ? 'bean(default)' : 'mark' + mk); if (mk === 0) { /* 无法通用走bean, 记录*/ } }
      else if (fl.op === 'readArray') desc = arr('int');
      else if (fl.op === 'readObject') { var mk = u8(); desc = mk === 0xff ? 'null' : 'obj(' + i32() + ')'; if (mk !== 0xff) { /* keys 剩余未走 */ } }
      else if (fl.op === 'readDifObject') {
        var args = fl.args.split(',').map(function (x) { return x.trim().replace(/"/g, ''); });
        var kt = args[0] || 'int', vt = args[3] || '';
        desc = dif(kt, vt === 'bean' ? 'bean' : (args[1] || 'int'));
      }
      else desc = '?';
      out.push(fl.f + ' @' + st + '-' + pos + ' = ' + desc);
      if (pos > b.length) { out.push('!! OVERFLOW'); break; }
    } catch (e) {
      out.push(fl.f + ' @' + st + ' THROW: ' + e.message);
      break;
    }
  }
  out.push('TOTAL: walked ' + pos + ' / ' + b.length);
  return out.join('\n');
})()
