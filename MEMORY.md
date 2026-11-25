# MEMORY — 斗罗大陆H5 单机化项目记忆文档

更新: 2026-11-25 04:00 (UTC+8) | 阶段: 【阶段3·完整单机化 v2】H5端核心链路全通

## 一、任务需求(用户)
1. 老网游完全单机化: 剧情/觉醒武魂/任务/商店/金币增减 全部正常
2. VIP 默认无(未开通) ✓ | 金币正常初始值(10000)非乱码 ✓
3. HUD 上下正常显示 ✓ | 充值活动HUD ✓
4. 外挂菜单(GM面板: 金币/钻石/等级/删档) ✓
5. 假人系统(主城游走+聊天) 部分完成
6. work=代码 dist=APK tmp=临时; GitHub: chenmoulaile/dldl (token in .ghtoken)

## 二、v2 架构(核心技术)
- **vserver.js v2**: JS层虚拟服务器, hook SocketHandler.connect/sendPackage
- **运行时反射引擎**: 解析客户端 Laya.__classmap 消息类 reading().toString()
  → wire操作序列(含 readBean1/readFloat/-1==标记/无名读取/getValByType循环体)
  → writeOps 通用序列化器(4376消息全覆盖)
- **idmap.js**: 4376条 消息ID→类名 映射(负数键必须加引号!)
- **关键坑**:
  - ResLoginPlayerDetailInfo(-1107) 107字段: newcomerGuideIDs 需 [ff][00] 特殊布局(迭代插入法验证)
  - wSoulInfo/hunheInfoVO/magicHerbInfo/expPoolInfo/tinyMailsInfo/magicHerbBag 不能为null(空实例)
  - jewelInfo 需空nest [00][00]; equips 需空数组[00][00]
  - -1607 同ID冲突: SM_Task_Info 为真(MessagePool注册为准)
  - 两个同名WSoulVO: 详情用 x5Protocol.wsoul.bean(带playerSoulInfo map)
- **探索任务系统(剧情驱动)**: SM_Load_Explor(-1626) 推送主线任务链
  200001斗罗大陆→200002觉醒仪式→200003觉醒大殿→200004武魂觉醒→200005附体...
  CM_Choose_Explor_Task(-1627)/CM_Reward_Explor(-1630) → 推进链
- **武魂觉醒**: CM_ChooseSoul(-9701)→SM_ChooseSoulSuccess(-9702)+SM_WSoulObjUpdate(-9710)
  觉醒地图id=90012(isJueXingMap: 90012或90014-90018)

## 三、已验证通过的流程(H5浏览器端)
1. 清档→创角→进游戏(觉醒地图) ✓
2. HUD全显示: 战力/等级/金币(紫钻图标)/VIP"未开通"/底部菜单 ✓
3. 剧情: 200001对话(点击推进)→选择→200002觉醒仪式(前往寻路) ✓
4. 武魂数据层: CM_ChooseSoul→playerSoulInfo[1]={id:13,level:1} ✓
5. GM菜单: 金币+1万→save.gold 10000→20000→HUD实时更新(ResCoinGoldUpdateMessage -1006) ✓
6. 活动自动响应: CM_OpenActivity→SM_OpenActivity 反射生成 ✓
7. agent-browser测试链: scripts/diag/fulltest.sh (tapinject.js 每次reload后必须重注入!)

## 四、剩余工作
- [ ] 商店购买扣款(CM_CoinshopBuy -2706 等) + 背包物品
- [ ] 假人完善(主城cansee已写,聊天定时) + 排行榜假数据
- [ ] 剧情200002+的分步action(对话10003等, 真机可玩)
- [ ] APK重打包: repack.py + DCC注入(inject_dcc.py已有) + idmap.js/appindex.html 更新
- [ ] GitHub Actions 模拟器整机测试
- [ ] 最终签名交付 dist/

## 五、环境
- testsrv: python3 scripts/testsrv.py (8899端口, 本地优先CDN代理)
- 测试页: http://127.0.0.1:8899/appindex.html (agent-browser set viewport 720 1280)
- CDN: res.xxh5.z7xz.com/xxh5dev/ 允许CORS(*) — 资源直连不依赖本地服务器
- msgs.json: tmp/msgs.json (4376消息+1793bean schema, parse_msgs.py生成)
- 诊断: scripts/diag/{diag_detail,trace_read,dv_trace,client_read,insert_probe,iter_fix}.js

## 六、恢复指引
1. cd work && git pull
2. 起服务: python3 scripts/testsrv.py
3. agent-browser open http://127.0.0.1:8899/appindex.html + scripts/diag/tapinject.js
4. 按"四、剩余工作"继续
