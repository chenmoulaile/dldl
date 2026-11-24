/**
 * vserver.js — 斗罗大陆H5 离线单机虚拟服务器 v1.0
 * ---------------------------------------------------------------
 * 原理: hook SocketHandler.connect/sendPackage
 *   - connect: 不建立真实 WebSocket,直接假装连接成功
 *   - sendPackage: 拦截出站帧 → 解析消息ID+body → 虚拟服务器逻辑
 *     → 按各消息 reading() 的字段顺序构造响应 (ByteArray 大端)
 *     → 经 _receiveFun(=Connecter.receiveData) 注入客户端
 * 存档: localStorage (key: dldl_save_v1)
 * 假人: SM_PlayerCanSee 注入伪造在线玩家,主城内游走
 */
(function () {
    if (window.__DLDL_VSERVER__) return;
    window.__DLDL_VSERVER__ = true;

    var V = window.__DLDL_VSERVER__ = {
        version: '1.0',
        log: [],
        handler: null,
        state: 'idle',
        save: null,
        fakePlayers: [],
        fakeTimer: 0,
        debug: true
    };

    function log() {
        var args = Array.prototype.slice.call(arguments);
        args.unshift('[vserver]');
        console.log.apply(console, args);
        V.log.push(args.join(' '));
        if (V.log.length > 500) V.log.shift();
    }

    function waitClass(name, cb, tries) {
        tries = tries || 0;
        if (window.Laya && Laya.__classmap && Laya.__classmap[name]) { cb(Laya.__classmap[name]); return; }
        if (tries > 900) { log('等待类超时:', name); return; }
        setTimeout(function () { waitClass(name, cb, tries + 1); }, 100);
    }

    // ================= 存档 =================
    var SAVE_KEY = 'dldl_save_v1';
    function loadSave() {
        try {
            var s = window.localStorage.getItem(SAVE_KEY);
            if (s) return JSON.parse(s);
        } catch (e) { }
        return {
            account: 'dldl' + Math.floor(1000 + Math.random() * 9000),
            player: null,
            gold: 88888888,
            firstLoginDone: false
        };
    }
    function persist() {
        try { window.localStorage.setItem(SAVE_KEY, JSON.stringify(V.save)); } catch (e) { log('存档失败', e); }
    }

    // ================= 序列化助手 (Bean规范, varint+zigzag, ByteArrayUtil.compress=true) =================
    // int: varint32(zigzag32(v)); long: varint64(zigzag64(v)); string: varint(len)+utf8
    // byte/short/boolean: 原始大端; bean: [byte 0/-1][内联]; array: [byte 0/-1][varint n][items]
    function zz32(v) { v = v | 0; return ((v << 1) ^ (v >> 31)) >>> 0; }
    function varintBytes(u) {  // u: 无符号整数(BigInt或Number)
        u = BigInt(u);
        var out = [];
        while (u >= 0x80n) { out.push(Number(u & 0x7fn) | 0x80); u >>= 7n; }
        out.push(Number(u));
        return out;
    }
    function Ser() { this.bytes = []; }
    Ser.prototype.u8 = function (v) { this.bytes.push(v & 0xff); return this; };
    Ser.prototype.i32 = function (v) {
        var b = varintBytes(zz32(v));
        for (var i = 0; i < b.length; i++) this.bytes.push(b[i]);
        return this;
    };
    Ser.prototype.i16 = function (v) {
        v = v | 0;
        this.bytes.push((v >>> 8) & 0xff, v & 0xff);
        return this;
    };
    Ser.prototype.l64 = function (n) {
        // zigzag64: (n<<1)^(n>>63) — BigInt处理
        n = BigInt(Math.floor(n));
        var z = (n < 0n) ? (((n * 2n) ^ 0xFFFFFFFFFFFFFFFFn) & 0xFFFFFFFFFFFFFFFFn)
                         : ((n * 2n) & 0xFFFFFFFFFFFFFFFFn);
        var b = varintBytes(z);
        for (var i = 0; i < b.length; i++) this.bytes.push(b[i]);
        return this;
    };
    Ser.prototype.str = function (s) {
        if (s == null) { this.i32(0); return this; }
        s = String(s);
        var out = [];
        for (var i = 0; i < s.length; i++) {
            var c = s.charCodeAt(i);
            if (c < 0x80) out.push(c);
            else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
            else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
                var c2 = s.charCodeAt(i + 1);
                if (c2 >= 0xdc00 && c2 <= 0xdfff) {
                    var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
                    out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
                    i++;
                } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
            } else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
        }
        this.i32(out.length);   // varint长度
        for (var j = 0; j < out.length; j++) this.bytes.push(out[j] & 0xff);
        return this;
    };
    Ser.prototype.boolean = function (b) { this.u8(b ? 1 : 0); return this; };
    Ser.prototype.beanNull = function () { this.u8(0xff); return this; };
    Ser.prototype.beanHead = function () { this.u8(0); return this; };
    Ser.prototype.arrNull = function () { this.u8(0xff); return this; };
    Ser.prototype.arrHead = function (n) { this.u8(0); this.i32(n); return this; };

    // ================= 解析助手 (varint+zigzag) =================
    function Par(u8arr) { this.d = u8arr; this.p = 0; }
    Par.prototype.varint = function () {
        var result = 0, shift = 0, b;
        do {
            b = this.d[this.p++];
            result |= (b & 0x7f) << shift;
            shift += 7;
        } while (b & 0x80);
        return result >>> 0;
    };
    Par.prototype.i32 = function () {
        var u = this.varint();
        return (u >>> 1) ^ -(u & 1);   // decodeZigZag32
    };
    Par.prototype.i16 = function () { var v = (this.d[this.p] << 8) | this.d[this.p + 1]; this.p += 2; return v; };
    Par.prototype.u8 = function () { return this.d[this.p++]; };
    Par.prototype.l64 = function () {
        // varint64 + zigzag64 解码 (BigInt)
        var u = 0n, shift = 0n, b;
        do {
            b = this.d[this.p++];
            u |= BigInt(b & 0x7f) << shift;
            shift += 7n;
        } while (b & 0x80);
        var v = (u >> 1n) ^ (-(u & 1n) & 0xFFFFFFFFFFFFFFFFn);
        return Number(v);
    };
    Par.prototype.str = function () {
        var n = this.i32();
        if (n <= 0) return '';
        var s = '';
        for (var i = 0; i < n; i++) s += String.fromCharCode(this.d[this.p + i]);
        this.p += n;
        try { return decodeURIComponent(escape(s)); } catch (e) { return s; }
    };

    // ================= 消息 ID =================
    var ID = {
        REQ_LOGIN_37APP: -1122,
        REQ_LOGIN_MESSAGE: -1101,   // 浏览器分支
        RES_LOGIN_LIST: -1102,
        REQ_SELECT_PLAYER: -1103,
        CM_CREATE_PLAYER: -1104,
        RES_LOGIN_SUCCESS: -1105,
        RES_LOGIN_DETAIL: -1107,
        RES_LOGIN_FAIL: -1108,
        SM_LOGIN_WAITING: -1139,
        SM_HEARTBEAT: -1113,
        CM_HEARTBEAT: -1005,
        SM_UPDATE_RECONNECT_KEY: -1128,
        CM_ENTER_MAINCITY: -3601,
        CM_QUIT_MAINCITY: -3602,
        CM_PLAYER_MOVE: -3603,
        SM_PLAYER_UPDATE: -3604,
        SM_PLAYER_CANSEE: -3605,
        SM_PLAYER_MOVE: -3606,
        SM_TASK_INFO: -1607
    };

    // ================= 假玩家 =================
    var FAKE_NAMES = ['唐三', '小舞', '戴沐白', '朱竹清', '马红俊', '宁荣荣', '奥斯卡',
        '剑斗罗', '罗刹神', '千仞雪', '比比东', '唐昊', '波塞西', '独孤博',
        '风清扬', '萧炎', '林动', '牧尘', '洛璃', '药老', '云韵', '美杜莎',
        '海神唐三', '修罗神', '千道流', '尘心', '玉小刚', '弗兰德', '赵无极', '柳二龙',
        '独孤雁', '叶泠泠', '泰坦', '牛皋', '白鹤', '杨无敌', '蛇矛斗罗', '刺豚斗罗',
        '鬼斗罗', '菊斗罗', '剑道尘心', '骨斗罗', '毒斗罗', '昊天斗罗', '啸天斗罗', '圣龙斗罗'];
    var JOBS = [1, 2, 3, 4, 5, 6, 7];

    function mkFake(pid, idx) {
        var name = FAKE_NAMES[idx % FAKE_NAMES.length];
        if (idx >= FAKE_NAMES.length) name += Math.floor(idx / FAKE_NAMES.length);
        return {
            playerId: pid,
            playerName: name,
            job: JOBS[idx % JOBS.length],
            sex: (idx % 2) + 1,
            level: 30 + (idx * 7) % 220,
            fightPower: 100000 + idx * 34567,
            x: 300 + ((idx * 137) % 1400),
            y: 300 + ((idx * 251) % 800),
            allianceName: idx % 3 === 0 ? '史莱克学院' : (idx % 3 === 1 ? '武魂殿' : ''),
            titleId: 0,
            horseId: idx % 5,
            vx: (idx % 2 ? 1 : -1) * (1 + idx % 3),
            vy: (idx % 3 ? 1 : -1) * (1 + idx % 2)
        };
    }

    function initFakePlayers() {
        V.fakePlayers = [];
        var ONLINE = 20 + Math.floor(Math.random() * 8);
        for (var i = 0; i < ONLINE; i++) V.fakePlayers.push(mkFake(900000 + i * 13, i));
    }

    // ================= 响应构造 =================
    function buildLoginList(save) {
        var s = new Ser();
        s.u8(0);
        if (save.player) {
            s.i32(1);
            s.l64(save.player.personId).str(save.player.name).i32(save.player.job)
                .i32(save.player.level).i32(0).l64(999999).i32(0).i32(0).i32(0).i32(save.player.sex);
        } else {
            s.i32(0);
        }
        s.i32(3).i32(0).i32(save.gold);
        return s;
    }

    function buildLoginSuccess(save) {
        var s = new Ser();
        s.i32(save.player.mapId).i32(save.player.soulId || 0).l64(save.player.personId);
        return s;
    }

    function buildLoginDetail(save) {
        var s = new Ser();
        s.u8(0);
        s.i32(1);
        var p = save.player;
        // --- PlayerDetailBean ---
        s.l64(p.personId).str(p.name).i32(p.job).i32(p.level).l64(0);
        s.i32(0).i32(0);
        // attributeVo: PlayerAttributeContainerVo (attribute obj, attributeBuff obj)
        s.beanHead().arrNull().arrNull();
        // skillVo: SkillListVo (标记0 + count 0 + otherSkill null)
        s.beanHead().u8(0).i32(0).arrNull();
        s.beanNull();      // buffEffectsVo
        s.arrNull();       // fruitObj
        s.i32(0);          // jobType
        s.beanHead().i32(0).u8(0).i32(0).i32(0).boolean(false);  // taskEntry
        s.i32(0);          // expiredTime
        s.l64(999999);     // battleScore
        s.i32(0);          // starLv
        s.i32(p.createTime || 1600000000);
        s.beanHead().arrNull().l64(0);    // elementInfo
        s.beanHead().i32(0).u8(0).i32(0).u8(0).i32(0);  // wSoulInfo
        s.i32(p.sex);      // sex
        s.i32(0);          // souNum
        s.l64(p.personId); // ownPlayerId
        s.beanHead().arrNull().arrNull().arrNull().i32(0).i32(0);  // magicHerbInfo
        s.i32(0);          // skinId
        // hunheInfoVO: HunheInfoVO (difObj null + array null + obj null + int level=1)
        s.beanHead().arrNull().arrNull().arrNull().i32(1);
        s.beanNull();      // appearVO
        s.beanHead().i32(0).arrNull().arrNull().arrNull();  // fightArmorVo
        s.beanHead().arrNull().arrNull().str('').i32(0);  // godTablePlayerInfoVO
        // --- 主体 ---
        s.i32(save.gold);
        for (var i = 0; i < 28; i++) s.l64(0);
        s.boolean(true);   // isOpenGM ★
        s.l64(0).str('').u8(0).str(p.name);
        s.boolean(!save.firstLoginDone);
        s.arrHead(0);      // teamPartnerIds
        s.beanHead().i32(500).i32(400);   // mainCityPosition: Position(x,y)
        // vipInfo: SM_VipInfoMessage (int tmpVipLv, long vipExp, 9×boolean)
        s.beanHead().i32(3).l64(0);
        for (var vi = 0; vi < 9; vi++) s.boolean(false);
        s.arrNull();       // newcomerGuideIDs
        s.u8(0).i32(0);    // goods 空实例
        s.u8(0).i32(0);    // equips 空实例
        s.arrNull();       // jewelInfo
        s.beanHead().u8(0xff);              // tinyMailsInfo: 实例+内部null标记→空map
        s.i32(60).i32(60).u8(0);
        s.beanHead().l64(0).l64(0);   // expPoolInfo: ExpPoolInfo(exp,expLimit)
        s.i32(0).l64(1).i32(0);
        s.str(p.reconnectSign || 'rs_' + Date.now());
        s.l64(p.createTime || 1600000000);
        s.str('cnt_' + p.personId);
        s.l64(p.personId);
        s.i32(1);          // allianceLevel
        s.beanHead().l64(0).arrNull();    // elementWarehouse: (elementChip, elementMap)
        s.beanHead().u8(0).i32(0).i32(0); // hunhuanBagInfo: WSoulLoopBagVO(空数组,resolveDailyNum)
        s.beanHead().i32(0).i32(0);       // elementTreInfo: (elementCount,elementFreeTime)
        s.arrNull();       // fateAttribute
        for (var j = 0; j < 41; j++) s.arrNull();  // #60-97: magicHerbBag..spiritSeaBagInfo
        s.beanNull();      // legionShowVo
        s.arrNull();       // TrinityBagInfo
        s.arrNull();       // KeelBagInfo
        s.arrNull();       // KeelModuleBagInfo
        s.str('单机离线服').str('单机离线服');
        s.i32(1).i32(1).i32(0).str('37wan');
        return s;
    }

    function buildTaskInfo() {
        // SM_Task_Info: int finishPoint, int achiPoint, arr finishPointRewIdList,
        //   arr achiTaskEntryVOs(bean), arr allPointList, arr achiPointRewIdList, arr equipTaskEntryVOs(bean)
        var s = new Ser();
        s.i32(0).i32(0);
        s.u8(0).i32(0);   // finishPointRewIdList 空
        s.u8(0).i32(0);   // achiTaskEntryVOs 空
        s.u8(0).i32(0);   // allPointList 空
        s.u8(0).i32(0);   // achiPointRewIdList 空
        s.u8(0).i32(0);   // equipTaskEntryVOs 空
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
        s.arrNull();                       // equipInfos
        s.beanHead().i32(f.x).i32(f.y);    // Position
        s.str(f.allianceName).u8(0).i32(f.titleId);
        s.l64(Math.floor(Date.now() / 1000));
        s.i32(0).i32(0).i32(0).i32(f.level).i32(f.horseId);
        s.beanNull();                      // blueInfo
        s.i32(f.sex).i32(0).i32(0);
        s.beanNull().beanNull();           // appearVO, legionShowVO
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

    // ================= 注入 =================
    function inject(handler, msgId, bodySer) {
        try {
            var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
            var ba = new ByteArray();
            var arr = bodySer.bytes;
            for (var i = 0; i < arr.length; i++) ba.writeByte(arr[i] & 0xff);
            ba.position = 0;
            setTimeout(function () {
                if (handler && handler._receiveFun) {
                    try {
                        ba.position = 0;          // ★ 双保险: 注入前强制重置
                        ba._position_ = 0;         // ★ 直接写内部字段兜底
                        handler._receiveFun.runWith([msgId, ba]);
                        if (V.debug) log('S→C 注入 id=' + msgId + ' (' + arr.length + 'B)');
                    } catch (e) {
                        log('注入处理异常 id=' + msgId, e && e.message, (e && e.stack || '').substring(0, 400));
                        // 深度诊断
                        try {
                            var dbg = { len: ba._len, pos: ba._position_, alloc: ba._$1__allocated_, head: [] };
                            var bv = ba._byteView_ || (ba.__getBuffer && new Uint8Array(ba.__getBuffer()));
                            if (bv) for (var k = 0; k < Math.min(24, bv.length); k++) dbg.head.push((bv[k]).toString(16));
                            log('buf诊断:', JSON.stringify(dbg));
                        } catch (e2) { log('诊断失败', e2 && e2.message); }
                    }
                }
            }, 30 + Math.floor(Math.random() * 60));
        } catch (e) {
            log('注入失败 id=' + msgId, e && e.message);
        }
    }

    // ================= 主逻辑 =================
    function handleRequest(handler, msgId, bodyU8) {
        V.handler = handler;
        var save = V.save;
        switch (msgId) {
            case ID.REQ_LOGIN_37APP:
            case ID.REQ_LOGIN_MESSAGE:
                log('登录请求, 账号:', save.account);
                setTimeout(function () {
                    inject(handler, ID.RES_LOGIN_LIST, buildLoginList(save));
                }, 400);
                break;

            case ID.CM_CREATE_PLAYER:
                var par = new Par(bodyU8);
                var name = par.str(), job = par.i32(), sex = par.i32();
                log('创建角色:', name, 'job=', job, 'sex=', sex);
                save.player = {
                    personId: 10001,
                    name: name,
                    job: job || 1,
                    sex: sex || 1,
                    level: 1,
                    mapId: 30001,
                    soulId: 0,
                    createTime: Math.floor(Date.now() / 1000),
                    reconnectSign: 'rs_' + Date.now()
                };
                persist();
                inject(handler, ID.RES_LOGIN_LIST, buildLoginList(save));
                break;

            case ID.REQ_SELECT_PLAYER:
                log('选择角色,进入游戏');
                inject(handler, ID.RES_LOGIN_SUCCESS, buildLoginSuccess(save));
                setTimeout(function () {
                    inject(handler, ID.RES_LOGIN_DETAIL, buildLoginDetail(save));
                }, 250);
                setTimeout(function () {
                    inject(handler, ID.SM_TASK_INFO, buildTaskInfo());   // 任务系统初始化(先于详情)
                }, 150);
                save.firstLoginDone = true;
                persist();
                V.state = 'ingame';
                break;

            case ID.CM_HEARTBEAT:
                inject(handler, ID.SM_HEARTBEAT, buildHeartbeat());
                break;

            case ID.CM_ENTER_MAINCITY:
                log('进入主城, 假人:', V.fakePlayers.length);
                if (!V.fakePlayers.length) initFakePlayers();
                inject(handler, ID.SM_PLAYER_CANSEE, buildCanSee());
                startFakeLife();
                break;

            case ID.CM_PLAYER_MOVE:
                break;

            default:
                if (V.debug) log('未处理 C→S id=' + msgId + ' (' + bodyU8.length + 'B)');
                break;
        }
    }

    function startFakeLife() {
        if (V.fakeTimer) return;
        V.fakeTimer = setInterval(function () {
            if (V.state !== 'ingame' || !V.handler) return;
            var f = V.fakePlayers[Math.floor(Math.random() * V.fakePlayers.length)];
            if (!f) return;
            f.x += f.vx * (2 + Math.floor(Math.random() * 4));
            f.y += f.vy * (2 + Math.floor(Math.random() * 4));
            if (f.x < 100 || f.x > 1800) f.vx = -f.vx;
            if (f.y < 100 || f.y > 1000) f.vy = -f.vy;
            inject(V.handler, ID.SM_PLAYER_MOVE, buildPlayerMove(f));
        }, 1600);
    }

    // ================= Hook =================
    function installHooks(SocketHandler) {
        log('安装 SocketHandler hooks');
        SocketHandler.prototype.connect = function () {
            var self = this;
            log('拦截connect → 虚拟连接', self.svrIP + ':' + self.svrPort);
            setTimeout(function () {
                // 哑socket: 让 connected getter 返回 true (isLive检查依赖它)
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
                // 帧头: [varint len][byte 0][int16 BE id][body]
                var pv = new Par([]);
                pv.d = [];
                // 手动从 pkg 逐字节读 (ByteArray.readByte)
                var len = 0, shift = 0, b;
                do { b = pkg.readByte() & 0xff; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
                len = (len >>> 1) ^ -(len & 1);   // ★ 长度字段也是zigzag编码
                var flag = pkg.readByte() & 0xff;
                var msgId = pkg.readShort();
                var bodyLen = (len >>> 0) - 2;
                var body = [];
                for (var i = 0; i < bodyLen; i++) body.push(pkg.readByte() & 0xff);
                if (V.debug) log('C→S id=' + msgId + ' (' + bodyLen + 'B)');
                handleRequest(this, msgId, body);
            } catch (e) {
                log('sendPackage解析失败', e && e.message);
                // 诊断: 转储帧头部
                try {
                    pkg.position = 0;
                    var dump = [];
                    for (var k = 0; k < Math.min(40, pkg.length); k++) dump.push((pkg.readByte() & 0xff).toString(16));
                    log('帧头hex(' + pkg.length + 'B):', dump.join(' '));
                } catch (e2) { }
            }
            return true;
        };
        log('hooks 就绪');
    }

    // ================= 启动 =================
    V.save = loadSave();
    log('虚拟服务器启动, 存档账号:', V.save.account);
    waitClass('com.common.connect.SocketHandler', installHooks);

    V.inject = inject;
    V.buildLoginDetail = buildLoginDetail;
    V.buildLoginList = buildLoginList;
})();
