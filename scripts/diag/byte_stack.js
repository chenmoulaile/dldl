// 抓取 280+ 读取时的调用栈
(function(){
    var V = window.__DLDL_VSERVER__;
    var ser = V.buildLoginDetail(V.save);
    var ByteArray = Laya.__classmap['com.common.connect.structure.ByteArray'];
    var ba = new ByteArray();
    for (var i=0;i<ser.bytes.length;i++) ba.writeByte(ser.bytes[i]&0xff);
    ba.position = 0; ba._position_ = 0;
    var origRead = ByteArray.prototype.readByte;
    window.__stacks = [];
    ByteArray.prototype.readByte = function(){
        var pos = this._position_ !== undefined ? this._position_ : this.pos;
        if (pos >= 279 && window.__stacks.length < 3) {
            try { throw new Error('STACK@' + pos); } catch(e) { window.__stacks.push(e.stack.substring(0, 900)); }
        }
        return origRead.apply(this, arguments);
    };
    try {
        V.handler._receiveFun.runWith([-1107, ba]);
        window.__byte_result = 'OK';
    } catch(e) { window.__byte_result = 'ERR: ' + e.message; }
    ByteArray.prototype.readByte = origRead;
})();
