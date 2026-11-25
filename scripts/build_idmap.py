#!/usr/bin/env python3
"""build_idmap.py — 从 msgs.json 生成 vserver 用的 消息ID→类名 映射 (idmap.js)"""
import json, os

d = json.load(open('/home/z/my-project/tmp/msgs.json'))
OUT = '/home/z/my-project/tmp/testsrv/js/idmap.js'

pairs = []
for k, v in d['msgs'].items():
    if v['id']:
        pairs.append((v['id'], k))
pairs.sort()
print('消息映射:', len(pairs), '条')

with open(OUT, 'w', encoding='utf-8') as f:
    f.write('// 自动生成: 消息ID → 类名映射 (勿手改)\n')
    f.write('window.__DLDL_IDMAP__ = {\n')
    for mid, name in pairs:
        f.write('"' + str(mid) + '":"' + name + '",\n')
    f.write('};\n')
    # proto → 类名 (供反射查类)
    f.write('window.__DLDL_PROTO2NAME__ = {\n')
    for k, v in d['msgs'].items():
        if v['id']:
            f.write('"%s":"%s",\n' % (v['proto'], k))
    for k, v in d['beans'].items():
        f.write('"%s":"%s",\n' % (v['proto'], k))
    f.write('};\n')
print('输出:', OUT, '(%.0f KB)' % (os.path.getsize(OUT) / 1024))
