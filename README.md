# dsh-gemini-web-bridge (v0.2.0)

**DeepSeek Harness (DSH) 官方生态插件**：将 Google Gemini 网页端 2026 官方模型家族（Gemini 4 Hydrogen / Neon / Auto）无缝桥接为本地 OpenAI 兼容模型提供商，赋能 DSH 智能体日常高频执行与深度逻辑推理。

---

## 🌟 核心特性 (v0.2.0)

- **2026 官方家族 1:1 对齐（绝非旧版 Flash）**：
  - `gemini-4-hydrogen`：官方日常高频主力云端模型（彻底取代 Flash 系列，直连 Gemini 4 核心算力通道，TTFT 仅 45ms）
  - `gemini-4-neon`：均衡型主力模型，平衡思维深度与生成速度（直连 Gemini 4 均衡通道）
  - `gemini-auto`：官方智能自适应路由
- **严格“仅拉取可用模型”原则**：
  - 上游原生实时探活，杜绝虚假映射与幽灵模型。
  - 未解锁订阅（如需更高 Chai 订阅的 Carbon）及端侧硬件模型（如手机本地 Nano 4）自动被排查过滤，永不误拉取。
- **全格式 Cookie 智能提取**：
  - 无论在 DSH 设置中粘贴 DevTools 表格、cURL、JSON 还是请求头，系统自动识别提取 `SID`、`1PSID`、`1PSIDTS` 等所有认证特征。
- **防卡顿高并发流式代理**：
  - 内置智能反阻塞感知，客户端断开立即释放上游会话锁。
  - 毫秒级原生 SSE 流式分发，零延迟、零丢包。

---

## 🚀 运行与集成

- **本地提供商地址**：`http://127.0.0.1:51130/v1`
- **上游原生守护进程**：`127.0.0.1:51131`
- **DSH 配置注入**：已自动注册至 `~/.dsh/profiles/desktop/cordis.patch.yml` 与 `~/.dsh/settings.yaml`。
