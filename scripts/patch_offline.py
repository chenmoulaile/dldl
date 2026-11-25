#!/usr/bin/env python3
"""patch_offline.py — v2.2 完整离线化补丁 (在 GitHub Actions 上执行)
用法: python3 patch_offline.py <base.apk> <game目录> <vendor目录> [输出.apk]

做五件事:
1. DCC 缓存注入: game/ + vendor/ 所有文件 → assets/cache/<域名>/<crc32('/'+path)>
   (入口 index.html 替换掉原"开发登录页", 从资源包直接提供, 无需 filetable 命中)
2. filetable.txt/bin 重新生成: 原有 561 条目保留 + 全部新文件条目 (scrc32 verhash)
3. assetsid.txt 更新 → 首启触发 setAssets 重新拷贝 filetable 到本地
4. assets/scripts/index.js: updateDcc() 调用改 null (禁用 CDN filetable 覆盖, 永离线)
5. AndroidManifest versionCode 1020 → 1022 (可覆盖安装)
"""
import sys, os, json, zlib, struct, zipfile, shutil, hashlib

CDN_DIR = 'assets/cache/https.__res.xxh5.z7xz.com_xxh5dev'


def crc32_url(path):
    return format(zlib.crc32(('/' + path).encode('utf-8')) & 0xFFFFFFFF, '08x')


def scrc32(data):
    """LayaAir DCC verhash (JCSimpleCRC): 8字节组XOR进int64, 尾字节XOR进低字节, 高低32位折叠"""
    key = 0
    n = len(data)
    full = n // 8
    for i in range(full):
        off = i * 8
        for j in range(8):
            key ^= data[off + j] << (8 * j)
    for i in range(full * 8, n):
        key ^= data[i]
    lo = key & 0xFFFFFFFF
    hi = (key >> 32) & 0xFFFFFFFF
    ret = (lo ^ hi) & 0xFFFFFFFF
    return ret if ret != 0 else 1


def patch_index_js(data):
    """禁用 conch 启动时的 DCC 网络更新 (updateDcc yield → null)"""
    text = data.decode('utf-8')
    anchor = 'return [4 /*yield*/, updateDcc()];'
    if anchor not in text:
        # 备选锚点 (不同版本转译格式)
        alt = 'return [4 /*yield*/, updateDcc()];'
        if alt not in text:
            raise RuntimeError('index.js 中找不到 updateDcc 调用锚点!')
    text = text.replace(anchor, 'return [4 /*yield*/, null]; /* offline: no dcc update */', 1)
    return text.encode('utf-8')


def patch_version_code(manifest):
    """AndroidManifest 二进制 AXML: versionCode 1020 → 1022
    versionCode 是整型属性: 直接改 manifest 元素属性的 data 字段(u32), 同时改raw字符串"""
    d = bytearray(manifest)
    if struct.unpack('<H', d[0:2])[0] != 0x0003:
        return bytes(d), False

    def u16(p): return struct.unpack('<H', d[p:p + 2])[0]
    def u32(p): return struct.unpack('<I', d[p:p + 4])[0]

    # 1. 解析字符串池 → "versionCode" 的索引
    pool_off = 8
    if u16(pool_off) != 0x0001:
        return bytes(d), False
    scount = u32(pool_off + 8)
    sstart = u32(pool_off + 20)
    strings = []
    for i in range(scount):
        off = u32(pool_off + 28 + i * 4)
        p = pool_off + sstart + off
        ln = u16(p)
        strings.append(d[p + 2:p + 2 + ln * 2].decode('utf-16-le', 'replace'))
    try:
        vc_idx = strings.index('versionCode')
    except ValueError:
        return bytes(d), False

    # 2. 找 manifest START 元素的 versionCode 属性, 改 data (attr+16)
    pos = 8
    patched = 0
    while pos + 8 <= len(d):
        ctype = u16(pos)
        csize = u32(pos + 4)
        if csize == 0:
            break
        if ctype == 0x0102:  # START element
            acount = u16(pos + 28)
            base = pos + 36
            for i in range(acount):
                a = base + i * 20
                if a + 20 > len(d):
                    break
                if u32(a + 4) == vc_idx and u32(a + 16) == 1020:
                    struct.pack_into('<I', d, a + 16, 1022)
                    patched += 1
        pos += csize

    # 3. raw 字符串 "1020" (如有引用) 同步改
    for i in range(scount):
        if strings[i] == '1020':
            off = u32(pool_off + 28 + i * 4)
            p = pool_off + sstart + off
            ln = u16(p)
            if ln == 4:
                d[p + 4:p + 6] = b'2\x002'
    return bytes(d), patched >= 1


def build_filetable(real_entries, assetsid_hex32):
    """filetable.txt: 头3行 = 'ffeeffee 1' + assetsid拆成两对; 之后每行一条真实条目"""
    lines = ['ffeeffee 1',
             assetsid_hex32[0:8] + ' ' + assetsid_hex32[8:16],
             assetsid_hex32[16:24] + ' ' + assetsid_hex32[24:32]]
    for uh, vh in real_entries:
        lines.append('%s %s' % (uh, vh))
    return '\r\n'.join(lines) + '\r\n'


def build_filetable_bin(entries, assetsid_hex32):
    """bin: [0xffeeddcc][1][0x00ffffff][1][32字节ASCII assetsid][urlhash,verhash]*
       注: 头两条为表头占位(与txt一致)"""
    out = struct.pack('<IIII', 0xffeeddcc, 1, 0x00ffffff, 1)
    out += assetsid_hex32.encode('ascii')   # 32字节
    for uh, vh in entries:
        out += struct.pack('<II', int(uh, 16), int(vh, 16))
    return out


