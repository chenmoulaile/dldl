#!/usr/bin/env python3
"""testsrv.py — 斗罗大陆H5 单机化 测试服务器 (端口 8899)
规则: 本地 h5root 有文件 → 用本地; 没有 → 代理 CDN (res.xxh5.z7xz.com/xxh5dev/)
"""
import http.server
import socketserver
import os
import sys
import urllib.request
import urllib.error

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tmp', 'h5root')
ROOT = os.path.normpath(ROOT)
CDN = 'https://res.xxh5.z7xz.com/xxh5dev/'
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8899

MIME = {
    '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
    '.json': 'application/json', '.bin': 'application/octet-stream',
    '.txt': 'text/plain', '.atlas': 'text/plain', '.fnt': 'application/octet-stream',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.part': 'application/octet-stream', '.zip': 'application/zip',
    '.webp': 'image/webp', '.xml': 'text/xml', '.ts': 'application/octet-stream',
    '.sk': 'application/octet-stream', '.ani': 'application/octet-stream',
    '.lc': 'application/octet-stream', '.thdata': 'application/octet-stream',
}

LOG = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'tmp', 'testsrv.log'), 'a')


def log(msg):
    LOG.write(msg + '\n')
    LOG.flush()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt, *args):
        pass

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        if ext in MIME:
            return MIME[ext]
        return super().guess_type(path)

    def _proxy(self):
        url = CDN + self.path.lstrip('/')
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
                ctype = r.headers.get('Content-Type', 'application/octet-stream')
            self.send_response(200)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            log('PROXY %s -> %d B' % (self.path, len(data)))
        except urllib.error.HTTPError as e:
            self.send_error(e.code)
            log('PROXY404 %s' % self.path)
        except Exception as e:
            self.send_error(502)
            log('PROXYERR %s %s' % (self.path, e))

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = self.path.split('?')[0].split('#')[0]
        if path in ('/', '/appindex.html', '/index.html'):
            f = os.path.join(ROOT, 'appindex.html')
            if os.path.isfile(f):
                self._serve(f)
                return
        local = os.path.normpath(os.path.join(ROOT, path.lstrip('/')))
        if local.startswith(ROOT) and os.path.isfile(local):
            self._serve(local)
            return
        self._proxy()

    def _serve(self, f):
        try:
            with open(f, 'rb') as fh:
                data = fh.read()
        except OSError:
            self.send_error(404)
            return
        self.send_response(200)
        self.send_header('Content-Type', self.guess_type(f))
        self.send_header('Content-Length', str(len(data)))
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(data)
        log('LOCAL %s %d B' % (self.path, len(data)))


class TS(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == '__main__':
    if not os.path.isdir(ROOT):
        os.makedirs(ROOT, exist_ok=True)
    print('testsrv: root=%s port=%d cdn=%s' % (ROOT, PORT, CDN))
    with TS(('0.0.0.0', PORT), Handler) as httpd:
        httpd.serve_forever()
