#!/usr/bin/env python3
"""ilanzou (蓝奏云优享版) API 探测脚本
逆向结论:
- apiBaseURL: https://apis.ilanzou.com/
- AES-128-ECB, PKCS7, key='lanZouY-disk-app', hex大写输出
- 请求拦截器: headers.appToken=cookie, params+={devType,devModel,uuid,extra:2,timestamp:encryptHex(ms)}
- 分享流程: POST /unproved/share/list -> POST /unproved/downLoad/url
"""
import json, time, uuid as uuidlib, sys, urllib.request, urllib.parse, gzip, io
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

KEY = b'lanZouY-disk-app'
BASE = 'https://apis.ilanzou.com/'

def encrypt_hex(text: str) -> str:
    data = pad(text.encode('utf-8'), 16)
    cipher = AES.new(KEY, AES.MODE_ECB)
    return cipher.encrypt(data).hex().upper()

def call(path, params, method='POST', headers=None):
    p = {
        'devType': 2,
        'devModel': 'Chrome',
        'uuid': uuidlib.uuid4().hex[:21],
        'extra': 2,
        'timestamp': encrypt_hex(str(int(time.time()*1000))),
    }
    p.update(params)
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.ilanzou.com/s/psdyDmpVK',
        'Origin': 'https://www.ilanzou.com',
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'appToken': '',
    }
    if headers: h.update(headers)
    req = urllib.request.Request(url, data=b'' if method=='POST' else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read()
            if resp.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
            txt = raw.decode('utf-8', 'replace')
            print(f'[{method} {path}] HTTP {resp.status}')
            print(txt[:1500])
            return txt
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            if e.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
        except Exception:
            pass
        print(f'[{method} {path}] HTTP {e.code}')
        print(raw[:1500].decode('utf-8','replace'))
    except Exception as e:
        print(f'[{method} {path}] ERROR {e}')
    return None

if __name__ == '__main__':
    print('=== /unproved/share/list (shareId) ===')
    call('unproved/share/list', {'shareId': 'psdyDmpVK'})
    print()
    print('=== /unproved/share/list (code) ===')
    call('unproved/share/list', {'code': 'psdyDmpVK'})
    print()
    print('=== /unproved/share/list (id) ===')
    call('unproved/share/list', {'id': 'psdyDmpVK'})