def main():
    apk = sys.argv[1]
    game_dir = sys.argv[2]
    vendor_dir = sys.argv[3] if len(sys.argv) > 3 else None
    out_apk = sys.argv[4] if len(sys.argv) > 4 else apk.replace('.apk', '_v2.2.apk')

    # ── 收集所有待注入文件 {url_path: abs_path} ──
    inject_files = {}
    for root_dir in [game_dir, vendor_dir]:
        if not root_dir or not os.path.isdir(root_dir):
            continue
        for root, _, names in os.walk(root_dir):
            for n in names:
                if n == 'vendor.json':
                    continue
                full = os.path.join(root, n)
                rel = os.path.relpath(full, root_dir).replace('\\', '/')
                inject_files[rel] = full
    print('注入文件 %d 个:' % len(inject_files))
    for rel in sorted(inject_files):
        print('  %-42s → %s' % (rel, crc32_url(rel)))

    # ── 读原 APK, 取原 filetable 条目 ──
    zin = zipfile.ZipFile(apk, 'r')
    names = zin.namelist()
    old_cache = [n for n in names if n.startswith(CDN_DIR + '/')]
    print('原 DCC 缓存文件数:', len(old_cache))

    old_ft = None
    if CDN_DIR + '/filetable.txt' in names:
        old_ft = zin.read(CDN_DIR + '/filetable.txt').decode('utf-8')
    old_entries = []
    if old_ft:
        for line in old_ft.replace('\r\n', '\n').split('\n'):
            p = line.split()
            if len(p) == 2:
                old_entries.append((p[0], p[1]))
    # 跳过头3行 (ffeeffee 1 + assetsid两对), 其后为真实条目
    if old_entries and old_entries[0][0].lower() == 'ffeeffee':
        real_old = old_entries[3:]
    else:
        real_old = old_entries
    print('原 filetable 真实条目:', len(real_old))

    # ── 计算新条目 (原真实条目 + 我们文件的 scrc32) ──
    new_entries = list(real_old)
    seen = set(e[0] for e in new_entries)
    inject_map = {}   # cache文件名 → 本地路径
    for rel in sorted(inject_files):
        uh = crc32_url(rel)
        data = open(inject_files[rel], 'rb').read()
        vh = format(scrc32(data), '08x')
        inject_map[uh] = inject_files[rel]
        if uh in seen:
            new_entries = [(u, vh if u == uh else v) for (u, v) in new_entries]
            print('  [替换条目] %s → verhash %s (%s)' % (uh, vh, rel))
        else:
            new_entries.append((uh, vh))
            seen.add(uh)
            print('  [新增条目] %s → verhash %s (%s)' % (uh, vh, rel))

    # assetsid: 新 32 hex (任何与旧不同的值都会触发首启重拷 filetable)
    new_assetsid = hashlib.md5(('offline22:' + ','.join('%s:%s' % e for e in new_entries)).encode()).hexdigest()
    print('新 assetsid:', new_assetsid)

    ft_txt = build_filetable(new_entries, new_assetsid)
    ft_bin = build_filetable_bin(new_entries, new_assetsid)

    # allfiles: 原始 + 我们的路径
    allfiles = ''
    if CDN_DIR + '/allfiles.txt' in names:
        allfiles = zin.read(CDN_DIR + '/allfiles.txt').decode('utf-8', errors='replace')
        if not allfiles.endswith('\n'):
            allfiles += '\r\n'
    allfiles += '\r\n'.join('/' + rel for rel in sorted(inject_files)) + '\r\n'

    # ── 逐项检查 index.js / manifest ──
    idx_data = zin.read('assets/scripts/index.js')
    idx_new = patch_index_js(idx_data)
    print('index.js 已打补丁 (updateDcc 禁用)')

    mf_data = zin.read('AndroidManifest.xml')
    mf_new, ok = patch_version_code(mf_data)
    print('AndroidManifest versionCode 1020→1022:', 'OK' if ok else '未命中(跳过)')

    # ── 重写 ZIP ──
    inject_names = set(CDN_DIR + '/' + h for h in inject_map)
    with zipfile.ZipFile(out_apk, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zout:
        for item in zin.infolist():
            n = item.filename
            if n == 'AndroidManifest.xml':
                zout.writestr(item, mf_new)
            elif n == 'assets/scripts/index.js':
                zout.writestr(item, idx_new)
            elif n == CDN_DIR + '/filetable.txt':
                zout.writestr(item, ft_txt)
            elif n == CDN_DIR + '/filetable.bin':
                zout.writestr(item, ft_bin)
            elif n == CDN_DIR + '/filetable1.txt':
                zout.writestr(item, ft_txt)      # 备用表同步
            elif n == CDN_DIR + '/assetsid.txt':
                zout.writestr(item, new_assetsid)
            elif n == CDN_DIR + '/allfiles.txt':
                zout.writestr(item, allfiles)
            elif n in inject_names:
                h = n[len(CDN_DIR) + 1:]
                zout.write(inject_map[h], n)
                print('  [替换] %s (%s)' % (n, os.path.basename(inject_map[h])))
            else:
                zout.writestr(item, zin.read(n))
        # ── 关键: 新增 APK 里不存在的哈希条目 (v2.2曾遗漏导致全部走CDN!) ──
        existing = set(names)
        for h in sorted(inject_map):
            entry = CDN_DIR + '/' + h
            if entry not in existing:
                zout.write(inject_map[h], entry)
                print('  [新增] %s (%d B)' % (entry, os.path.getsize(inject_map[h])))
    zin.close()
    print('输出:', out_apk, os.path.getsize(out_apk), 'bytes')


if __name__ == '__main__':
    main()
