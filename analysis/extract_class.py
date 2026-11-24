#!/usr/bin/env python3
"""从混淆JS中提取类定义(含继承链),用于协议分析"""
import re, sys

def extract_class(js, name, max_len=6000):
    """提取 var NAME=function(e){...}(...) 形式的类定义"""
    pat = re.escape(name) + r'=function\('
    m = re.search(pat, js)
    if not m:
        return None
    # 从此处向后找配对的 }(ParentClass) 结尾
    start = m.start()
    depth = 0
    i = js.index('{', m.end() - 1)
    # 简单扫描: 找 __cl( 调用后的类体结束 "}(...)"
    end_pat = re.compile(r'\}\((\w+)\),')
    seg_end = min(len(js), start + max_len * 3)
    em = end_pat.search(js, start, seg_end)
    if not em:
        return js[start:start + max_len]
    return js[start:em.end()]

def main():
    limit = 4000
    files = {
        'main': open('/home/z/my-project/tmp/cdn/main_004827.js', encoding='utf-8', errors='replace').read(),
        'module': open('/home/z/my-project/tmp/cdn/module_002279.js', encoding='utf-8', errors='replace').read(),
        'login': open('/home/z/my-project/tmp/cdn/login_001599.js', encoding='utf-8', errors='replace').read(),
        'gm': open('/home/z/my-project/tmp/cdn/GameMain.max_004325.js', encoding='utf-8', errors='replace').read(),
    }
    names = sys.argv[1:]
    for name in names:
        for fn, js in files.items():
            code = extract_class(js, name)
            if code:
                print(f"===== {name} (from {fn}) =====")
                print(code[:limit].replace('\n', ' '))
                print()
                break
        else:
            print(f"===== {name}: NOT FOUND =====")

if __name__ == '__main__':
    main()
