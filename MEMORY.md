# MEMORY — 记忆文档(防沙箱重置,每阶段更新)

更新时间: 2026-11-24 00:5x (UTC+8)
阶段: 【阶段1·文件获取】受阻,等待用户重新提供 APK

## 一、任务全貌(用户需求,全部已确认)
1. 把 10+ 年前的联网老游戏(单机逻辑为主,服务器已停)改成**单机离线存档版**
2. 分析登录响应包/协议字段 → 本地构造字段 → 本地回包实现登录
3. **伪造假人,伪造"很多人还在玩"的迹象**(假在线、假聊天、假排行)
4. **外挂菜单** 或 **内购功能**(用户追加需求,做分析后定方案)
5. work=代码跟踪, dist=编译产物, tmp=临时; 需要的工具自行下载安装
6. 阶段性成果上传 GitHub: https://github.com/chenmoulaile/dldl (token 在 work/.ghtoken,勿提交勿外传,用户做完即删)
7. 最终交付编译签名好的安装包

## 二、当前阻塞点(关键!)
- 用户给的分享链接: https://www.ilanzou.com/s/psdyDmpVK (RAR 内含 APK)
- **ilanzou 对阿里云机房 IP 风控**: API 返回空列表,网页显示"该链接已过期,请联系分享者"
  - 已验证 4 个链接(含 2 个公开活跃链接)全部如此 → 是 IP 风控,不是链接失效
  - 用户本地打开该链接应是正常的
- **解决路径:请用户把 RAR/APK 直接作为对话附件上传**(最快),或提供非 ilanzou 的直链
- 已告知用户,等下一轮回复

## 三、已完成的逆向成果(ilanzou 协议,已 100% 验证)
- apiBaseURL: `https://apis.ilanzou.com/`,页面: `https://www.ilanzou.com/s/<shareId>`
- **AES-128-ECB/PKCS7, key = `lanZouY-disk-app`(16字节), 输出 hex 大写**
- 请求拦截器全局参数(query string,POST 空 body):
  - devType: 3(移动UA)/6(PC UA); devModel: 浏览器名(如 Chrome); extra: 2
  - uuid: localStorage 21位随机; timestamp: encryptHex(毫秒时间戳字符串)
- 关键端点:
  - `POST /unproved/recommend/list?shareId=<id>&type=0&offset=1&limit=60` → 分享文件列表
    - 响应: {code:200,status:0|1|2,list:[{fileList:[{fileId,fileName,fileUrl,...}]}]}
    - status=2 → 要提取码; 空列表 → "已过期"(或风控)
  - `POST /unproved/downLoad/url` + params → 下载直链
  - 下载直链构造: apiBaseURL + `unproved/file/redirect?downloadId=<encryptHex(fileId|userId)>&enable=1&devType=<3|6>&uuid=<uuid>`
- 工具脚本: `scripts/ilanzou_api2.py`(call/encrypt_hex 可复用)
- 前端 chunk 结构已摸清(/s/js/chunk.<id>.<ts>.<hash>.js, hash 表在 app js 里)

## 四、环境状态
- Java 21 / Python 3.12 (pycryptodome 已装) / Node 24 / git 2.47 / unrar / zip / keytool
- 待装: jadx, apktool, apksigner/uber-apk-signer(拿到 APK 后再装)
- agent-browser 可用(npm 全局 + @agent-browser/cli-linux-x64-gnu)
- 出口 IP: 北京阿里云(123.57.40.228) — 注意:国内网盘风控高发区

## 五、恢复指引(沙箱重置后)
1. `cd /home/z/my-project/work && git pull` 恢复所有成果
2. 本文件(MEMORY.md)即上下文,按"一、任务全貌"对齐用户需求
3. 阻塞点若仍在:向用户要 APK 附件;若用户已给,跳到反编译阶段
4. GitHub push 命令(勿回显 token):
   `git push origin main` (remote 已内嵌凭证,若失效请用户重新提供)
