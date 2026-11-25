#!/usr/bin/env python3
"""parse_msgs.py v2 — 字符串定位方式提取协议消息 schema(避免正则回溯)"""
import re, json, os

JS_DIR = '/home/z/my-project/tmp/testsrv/js'
FILES = ['main.js', 'module.js', 'skin.js', 'login_001599.js']
OUT = '/home/z/my-project/tmp/msgs.json'

READ_CALL = re.compile(
    r'this\.(\w+)\s*=\s*this\.(readByte|readShort|readInt|readLong|readString|readBoolean|readDouble|readBean|readArray|readObject|readDifObject|readNestObject|readNestObj)\(\s*([^)]*)\)')
WRITE_CALL = re.compile(
    r'this\.(writeByte|writeShort|writeInt|writeLong|writeString|writeBoolean|writeDouble|writeBean|writeArray|writeObject)\(\s*this\.(\w+)')

def parse_args(argstr):
    argstr = argstr.strip()
    if not argstr:
        return []
    return [a.strip() for a in argstr.split(',')]

def norm_type(op, args):
    if op == 'readBean':
        return ['bean', args[0] if args else '?']
    if op == 'readArray':
        t = args[0].strip('"') if args else '?'
        sub = args[1] if len(args) > 1 else None
        if sub in ('null', None, ''):
            sub = None
        elif sub and not re.match(r'^[A-Z]', sub):
            sub = sub.strip('"')
        return ['arr', t, sub]
    if op == 'readObject':
        return ['obj'] + [a.strip('"') for a in args]
    if op == 'readDifObject':
        return ['dif'] + args
    if op == 'readNestObject':
        return ['nest'] + args
    if op == 'readNestObj':
        return ['nestobj', args[0] if args else '?']
    return [op.replace('read', '').lower()]

def extract_seq(body):
    return [{'f': m.group(1), 't': norm_type(m.group(2), parse_args(m.group(3))), 'at': m.start()}
            for m in READ_CALL.finditer(body)]

def extract_write_seq(body):
    return [{'f': m.group(2), 't': [m.group(1).replace('write', '').lower()]}
            for m in WRITE_CALL.finditer(body)]

def find_blocks(all_src):
    """迭代所有消息/bean区块: 锚点 = __cl(t,"proto",e) 后跟 ; 或 ,"""
    ANCHOR = '__cl(t,"'
    pos = 0
    while True:
        i = all_src.find(ANCHOR, pos)
        if i < 0:
            return
        j = all_src.find('"', i + len(ANCHOR))
        proto = all_src[i + len(ANCHOR):j]
        if not proto or '.' not in proto:
            pos = j
            continue
        # 向前找块头: Name=function(e){function t(){
        head = all_src.rfind('=function(e){function t(){', max(0, i - 30000), i)
        if head < 0:
            pos = j
            continue
        pre = all_src[:head]
        k = max(pre.rfind(','), pre.rfind(';'), pre.rfind('{'), pre.rfind('}'))
        name = pre[k + 1:].strip()
        ctor_start = head + len('=function(e){function t(){')
        ctor = all_src[ctor_start:i - 1]  # 去掉 '}'
        # methods: anchor 后到最近的 ',t}('
        end2 = all_src.find(',t}(', j)
        if end2 < 0 or end2 - j > 80000:
            methods = ''
            is_msg = False
        else:
            methods = all_src[j:end2]
            base = all_src[end2 + 4:end2 + 14].split(')')[0]  # Message / Bean / ...
            is_msg = (base == 'Message')
        yield name, proto, ctor, methods, is_msg
        pos = j

def main():
    all_src = ''
    for fn in FILES:
        p = os.path.join(JS_DIR, fn)
        if os.path.exists(p):
            all_src += '\n/*FILE:%s*/\n' % fn + open(p, encoding='utf-8', errors='ignore').read()
    print('JS 总量: %.1f MB' % (len(all_src) / 1e6))

    msgs, beans = {}, {}
    n = 0
    for name, proto, ctor, methods, is_msg in find_blocks(all_src):
        n += 1
        if not name or not re.match(r'^\w+$', name):
            continue
        fields = re.findall(r'this\.(\w+)=(?:[^,]+?)(?=,this\.|$)', ctor)
        idm = re.search(r'getId=function\(\)\{return(-?\d+)\}', methods)
        mid = int(idm.group(1)) if idm else 0
        # reading
        rm = re.search(r'\.reading=function\(\)\{', methods)
        read_seq = extract_seq(methods[rm.end():rm.end() + 20000]) if rm else []
        wm = re.search(r'\.writing=function\(\)\{', methods)
        write_seq = extract_write_seq(methods[wm.end():wm.end() + 20000]) if wm else []
        entry = {'id': mid, 'proto': proto,
                 'dir': name[:3] if name[:3] in ('SM_', 'CM_', 'Res', 'Req') else 'bean',
                 'fields': fields, 'read_seq': read_seq, 'write_seq': write_seq,
                 'has_reading': bool(rm), 'has_writing': bool(wm)}
        if is_msg and mid:
            msgs[name] = entry
        elif read_seq or fields:
            beans[name] = entry

    print('区块: %d  消息类: %d  Bean类: %d' % (n, len(msgs), len(beans)))
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump({'msgs': msgs, 'beans': beans}, f, ensure_ascii=False, indent=1)
    print('输出:', OUT, '(%.2f MB)' % (os.path.getsize(OUT) / 1e6))

    for k in ['ResLoginPlayerDetailInfo', 'SM_VipInfoMessage', 'PlayerDetailBean',
              'CM_OpenActivity', 'SM_Task_Info', 'SM_PlayerCanSee', 'SM_ActivityData']:
        e = msgs.get(k) or beans.get(k)
        if not e:
            print('!! 缺失:', k)
            continue
        print('%-28s id=%-6s read=%d 字段=%d' % (k, e['id'], len(e['read_seq']), len(e['fields'])))

if __name__ == '__main__':
    main()
