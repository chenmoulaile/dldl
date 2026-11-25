// 逐位置插入探针: 找出让客户端成功解析的插入点
(function(){
    var V = window.__DLDL_VSERVER__;
    var ser = V.buildLoginDetail(V.save);
    var base = ser.bytes;
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var DetailCls = Laya.__classmap['com.protocol.login.ResLoginPlayerDetailInfo'];
    var results = [];
    // 尝试在每个位置插入 1 字节 (0x00), 看是否 READ_OK
    for (var insPos = 0; insPos <= base.length; insPos += 1) {
        var msg = new DetailCls();
        var ba = new ByteArray();
        for (var i = 0; i < base.length; i++) {
            if (i === insPos) ba.writeByte(0);
            ba.writeByte(base[i] & 0xff);
        }
        if (insPos === base.length) ba.writeByte(0);
        ba.position = 0; ba._position_ = 0;
        var r;
        try { msg.read(ba); r = 'OK'; } catch (e) { r = 'E'; }
        if (r === 'OK') results.push(insPos);
        if (results.length >= 8) break;
    }
    window.__probe_result = {len: base.length, okPositions: results};
})();
