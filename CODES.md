# 限次验证码说明

- 每个验证码最多使用 **3 次**（跨设备共享计数）
- 同一浏览器标签页会话内解锁后，「再测一次」不重复扣次
- 旧万能码 `MIAO99` 已失效
- 发码：付款后手动把 6 位码发给买家即可
- 继续造码（在已配置 `MANTLE_KEY` 的机器上）：

```bash
MANTLE_KEY=*** ./tools/mint.sh 10
```

后端：MantleDB 免费 KV（namespace `catquiz-zph420-codes`）。  
可选升级：见 `worker/`（Cloudflare Worker，把写密钥移出前端）。
