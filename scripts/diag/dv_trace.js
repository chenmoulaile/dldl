// 终极追踪: hook DataView 底层字节读取
(function(){
    var V = window.__DLDL_VSERVER__;
    var rec = [];
    var orig = {};
    ['getUint8','getInt8','getFloat32','getUint32','getInt32'].forEach(function(m){
        if (typeof DataView.prototype[m] !== 'function') return;
        orig[m] = DataView.prototype[m];
        DataView.prototype[m] = function(){
            var args = Array.prototype.slice.call(arguments);
            var r = orig[m].apply(this, args);
            if (window.__dv_on) rec.push(args[0] + ':' + m.replace('get','').toLowerCase() + '=' + r);
            return r;
        };
    });
    var ser = V.buildLoginDetail(V.save);
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var ba = new ByteArray();
    for (var i=0;i<ser.bytes.length;i++) ba.writeByte(ser.bytes[i]&0xff);
    ba.position = 0; ba._position_ = 0;
    window.__dvbytes = ser.bytes.slice();
    window.__dv_on = true;
    try {
        V.handler._receiveFun.runWith([-1107, ba]);
        window.__dv_result = 'OK';
    } catch(e) { window.__dv_result = 'ERR: ' + e.message; }
    window.__dv_on = false;
    window.__dvtrace = rec;
    // 恢复
    ['getUint8','getInt8','getFloat32','getUint32','getInt32'].forEach(function(m){
        if (orig[m]) DataView.prototype[m] = orig[m];
    });
})();
