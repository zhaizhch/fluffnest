# 绒窝 FluffNest

<p align="center">
  <img src="docs/assets/demo-preview.gif" alt="绒窝 FluffNest 桌面宠物预览 · 暖卡卡" width="448" />
</p>

<p align="center">
  <strong>桌边有个软软的小窝</strong><br/>
  macOS 萌系桌面宠物 · AI 性格对话 · 喝水久坐编舞提醒 · 神经语音 · 多宠图鉴 · 个人免费 · 禁止商用
</p>

<p align="center">
  <a href="https://github.com/zhaizhch/fluffnest/releases/latest"><img src="https://img.shields.io/github/v/release/zhaizhch/fluffnest?style=flat-square&label=Download&color=c4a484" alt="Latest release" /></a>
  <a href="https://github.com/zhaizhch/fluffnest/releases"><img src="https://img.shields.io/github/downloads/zhaizhch/fluffnest/total?style=flat-square&color=8fa3bc" alt="Downloads" /></a>
  <a href="https://github.com/zhaizhch/fluffnest/stargazers"><img src="https://img.shields.io/github/stars/zhaizhch/fluffnest?style=flat-square" alt="Stars" /></a>
  <img src="https://img.shields.io/badge/macOS-12%2B-black?style=flat-square" alt="macOS 12+" />
</p>

<p align="center">
  <a href="https://virtualpet.beer"><strong>官网 virtualpet.beer</strong></a>
  ·
  <a href="https://zhaizhch.github.io/fluffnest/"><strong>网页试玩（暖卡卡）</strong></a>
  ·
  <a href="https://github.com/zhaizhch/fluffnest/releases/latest"><strong>⬇ 立刻下载最新版</strong></a>
  ·
  <a href="./docs/用户安装指南.md">安装指南</a>
  ·
  <a href="./LICENSE">许可（禁止商用）</a>
  ·
  <a href="./docs/support.md">请杯奶茶</a>
  ·
  <a href="https://github.com/zhaizhch/fluffnest/issues">反馈问题</a>
</p>

> **下载许可**：本软件及安装包仅供 **个人免费体验**，**禁止任何商业用途**（售卖、收费分发、广告变现、商业产品内嵌等）。精灵素材亦不可商用。完整条款见 [LICENSE](./LICENSE)。

---

## 30 秒了解

绒窝会在你的 Mac **桌角常驻**一只软软伙伴：眨眼、小蹦跳、点一点就有对话。  
可接入大模型，按宠物性格聊天；微信 ClawBot 还能远程查天气、搜近况、记你的喜好。  
喝水 / 久坐提醒时，宠物会跳一段编舞，并用更贴近人声的神经语音轮换提醒。  
适合摸鱼陪伴，不打扰专注。

| | |
|--|--|
| 平台 | **仅 macOS** 12+（Apple Silicon / Intel） |
| 价格 | **免费下载**（仅限个人非商用） |
| 安装 | 下载 DMG → 拖进「应用程序」 |
| 数据 | 仅保存在本机，不上传账号（AI 需你自备 API Key） |
| 许可 | **禁止商用** · 详见 [LICENSE](./LICENSE) |

---

## 下载安装

### 1. 选对芯片

打开「终端」执行 `uname -m`：

