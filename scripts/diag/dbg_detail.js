// dbg_detail.js — 带字段日志的登录详情序列化 (复制 buildLoginDetail 逻辑)
(function () {
  var V = window.__DLDL_VSERVER__;
  var save = V.save;
  var p = save.player;
  // 复制 writeOps 逻辑(从 vserver 源) — 简化版, 只走主体(从gold起), 记录每字段字节区间
  function reflectN(cls) { return V.reflect(cls); }
  var log = [];
  function mkSer() {
    return {
      bytes: [],
      u8: function (v) { this.bytes.push(v & 0xff); },
      i16: function (v) { v |= 0; this.bytes.push((v >>> 8) & 0xff, v & 0xff); },
      i32: function (v) { var u = BigInt(((v | 0) << 1) ^ (v >> 31) >>> 0); var out = []; var x = ((v | 0) << 1) ^ (v >> 31); x = x >>> 0; while (x >= 0x80) { out.push((x & 0x7f) | 0x80); x >>>= 7; } out.push(x); for (var i = 0; i < out.length; i++) this.bytes.push(out[i]); },
      l64: function (n) { n = BigInt(Math.floor(n || 0)); var z = (n < 0n) ? (((n * 2n) ^ 0xFFFFFFFFFFFFFFFFn) & 0xFFFFFFFFFFFFFFFFn) : ((n * 2n) & 0xFFFFFFFFFFFFFFFFn); var out = []; while (z >= 0x80n) { out.push(Number(z & 0x7fn) | 0x80); z >>= 7n; } out.push(Number(z)); for (var i = 0; i < out.length; i++) this.bytes.push(out[i]); },
      str: function (st) { if (st == null) { this.i32(0); return; } st = String(st); var out = unescape(encodeURIComponent(st)); this.i32(out.length); for (var j = 0; j < out.length; j++) this.bytes.push(out.charCodeAt(j) & 0xff); },
      boolean: function (b) { this.bytes.push(b ? 1 : 0); },
      f32: function () { this.bytes.push(0, 0, 0, 0); },
      beanNull: function () { this.bytes.push(0xff); },
      beanHead: function () { this.bytes.push(0); },
      arrNull: function () { this.bytes.push(0xff); },
      arrHead: function (n) { this.bytes.push(0); this.i32(n); }
    };
  }
  function writePrimitive(s, t, v) {
    if (t === 'int') s.i32(Number(v) || 0);
    else if (t === 'long') s.l64(Number(v) || 0);
    else if (t === 'string') s.str(String(v == null ? '' : v));
    else if (t === 'boolean') s.boolean(!!v);
    else if (t === 'byte') s.u8(Number(v) || 0);
    else if (t === 'short') s.i16(Number(v) || 0);
  }
  function defaultFor(name) { return null; }
  function writeOpsDbg(s, ops, ov, depth, label) {
    depth = depth || 0;
    for (var i = 0; i < ops.length; i++) {
      var it = ops[i];
      var st = s.bytes.length;
      var v = it.f ? ov[it.f] : undefined;
      if (it.op === 'mark') { s.u8(0); log.push((label || '') + (it.f || '@mark') + ' @' + st); continue; }
      if (it.op === 'int' || it.op === 'long') {
        var dv = (v !== undefined && v !== null) ? v : defaultFor(it.f);
        if (dv === null || dv === undefined) dv = 0;
        if (it.op === 'int') s.i32(dv); else s.l64(dv);
      } else if (it.op === 'short') { s.i16(v !== undefined ? v : 0); }
      else if (it.op === 'byte') { s.u8(v !== undefined ? v : 0); }
      else if (it.op === 'float') { s.f32(v || 0); }
      else if (it.op === 'boolean') { s.boolean(v !== undefined ? v : false); }
      else if (it.op === 'string') { s.str(v !== undefined ? v : ''); }
      else if (it.op === 'double') { s.l64(v || 0); }
      else if (it.op === 'bean') {
        if (v === null) { s.beanNull(); log.push((label || '') + (it.f || '?') + ' @' + st + '-' + s.bytes.length + ' NULL'); continue; }
        var beanCls = it.args[0];
        var bops = (beanCls && typeof beanCls === 'string') ? reflectN(beanCls.replace(/"/g, '')) : null;
        s.beanHead();
        if (bops) writeOpsDbg(s, bops, v || {}, depth + 1, (it.f || '?') + '.');
        log.push((label || '') + (it.f || '?') + ' @' + st + '-' + s.bytes.length + ' bean(' + (bops ? bops.length : '?') + 'ops)');
      } else if (it.op === 'array') {
        if (v && v.__raw) { for (var ri = 0; ri < v.__raw.length; ri++) s.u8(v.__raw[ri]); log.push((label || '') + (it.f || '?') + ' @' + st + '-' + s.bytes.length + ' raw'); continue; }
        if (v === null) { s.arrNull(); log.push((label || '') + (it.f || '?') + ' @' + st + ' NULL'); continue; }
        var arr = v || [];
        s.arrHead(arr.length);
      } else if (it.op === 'object' || it.op === 'dif' || it.op === 'nest') {
        var o = v;
        if (o && o.__raw) { for (var ri = 0; ri < o.__raw.length; ri++) s.u8(o.__raw[ri]); log.push((label || '') + (it.f || '?') + ' @' + st + '-' + s.bytes.length + ' raw'); continue; }
        if (o === null || o === undefined) { s.u8(0xff); log.push((label || '') + (it.f || '?') + ' @' + st + ' NULL'); continue; }
        var keys = Object.keys(o);
        s.u8(0); s.i32(keys.length);
        var isDifBean = (it.op === 'dif') && (String(it.args[3] || '').replace(/"/g, '') === 'bean');
        for (var ki = 0; ki < keys.length; ki++) {
          var kv = keys[ki];
          var kt = (it.args[0] || 'int').replace(/"/g, '');
          writePrimitive(s, kt, kv);
          var vv = o[kv];
          if (isDifBean) {
            if (vv === null || vv === undefined) { s.u8(0xff); continue; }
            s.u8(0); s.i32((vv && vv.typeId) || 10); s.u8(0);
            var iops = reflectN('com.protocol.bag.bean.Item');
            if (iops) writeOpsDbg(s, iops, vv, depth + 1, 'item' + kv + '.');
          } else {
            var vt = (it.args[2] || it.args[1] || 'int').replace(/"/g, '');
            writePrimitive(s, vt, vv);
          }
        }
        log.push((label || '') + (it.f || '?') + ' @' + st + '-' + s.bytes.length + ' ' + it.op + '(' + keys.length + ')');
      } else if (it.item) {
        // 手写循环条目: 跳过(主体没有)
      }
    }
  }
  // 主体 ov (复制 buildLoginDetail)
  var ov = {
    gold: save.gold, coin: save.coin, bing: save.bing, jin: save.jin,
    soulForce: save.soulForce,
    integral: 0, contribute: 0, elementExp: 0,
    magicHerbDust: 0, hunHePiece: 0, coreItemSoul: 0, huntingCoin: 0,
    soulMonPiece: 0, divinityCenterScore: 0, gsExp: 0, gtExp: 0,
    dragonSoulPiece: 0, horseUpDan: 0, spiderArmorPiece: 0, spiderCrystal: 0,
    spiderHolePiece: 0, angleRuneScore: 0, cultivationScore: 0,
    legendSoulCardPiece: 0, mostWeaponSoulItem: 0, electroluxRingScore: 0,
    spiritSeaScore: 0, douLuoNewBond: 0,
    isOpenGM: true,
    allianceId: null, allianceName: '', alliancePosition: 0,
    nickName: p.name,
    firstLogin: !save.firstLoginDone,
    teamPartnerIds: null,
    mainCityPosition: null,
    vipInfo: {},
    newcomerGuideIDs: { __raw: [0xff] },
    goods: (function () {
      var bag = save.bag || {}; var out = {};
      for (var k in bag) { if (!bag[k]) continue; out[k] = { typeId: 10, itemModeId: Number(k) || 0, num: bag[k], state: 0, present: 0, deprecatedTime: 0, trade: 0, createTime: 100, activityGain: 0, isSelfCreate: false, onlyId: 9000000000 + Number(k) }; }
      return out;
    })(),
    equips: [], jewelInfo: {},
    tinyMailsInfo: {},
    equipGrids: 60, warehouseCount: 60, countryId: 0,
    expPoolInfo: {}, monthCardType: 0,
    openServerDay: 1, activity: 0,
    reconnectSign: 'rs_1',
    createAccountTime: p.createTime,
    countId: 'cnt_' + p.personId, showPlayerId: p.personId,
    allianceLevel: 0,
    fateAttribute: null,
    serverName: '单机离线服', orgServerName: '单机离线服',
    serverId: 1, orgServerId: 1, mergeStatus: 0, plat: '37wan'
  };
  var mops = reflectN('com.protocol.login.ResLoginPlayerDetailInfo');
  var startIdx = 0;
  for (var i = 0; i < mops.length; i++) if (mops[i].f === 'gold') { startIdx = i; break; }
  var s = mkSer();
  writeOpsDbg(s, mops.slice(startIdx), ov, 0, '');
  // 只输出 130 字节后的字段日志
  var out = [];
  for (var i = 0; i < log.length; i++) {
    var m = log[i].match(/@(\d+)/);
    if (m && parseInt(m[1]) >= 130) out.push(log[i]);
  }
  out.push('TOTAL: ' + s.bytes.length + ' bytes');
  return out.join('\n');
})()
