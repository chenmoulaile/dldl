# MEMORY — 斗罗大陆H5 单机化项目记忆文档

更新: 2026-11-25 07:10 (UTC+8) | 阶段: 【v2.1 已发布】全系统修复完成

## 一、任务需求(用户) — 验收状态
1. 剧情/觉醒武魂/任务 正常顺序 ✅ (200001-200010全通, 五武魂选择)
2. VIP 默认无(未开通) ✅ | 金币正常显示非乱码 ✅ (修复负数bug)
3. HUD 上下/充值活动 ✅ | 货币增减闭环 ✅ (任务奖励+商店扣费)
4. 外挂菜单(GM面板) ✅ (金币/钻石/等级/猎场令牌/聊天/删档)
5. 假人系统 ✅ (主城22个游走+世界聊天每9秒)
6. GitHub: chenmoulaile/dldl (token in .ghtoken)

## 二、v2.1 APK (已发布)
- Release: v2.1-offline / dldlh5_offline_v2.1.apk (142.6MB)
- **自动构建**: push game/** → GitHub Actions (build-apk.yml)
- 签名: keystore/dldl.jks (alias=dldl, pass=dldl123456, 固定)
- 流程: 下载v2.0 → patch_dcc.py注入 → zipalign → apksigner → 上传release

## 三、关键技术(全部已验证)
### DCC 缓存 (APK资产)
- 哈希: crc32('/'+路径) 8位hex; 缓存目录 assets/cache/https.__res.xxh5.z7xz.com_xxh5dev/
- **v2.0 filetable 关键映射**: /js/vserver.js=c080f221, /js/idmap.js=4caac671,
  /appindex.html=d787e48a, /ver.js=8dcb20bc, /js/main.js=53817d39
- game/ 目录必须与URL路径一致 (vserver.js 必须在 game/js/ 下!)
- filetable.txt: "ffeeffee 1" + N行[urlhash verhash]

### 协议序列化 (血泪教训)
- Bean: int=varint+zigzag; long=varint64+zigzag64; bean=[0/-1标记]+内联
- difObject(int→bean,ITEM_MAP): [key][present=0][typeId][beanMark=0][字段...]
- **TinyMailsInfo 手写循环bean**: [beanMark][mapMark][count] 3字节, 反射会多写1字节!
- ResCoinGoldUpdate: total发绝对值+positive=true (客户端 total = positive?e:-e)
- ResAddGoods/-1910: 物品入包, 登录时goods字段下发全背包

### 已实现系统 (vserver.js)
- 任务链: 客户端taskNextCondDef驱动, completes上报, 奖励=firstTime配置
- 切图: -1201→-1209; 等级: -1401 ResLevelUpdate; 经验曲线 60*lv*(lv+1)
- 属性: MAXHP=1000+lv*800, ATK=80+lv*60 (id: 6/9/15/18/19/16/25)
- 顶栏按钮: -2601 SM_FunctionButtonOpen (openType=2按任务key解锁)
- 商店: -2701/-2703/-2704 买卖扣费+发货; 令牌913(昊天锤)等14种
- 假人: CITY_BORN(3525,2825)±800, SM_Chat(-2203)世界聊天
- GM菜单: 金币/钻石/等级+1+5/经验满/猎场令牌/聊天开关/存档/删档

## 四、测试环境
- testsrv: python3 scripts/testsrv.py (8899, 本地优先+CDN代理)
- CDN: res.xxh5.z7xz.com/xxh5dev/ (15MB/s快, GitHub Release限速13KB/s!)
- 测试: agent-browser open http://127.0.0.1:8899/appindex.html + tapinject.js
- 自动剧情: scripts/diag/autostory.js; 序列化调试: dbg_detail.js
- VLM截图验证: z-ai vision -i xxx.png

## 五、恢复指引
1. cd work && git pull
2. 起服务: python3 scripts/testsrv.py & agent-browser open http://127.0.0.1:8899/appindex.html
3. 改 game/js/vserver.js → git push → Actions自动构建新APK (v2.1 release)
4. 用户安装: https://github.com/chenmoulaile/dldl/releases (v2.1-offline)

## 六、已知限制/待办
- 猎场BOSS战: 皇家猎场面板/引导/令牌OK, BOSS怪物spawn机制未完全走通(isExploreBossMap mapType=28)
- 排行榜假数据未做; 更多活动面板可按需补 -5109→-5110 autoReply
- 剧情对话需手动点击推进(真机可玩), autostory.js仅测试用
