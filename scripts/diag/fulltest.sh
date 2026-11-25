#!/bin/bash
# 完整流程测试: 清档→重载→创角→等待→截图+日志
NAME=$1
cd /home/z/my-project
agent-browser eval "localStorage.clear(); 'ok'" > /dev/null 2>&1
(python3 scripts/testsrv.py > tmp/testsrv_now.log 2>&1 &)
sleep 1
agent-browser open "http://127.0.0.1:8899/appindex.html" > /dev/null 2>&1
sleep 22
agent-browser eval "$(cat /home/z/my-project/scripts/diag/tapinject.js)" > /dev/null 2>&1
agent-browser eval "__tap(375, 1130)" > /dev/null 2>&1
sleep ${2:-14}
agent-browser screenshot /home/z/my-project/tmp/${NAME}.png > /dev/null 2>&1
echo "── 日志(异常/关键):"
agent-browser eval "JSON.stringify(__DLDL_VSERVER__.log.filter(function(l){return l.indexOf('HeartBeat')<0&&l.indexOf('S→C')<0}))" 2>&1 | python3 -c "
import json,sys
t=sys.stdin.read(); i=t.find('\"[')
if i>=0:
    for l in json.loads(json.loads(t[i:].strip())): print(' ', l[:180])
" 2>/dev/null
echo "── 注入统计:"
agent-browser eval "JSON.stringify(__DLDL_VSERVER__.stats)" 2>&1 | head -2
