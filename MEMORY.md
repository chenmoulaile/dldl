# MEMORY — 斗罗大陆H5 单机化项目记忆文档

更新: 2026-11-25 09:45 (UTC+8) | 阶段: 【v2.2 已发布】免登录直进修复完成

## 一、任务需求(用户) — 验收状态
1. **免SDK登录直进游戏** ✅ v2.2 根因修复 (详见三)
2. 剧情/觉醒武魂/任务 正常顺序 ✅ (30001主城出生→老杰克→大师→切图90012→觉醒五选一)
3. VIP 默认有值 ✅ v2.2: 默认3级+部分双倍特权 | 金币正常显示 ✅
4. HUD 上下/充值活动 ✅ | 货币增减闭环 ✅ (任务奖励+商店扣费)
5. 外挂菜单(GM面板) ✅ v2.2画布版(真机可见): 金币/钻石/等级/令牌/聊天/删档
6. 假人系统 ✅ (主城游走+世界聊天) | 剧情手动点击 ✅ (符合原版)
7. 猎场协议 ✅ v2.2 (挑战/结算/奖励/排行/鼓舞/跳过)
8. GitHub: chenmoulaile/dldl (token in .ghtoken) — **每步完成即push**

## 二、v2.2 APK (已发布, Actions自动构建)
- Release: v2.2-offline / dldlh5_offline_v2.2.apk (135.9MB, versionCode 1022)
- 构建: push game/** → build-apk.yml: 下载v2.0基础包+CDN vendor(scrc32校验)→patch_offline.py→签名
- 模拟器测试: emulator-test.yml (联网+飞行模式断网双模式截图)

## 三、v2.1失败根因 (血泪, 勿忘)
1. **presetUrl = CDN index.html = 开发登录页**(内网IP列表+用户名表单), 用户卡死在这
2. v2.1 只注入了 appindex.html, **index.html 从未注入** → 永远走网络下载原始页
3. CDN assetsid 会变(dc731bbd≠本地3ba50ccb) → 每次启动 updateDcc 用 CDN filetable 覆盖本地
4. filetable verhash=scrc32(Laya自制XOR校验): 改过的文件verhash不匹配 → 回源下载
5. conch initHtml 只支持 html/title/head/body/script/meta 六种标签, **style/div 会弹alert**
6. **URL带?query绕过DCC直接走网络** (v2.1 加载器 ?v=Date.now() 是bug)
7. 剧情加载器动态script无执行顺序保证 → 必须onload链式

## 四、关键技术 (全部已验证)
### DCC 缓存机制 (逆向自 LayaNative 开源源码)
- 源码: github.com/layabox/LayaNative1.0 (conch5) Conch/source/common/downloadCache/
- urlhash = crc32('/'+路径) 8位hex; verhash = scrc32(文件字节) 8字节组XOR int64→高低32折叠,0则置1
- **文件不在filetable也会先查 assets!** (__load→_loadFromAssets, chksum=0直接过) — 但在表内的必须verhash匹配
- assetsid.txt(APK内) ≠ 本地记录 → setAssets 清缓存+拷APK的filetable (重装/升级自愈)
- 本地缓存: <cache>/appCache/<crc32(webbase)>/files/<xx>/<hash6>, 文件头 fileShell{magic 0x7788eeff, ver=2, chkSum}
- 持久化白名单: m_vExtNeedSave={png,jpg,wav,ogg} — .html/.js 不持久化(每次网络)
- patch_offline.py: DCC重打+filetable重生成+assetsid更新+updateDcc禁用(assets/scripts/index.js
  的 "return [4 /*yield*/, updateDcc()];"→null)+versionCode直改AXML属性data(u32)

### v2.2 文件布局 (work/game/)
- index.html = appindex.html (conch纯净启动页: 内联ver参数+onload链式加载器+直启com.Game)
- 加载链: idmap_offline→GameMain.max_004325→zlib_offline→login_001599→vserver_offline→main_004827
- vendor.json: CDN依赖钉死scrc32 (GameMain 2ae00607/login eb91d444/main ae8f5c6a/module edce2c89/
  skin 4775222e/files_679txg.bin 645f1f3e +4变体/newCSV 614d6b18)
- ver.js: 钉死版本链 (h5jsUrl=js/main_004827.js)

### 协议 (vserver_offline.js v2.2)
- VIP: SM_VipInfoMessage{tmpVipLv=3,vipExp,castleOpen...spiderTrainDouble}, loginDetail.vipInfo
- 猎场 huntinggame: -15881面板→SM_HuntingGamePlayerInfo/-15874Season, -15888结算→-15889
  {reslut:1,rewards difObject}, -15887鼓舞, -15883宗主, -15872排行, -15890跳过
- 出生点: 30001主城 (200003任务才切90012); 任务链客户端taskNextCondDef驱动
- GM: startGM() 环境判断 → conch画布版(Laya Sprite+Text) / 浏览器DOM版
- scrc32 参考实现: /home/z/my-project/scripts/scrc32.py (559/559 实测对齐)

## 五、测试环境 (本地)
- testsrv: python3 work/scripts/testsrv.py (8899, ROOT已修复指向 tmp/h5root)
- h5root: tmp/h5root/ (index+js新命名+vendor链+autostory.js可 http注入)
- agent-browser 会话重启会丢 localStorage (每次全流程重跑)
- 浏览器回归脚本: /home/z/my-project/scripts/btest_v22*.sh (阶段1-6全通)
- 已验证: 直启→创角(赵若蕊)→30001→200002/200003(金币+500/+5000)→切图90012→
  200004觉醒(点选择按钮x=639,y=531)→soul=33火凤凰→200005/200006→先天满魂力水晶球(待手动长按)
- VLM: z-ai vision -p "提示" -i 图 -o out.json

## 六、恢复指引
1. cd work && git pull
2. 改 game/js/vserver_offline.js → push → Actions 自动构建 v2.2 release
3. 模拟器验证: Actions→emulator-test.yml→Run workflow
4. 用户安装: https://github.com/chenmoulaile/dldl/releases (v2.2-offline)

## 七、已知限制/待办
- 猎场BOSS战: serverFightReal 实时战斗流未实现(战斗演算大工程, 猎场面板/结算协议已就绪)
- 断网美术覆盖: APK 576缓存贴图 vs 版本链需求, 模拟器断网截图验证中
- 排行榜假数据: -15875 空响应(可补); 更多活动面板可按需补 -5109→-5110
- 剧情小游戏(长按水晶球等)需手动操作(符合原版设计)