| 输出 | 下载 |
|------|------|
| `arm64` | [**FluffNest_*_aarch64.dmg**](https://github.com/zhaizhch/fluffnest/releases/latest)（M1 / M2 / M3 / M4） |
| `x86_64` | [**FluffNest_*_x86_64.dmg**](https://github.com/zhaizhch/fluffnest/releases/latest)（Intel） |

到 **[Releases · 最新版](https://github.com/zhaizhch/fluffnest/releases/latest)** 的 Assets 里点对应文件。

### 2. 安装

1. 双击打开 `.dmg`
2. 把 **FluffNest** 拖进 **应用程序**
3. 从启动台或「应用程序」打开

### 3. 打不开 / 提示已损坏？

未公证时 macOS 会拦一下。任选其一：

**右键打开**：在「应用程序」里右键 FluffNest → **打开** → 再点打开  

或终端：

```bash
xattr -cr /Applications/FluffNest.app
```

完整排障见 **[用户安装指南](./docs/用户安装指南.md)**。

---

## 功能亮点

| 能力 | 说明 |
|------|------|
| 桌面常驻 | 透明置顶窗；菜单栏托盘可显示 / 隐藏 / 打开面板 |
| 多宠图鉴 | 毛绒、人型、偶像、数码、奇幻、卡卡、Live2D 等；收集进度与徽章 |
| AI 性格对话 | 可选接入 OpenAI 兼容大模型；点击互动、闲聊均按宠物性格生成台词 |
| 微信 ClawBot 智能体 | 远程聊天：天气/新闻/计算/翻译/文档摘要；国内+国际并行检索；时事预取 |
| 个人知识库 | 闲聊里说到的喜好、城市、工作、家人等会自动记入档案，下次秒答「你还记得…」 |
| 想法与日记 | 想法 / 心情 / 日记按日期分类（月→日）存放；支持「日记：…」写入与按时间/关键词回顾 |
| 多智能体协作 | 决策/利弊时可拉研究员+挑刺+方案组并行开会，主智能体综合后口语回复 |
| 快捷右键菜单 | 笑话、科技/娱乐新闻、天气、设提醒、一句聊天；菜单在宠物右侧弹出 |
| 喝水 / 久坐大场面 | 触发后放大提醒条，按角色编舞（跑动 / 摇摆 / 绕圈），满屏连贯移动 |
| 神经语音提醒 | Microsoft Edge 神经中文音色；跳舞期间持续播报，文案由大模型生成且不重复 |
| 自然语言提醒 | 口头说「每 30 分钟喝水」「45 分钟起身」等即可快速设提醒 |
| 定时推送微信 | 每天定点推明日天气 / 资讯简报到 ClawBot 微信 |
| 点击互动 | 单击互动 + 气泡；拖动移动位置 |
| 养成与小铺 | 亲密度分档；每日登录礼；金币解锁更多宠物 |

<p align="center">
  <img src="docs/assets/hero.png" alt="绒窝界面预览" width="720" />
</p>

---

## 怎么玩

| 操作 | 效果 |
|------|------|
| 拖拽宠物 | 移动窗口（移动超过约 6px 才算拖） |
| 单击宠物 | 互动 + 性格台词（开启 AI 时由大模型生成） |
| 右键宠物 | 快捷菜单：笑话 / 新闻 / 天气 / 提醒 / 聊天 |
| 双击宠物 | 打开绒窝面板 |
| 菜单栏图标 | 显示 / 隐藏、打开面板、退出 |
| 微信 ClawBot | 登录后跟宠物远程聊：查近况、记偏好、设提醒与定时推送 |

面板：状态 · 对话 · 图鉴 · 提醒 · 小铺 · 设置（含 AI 开关与 API）。

> **AI 说明**：需在设置中填写兼容 OpenAI Chat Completions 的 API Base / Key / 模型。天气与新闻为公开数据源；语音走 Edge 在线神经 TTS（需联网）。静音开关仍可关闭播报。微信智能体记忆保存在本机 `~/.fluffnest/agent-memory.json`（可用环境变量覆盖）。

---

## 文档

- [用户安装指南](./docs/用户安装指南.md) — 下载、安装、Gatekeeper
- [方案 v1](./docs/方案-v1.md) — 产品与实现对齐
- [部署方案](./docs/部署方案.md) — 发版与 CI

欢迎 **Star**、提 [Issue](https://github.com/zhaizhch/fluffnest/issues)，或把试用截图发回来——早期反馈最有用。

---

## 开发者

环境：macOS 12+、Node 20+、Rust stable、Xcode CLT。

```bash
git clone https://github.com/zhaizhch/fluffnest.git
cd fluffnest
npm install
npm run tauri:dev
```

```bash
npm run tauri:build          # 打 .app
npm run release:package      # 当前架构发布包
./scripts/bump-version.sh 0.2.2
python3 scripts/make-demo-assets.py   # 重新生成 README Demo 图
npm run demo:dev             # 浏览器试玩开发（无需 Key）
npm run demo:build           # 输出到 website/try + website/pets
```

网页试玩（暖卡卡，无需 Key）：
- GitHub Pages：https://zhaizhch.github.io/fluffnest/
- 源码目录：`docs/web-demo/`
- 官网嵌入：https://virtualpet.beer/

博客可 iframe：

```html
<iframe src="https://zhaizhch.github.io/fluffnest/?embed=1" width="320" height="520" style="border:0;background:transparent;max-width:100%" loading="lazy" title="绒窝试玩"></iframe>
```

推送 `v*` tag 后，Actions 会构建 aarch64 + x86_64 并写入 Release。

```bash
npx tsx scripts/verify-quiet-schedule.ts
npx tsx scripts/verify-pet-roster.ts
npx tsx scripts/verify-bond-collect.ts
```

---

## 品牌

| | |
|--|--|
| 中文名 | 绒窝 |
| 英文名 | FluffNest |
| Bundle ID | `com.fluffnest.deskpet` |
| Slogan | 桌边有个软软的小窝 |

技术栈：Tauri 2 · React · TypeScript · Rust · Canvas 2D（Codex 精灵图集）

---

## License / 许可

**个人免费使用 · 禁止商用。**

- 允许：个人下载、安装、本机自用  
- 禁止：售卖、收费分发、捆绑、广告变现、商业产品/服务中使用本软件或宠物素材  
- 完整条款：[LICENSE](./LICENSE)

如需商业授权，请通过 GitHub Issue / 仓库维护者联系。

---

## 请杯奶茶 / Support

个人维护不易。自愿打赏不是购买，也不影响你免费使用。

- 官网打赏页：https://virtualpet.beer/#support
- 说明与二维码：[docs/support.md](./docs/support.md)
- 海外：优先 [GitHub Sponsors](https://github.com/sponsors/zhaizhch)

<p align="center">
  <img src="docs/assets/qr-wechat-v2.png" alt="微信收款码" width="180" />
  &nbsp;&nbsp;
  <img src="docs/assets/qr-alipay-v2.png" alt="支付宝收款码" width="180" />
</p>

<p align="center"><sub>微信 · 支付宝（扫码打赏）</sub></p>
