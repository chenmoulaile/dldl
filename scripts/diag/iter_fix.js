// 迭代插入: 反复在"最佳插入点"插入字节直到原生读取成功
(function(){
    var V = window.__DLDL_VSERVER__;
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var DetailCls = Laya.__classmap['com.protocol.login.ResLoginPlayerDetailInfo'];
    function tryRead(bytes) {
        var msg = new DetailCls();
        var ba = new ByteArray();
        for (var i = 0; i < bytes.length; i++) ba.writeByte(bytes[i] & 0xff);
        ba.position = 0; ba._position_ = 0;
        try { msg.read(ba); return {ok: true, msg: msg}; } catch (e) { return {ok: false}; }
    }
    var base = V.buildLoginDetail(V.save).bytes;
    var r = tryRead(base);
    var insertions = [];
    var guard = 0;
    while (!r.ok && guard < 12) {
        guard++;
        // 找第一个让读取成功(或推进最远)的插入点
        var found = -1;
        for (var p = 0; p <= base.length; p++) {
            var cand = base.slice(0, p).concat([0], base.slice(p));
            if (tryRead(cand).ok) { found = p; break; }
        }
        if (found < 0) {
            // 没有单点插入能OK → 找推进最远的(用错误位置衡量不可行) → 放弃
            window.__iterfix = {failed: true, insertions: insertions, len: base.length};
            return;
        }
        base = base.slice(0, found).concat([0], base.slice(found));
        insertions.push(found);
        r = tryRead(base);
    }
    // 成功: 输出插入点与字段校验
    var m = r.msg;
    window.__iterfix = {ok: r.ok, insertions: insertions, len: base.length,
        check: {countryId: m.countryId, equipGrids: m.equipGrids, warehouseCount: m.warehouseCount,
                activity: m.activity, allianceLevel: m.allianceLevel, monthCardType: m.monthCardType,
                serverId: m.serverId, mergeStatus: m.mergeStatus, plat: m.plat,
                countId: m.countId, openServerDay: m.openServerDay && m.openServerDay.toString()}};
})();
