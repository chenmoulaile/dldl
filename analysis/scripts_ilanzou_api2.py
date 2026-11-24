#!/usr/bin/env python3
"""ilanzou API v2 - 修正devType(3=mobile,6=pc)与参数序列化"""
import json, time, uuid as uuidlib, urllib.request, urllib.parse, gzip
from Crypto.Cipher import AES
from Crypto.Util.Padding import pad

KEY = b'lanZouY-disk-app'
BASE = 'https://apis.ilanzou.com/'

def encrypt_hex(text: str) -> str:
    return AES.new(KEY, AES.MODE_ECB).encrypt(pad(text.encode(), 16)).hex().upper()

def call(path, params=None, dev_type=6, method='POST', extra_headers=None, show=True):
    p = {
        'devType': dev_type,
        'devModel': 'Chrome',
        'uuid': uuidlib.uuid4().hex[:21],
        'extra': 2,
        'timestamp': encrypt_hex(str(int(time.time()*1000))),
    }
    for k, v in (params or {}).items():
        if v is not None:
            p[k] = v
    url = BASE + path + '?' + urllib.parse.urlencode(p)
    h = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.ilanzou.com/s/psdyDmpVK',
        'Origin': 'https://www.ilanzou.com',
        'Accept': 'application/json, text/plain, */*',
    }
    if extra_headers: h.update(extra_headers)
    req = urllib.request.Request(url, data=b'' if method == 'POST' else None, headers=h, method=method)
    try:
        with urllib.request.urlopen(req, timeout=25) as resp:
            raw = resp.read()
            if resp.headers.get('Content-Encoding') == 'gzip':
                raw = gzip.decompress(raw)
            txt = raw.decode('utf-8', 'replace')
            if show:
                print(f'[{method} {path}?devType={dev_type}] HTTP {resp.status}')
                print(txt[:2000])
            return json.loads(txt) if txt.startswith('{') or txt.startswith('[') else txt
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            if e.headers.get('Content-Encoding') == 'gzip': raw = gzip.decompress(raw)
        except Exception: pass
        print(f'[{method} {path}] HTTP {e.code}'); print(raw[:800].decode('utf-8','replace'))
    except Exception as e:
        print(f'[{method} {path}] ERROR {e}')
    return None

if __name__ == '__main__':
    for dt in (6, 3):
        print(f'--- devType={dt} ---')
        call('unproved/recommend/list', {'shareId': 'psdyDmpVK', 'type': 0, 'offset': 1, 'limit': 10}, dev_type=dt)
        print()
