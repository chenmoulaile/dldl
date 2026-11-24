# ilanzou(蓝奏云优享版) 分享/下载协议逆向

> 逆向自 https://www.ilanzou.com/s/<shareId> 前端 (Vue3 SPA, 2026-11 抓取)
> 验证方式: 与真实浏览器请求/响应逐字段比对, timestamp 密文解密一致性确认

## 1. 基础设施
| 项 | 值 |
|---|---|
| 页面 | https://www.ilanzou.com/s/{shareId} (Vue, /s/js/*.js) |
| API | https://apis.ilanzou.com/ |
| 文件CDN | https://web.feejii.com/ (fileBaseURL) |

## 2. 签名算法(已验证)
```
AES-128-ECB / PKCS7 / key = b"lanZouY-disk-app"
encrypt_hex(s) = AES_ECB_PKCS7_encrypt(s).hex().UPPER
```
- 所有请求的 `timestamp` 参数 = encrypt_hex(毫秒时间戳的十进制字符串)
- 下载直链的 `downloadId` = encryptHex("<fileId>|<userId 或空串>")

## 3. 请求规范
- 方法: POST, **body 为空**, 参数全部在 query string
- 拦截器自动附加:
  - `devType`: 3(移动端UA) 或 6(PC UA)  ← 由 navigator.userAgent 判定
  - `devModel`: 浏览器名 ("Chrome")
  - `uuid`: localStorage 持久随机 21 字符
  - `extra`: 2
  - `timestamp`: 见上
- Headers: 常规浏览器头; appToken cookie 仅登录后接口需要

## 4. 端点清单(模块9403, app.765c26a5.js)
| 导出名 | 端点 | 用途 |
|---|---|---|
| lf | /unproved/recommend/list | 分享页首屏文件列表(带 shareId!) |
| _b | /unproved/share/list | 文件夹内翻页/搜索 |
| zx | /unproved/downLoad/url | 获取下载直链 |
| sT | unproved/file/redirect | 下载直链前缀(带 downloadId 签名) |
| hX | /proved/file/report | 举报(登录) |
| 其余 | /proved/*... | 登录后网盘管理功能 |

### 分享列表调用
```
POST /unproved/recommend/list?...&shareId=<id>&type=0&offset=1&limit=60
响应: {msg, code:200, status, total, list:[{fileList:[{
  fileId, fileName, fileUrl, fileIcon, fileSize, iconId, type, fileDesc,
  folderId, folderName, folderDesc, fileType
}]}]}
status: 0=正常 2=提取码错误/需要提取码
```

### 下载直链构造
```
GET https://apis.ilanzou.com/unproved/file/redirect
  ?downloadId=<encryptHex(fileId|userId)>&enable=1&devType=<3|6>&uuid=<uuid>
```

## 5. 风控发现(重要)
从**数据中心 IP**(阿里云北京)访问时:
- 所有 shareId(无论真假新旧)均返回 `{"list":[],"status":0}` → 前端渲染"该链接已过期"
- 已用 4 个不同链接交叉验证,含 2 个公开活跃链接 → 结论:机房 IP 软封锁,非链接失效
- 对策:让用户直接提供文件附件,或换非机房出口
