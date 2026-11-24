# 斗罗大陆H5 — 游戏协议完整逆向(阶段2核心成果)

> 游戏识别: 《斗罗大陆H5》37wan/gm99 发行, LayaAir 引擎, APK 由 37WAN 签名(2022-05-25 构建)
> CDN 仍存活: https://res.xxh5.z7xz.com/xxh5dev/ (build_time=20261119181740, 仍在更新!)
> 错误上报: www.error.dtsh5.5jli.com (墨麟系 dtsh5 框架)

## 1. 加载链
```
conch.presetUrl (Java层注入,待反编译确认)
  → CDN index.html (dev版,含内网服务器列表+登录参数透传)
      username/ip/port/op/server/referer 参数 + sign=md5(username+op+server+time+key), dev key="123456"
  → entertest.html → skin.js + cc.js + server.js + enter.js
  → ver.js: GameMain.max_004325.js / js/login_001599.js / js/main_004827.js / js/module_002279.js
  → WebSocket 连接游戏服
```

## 2. WebSocket 协议 (双向二进制, 大端)

### C→S 帧 (Connecter.writeDecode)
```
[int32 BE len]  = body字节数 + 2
[byte 0]        (标志位)
[int16 BE id]   消息ID(负数)
[body]          Bean序列化消息体
```

### S→C 帧 (SocketHandler.decodeMsg)
```
[int32 BE A]    A = body字节数 + 3
[int32 BE X]    客户端直接忽略
[int16 BE id]
[body]          A-3 字节
```
- A 的 bit24 为压缩标志(代码里实际是死代码,不生效)
- 粘包处理: bytesAvailable<3 则回退等待

### 收包分发
`Connecter.receiveData(id, bodyByteArray)` → messagePool.getMessage(id) → msg.read(body) → getHandler(id).action()

## 3. Bean 序列化 (自研,非AMF3;AMF3代码存在但消息层不用)
| 类型 | 编码 |
|---|---|
| int | 4字节大端 (ByteArrayUtil.compress=false 默认; 若开启则varint+zigzag) |
| long | 8字节: writeInt(high)+writeUnsignedInt(low) |
| string | [int32 len][UTF-8 bytes]; null→len=0 |
| boolean | 1字节 1/0 |
| bean | [byte 0(存在)/-1(null)] + bean.writing() 输出 |
| array | [byte 0][int32 count][元素...] |
| object | [byte 0/-1][int32 count][k,v...] |

## 4. 登录协议链 (conch APK 走 37App 分支)

### C→S ReqLoginFor37App (id=-1122)
```
writeString(account); writeString(op); writeInt(server); writeString(referer);
writeInt(time); writeString(sign); writeString(gid); writeInt(platform); //1=Android
writeString(ext); writeString(imei); writeString(pid); writeString(phoneModel); writeString(phoneOS)
```

### S→C ResLoginPlayerInfoList (id=-1102) → LoginHandler
```
readByte() 状态(-1则跳过)
readInt() count; 循环: readBean(LoginPlayerInfo)
readInt() vipLv; readInt() achievePoint; readInt() gold
LoginPlayerInfo: readLong(playerId), readString(name), readInt(job), readInt(level),
  readInt(reBirthNum), readLong(battleScore), readInt(changeJob), readInt(expiredTime),
  readInt(changeJobType), readInt(sex)
```

### C→S ReqLoginSelectPlayer (id=-1103): writeLong(playerId)
### C→S CM_LoginCreatePlayer (id=-1104): writeString(name),writeInt(job),writeInt(sex),writeInt(soul)

### S→C ResLoginSuccessMessage (id=-1105) → LoginSuccHandler
```
readInt(mapId), readInt(soulId), readLong(playerId)
```

### S→C ResLoginPlayerDetailInfo (id=-1107) → PlayerInfoDetailHandler
巨大: list<PlayerDetailBean> + 金币/各种货币20+种long + isOpenGM(**GM开关!**) +
allianceId/allianceName/nickName + 背包/装备/邮件 + reconnectSign + serverName...
(完整字段表见 main_004827.js 中类定义)

### 其他关键: -1108 ResLoginFail / -1139 SM_LoginWaiting / -1116 SM_Rename / -1128 SM_UpdateReconnectKey
### 心跳: CM_Heartbeat; 重连: CM_Reconnect(account/op/server/.../playerId/mapId/reconnectSign)

## 5. 消息池
2422 条消息注册, 已导出 tmp/msgpool.txt (id\t消息类\tHandler类)

## 6. 单机化方案(已定)
**进程内虚拟服务器**: hook Connecter.prototype.sendPkg → 解析请求(用游戏自己的 CM_ 类 read) →
构造响应(new 游戏自己的 SM_/Res_ 类, 填字段, write()) → 封S→C帧 → 注入 Connecter.receiveData
- 序列化代码 100% 复用游戏自身, 零手写编解码
- 存档: localStorage/文件
- 假人: 虚拟服务器注入伪造玩家数据
- GM: ResLoginPlayerDetailInfo.isOpenGM=true 解锁内置GM系统(外挂菜单基础)
- 完全离线: CDN资源已可全量镜像进APK, presetUrl 改本地

## 7. 待办
- [ ] 反编译APK找 presetUrl 注入点(jadx)
- [ ] CDN 全量资源下载(files_679txg.bin 解析)
- [ ] LoginHandler/LoginSuccHandler 行为分析(登录后自动发什么)
- [ ] 进主城消息流最小集
- [ ] hook JS + 虚拟服务器实现
- [ ] 重编译签名
