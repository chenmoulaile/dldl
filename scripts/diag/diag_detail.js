// 诊断: 模拟客户端读取 buildLoginDetail 输出, 定位第一个错位操作
(function () {
    var V = window.__DLDL_VSERVER__;
    var ser = V.buildLoginDetail(V.save);
    var B = ser.bytes;
    var p = 0;
    var trace = [];
    function fail(op, f, msg) {
        console.log('★错位 @', p, op, f || '-', msg || '');
        console.log('前50操作:', JSON.stringify(trace.slice(-50)));
        throw new Error('FAIL@' + p + ' ' + op + ':' + (f || ''));
    }
    function rdU8() { if (p >= B.length) fail('EOF', '', 'p=' + p + ' len=' + B.length); return B[p++]; }
    function rdVarint() {
        var r = 0, s = 0, b;
        do { b = rdU8(); r |= (b & 0x7f) << s; s += 7; } while (b & 0x80);
        return r >>> 0;
    }
    function rdI32() { var u = rdVarint(); return (u >>> 1) ^ -(u & 1); }
    function rdI64() { var u = 0n, s = 0n, b; do { b = rdU8(); u |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80); return (u >> 1n) ^ (-(u & 1n) & 0xFFFFFFFFFFFFFFFFn); }
    function rdStr() { var n = rdI32(); if (n < 0 || p + n > B.length) fail('str', '', 'len=' + n + ' p=' + p); var s = ''; for (var i = 0; i < n; i++) s += String.fromCharCode(B[p + i]); p += n; return s; }
    function rdBean(cls) {
        var m = rdU8();
        if (m === 0xff) return null;
        var ops = V.reflect(cls);
        if (!ops) fail('bean', cls, '无schema');
        return walk(ops, cls);
    }
    function rdArr(args) {
        var m = rdU8();
        if (m === 0xff) return null;
        var n = rdI32();
        trace.push('readInt:arrcount=' + n);
        if (n < 0 || n > 10000) fail('arr', '', 'count=' + n);
        var out = [];
        for (var i = 0; i < n; i++) {
            var t = (args[0] || 'int').replace(/"/g, '');
            if (t === 'bean') out.push(rdBean(args[1]));
            else if (t === 'int') out.push(rdI32());
            else if (t === 'long') out.push(rdI64());
            else if (t === 'string') out.push(rdStr());
            else if (t === 'byte') out.push(rdU8());
        }
        return out;
    }
    function walk(ops, cls) {
        for (var i = 0; i < ops.length; i++) {
            var it = ops[i], op = it.op, f = it.f || '';
            try {
                switch (op) {
                    case 'mark': trace.push(p+':readByte:mark'); rdU8(); break;
                    case 'int': trace.push(p+':readInt:' + f + '=' + rdI32()); break;
                    case 'long': trace.push(p+':readLong:' + f + '=' + rdI64().toString()); break;
                    case 'byte': trace.push(p+':readByte:' + f + '=' + rdU8()); break;
                    case 'short': trace.push('short:' + f + '=' + (rdU8() << 8 | rdU8())); break;
                    case 'boolean': trace.push(p+':readBoolean:' + f + '=' + rdU8()); break;
                    case 'float': rdU8(); rdU8(); rdU8(); rdU8(); trace.push('float:' + f); break;
                    case 'string': trace.push(p+':readString:' + f + '=' + rdStr().substring(0, 12)); break;
                    case 'bean': trace.push('bean:' + f + '→' + (it.args[0] || '?')); rdBean(it.args[0] || '?'); break;
                    case 'array': trace.push('readByte:' + f + '_mark'); rdArr(it.args); trace.push('readArray:' + f); break;
                    case 'object': case 'dif': case 'nest':
                        trace.push('readByte:' + f + '_mark');
                        var m = rdU8();
                        if (m !== 0xff) { trace.push('readInt:' + f + '_count'); var n = rdI32(); trace.push('readObject:' + f + ' n=' + n); }
                        else trace.push('readObject:' + f + '=null');
                        break;
                    default: fail('op?', op, '未知操作');
                }
            } catch (e) { if (e.message && e.message.indexOf('FAIL') === 0) throw e; fail(op, f, e.message); }
        }
    }
    var ops = V.reflect('com.protocol.login.ResLoginPlayerDetailInfo');
    var result = '';
    try {
        walk(ops, 'detail');
        result = 'DONE p=' + p + '/' + B.length + (p !== B.length ? ' !!剩余' + (B.length - p) : '');
    } catch (e) { result = e.message; }
    window.__diag_trace = trace;
    window.__diag_result = result;
})();
