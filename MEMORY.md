# MEMORY — 记忆文档(防沙箱重置,每阶段更新)

更新时间: 2026-11-24 18:20 (UTC+8)
阶段: 【里程碑】单机化核心链路全部打通,APK v1.0 已产出

## 一、任务全貌(用户需求)
1. 老网游(斗罗大陆H5/37wan/LayaAir)改单机离线存档版 ✅核心达成
2. 分析登录协议→本地回包 ✅
3. 伪造假人在线假象 ✅(主城假人游走中)
4. 外挂菜单/内购 🔜(下阶段;isOpenGM=true 已埋)
5. work/dist/tmp 目录约定 ✅
6. GitHub同步+记忆文档 ✅
7. 交付编译签名安装包 ✅(dist/dldlh5_offline_v1.0.apk 142MB)

## 二、技术架构(全部已验证)
- 游戏: 斗罗大陆H5, LayaAir引擎(conch壳), WebSocket二进制协议
- 协议: [varint32(zigzag)长度][byte 0][int16 BE 消息ID][Bean序列化body]
  - Bean: int=varint+zigzag; long=varint64+zigzag64; string=varint(len)+utf8
  - byte/short/bool=原始; bean=[0/-1标记][内联]; array=[标记][varint count][元素]
- 方案: 进程内虚拟服务器(hook SocketHandler.connect/sendPackage)
  - connect→哑socket{connected:true}→event('open') (isLive依赖!)
  - sendPackage→解析→handleRequest→inject(30-90ms异步,内部强设position=0)
  - 响应注入: Connecter.receiveData(id, ByteArray) via _receiveFun.runWith
- 启动: 修改版appindex.html(直启游戏,绕过37wanSDK) → ver.js(无后缀main/module) 
  → GameMain.max+zlib+login+vserver+main → 设app.Params → new com.Game();gameCaller.init()
- 离线: index.js注入downloadBySourceIp钩子跳过DCC更新; 文件全入DCC缓存(crc32命名)

## 三、登录链(已跑通,全部消息构造在vserver.js)
-1101/-1122登录 → -1102列表(空→创角UI/有→自动选)
-1104创角(CM_LoginCreatePlayer: name,job,sex,soul) → -1102(带角色)
-1103选角 → -1105成功(mapId=30001★主城,查表com.game.switchMap.model.SmallMapCfgObj mapType=1唯一)
  → -1607任务信息(先于-1107!否则TaskModel.initialData null崩) → -1107详情(121字段,见下)
-1005心跳 → -1113回时间戳; -3601进主城 → -3605视野假人 → -3606假人移动(1.6s间隔)

## 四、-1107 ResLoginPlayerDetailInfo 字段表(血泪结晶,120+字段顺序严格!)
PlayerDetailBean26字段: personId,name,job,level,exp,transferJob,rebirthLv,
 attributeVo(★bean实例:obj+obj), skillVo(★bean:byte0+count0+obj), buffEffectsVo(null),
 fruitObj(null), jobType, taskEntry(★bean:int+arr+int+bool), expiredTime, battleScore, starLv,
 createTime, elementInfo(★bean:obj+long), wSoulInfo(★bean:int+arr+arr), sex, souNum, ownPlayerId,
 magicHerbInfo(★bean:obj+arr+obj+int+int), skinId, hunheInfoVO(★bean:obj+arr+obj+int),
 appearVO(null可), fightArmorVo(★bean:int+obj+obj+arr), godTablePlayerInfoVO(★bean:obj+obj+str+int)
主体: gold(int), 28×long, isOpenGM(★true=GM开关!), allianceId(long), allianceName(str),
 alliancePosition(byte), nickName(str), firstLogin(bool), teamPartnerIds(arr),
 mainCityPosition(★bean:int+int), vipInfo(★bean:int+long+9×bool★), newcomerGuideIDs(arr),
 goods(dif), equips(arr), jewelInfo(nest), tinyMailsInfo(★bean+0xff内部标记→空map),
 equipGrids(int), warehouseCount(int), countryId(byte), expPoolInfo(★bean:long+long),
 monthCardType(int), openServerDay(long), activity(int), reconnectSign(str),
 createAccountTime(long), countId(str), showPlayerId(long), allianceLevel(int),
 elementWarehouse(★bean:long+obj), hunhuanBagInfo(★bean:arr+int), elementTreInfo(★bean:int+int),
 fateAttribute(obj), 41×dif, legionShowVo(bean), 3×dif(Trinity/Keel/KeelModule),
 serverName(str), orgServerName(str), serverId(int), orgServerId(int), mergeStatus(int), plat(str)

## 五、关键坑(调试血泪)
1. ByteArrayUtil.compress=true → 全varint+zigzag(帧长度字段也zigzag!)
2. SocketHandler.connected getter查m_socket → 假连接必须建哑socket否则isLive=false→消息全被onCheckReconnectPkg拦截
3. vipInfo必须9个boolean(不是8) 差1字节全线错位
4. -1607必须在-1107之前(TaskModel初始化)
5. 浏览器测试用no-cache+动态时间戳,否则旧JS缓存误导调试
6. DCC缓存hash=crc32('/'+path); filetable.bin=48B头(小端!)+N×8B对
7. CDN仍活着(res.xxh5.z7xz.com/xxh5dev) build_time 2026-11-19

## 六、测试环境(可复现)
- python3 scripts/testsrv.py (8765端口,本地优先+CDN代理,已加no-cache)
- agent-browser open http://127.0.0.1:8765/appindex.html
- 测试脚本: work/analysis/(vserver/appindex/ver.js); trace对拍器scripts/sim_fields.py
- 验收标准: console无TypeError; -3606假人移动刷屏; 截图VLM见主城

## 七、下阶段待办
- [ ] 主城自己角色模型(appearVO补全)/假人外观
- [ ] 外挂菜单(GM面板:isOpenGM已开,查GM命令系统NationalWarControl.triggerGuideEventGM)
- [ ] 内购本地化(拦截pay回调)
- [ ] 核心玩法消息(副本/战斗/背包)
- [ ] 假人聊天/世界频道
- [ ] 真机测试(浏览器已验证,APK待真机)

## 八、恢复指引
1. cd work && git pull
2. 测试: python3 scripts/testsrv.py & agent-browser open http://127.0.0.1:8765/appindex.html
3. 重打包: python3 scripts/inject_dcc.py(如缓存未注入) → scripts/repack.py → uber-apk-signer签名
4. 产物: dist/dldlh5_offline_v1.0.apk
