#!/usr/bin/env python3
"""patch_dcc.py — 用 game/ 目录的更新文件替换 APK 内 DCC 缓存
用法: python3 patch_dcc.py <apk路径> <game目录>
DCC 缓存命名: crc32('/'+相对路径) 的8位小写hex
缓存目录: assets/cache/https.__res.xxh5.z7xz.com_xxh5dev/
"""
import sys, os, zlib, zipfile, shutil

def dcc_name(path):
    """DCC 缓存文件名 = crc32('/'+path) 8位小写hex"""
    return format(zlib.crc32(('/' + path).encode('utf-8')) & 0xFFFFFFFF, '08x')

def main():
    apk, game_dir = sys.argv[1], sys.argv[2]
    if not os.path.isfile(apk):
        print('APK 不存在:', apk); sys.exit(1)
    if not os.path.isdir(game_dir):
        print('game 目录不存在:', game_dir); sys.exit(1)

    # 收集 game/ 下所有文件
    files = {}
    for root, _, names in os.walk(game_dir):
        for n in names:
            full = os.path.join(root, n)
            rel = os.path.relpath(full, game_dir).replace('\\', '/')
            files[rel] = full
    print('待更新文件 %d 个:' % len(files))
    cache_dir = 'assets/cache/https.__res.xxh5.z7xz.com_xxh5dev'
    mapping = []
    for rel in sorted(files):
        h = dcc_name(rel)
        mapping.append((rel, h, files[rel]))
        print('  %-28s → %s' % (rel, h))

    # 重写 ZIP
    tmp = apk + '.new'
    with zipfile.ZipFile(apk, 'r') as zin:
        names = zin.namelist()
        # 验证缓存目录存在
        cache_files = [n for n in names if n.startswith(cache_dir + '/')]
        print('APK 内 DCC 缓存文件数:', len(cache_files))
        replaced = 0
        with zipfile.ZipFile(tmp, 'w', zipfile.ZIP_DEFLATED) as zout:
            for item in zin.infolist():
                n = item.filename
                target = cache_dir + '/'
                if n.startswith(target):
                    h = n[len(target):]
                    for rel, hh, full in mapping:
                        if hh == h:
                            zout.write(full, n)
                            replaced += 1
                            print('  [替换] %s (%s)' % (n, rel))
                            break
                    else:
                        zout.writestr(item, zin.read(n))
                else:
                    zout.writestr(item, zin.read(n))
            # 新增文件 (APK 里没有的 hash)
            existing = set(names)
            for rel, h, full in mapping:
                entry = cache_dir + '/' + h
                if entry not in existing:
                    zout.write(full, entry)
                    print('  [新增] %s (%s)' % (entry, rel))
                    replaced += 1
    print('共更新 %d 个文件' % replaced)
    shutil.move(tmp, apk)
    print('完成:', apk)

if __name__ == '__main__':
    main()
