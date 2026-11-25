#!/usr/bin/env python3
"""patch_dex_gate.py — 37wan SDK 启动门禁 smali 级补丁
原理: MainActivity 状态机 enStepNone→startStep1→(net+1s)→startStep2→(laya+sdk)→stepOver(启动conch)
补丁:
  startStep1()  → 直接 m_isNetOk=true, m_is37SDKOk=true (跳过 SQwanCore.init: 隐私弹窗/热更杀进程/SDK登录)
  checkNet()    → 直接 m_isNetOk=true (离线不再弹"找不到网络"对话框)
  init37Sdk()   → 直接 m_is37SDKOk=true (兜底)
用法: python3 patch_dex_gate.py <apk> <baksmali.jar> <smali.jar>
"""
import sys, os, re, zipfile, shutil, subprocess, tempfile

CLS = 'Lcom/jiguang/main/MainActivity;'

BODY_TWO = ('    .locals 1\n\n'
            '    const/4 v0, 0x1\n\n'
            '    iput-boolean v0, p0, %s->m_isNetOk:Z\n\n'
            '    iput-boolean v0, p0, %s->m_is37SDKOk:Z\n\n'
            '    return-void\n' % (CLS, CLS))

BODY_NET = ('    .locals 1\n\n'
            '    const/4 v0, 0x1\n\n'
            '    iput-boolean v0, p0, %s->m_isNetOk:Z\n\n'
            '    return-void\n' % CLS)

BODY_SDK = ('    .locals 1\n\n'
            '    const/4 v0, 0x1\n\n'
            '    iput-boolean v0, p0, %s->m_is37SDKOk:Z\n\n'
            '    return-void\n' % CLS)


def replace_method(src, name, body):
    pat = re.compile(r'(\.method[^\n]*\b' + name + r'\(\)V\s*\n)(.*?)(\.end method)', re.S)
    m = pat.search(src)
    if not m:
        raise RuntimeError('未找到方法 ' + name)
    return src[:m.start()] + m.group(1) + body + m.group(3) + src[m.end():]


def main():
    apk, baksmali_jar, smali_jar = sys.argv[1], sys.argv[2], sys.argv[3]
    tmp = tempfile.mkdtemp(prefix='dexgate')
    zin = zipfile.ZipFile(apk)
    daxes = [n for n in zin.namelist() if re.match(r'classes\d*\.dex$', n)]
    target = None
    for n in daxes:
        if b'com/jiguang/main/MainActivity' in zin.read(n):
            target = n
            break
    if not target:
        print('!! 未找到含 com/jiguang/main/MainActivity 的 dex')
        sys.exit(1)
    print('目标 dex:', target)
    dex_path = os.path.join(tmp, 'target.dex')
    open(dex_path, 'wb').write(zin.read(target))

    out_dir = os.path.join(tmp, 'smali_out')
    subprocess.run(['java', '-jar', baksmali_jar, 'd', dex_path, '-o', out_dir], check=True)
    ma = os.path.join(out_dir, 'com/jiguang/main/MainActivity.smali')
    src = open(ma, encoding='utf-8').read()
    src = replace_method(src, 'startStep1', BODY_TWO)
    src = replace_method(src, 'checkNet', BODY_NET)
    src = replace_method(src, 'init37Sdk', BODY_SDK)
    open(ma, 'w', encoding='utf-8').write(src)
    print('smali 已补丁 (startStep1/checkNet/init37Sdk)')

    subprocess.run(['java', '-jar', smali_jar, 'a', out_dir, '-o', dex_path], check=True)
    new_dex = open(dex_path, 'rb').read()
    print('回编 dex:', len(new_dex), 'B')

    tmp_apk = apk + '.gate'
    with zipfile.ZipFile(tmp_apk, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for item in zin.infolist():
            if item.filename == target:
                zout.writestr(item, new_dex)
            else:
                zout.writestr(item, zin.read(item))
    zin.close()
    shutil.move(tmp_apk, apk)
    shutil.rmtree(tmp, ignore_errors=True)
    print('完成:', apk)


if __name__ == '__main__':
    main()
