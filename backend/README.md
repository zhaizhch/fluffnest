# fluffnest-ai (Go sidecar)

桌宠 AI 后端：大模型对话、天气、新闻 RSS、今日运势等网络逻辑均在此进程中完成。

## 架构

```
Tauri (Rust) ──HTTP 127.0.0.1──► fluffnest-ai (Go)
  窗口 / 托盘 / 状态持久化           LLM · 天气 · 新闻 · 运势
```

## 性能要点

- 进程级复用 `http.Client`（连接池 + HTTP/2）
- 天气缓存 15 分钟、新闻缓存 10 分钟
- 新闻 RSS 并发抓取（信号量限流）
- 长驻 sidecar，避免每次请求冷启动

## 本地构建

```bash
npm run build:go
# 或
bash scripts/build-go-sidecar.sh
```

产物：

- `backend/bin/fluffnest-ai`
- `src-tauri/binaries/fluffnest-ai-<triple>`（供 Tauri `externalBin` 打包）

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/health` | 健康检查 |
| POST | `/v1/bubble` | 短台词 |
| POST | `/v1/chat` | 面板对话 |
| POST | `/v1/fortune` | 今日运势 |
| POST | `/v1/care-voice` | 喝水/久坐台词批量 |
| POST | `/v1/weather` | 天气数字摘要 |
| POST | `/v1/weather-bubble` | 天气摘要 + 性格化防护叮嘱（单次往返） |
| POST | `/v1/news` | 新闻插件先拉实时资讯，再一轮吐槽 |
