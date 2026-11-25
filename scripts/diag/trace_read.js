// 追踪客户端真实读取序列 (hook Message 基类读取方法)
(function(){
    var V = window.__DLDL_VSERVER__;
    var targets = [Laya.__classmap['com.common.connect.structure.Bean']];
    var rec = [];
    var patches = [];
    var methods = ['readByte','readShort','readInt','readLong','readString','readBoolean','readFloat','readDouble','readBean1','readBean','readArray','readObject','readDifObject','readNestObject'];
    targets.forEach(function(MsgCls){
        var proto = MsgCls.prototype;
        var orig = {};
        methods.forEach(function(m){
            if (typeof proto[m] !== 'function') return;
            orig[m] = proto[m];
            var patched = function(){
                var args = Array.prototype.slice.call(arguments);
                var r;
                try { r = orig[m].apply(this, args); }
                catch(e) { rec.push('!!' + m + ' ERR:' + e.message); throw e; }
                var pos = '?';
                try { pos = (this.buf && (this.buf._position_ !== undefined)) ? this.buf._position_ : ((this.buf && this.buf.pos !== undefined) ? this.buf.pos : '?'); } catch(e2) {}
                var disp = (m === 'readBean') ? 'readBean' : m;
                rec.push(pos + ':' + disp + (r === null ? '=null' : (typeof r === 'object' ? '=obj' : '=' + String(r).substring(0,10))));
                return r;
            };
            try { proto[m] = patched; patches.push([proto, m, orig[m]]); } catch(e){}
        });
    });
    // 构造并同步注入 -1107
    var ser = V.buildLoginDetail(V.save);
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var ba = new ByteArray();
    for (var i=0;i<ser.bytes.length;i++) ba.writeByte(ser.bytes[i]&0xff);
    ba.position = 0; ba._position_ = 0;
    window.__readtrace_result = 'pending';
    try {
        V.handler._receiveFun.runWith([-1107, ba]);
        window.__readtrace_result = 'OK 读取' + rec.length + '次 pos=' + ba._position_ + '/' + ser.bytes.length;
    } catch(e) {
        window.__readtrace_result = 'ERR@pos' + ba._position_ + '/' + ser.bytes.length + ': ' + e.message;
    }
    window.__readtrace = rec;
    // 恢复
    patches.forEach(function(p){ p[0][p[1]] = p[2]; });
})();
