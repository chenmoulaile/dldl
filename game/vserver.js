/**
 * vserver.js v2 — 斗罗大陆H5 完整离线虚拟服务器
 * ----------------------------------------------------------------
 * v2 目标: 完全单机化
 *   - 运行时反射: 解析客户端消息类 reading() → 自动构造任意响应
 *   - 完整存档: 金币/钻石/等级/任务/剧情 全状态
 *   - 剧情推进: SoulRoad 故事线/任务状态机/武魂觉醒
 *   - GM 菜单: 金币/钻石/等级/加速
 *   - 假人系统: 主城游走 + 聊天 + 排行
 * 依赖: idmap.js (消息ID映射, 自动生成)
 */
(function () {
    if (window.__DLDL_VSERVER__) return;
    var V = window.__DLDL_VSERVER__ = {
        version: '2.0',
        log: [], handler: null, state: 'idle',
        save: null, fakePlayers: [], fakeTimer: 0, chatTimer: 0,
        schemaCache: {}, autoReply: {}, stats: {in: 0, out: 0, unhandled: {}},
        debug: true
    };

    function log() {
        var a = Array.prototype.slice.call(arguments);
        a.unshift('[vserver]');
        console.log.apply(console, a);
        V.log.push(a.join(' '));
        if (V.log.length > 800) V.log.shift();
    }

    function waitClass(name, cb, tries) {
        tries = tries || 0;
        if (window.Laya && Laya.__classmap && Laya.__classmap[name]) { cb(Laya.__classmap[name]); return; }
        if (tries > 1200) { log('等待类超时:', name); return; }
        setTimeout(function () { waitClass(name, cb, tries + 1); }, 100);
    }

    // ═══════════════ 存档 v2 ═══════════════
    var SAVE_KEY = 'dldl_save_v2';
    function defaultSave() {
        return {
            account: 'player' + Math.floor(1000 + Math.random() * 9000),
            player: null,           // {personId,name,job,sex,level,exp,mapId,soulId,...}
            gold: 10000,            // 金币 (正常初始)
            coin: 0,                // 钻石(充值)
            bing: 0, jin: 0,        // 绑钻/元宝
            soulForce: 0,           // 魂力
            firstLoginDone: false,
            tasks: {},              // 任务状态 {taskId: {status, progress}}
            story: {chapter: 1, soulRoadId: 0},  // 剧情进度
            bag: {},                // 背包 {itemId: count}
            flags: {}               // 杂项开关
        };
    }
    function loadSave() {
        try {
            var s = window.localStorage.getItem(SAVE_KEY);
            if (s) {
                var o = JSON.parse(s); var d = defaultSave(); for (var k in d) if (!(k in o)) o[k] = d[k];
                // 迁移: 老存档无 doneIds 时按主线链回填
                if (o.story && o.story.curTaskId && (!o.story.doneIds || !o.story.doneIds.length)) {
                    o.story.doneIds = [];
                    var CHAIN = [200001, 200002, 200003, 200004, 200005, 200006, 200007, 200008, 200009, 200010,
                        200011, 200012, 200013, 200014, 200015, 200016, 200017, 200018, 200019, 200020];
                    for (var i = 0; i < CHAIN.length; i++) {
                        if (CHAIN[i] == o.story.curTaskId) break;
                        o.story.doneIds.push(CHAIN[i]);
                    }
                }
                return o;
            }
        } catch (e) { }
        return defaultSave();
    }
    function persist() {
        try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(V.save)); } catch (e) { log('存档失败', e); }
    }

    // ═══════════════ 序列化助手 (Bean规范: varint+zigzag) ═══════════════
    function zz32(v) { v = v | 0; return ((v << 1) ^ (v >> 31)) >>> 0; }
    function varintBytes(u) {
        u = BigInt(u);
        var out = [];
        while (u >= 0x80n) { out.push(Number(u & 0x7fn) | 0x80); u >>= 7n; }
        out.push(Number(u));
        return out;
    }
    function Ser() { this.bytes = []; }
    Ser.prototype.u8 = function (v) { this.bytes.push(v & 0xff); return this; };
    Ser.prototype.i32 = function (v) { var b = varintBytes(zz32(v)); for (var i = 0; i < b.length; i++) this.bytes.push(b[i]); return this; };
    Ser.prototype.i16 = function (v) { v = v | 0; this.bytes.push((v >>> 8) & 0xff, v & 0xff); return this; };
    Ser.prototype.l64 = function (n) {
        n = BigInt(Math.floor(n || 0));
        var z = (n < 0n) ? (((n * 2n) ^ 0xFFFFFFFFFFFFFFFFn) & 0xFFFFFFFFFFFFFFFFn) : ((n * 2n) & 0xFFFFFFFFFFFFFFFFn);
        var b = varintBytes(z);
        for (var i = 0; i < b.length; i++) this.bytes.push(b[i]);
        return this;
    };
    Ser.prototype.str = function (s) {
        if (s == null) { this.i32(0); return this; }
        s = String(s);
        var out = unescape(encodeURIComponent(s));
        this.i32(out.length);
        for (var j = 0; j < out.length; j++) this.bytes.push(out.charCodeAt(j) & 0xff);
        return this;
    };
    Ser.prototype.boolean = function (b) { this.u8(b ? 1 : 0); return this; };
    Ser.prototype.f32 = function (v) {
        var buf = new ArrayBuffer(4);
        new DataView(buf).setFloat32(0, Number(v) || 0, false); // 大端
        var a = new Uint8Array(buf);
        for (var i = 0; i < 4; i++) this.bytes.push(a[i]);
        return this;
    };
    Ser.prototype.beanNull = function () { this.u8(0xff); return this; };
    Ser.prototype.beanHead = function () { this.u8(0); return this; };
    Ser.prototype.arrNull = function () { this.u8(0xff); return this; };
    Ser.prototype.arrHead = function (n) { this.u8(0); this.i32(n); return this; };

    function Par(u8arr) { this.d = u8arr; this.p = 0; }
    Par.prototype.varint = function () {
        var r = 0, s = 0, b;
        do { b = this.d[this.p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
        return r >>> 0;
    };
    Par.prototype.i32 = function () { var u = this.varint(); return (u >>> 1) ^ -(u & 1); };
    Par.prototype.u8 = function () { return this.d[this.p++]; };
    Par.prototype.i16 = function () { var v = (this.d[this.p] << 8) | this.d[this.p + 1]; this.p += 2; return v; };
    Par.prototype.l64 = function () {
        var u = 0n, s = 0n, b;
        do { b = this.d[this.p++]; u |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80);
        return Number((u >> 1n) ^ (-(u & 1n) & 0xFFFFFFFFFFFFFFFFn));
    };
    Par.prototype.str = function () {
        var n = this.i32();
        if (n <= 0) return '';
        var s = '';
        for (var i = 0; i < n; i++) s += String.fromCharCode(this.d[this.p + i]);
        this.p += n;
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    };

    // ═══════════════ 消息 ID 表 ═══════════════
    var IDMAP = window.__DLDL_IDMAP__ || {};
    // 同ID冲突修正 (以客户端 MessagePool.registerMsg 实际注册为准)
    IDMAP[-1607] = 'SM_Task_Info';
    var P2N = window.__DLDL_PROTO2NAME__ || {};
    var ID = {
        REQ_LOGIN_37APP: -1122, REQ_LOGIN_MESSAGE: -1101,
        RES_LOGIN_LIST: -1102, REQ_SELECT_PLAYER: -1103, CM_CREATE_PLAYER: -1104,
        RES_LOGIN_SUCCESS: -1105, RES_LOGIN_DETAIL: -1107, RES_LOGIN_FAIL: -1108,
        SM_HEARTBEAT: -1113, CM_HEARTBEAT: -1005,
        SM_UPDATE_RECONNECT_KEY: -1128,
        RES_COIN_GOLD_UPDATE: -1006,
        CM_ENTER_MAINCITY: -3601, CM_QUIT_MAINCITY: -3602, CM_PLAYER_MOVE: -3603,
        SM_PLAYER_UPDATE: -3604, SM_PLAYER_CANSEE: -3605, SM_PLAYER_MOVE: -3606,
        SM_TASK_INFO: -1607,
        CM_CHOOSE_SOUL: -9701, SM_CHOOSE_SOUL_SUCCESS: -9702,
        SM_WSOUL_OBJ_UPDATE: -9710,
    };

    // ═══════════════ 反射引擎 ═══════════════
    // 解析 reading().toString() → 线性 wire 操作序列
    var READ_OPS = 'readByte|readShort|readInt|readLong|readString|readBoolean|readDouble|readFloat|readBean1|readBean|readArray|readObject|readDifObject|readNestObject';
    var RE_NAMED = new RegExp('this\\.(\\w+)\\s*=\\s*this\\.(' + READ_OPS + ')\\(\\s*([^)]*)\\)', 'g');
    // 无名/临时变量读取: 排除 this.xxx= 形式(前面是 . 或字母)
    var RE_TEMP = new RegExp('(?<![.\\w])(?:var\\s+)?(\\w+)\\s*=\\s*this\\.(readByte|readShort|readInt|readLong|readString|readBoolean|readDouble|readBean1|readBean)\\(', 'g');
    var RE_MARK = /-1\s*[!=]=\s*this\.readByte\(\)/g;
    var OP_MAP = { readByte: 'byte', readShort: 'short', readInt: 'int', readLong: 'long', readString: 'string',
        readBoolean: 'boolean', readDouble: 'double', readFloat: 'float', readBean1: 'bean', readBean: 'bean', readArray: 'array',
        readObject: 'object', readDifObject: 'dif', readNestObject: 'nest' };
    var RE_PUSH = new RegExp('this\\.(\\w+)\\.push\\(this\\.(readBean|readInt|readLong|readString|readShort|readByte|readBoolean|readArray)\\(\\s*([^)]*)\\)', 'g');

    function parseArgs(argstr) {
        argstr = (argstr || '').trim();
        if (!argstr) return [];
        return argstr.split(',').map(function (a) { return a.trim(); });
    }

    // 短类名 → 完整proto路径 映射 (惰性: 首次reflect时classmap已就绪)
    var SHORT2PROTO = null;
    function short2proto(short) {
        if (SHORT2PROTO === null) {
            SHORT2PROTO = {};
            if (window.Laya && Laya.__classmap) {
                for (var key in Laya.__classmap) {
                    var s = key.split('.').pop();
                    if (!SHORT2PROTO[s]) SHORT2PROTO[s] = key;
                }
            }
        }
        return SHORT2PROTO[short];
    }

    function reflect(clsName) {
        if (V.schemaCache[clsName]) return V.schemaCache[clsName];
        var cls = (window.Laya && Laya.__classmap) ? (Laya.__classmap[clsName] || Laya.__classmap[short2proto(clsName)]) : null;
        if (!cls || !cls.prototype || typeof cls.prototype.reading !== 'function') return null;
        var src;
        try { src = cls.prototype.reading.toString(); } catch (e) { return null; }
        var ops = [], m;
        RE_NAMED.lastIndex = 0;
        while ((m = RE_NAMED.exec(src))) {
            ops.push({ at: m.index, op: OP_MAP[m[2]] || m[2], f: m[1], args: parseArgs(m[3]) });
        }
        RE_TEMP.lastIndex = 0;
        while ((m = RE_TEMP.exec(src))) {
            if (m[1] === 'this') continue;
            ops.push({ at: m.index, op: OP_MAP[m[2]] || m[2], f: null, args: [] });
        }
        RE_MARK.lastIndex = 0;
        while ((m = RE_MARK.exec(src))) ops.push({ at: m.index, op: 'mark', f: null, args: [] });
        RE_PUSH.lastIndex = 0;
        while ((m = RE_PUSH.exec(src))) {
            ops.push({ at: m.index, op: OP_MAP[m[2]] || m[2], f: null, item: true, arrf: m[1], args: parseArgs(m[3]) });
        }
        ops.sort(function (a, b) { return a.at - b.at; });
        V.schemaCache[clsName] = ops;
        if (V.debug && ops.length === 0) log('反射空schema:', clsName);
        return ops;
    }

    // ═══════════════ 智能默认值 ═══════════════
    function defaultFor(name, op, ctx) {
        var p = V.save && V.save.player;
        switch (name) {
            case 'playerName': case 'nickName': return p ? p.name : '玩家';
            case 'personId': case 'playerId': case 'ownPlayerId': case 'showPlayerId': return p ? p.personId : 10001;
            case 'level': return p ? p.level : 1;
            case 'job': return p ? p.job : 1;
            case 'sex': return p ? p.sex : 1;
            case 'gold': return V.save ? V.save.gold : 0;
            case 'coin': return V.save ? V.save.coin : 0;
            case 'serverName': case 'orgServerName': return '单机离线服';
            case 'tmpVipLv': case 'vipLv': return 0;
            case 'mapId': return p ? p.mapId : 90012;
        }
        if (/time$/i.test(name) && (op === 'int' || op === 'long')) return Math.floor(Date.now() / 1000);
        if (/^is|^has|^can|^open|^show|^need/i.test(name) && op === 'boolean') return false;
        return null; // 按类型默认
    }

    // ═══════════════ 通用 writer ═══════════════
    // ov: {字段名: 值}; 特殊: __items 数组(列表循环体), null → beanNull
    function writeOps(s, ops, ov, depth) {
        ov = ov || {}; depth = depth || 0;
        for (var i = 0; i < ops.length; i++) {
            var it = ops[i];
            var v = it.f ? ov[it.f] : undefined;
            if (it.op === 'mark') { s.u8(0); continue; }
            if (it.op === 'int' || it.op === 'long') {
                var dv = (v !== undefined && v !== null) ? v : defaultFor(it.f, it.op);
                if (dv === null || dv === undefined) dv = 0;
                if (it.op === 'int') s.i32(dv); else s.l64(dv);
            } else if (it.op === 'short') { s.i16(v !== undefined ? v : 0); }
            else if (it.op === 'byte') { s.u8(v !== undefined ? v : 0); }
            else if (it.op === 'float') { s.f32(v || 0); }
            else if (it.op === 'boolean') { s.boolean(v !== undefined ? v : false); }
            else if (it.op === 'string') { s.str(v !== undefined ? v : (defaultFor(it.f, 'string') || '')); }
            else if (it.op === 'double') { s.l64(v || 0); }
            else if (it.op === 'bean') {
                if (v && v.__raw) { for (var ri = 0; ri < v.__raw.length; ri++) s.u8(v.__raw[ri]); continue; }
                if (v === null) { s.beanNull(); continue; }
                var beanCls = it.args[0];
                var bops = (beanCls && typeof beanCls === 'string') ? reflect(beanCls) : null;
                s.beanHead();
                if (bops) writeOps(s, bops, v || {}, depth + 1);
                else if (v && typeof v === 'object') { /* 无schema bean: 空 */ }
            } else if (it.op === 'array') {
                if (v && v.__raw) { for (var ri = 0; ri < v.__raw.length; ri++) s.u8(v.__raw[ri]); continue; }
                if (v === null) { s.arrNull(); continue; }
                var arr = v || [];
                s.arrHead(arr.length);
                for (var k = 0; k < arr.length; k++) writeItem(s, it.args, arr[k], depth);
            } else if (it.op === 'object' || it.op === 'dif' || it.op === 'nest') {
                var o = v;
                if (o && o.__raw) { for (var ri = 0; ri < o.__raw.length; ri++) s.u8(o.__raw[ri]); continue; }
                if (o === null || o === undefined) { s.u8(0xff); continue; }
                var keys = Object.keys(o);
                s.u8(0); s.i32(keys.length);
                var isDifBean = (it.op === 'dif') && (String(it.args[3] || '').replace(/"/g, '') === 'bean');
                for (var ki = 0; ki < keys.length; ki++) {
                    var kv = keys[ki];
                    var kt = (it.args[0] || 'int').replace(/"/g, '');
                    writePrimitive(s, kt, kv);
                    var vv = o[kv];
                    if (isDifBean) {
                        // dif→bean: [present][typeId][beanMark][fields]
                        if (vv === null || vv === undefined) { s.u8(0xff); continue; }
                        s.u8(0);
                        s.i32((vv && vv.typeId) || 10);   // 默认 Item
                        s.u8(0);
                        var iops = reflect('com.protocol.bag.bean.Item');
                        if (iops) writeOps(s, iops, vv, depth + 1);
                    } else {
                        var vt = (it.args[2] || it.args[1] || 'int').replace(/"/g, '');
                        if (vt === 'bean') {
                            var vc = (it.op === 'dif') ? (it.args[4] || '') : (it.args[3] || '');
                            var vops = reflect(vc);
                            if (vops) { s.beanHead(); writeOps(s, vops, vv || {}, depth + 1); }
                            else s.beanNull();
                        } else writePrimitive(s, vt, vv);
                    }
                }
            } else if (it.item) { // 手写循环体条目
                writeItem(s, it.args, v, depth);
            }
        }
    }
    function writePrimitive(s, t, v) {
        if (t === 'int') s.i32(Number(v) || 0);
        else if (t === 'long') s.l64(Number(v) || 0);
        else if (t === 'string') s.str(String(v == null ? '' : v));
        else if (t === 'boolean') s.boolean(!!v);
        else if (t === 'byte') s.u8(Number(v) || 0);
        else if (t === 'short') s.i16(Number(v) || 0);
    }
    function writeItem(s, args, item, depth) {
        var t = (args[0] || 'int').replace(/"/g, '');
        if (t === 'bean') {
            var cls = args[1];
            var ops = (cls && typeof cls === 'string') ? reflect(cls) : null;
            if (item === null) { s.beanNull(); }
            else {
                s.beanHead();
                if (ops) writeOps(s, ops, item || {}, depth + 1);
            }
        } else writePrimitive(s, t, item);
    }

    // 按消息类名构造响应
    function writeAuto(clsName, ov) {
        var ops = reflect(clsName);
        if (!ops) { log('!! 无schema:', clsName); return null; }
        var s = new Ser();
        writeOps(s, ops, ov || {});
        return s;
    }

    // ═══════════════ 注入 ═══════════════
    function inject(handler, msgId, bodySer) {
        if (!bodySer) return;
        try {
            var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
            var ba = new ByteArray();
            var arr = bodySer.bytes;
            for (var i = 0; i < arr.length; i++) ba.writeByte(arr[i] & 0xff);
            ba.position = 0;
            var self = handler;
            setTimeout(function () {
                try {
                    ba.position = 0; ba._position_ = 0;
                    if (self && self._receiveFun) {
                        self._receiveFun.runWith([msgId, ba]);
                        V.stats.out++;
                        if (V.debug) log('S→C -' + msgId.toString().replace('-', '') + ' ' + (IDMAP[msgId] || '?') + ' (' + arr.length + 'B)');
                    }
                } catch (e) {
                    log('注入异常 id=' + msgId, e && e.message, '读pos=' + (ba._position_ !== undefined ? ba._position_ : '?') + '/' + arr.length, (e && e.stack || '').substring(0, 500));
                }
            }, 20 + Math.floor(Math.random() * 50));
        } catch (e) { log('注入失败 id=' + msgId, e && e.message); }
    }

    // ═══════════════ 假人系统 v2 ═══════════════
    var FAKE_NAMES = ['唐三', '小舞', '戴沐白', '朱竹清', '马红俊', '宁荣荣', '奥斯卡',
        '剑斗罗', '千仞雪', '比比东', '唐昊', '波塞西', '独孤博', '风清扬', '萧炎',
        '林动', '牧尘', '洛璃', '药老', '云韵', '海神唐三', '修罗神', '千道流',
        '尘心', '玉小刚', '弗兰德', '赵无极', '柳二龙', '叶泠泠', '泰坦', '牛皋',
        '白鹤', '杨无敌', '蛇矛斗罗', '刺豚斗罗', '鬼斗罗', '菊斗罗', '骨斗罗',
        '毒斗罗', '昊天斗罗', '啸天斗罗', '圣龙斗罗', '剑道尘心', '圣女胡列娜',
        '焱', '邪月', '降魔斗罗', '擎天斗罗'];
    var CHAT_LINES = [
        '有人一起刷魂环吗？', '这游戏居然还有人玩，爷青回', '刚升到30级，舒服',
        '出金魂环了哈哈哈', '新手求带', '主城见', '今晚八点团战来人',
        '单机版牛啊，还能看见这么多人', '武魂觉醒选哪个好？', '蓝银草才是真爱',
        '卖号了卖号了', '求个师傅', '这剧情看得我泪目', '斗罗大陆永不过时',
        '昨天抽到昊天锤了', '有没有公会收人？', '大佬们求组队刷本',
        '这服务器延迟好低', '回归玩家报道', '一区老大路过'];
    var JOBS = [1, 2, 3, 4, 5, 6, 7];

    // 主城出生点附近 (玩家实际出生 3525,2825)
    var CITY_BORN = { x: 3525, y: 2825 };
    function mkFake(pid, idx) {
        var name = FAKE_NAMES[idx % FAKE_NAMES.length];
        if (idx >= FAKE_NAMES.length) name += Math.floor(idx / FAKE_NAMES.length);
        return {
            playerId: pid, playerName: name, job: JOBS[idx % JOBS.length],
            sex: (idx % 2) + 1, level: 20 + (idx * 13) % 230,
            fightPower: 50000 + idx * 41333,
            x: CITY_BORN.x - 700 + ((idx * 173) % 1400),
            y: CITY_BORN.y - 500 + ((idx * 291) % 1000),
            allianceName: idx % 3 === 0 ? '史莱克学院' : (idx % 3 === 1 ? '武魂殿' : ''),
            titleId: 0, horseId: idx % 5,
            vx: (idx % 2 ? 1 : -1) * (1 + idx % 3), vy: (idx % 3 ? 1 : -1) * (1 + idx % 2)
        };
    }
    function initFakePlayers() {
        V.fakePlayers = [];
        var n = 18 + Math.floor(Math.random() * 10);
        for (var i = 0; i < n; i++) V.fakePlayers.push(mkFake(900000 + i * 13, i));
    }

    // ═══════════════ 手写响应 (关键流程) ═══════════════
    function buildLoginList(save) {
        var s = new Ser();
        s.u8(0);
        if (save.player) {
            s.i32(1);
            s.l64(save.player.personId).str(save.player.name).i32(save.player.job)
                .i32(save.player.level).i32(0).l64(save.player.exp || 0).i32(0).i32(0).i32(0).i32(save.player.sex);
        } else s.i32(0);
        s.i32(3).i32(0).i32(save.gold);   // vipLv=0, achievePoint, gold
        return s;
    }

    function buildLoginSuccess(save) {
        var s = new Ser();
        s.i32(save.player.mapId).i32(save.player.soulId || 0).l64(save.player.personId);
        return s;
    }

    // 登录详情: 用反射自动对齐 107 字段 (杜绝手工错位)
    // 构造背包 dif 数据 (int→bean ITEM_MAP): 每项 {typeId, itemModeId, num...}
    function buildBagDif() {
        var bag = (V.save && V.save.bag) || {};
        var out = {};
        for (var k in bag) {
            if (!bag[k]) continue;
            out[k] = {
                typeId: 10, itemModeId: Number(k) || 0, num: bag[k],
                state: 0, present: 0, deprecatedTime: 0, trade: 0,
                createTime: Math.floor(Date.now() / 1000), activityGain: 0,
                isSelfCreate: false, onlyId: 9000000000 + Number(k)
            };
        }
        return out;
    }
    function buildLoginDetail(save) {
        var p = save.player;
        var ov = {
            // 列表 (PlayerDetailBean 数组)
            // 主体货币
            gold: save.gold, coin: save.coin, bing: save.bing, jin: save.jin,
            soulForce: save.soulForce,
            integral: 0, contribute: 0, elementExp: 0,
            magicHerbDust: 0, hunHePiece: 0, coreItemSoul: 0, huntingCoin: 0,
            soulMonPiece: 0, divinityCenterScore: 0, gsExp: 0, gtExp: 0,
            dragonSoulPiece: 0, horseUpDan: 0, spiderArmorPiece: 0, spiderCrystal: 0,
            spiderHolePiece: 0, angleRuneScore: 0, cultivationScore: 0,
            legendSoulCardPiece: 0, mostWeaponSoulItem: 0, electroluxRingScore: 0,
            spiritSeaScore: 0, douLuoNewBond: 0,
            isOpenGM: true,             // 保留 GM 开关(菜单需要)
            allianceId: null, allianceName: '', alliancePosition: 0,
            nickName: p.name,
            firstLogin: !save.firstLoginDone,
            teamPartnerIds: null,
            mainCityPosition: null,
            vipInfo: {},                 // 反射默认 → tmpVipLv=0 ✓
            newcomerGuideIDs: null,
            newcomerGuideIDs: { __raw: [0xff] },       // null 数组(1字节); 旧版[ff,00]靠goods=null的dif吸收多余字节,现改为纯null
            goods: buildBagDif(), equips: [], jewelInfo: {},
            tinyMailsInfo: { __raw: [0x00, 0x00, 0x00] },  // 手写循环bean: [beanMark][mapMark][count=0] 共3字节!
            equipGrids: 60, warehouseCount: 60, countryId: 0,
            expPoolInfo: {}, monthCardType: 0,
            openServerDay: 1, activity: 0,
            reconnectSign: 'rs_' + Date.now(),
            createAccountTime: p.createTime,
            countId: 'cnt_' + p.personId, showPlayerId: p.personId,
            allianceLevel: 0,
            fateAttribute: null,
            serverName: '单机离线服', orgServerName: '单机离线服',
            serverId: 1, orgServerId: 1, mergeStatus: 0, plat: '37wan'
        };
        // 列表字段(list)是手写循环: mark+count+PlayerDetailBean
        var s = new Ser();
        var ops = reflect('com.protocol.login.bean.PlayerDetailBean');
        s.u8(0).i32(1);       // 标记 + 数量1
        s.beanHead();
        var pov = {
            personId: p.personId, playerName: p.name, job: p.job, level: p.level,
            exp: p.exp || 0, transferJob: 0, rebirthLv: 0,
            // 战斗属性 (客户端本地计算战斗): MAXHP=6,ATK=9,DEFENSE=15,HIT=18,DODGE=19,ATTACKSPEED=16,RUNSPEED=25
            attributeVo: {
                attribute: (function (lv) {
                    return {
                        6: 1000 + lv * 800,       // MAXHP
                        9: 80 + lv * 60,          // ATK
                        15: 40 + lv * 30,         // DEFENSE
                        18: 60 + lv * 6,          // HIT
                        19: 15 + lv * 3,          // DODGE
                        16: 800,                  // ATTACKSPEED
                        25: 300,                  // RUNSPEED
                        22: 5                     // PERFECTATTACK
                    };
                })(p.level || 1),
                attributeBuff: {}
            },
            skillVo: {}, buffEffectsVo: null, fruitObj: null,
            jobType: 0, taskEntry: null, expiredTime: 0,
            battleScore: p.battleScore || 0, starLv: 0,
            createTime: p.createTime, elementInfo: null, wSoulInfo: { playerSoulInfo: {} },   // 空 map (action 需非null)
            sex: p.sex, souNum: 0, ownPlayerId: p.personId,
            magicHerbInfo: {}, skinId: 0, hunheInfoVO: {},
            appearVO: null, fightArmorVo: null, godTablePlayerInfoVO: null
        };
        if (ops) writeOps(s, ops, pov);
        // 主体
        var mops = reflect('com.protocol.login.ResLoginPlayerDetailInfo');
        if (mops) {
            // 跳过 list 部分(已写), 从 gold 开始
            var startIdx = 0;
            for (var i = 0; i < mops.length; i++) if (mops[i].f === 'gold') { startIdx = i; break; }
            writeOps(s, mops.slice(startIdx), ov);
        }
        return s;
    }

    function buildHeartbeat() {
        var s = new Ser();
        s.i32(Math.floor(Date.now() / 1000));
        return s;
    }

    function writeEquipInfo(s, f) {
        s.beanHead();
        s.l64(f.playerId).str(f.playerName).i32(f.job).l64(f.fightPower);
        s.arrNull();
        s.beanHead().i32(f.x).i32(f.y);
        s.str(f.allianceName).u8(0).i32(f.titleId);
        s.l64(Math.floor(Date.now() / 1000));
        s.i32(0).i32(0).i32(0).i32(f.level).i32(f.horseId);
        s.beanNull();
        s.i32(f.sex).i32(0).i32(0);
        s.beanNull().beanNull();
    }
    function buildCanSee() {
        var s = new Ser();
        var list = V.fakePlayers;
        s.u8(0).i32(list.length);
        for (var i = 0; i < list.length; i++) writeEquipInfo(s, list[i]);
        return s;
    }
    function buildPlayerMove(f) {
        var s = new Ser();
        s.l64(f.playerId).i16(f.x).i16(f.y);
        return s;
    }

    // 货币变更推送
    function pushMoney(type, delta, isAdd, showTips) {
        var save = V.save;
        var total = 0;
        if (type === 1) { save.gold = Math.max(0, save.gold + (isAdd ? delta : -delta)); total = save.gold; }
        else if (type === 2) { save.coin = Math.max(0, save.coin + (isAdd ? delta : -delta)); total = save.coin; }
        else if (type === 3) { save.bing = Math.max(0, save.bing + (isAdd ? delta : -delta)); total = save.bing; }
        else if (type === 4) { save.jin = Math.max(0, save.jin + (isAdd ? delta : -delta)); total = save.jin; }
        persist();
        // type, long total(绝对值), bool positive(决定total符号,必须true), long changeValue, bool isAdd, bool showTips, int reasonId
        var s = new Ser();
        s.i32(type).l64(total).boolean(true).l64(delta).boolean(isAdd).boolean(showTips !== false).i32(0);
        inject(V.handler, ID.RES_COIN_GOLD_UPDATE, s);
    }

    // ═══════════════ 消息路由 ═══════════════
    var HANDLERS = {};

    HANDLERS[ID.REQ_LOGIN_37APP] = HANDLERS[ID.REQ_LOGIN_MESSAGE] = function (h, body, name) {
        log('登录请求, 账号:', V.save.account);
        _detailSent = false;
        V._detailSent = false;
        setTimeout(function () { inject(h, ID.RES_LOGIN_LIST, buildLoginList(V.save)); }, 350);
    };

    HANDLERS[ID.CM_CREATE_PLAYER] = function (h, body) {
        var par = new Par(body);
        var name = par.str(), job = par.i32(), sex = par.i32();
        log('创建角色:', name, 'job=', job, 'sex=', sex);
        // 清旧档换新角色
        var account = V.save.account;
        V.save = defaultSave();
        V.save.account = account;
        V.save.player = {
            personId: 10001, name: name, job: job || 1, sex: sex || 1,
            level: 1, exp: 0, mapId: 90012, soulId: 0,   // 觉醒地图
            createTime: Math.floor(Date.now() / 1000), battleScore: 0
        };
        persist();
        inject(h, ID.RES_LOGIN_LIST, buildLoginList(V.save));
    };

    HANDLERS[ID.REQ_SELECT_PLAYER] = function (h) {
        log('选择角色,进入游戏');
        inject(h, ID.RES_LOGIN_SUCCESS, buildLoginSuccess(V.save));
        setTimeout(function () { inject(h, ID.SM_TASK_INFO, buildTaskInfoSafe()); }, 150);
        V.save.firstLoginDone = true;
        persist();
        V.state = 'ingame';
        setTimeout(startGMMenu, 2500);
        // 兜底: 15s 后地图完成消息仍未到则强制推详情
        setTimeout(function () {
            if (!V._detailSent) { log('兜底推详情'); sendLoginDetail(); }
        }, 15000);
    };

    var _detailSent = false;
    function sendLoginDetail() {
        if (_detailSent) return;
        _detailSent = true;
        V._detailSent = true;
        inject(V.handler, ID.RES_LOGIN_DETAIL, buildLoginDetail(V.save));
    }

    // 客户端地图加载完成 → 推送角色详情
    HANDLERS[-1106] = function (h) {
        log('地图加载完成 → 推送详情');
        setTimeout(sendLoginDetail, 120);
        setTimeout(pushExploreTasks, 800);
        setTimeout(pushFunctionButtons, 1000);
        // 等级追赶: 按完成任务数补等级 (老存档兼容)
        (function () {
            var p = V.save.player;
            var dn = (V.save.story && V.save.story.doneIds) ? V.save.story.doneIds.length : 0;
            var should = Math.max(1, Math.min(dn, 15));
            if (p && p.level < should) {
                p.level = should; p.exp = 0; persist();
                var s = writeAuto('com.protocol.player.msg.ResLevelUpdateMessage',
                    { level: p.level, addexp: 0, exp: 0, personID: p.personId });
                if (s) setTimeout(function () { inject(V.handler, -1401, s); }, 1500);
                log('等级追赶 → Lv', p.level);
            }
        })();
    };

    // ══ 探索任务(剧情主线)系统 ══
    // 任务链由客户端配置表驱动(taskNextCondDef), 硬编码表仅作兜底
    var MAIN_CHAIN = [200001, 200002, 200003, 200004, 200005, 200006, 200007, 200008, 200009, 200010,
                      200011, 200012, 200013, 200014, 200015, 200016, 200017, 200018, 200019, 200020];
    // 从客户端配置读下一个任务ID (更准确, 覆盖全部75个任务)
    function getNextTaskId(taskId) {
        try {
            var MCls = window.Laya && Laya.__classmap && Laya.__classmap['com.game.exploreMission.model.ExploreMissModel'];
            if (MCls && MCls.ins) {
                var cfg = MCls.ins.getExploMissCfgById(taskId);
                if (cfg && cfg.taskNextCondDef && cfg.taskNextCondDef[0] && cfg.taskNextCondDef[0].nextIds && cfg.taskNextCondDef[0].nextIds.length) {
                    return cfg.taskNextCondDef[0].nextIds[0];
                }
            }
        } catch (e) { }
        var idx = MAIN_CHAIN.indexOf(taskId);
        return (idx >= 0 && idx < MAIN_CHAIN.length - 1) ? MAIN_CHAIN[idx + 1] : 0;
    }
    // 任务奖励: 读配置 firstTime (首通魂币), 无配置默认500
    function getTaskReward(taskId) {
        var gold = 500;
        try {
            var MCls = window.Laya && Laya.__classmap && Laya.__classmap['com.game.exploreMission.model.ExploreMissModel'];
            if (MCls && MCls.ins) {
                var cfg = MCls.ins.getExploMissCfgById(taskId);
                if (cfg && cfg.firstTime && cfg.firstTime > 0) gold = cfg.firstTime;
            }
        } catch (e) { }
        return gold;
    }
    function pushExploreTasks() {
        var st = V.save.story;
        // 当前任务: 已完成的下一个
        var curId = MAIN_CHAIN.indexOf(st.curTaskId) >= 0 ? st.curTaskId : st.curTaskId || MAIN_CHAIN[0];
        var done = (st.doneIds || []).slice(0, 200);
        if (done.indexOf(curId) >= 0) done.splice(done.indexOf(curId), 1);
        var ser = new Ser();
        ser.str('');                       // points
        ser.arrHead(1);                    // exploreTasks 数组1条
        ser.beanHead();
        ser.i32(curId).i32(st.progress || 0).i32(0).i32(0).i32(0).i32(0);  // TaskEntryVO
        ser.arrHead(0);                    // wasRewardIds 空
        ser.arrHead(done.length);          // completes: 已完成任务 → 客户端标记 taskStatu=1
        for (var i = 0; i < done.length; i++) ser.i32(done[i]);
        inject(V.handler, -1626, ser);
        log('推送探索任务 id=', curId, '已完成', done.length, '个');
    }
    // 任务完成 → 发奖励 + 下一任务
    function completeStoryTask(taskId) {
        var st = V.save.story;
        var gold = getTaskReward(taskId);
        var nextId = getNextTaskId(taskId);
        log('任务完成', taskId, '奖励魂币', gold, '下一任务', nextId);
        if (!st.doneIds) st.doneIds = [];
        if (st.doneIds.indexOf(taskId) < 0) st.doneIds.push(taskId);
        if (gold > 0) {
            V.save.gold = V.save.gold + gold;
            persist();
            // 推货币变化 (type 1 = gold/魂币)
            var s = new Ser();
            s.i32(1).l64(V.save.gold).boolean(true).l64(gold).boolean(true).boolean(true).i32(0);
            inject(V.handler, ID.RES_COIN_GOLD_UPDATE, s);
        }
        addExp(gold * 10);  // 任务经验 = 奖励的10倍 (快速成长)
        if (nextId && nextId > 0) {
            st.curTaskId = nextId;
            st.progress = 0;
        } else {
            st.progress = (st.progress || 0) + 1;
        }
        persist();
        setTimeout(pushExploreTasks, 250);
        setTimeout(pushFunctionButtons, 600);
    }
    // 完成探索任务 → 下一条
    HANDLERS[-1630] = function (h, body) {   // CM_Reward_Explor {taskId int}
        var par = new Par(body);
        var taskId = par.i32();
        log('完成探索任务(奖励线)', taskId);
        completeStoryTask(taskId);
    };
    HANDLERS[-1627] = function (h, body) {   // CM_Choose_Explor_Task {taskId, chooseId}
        var par = new Par(body);
        var taskId = par.i32(), chooseId = par.i32();
        log('任务选择/主线推进', taskId, '→', chooseId);
        V.save.story.chooseId = chooseId;
        persist();
        completeStoryTask(taskId);
    };

    // 切换地图: ReqSwitchMap {mapId} → ResSwitchMap {mapId}
    HANDLERS[-1201] = function (h, body) {
        var par = new Par(body);
        var mapId = par.i32();
        log('切图请求 mapId=', mapId);
        if (V.save.player) { V.save.player.mapId = mapId; persist(); }
        var s = new Ser();
        s.i32(mapId);
        inject(h, -1209, s);   // ResSwitchMap → SwitchMapControl.switchMapId(mapId)
        // 离开主城状态
        V.state = 'ingame';
    };

    // 地图加载完成 (ReqFinishMapLoad): 推送地图怪物/宝箱等 (留空即可)
    HANDLERS[-1210] = function (h) {
        log('地图加载完成 mapId=', V.save.player ? V.save.player.mapId : '?');
        // 重推当前任务 (切图后任务UI可能需要刷新)
        setTimeout(pushExploreTasks, 300);
        setTimeout(pushFunctionButtons, 500);
    };

    // ══ 顶栏功能按钮开放 (SM_FunctionButtonOpen) ══
    function pushFunctionButtons() {
        try {
            var B = Laya.__classmap['com.Light37.ResourceSystem.data.ButtonSortCfgObj'];
            if (!B || !B.ins) return;
            var d = B.ins.map || B.ins._data;
            if (!d) return;
            var done = (V.save.story && V.save.story.doneIds) || [];
            var ids = [];
            for (var k in d) {
                var b = d[k];
                if (!b || b.posType != 2 || b.openType != 2) continue;
                var key = parseInt(b.key);
                if (key && done.indexOf(key) >= 0) {
                    // 检查等级条件
                    if (b.forceLimit && b.forceLimit <= 90 && V.save.player.level < b.forceLimit) continue;
                    ids.push({ id: b.id, isNew: false, isClick: false });
                }
            }
            if (!ids.length) return;
            var s = writeAuto('com.protocol.mainButton.SM_FunctionButtonOpen', { ids: ids });
            if (s) inject(V.handler, -2601, s);
            log('开放顶栏功能按钮:', ids.map(function (x) { return x.id; }).join(','));
        } catch (e) { log('功能按钮推送失败', e && e.message); }
    }

    // ══ 经验/等级系统 ══
    function expNeed(lv) { return 60 * lv * (lv + 1); }
    function addExp(n) {
        var p = V.save.player; if (!p || n <= 0) return;
        p.exp = (p.exp || 0) + n;
        var leveled = 0;
        while (p.level < 999 && p.exp >= expNeed(p.level)) { p.exp -= expNeed(p.level); p.level++; leveled++; }
        persist();
        if (leveled > 0) {
            var s = writeAuto('com.protocol.player.msg.ResLevelUpdateMessage',
                { level: p.level, addexp: n, exp: p.exp, personID: p.personId });
            if (s) inject(V.handler, -1401, s);
            log('升级 → Lv', p.level);
        } else {
            var s2 = writeAuto('com.protocol.player.msg.ResExpUpdateMessage',
                { exp: p.exp, personID: p.personId, reasonId: 0, expToPool: 0, expReal: p.exp });
            if (s2) inject(V.handler, -1402, s2);
        }
    }

    // ══ 世界BOSS / 个人BOSS (猎杀魂兽) ══
    function getWorldBossMaps() {
        var maps = [];
        try {
            var S = Laya.__classmap['com.game.switchMap.model.SmallMapCfgObj'].ins;
            var d = S.map || S._data;
            for (var k in d) {
                var m = d[k];
                if (m && m.mapType == 8 && maps.length < 30) maps.push(m.id);
            }
        } catch (e) { }
        if (!maps.length) maps = [20101, 20102, 20103, 20104, 20105];
        return maps;
    }
    HANDLERS[-6005] = function (h) {   // ReqWorldBossMapInfo → ResWorldBossMapInfo
        log('请求世界BOSS地图信息');
        var list = [];
        var maps = getWorldBossMaps();
        for (var i = 0; i < maps.length; i++) {
            list.push({ mapId: maps[i], num: 1, maxHP: 1000000, curHP: 1000000, isDead: false, reliveTime: 0, isSetNotify: false, multi: 1 });
        }
        // 当前地图若不在列表中且是猎场/BOSS类地图(20xxx), 也加入 (皇家猎场 20805 等靠此刷BOSS)
        var curMap = V.save.player ? V.save.player.mapId : 0;
        if (curMap && curMap >= 20000 && curMap < 21000) {
            var has = false;
            for (var i = 0; i < list.length; i++) if (list[i].mapId === curMap) { has = true; break; }
            if (!has) {
                list.unshift({ mapId: curMap, num: 1, maxHP: 50000, curHP: 50000, isDead: false, reliveTime: 0, isSetNotify: false, multi: 1 });
            }
        }
        var s = writeAuto('com.protocol.worldBoss.ResWorldBossMapInfo', {
            bossCopyInfos: list, useTime: 0, buyTime: 0, addTime: 0,
            isFirstOpen: false, isDouble: false, isAuto: false, isOpenNewYearMonster: false
        });
        if (s) inject(h, -6001, s);
    };
    HANDLERS[-1290] = function (h) {   // CM_PersonalBossCopyInfo → SM_PersonalBossCopyInfo
        log('请求个人BOSS副本信息');
        var s = writeAuto('com.x5Protocol.personalboss.message.SM_PersonalBossCopyInfo', {
            useTime: 0, totalTime: 5, lastRefreshTime: Math.floor(Date.now() / 1000),
            isDouble: false, sweepMapIds: []
        });
        if (s) inject(h, -1291, s);
    };

    // ══ 商店系统 (神秘商店/金币商店) ══
    function getShopCfg() {
        try {
            var C = Laya.__classmap['com.game.shop.model.ShopCfgObj'];
            if (C && C.ins) { var d = C.ins.map || C.ins._data; if (d) return d; }
        } catch (e) { }
        return null;
    }
    // 按 shopLevel 分组挑选商品 (每级8件, 按权重)
    function buildShopGoods() {
        var cfg = getShopCfg();
        if (!cfg) return [];
        var lv = V.save.player ? V.save.player.level : 1;
        var byLevel = {};
        for (var k in cfg) {
            var g = cfg[k];
            if (!g || !g.shopLevel) continue;
            if (g.minLevel && g.minLevel > lv) continue;
            if (g.maxLevel && g.maxLevel < lv) continue;
            if (!byLevel[g.shopLevel]) byLevel[g.shopLevel] = [];
            byLevel[g.shopLevel].push(g);
        }
        var out = [];
        for (var lvl in byLevel) {
            var arr = byLevel[lvl];
            arr.sort(function (a, b) { return (b.weight || 0) - (a.weight || 0); });
            var goods = [];
            for (var i = 0; i < arr.length && goods.length < 8; i++) {
                goods.push({ id: parseInt(arr[i].id), isBuy: false });
            }
            out.push({ level: parseInt(lvl), goods: goods });
        }
        return out;
    }
    // 找商品配置
    function findShopGoods(id) {
        var cfg = getShopCfg();
        if (!cfg) return null;
        for (var k in cfg) {
            if (parseInt(cfg[k].id) === parseInt(id)) return cfg[k];
        }
        return null;
    }
    // 背包添加物品 + 推送 ResAddGoods
    // difObject(int→bean, ITEM_MAP) 格式: [key][present=0][typeId][beanMark=0][Item字段...]
    function addItem(itemId, num) {
        if (!itemId) return;
        V.save.bag = V.save.bag || {};
        V.save.bag[itemId] = (V.save.bag[itemId] || 0) + (num || 1);
        persist();
        var s = new Ser();
        s.i32(1);                       // sourceType
        s.u8(0).i32(1);                 // map 标记 + 数量1
        s.i32(itemId);                  // key: itemModeId
        s.u8(0);                        // bean present 标记
        s.i32(10);                      // typeId = 10 (Item)
        s.u8(0);                        // readBean 标记
        // Item bean: itemModeId,num,state,present,deprecatedTime,trade,createTime,activityGain,isSelfCreate,onlyId
        s.i32(itemId).i32(num || 1).i32(0).i32(0).l64(0).i32(0).l64(Math.floor(Date.now() / 1000)).i32(0).boolean(false).l64(9000000000 + itemId);
        inject(V.handler, -1910, s);
        log('添加物品', itemId, 'x', num, '→ 背包:', V.save.bag[itemId]);
    }
    // 解析奖励 (配置可能是数组或JSON串): [{type:"Item",value:"60107:1"}]
    function grantReward(rewards) {
        try {
            var arr = rewards;
            if (typeof arr === 'string') arr = JSON.parse(arr);
            if (!arr || !arr.length) return;
            for (var i = 0; i < arr.length; i++) {
                var r = arr[i];
                var v = String(r.value || '').split(':');
                var id = parseInt(v[0]), num = parseInt(v[1] || '1');
                if (r.type === 'Item' || r.type === 'ITEM') {
                    addItem(id, num);
                } else if (r.type === 'Gold' || r.type === 'GOLD') {
                    V.save.gold += num;
                    persist();
                } else if (r.type === 'Coin' || r.type === 'COIN') {
                    V.save.coin += num;
                    persist();
                }
            }
        } catch (e) { log('奖励解析失败', String(rewards).substring(0, 60), e && e.message); }
    }
    // 打开商店
    HANDLERS[-2701] = function (h) {   // CM_OpenShop → SM_ShowShop
        log('打开商店');
        var s = writeAuto('com.protocol.shop.SM_ShowShop', { levelAndGoodsList: buildShopGoods() });
        if (s) inject(h, -2702, s);
    };
    // 购买商品: CM_ShopBuy {level, indexs[]} (writeArray: [00][count][ints...])
    HANDLERS[-2703] = function (h, body) {
        var par = new Par(body);
        var level = par.i32();
        par.u8();                   // 数组标记 [00]
        var cnt = par.i32();
        var ids = [];
        for (var i = 0; i < cnt; i++) ids.push(par.i32());
        log('商店购买 level=', level, 'ids=', ids.join(','));
        var totalGold = 0, totalCoin = 0;
        for (var i = 0; i < ids.length; i++) {
            var g = findShopGoods(ids[i]);
            if (!g) { log('!! 商品不存在', ids[i]); continue; }
            var gp = parseInt(g.gold || '0') || 0, cp = parseInt(g.coin || '0') || 0;
            if (gp > 0 && V.save.gold < totalGold + gp) { log('魂币不足'); pushMoney(1, 0, false, false); return; }
            if (cp > 0 && V.save.coin < totalCoin + cp) { log('金币不足'); pushMoney(2, 0, false, false); return; }
            totalGold += gp; totalCoin += cp;
        }
        // 扣费
        if (totalGold > 0) {
            V.save.gold -= totalGold;
            var s1 = new Ser();
            s1.i32(1).l64(V.save.gold).boolean(true).l64(totalGold).boolean(false).boolean(true).i32(0);
            inject(h, -1006, s1);
        }
        if (totalCoin > 0) {
            V.save.coin -= totalCoin;
            var s2 = new Ser();
            s2.i32(2).l64(V.save.coin).boolean(true).l64(totalCoin).boolean(false).boolean(true).i32(0);
            inject(h, -1006, s2);
        }
        persist();
        // 发货
        for (var i = 0; i < ids.length; i++) {
            var g = findShopGoods(ids[i]);
            if (g && g.rewards) grantReward(g.rewards);
        }
        // 回商店状态 (标记已购)
        var s = writeAuto('com.protocol.shop.SM_ShowShop', { levelAndGoodsList: buildShopGoods() });
        if (s) setTimeout(function () { inject(h, -2702, s); }, 200);
    };
    // 刷新商店: SM_RefreshGoods {levelAndGoods: bean}
    HANDLERS[-2704] = function (h, body) {
        var par = new Par(body);
        var level = par.i32();
        log('刷新商店 level=', level);
        var goods = [];
        var all = buildShopGoods();
        for (var i = 0; i < all.length; i++) {
            if (all[i].level === level) { goods = all[i].goods; break; }
        }
        var s = writeAuto('com.protocol.shop.SM_RefreshGoods', {
            levelAndGoods: { level: level, goods: goods }
        });
        if (s) inject(h, -2709, s);
    };
    // 金币商店(coinShop 充值商城)
    HANDLERS[-2707] = function (h) {   // ReqOpenCoinShop → ResCoinShopList
        log('打开金币商城');
        var s = writeAuto('com.protocol.coinShop.ResCoinShopList', { commodityList: [] });
        if (s) inject(h, -2708, s);
    };
    HANDLERS[-2706] = function (h, body) {  // CM_CoinshopBuy {id, amount}
        var par = new Par(body);
        var id = par.i32(), amount = par.i32();
        log('金币商城购买 id=', id, 'amount=', amount);
        // 扣金币
        V.save.coin = Math.max(0, V.save.coin - 1 * (amount || 1));
        persist();
        var s = new Ser();
        s.i32(2).l64(V.save.coin).boolean(true).l64(amount || 1).boolean(false).boolean(true).i32(0);
        inject(h, -1006, s);
    };

    function buildTaskInfoSafe() {
        var s = new Ser();
        s.i32(0).i32(0);
        s.u8(0).i32(0); s.u8(0).i32(0); s.u8(0).i32(0); s.u8(0).i32(0); s.u8(0).i32(0);
        return s;
    }

    HANDLERS[ID.CM_HEARTBEAT] = function (h) { inject(h, ID.SM_HEARTBEAT, buildHeartbeat()); };

    HANDLERS[ID.CM_ENTER_MAINCITY] = function (h) {
        log('进入主城, 假人:', V.fakePlayers.length);
        if (!V.fakePlayers.length) initFakePlayers();
        inject(h, ID.SM_PLAYER_CANSEE, buildCanSee());
        startFakeLife();
        startFakeChat();
    };

    HANDLERS[ID.CM_QUIT_MAINCITY] = function () { V.state = 'idle'; };
    HANDLERS[ID.CM_PLAYER_MOVE] = function () { };

    // 武魂觉醒: CM_ChooseSoul {playerId long, soul int, index int}
    HANDLERS[ID.CM_CHOOSE_SOUL] = function (h, body) {
        var par = new Par(body);
        var pid = par.l64(), soulType = par.i32(), index = par.i32();
        log('★ 武魂觉醒 pid=', pid, 'soul=', soulType, 'index=', index);
        var p = V.save.player;
        p.soulId = soulType;
        p.soulIndex = index;
        persist();
        // 成功回执: soul int, playerId long
        var s = writeAuto('com.x5Protocol.wsoul.message.SM_ChooseSoulSuccess', { soul: soulType, playerId: pid });
        if (s) inject(h, ID.SM_CHOOSE_SOUL_SUCCESS, s);
        // 武魂对象全量更新
        var s2 = writeAuto('com.x5Protocol.wsoul.message.SM_WSoulObjUpdate', {
            wSoulObjVO: {
                id: soulType, level: 1, wearSoulLoopItemInfo: {},
                addFighting: 100, useCombination: 0, wsoulSkillLevel: 1, wuHunAdvanceFeature: 0
            },
            index: index || 1, playerId: pid, useCombination: 0
        });
        if (s2) setTimeout(function () { inject(h, ID.SM_WSOUL_OBJ_UPDATE, s2); }, 250);
    };

    // 活动打开
    HANDLERS[-5109] = function (h, body) {
        var par = new Par(body);
        var actId = par.i32();
        log('打开活动 activityId=', actId);
        var s = writeAuto('com.protocol.activity.SM_OpenActivity', { id: actId, activityId: actId, lastTime: 86400 });
        if (s) inject(h, -5110, s);
    };

    // 主逻辑分发
    function handleRequest(handler, msgId, bodyU8) {
        V.handler = handler;
        V.stats.in++;
        var name = IDMAP[msgId] || ('id' + msgId);
        var fn = HANDLERS[msgId];
        if (fn) { fn(handler, bodyU8, name); return; }
        V.stats.unhandled[msgId] = (V.stats.unhandled[msgId] || 0) + 1;
        if (V.debug) log('未处理 C→S ' + msgId + ' ' + name + ' (' + bodyU8.length + 'B)');
        // 自动兜底: 白名单内的 CM→SM 自动回空响应
        if (V.autoReply[msgId]) {
            var smName = V.autoReply[msgId];
            var s = writeAuto(smName, {});
            if (s) {
                var smId = null;
                for (var k in IDMAP) if (IDMAP[k] === smName) { smId = Number(k); break; }
                if (smId) { inject(handler, smId, s); return; }
            }
        }
    }

    // ═══════════════ 假人生命循环 ═══════════════
    function startFakeLife() {
        if (V.fakeTimer) return;
        V.fakeTimer = setInterval(function () {
            if (V.state !== 'ingame' || !V.handler) return;
            var f = V.fakePlayers[Math.floor(Math.random() * V.fakePlayers.length)];
            if (!f) return;
            f.x += f.vx * (2 + Math.floor(Math.random() * 4));
            f.y += f.vy * (2 + Math.floor(Math.random() * 4));
            if (f.x < CITY_BORN.x - 800 || f.x > CITY_BORN.x + 800) f.vx = -f.vx;
            if (f.y < CITY_BORN.y - 600 || f.y > CITY_BORN.y + 600) f.vy = -f.vy;
            inject(V.handler, ID.SM_PLAYER_MOVE, buildPlayerMove(f));
        }, 1800);
    }
    function startFakeChat() {
        if (V.chatTimer) return;
        V.chatTimer = setInterval(function () {
            if (V.state !== 'ingame' || !V.handler || !V.save.flags.fakeChat) return;
            sendFakeChat();
        }, 9000);
    }
    function sendFakeChat() {
        var f = V.fakePlayers[Math.floor(Math.random() * V.fakePlayers.length)];
        if (!f) return;
        var line = CHAT_LINES[Math.floor(Math.random() * CHAT_LINES.length)];
        // SM_Chat(-2203): channelId, content, sender(ChatSender bean), reciver, reciverPlayerId,
        // reciverServerId, createTime, params[], colorId, bgColorId, chatBadgeId, hasSend
        var s = writeAuto('com.protocol.chat.msg.SM_Chat', {
            channelId: 1, content: line,
            sender: {
                id: f.playerId, curId: f.playerId, name: f.playerName,
                job: f.job, sex: f.sex, fightScore: f.fightPower,
                asuramName: f.allianceName || '', level: f.level,
                changeJob: 0, rebirthLv: 0, vipLevel: 0, honourId: 0, gmLevel: 0,
                blueInfo: null, wSoulInfo: null, skinId: 0, plat: '37wan', orgPlat: '37wan',
                serNum: 1, orgSerNum: 1, titleId: 0, appearVO: null,
                genderAuth: 0, platformGenderAuth: 0, worldCupCustomName: 0,
                championShipGamer: 0, legionShowVO: null
            },
            reciver: '', reciverPlayerId: 0, reciverServerId: 0,
            createTime: Math.floor(Date.now() / 1000),
            params: [], colorId: 0, bgColorId: 0, chatBadgeId: 0, hasSend: false
        });
        if (s && V.handler) inject(V.handler, -2203, s);
    }

    // ═══════════════ GM 菜单 (DOM) ═══════════════
    function startGMMenu() {
        if (document.getElementById('__gm_btn')) return;
        var css = document.createElement('style');
        css.textContent = [
            '#__gm_btn{position:fixed;left:8px;bottom:120px;z-index:99999;width:44px;height:44px;border-radius:50%;',
            'background:rgba(0,0,0,.55);border:2px solid #c9a34e;color:#ffdf8e;font-size:11px;font-weight:bold;',
            'display:flex;align-items:center;justify-content:center;user-select:none;cursor:pointer;',
            'font-family:sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.6)}',
            '#__gm_panel{position:fixed;left:8px;bottom:172px;z-index:99999;width:190px;background:rgba(20,15,5,.92);',
            'border:2px solid #c9a34e;border-radius:10px;padding:10px;display:none;color:#e8d5a3;font-family:sans-serif;',
            'font-size:13px;box-shadow:0 4px 16px rgba(0,0,0,.7)}',
            '#__gm_panel h4{margin:0 0 8px;color:#ffdf8e;font-size:14px;text-align:center}',
            '.gmrow{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px}',
            '.gmbtn{flex:1;min-width:52px;padding:7px 4px;background:linear-gradient(180deg,#5a4a20,#3a2f12);',
            'border:1px solid #c9a34e;border-radius:6px;color:#ffdf8e;font-size:11px;text-align:center;cursor:pointer}',
            '.gmbtn:active{background:#c9a34e;color:#000}',
            '.gmstat{font-size:11px;color:#9a8a60;margin-bottom:6px;line-height:1.5}'
        ].join('');
        document.head.appendChild(css);
        var btn = document.createElement('div');
        btn.id = '__gm_btn';
        btn.innerText = 'GM';
        var panel = document.createElement('div');
        panel.id = '__gm_panel';
        panel.innerHTML = '<h4>⚒ 单机助手</h4>' +
            '<div class="gmstat" id="__gm_stat"></div>' +
            '<div class="gmrow">' +
            '<div class="gmbtn" data-a="gold">金币+1万</div>' +
            '<div class="gmbtn" data-a="goldbig">金币+100万</div>' +
            '<div class="gmbtn" data-a="coin">钻石+100</div>' +
            '</div>' +
            '<div class="gmrow">' +
            '<div class="gmbtn" data-a="lvl">等级+1</div>' +
            '<div class="gmbtn" data-a="lvl5">等级+5</div>' +
            '<div class="gmbtn" data-a="exp">经验满</div>' +
            '</div>' +
            '<div class="gmrow">' +
            '<div class="gmbtn" data-a="token">猎场令牌</div>' +
            '<div class="gmbtn" data-a="chat">聊天:开</div>' +
            '<div class="gmbtn" data-a="save">存档</div>' +
            '</div>' +
            '<div class="gmrow">' +
            '<div class="gmbtn" data-a="reset">删档重练</div>' +
            '</div>';
        document.body.appendChild(btn);
        document.body.appendChild(panel);
        btn.addEventListener('click', function (e) {
            e.stopPropagation();
            panel.style.display = panel.style.display === 'block' ? 'none' : 'block';
            refreshStat();
        });
        panel.addEventListener('click', function (e) { e.stopPropagation(); });
        panel.addEventListener('click', function (e) {
            var t = e.target.closest('.gmbtn');
            if (!t) return;
            gmAction(t.getAttribute('data-a'));
            refreshStat();
        });
        V.save.flags.fakeChat = true;
        V._refreshGM = refreshStat;
        function refreshStat() {
            var st = document.getElementById('__gm_stat');
            if (!st || !V.save.player) return;
            st.innerHTML = '角色: ' + V.save.player.name + ' Lv.' + V.save.player.level +
                '<br>金币: ' + V.save.gold + ' | 钻石: ' + V.save.coin;
        }
        function gmAction(a) {
            var p = V.save.player;
            if (!p) { alert('请先进入游戏'); return; }
            switch (a) {
                case 'gold': pushMoney(1, 10000, true); break;
                case 'goldbig': pushMoney(1, 1000000, true); break;
                case 'coin': pushMoney(2, 100, true); break;
                case 'lvl': playerLevelUp(1); break;
                case 'lvl5': playerLevelUp(5); break;
                case 'exp': pushExpMax(); break;
                case 'token': grantHuntTokens(); break;
                case 'chat':
                    V.save.flags.fakeChat = !V.save.flags.fakeChat;
                    if (V.save.flags.fakeChat) sendFakeChat();
                    break;
                case 'save': persist(); break;
                case 'reset':
                    if (confirm('确定删档?角色与资源将清空')) {
                        localStorage.removeItem(SAVE_KEY);
                        location.reload();
                    }
                    break;
            }
        }
    }

    // 猎场令牌补给: 按玩家武魂发放对应令牌 x20
    function grantHuntTokens() {
        var TOKEN_BY_WSOUL = {
            13: 913,   // 昊天锤
            12: 922, 11: 925, 15: 933, 17: 911, 16: 912,
            14: 921, 18: 931, 19: 923, 20: 932, 21: 915, 22: 916, 23: 914, 24: 917
        };
        var p = V.save.player;
        var sid = p && p.soulId;
        var token = TOKEN_BY_WSOUL[sid] || 913;   // 默认昊天令牌
        addItem(token, 20);
        // 同时补几张其它令牌方便体验
        var extra = [922, 925, 933];
        for (var i = 0; i < extra.length; i++) if (extra[i] !== token) addItem(extra[i], 5);
        log('猎场令牌补给完成, 武魂', sid, '→令牌', token);
    }

    function playerLevelUp(n) {
        var p = V.save.player;
        p.level = Math.min(999, p.level + n);
        persist();
        // 正确的玩家等级更新消息
        var s = writeAuto('com.protocol.player.msg.ResLevelUpdateMessage',
            { level: p.level, addexp: 0, exp: p.exp || 0, personID: p.personId });
        if (s && V.handler) inject(V.handler, -1401, s);
    }
    function pushExpMax() {
        var p = V.save.player;
        p.exp = 999999999;
        persist();
        playerLevelUp(0); // 触发刷新
    }

    // ═══════════════ Hook ═══════════════
    function installHooks(SocketHandler) {
        log('安装 SocketHandler hooks');
        SocketHandler.prototype.connect = function () {
            var self = this;
            log('拦截connect → 虚拟连接');
            setTimeout(function () {
                self.m_socket = {
                    connected: true,
                    off: function () { }, close: function () { },
                    on: function () { }, flush: function () { },
                    output: { writeArrayBuffer: function () { } }
                };
                self.linkStatus = 4;
                self.event('open');
            }, 200 + Math.floor(Math.random() * 300));
        };
        SocketHandler.prototype.sendPackage = function (pkg) {
            try {
                pkg.position = 0;
                var len = 0, shift = 0, b;
                do { b = pkg.readByte() & 0xff; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
                len = (len >>> 1) ^ -(len & 1);
                pkg.readByte();
                var msgId = pkg.readShort();
                var bodyLen = (len >>> 0) - 2;
                var body = [];
                for (var i = 0; i < bodyLen; i++) body.push(pkg.readByte() & 0xff);
                handleRequest(this, msgId, body);
            } catch (e) {
                log('sendPackage解析失败', e && e.message);
            }
            return true;
        };
        log('hooks 就绪');
    }

    // ═══════════════ 启动 ═══════════════
    V.save = loadSave();
    log('虚拟服务器 v2 启动, 账号:', V.save.account);
    waitClass('com.common.connect.SocketHandler', installHooks);

    V.inject = inject;
    V.writeAuto = writeAuto;
    V.buildLoginDetail = buildLoginDetail;
    V.buildLoginList = buildLoginList;
    V.buildLoginSuccess = buildLoginSuccess;
    V.reflect = reflect;
    V.pushMoney = pushMoney;
    V.writeOps = writeOps;
    V.addItem = addItem;
    V.addExp = addExp;
    V.grantHuntTokens = grantHuntTokens;
    V.pushExploreTasks = pushExploreTasks;
    V.pushFunctionButtons = pushFunctionButtons;
})();
