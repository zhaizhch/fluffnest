# 绒窝 FluffNest

> 桌边有个软软的小窝

macOS 萌系桌面宠物：**多分类独立宠物**养成与图鉴收集、点击互动、温和提醒，以及「绒窝小铺」金币解锁。常驻透明窗，托盘可随时显示 / 隐藏。

**仓库**：[github.com/zhaizhch/fluffnest](https://github.com/zhaizhch/fluffnest)  
**版本**：`0.2.0`

---

## 下载安装

到 **[Releases](https://github.com/zhaizhch/fluffnest/releases)** 下载对应芯片安装包：

| 芯片 | 文件 |
|------|------|
| Apple Silicon（M 系列） | `FluffNest_*_aarch64.dmg` |
| Intel | `FluffNest_*_x86_64.dmg`（可由 CI 构建） |

安装步骤（含「无法打开 / 已损坏」处理）见 **[用户安装指南](./docs/用户安装指南.md)**。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| 桌面常驻 | 透明置顶宠物窗；托盘显示 / 隐藏 / 打开面板 / 退出 |
| 多宠图鉴 | 毛绒、人型、偶像、数码、奇幻、卡卡等分类；点名字切换出战 |
| 安静陪伴 | 空闲定格 + 约 3 秒眨眼；约每分钟一个小动作 |
| 点击互动 | 左键单击随机动作与对话；拖动可移动窗口 |
| 提醒 | 喝水、久坐、手动会议；打卡得金币 |
| 绒窝小铺 | 金币解锁宠物；实付 / IAP 字段预留 |
| 每日登录 | 连续打卡发金币或解锁宠物 |
| 设置 | 静音、专注模式、始终置顶 |

本地数据：`~/Library/Application Support/com.fluffnest.deskpet/state.json`

---

## 使用说明

| 操作 | 效果 |
|------|------|
| 拖拽宠物 | 移动窗口位置（移动超过约 6px 才算拖拽） |
| 单击宠物 | 随机互动动画 + 气泡对话 |
| 双击 / 右键 | 打开绒窝面板 |
| 菜单栏托盘 | 显示 / 隐藏、打开面板、退出 |

面板页签：状态 · 图鉴 · 提醒 · 小铺 · 设置。

---

## 文档

- [方案 v1](./docs/方案-v1.md) — 产品与实现对齐说明
- [部署方案](./docs/部署方案.md) — GitHub 发版与 CI
- [用户安装指南](./docs/用户安装指南.md) — 最终用户安装与排障

---

## 开发者快速开始

环境：macOS 12+、Node 20+、Rust stable、Xcode Command Line Tools。

```bash
git clone https://github.com/zhaizhch/fluffnest.git
cd fluffnest
npm install
npm run tauri:dev
```

### 常用命令

```bash
npm run tauri:dev          # 开发（热更新前端；改 Rust 会重编）
npm run build              # 仅前端构建
npm run tauri:build        # 打 .app
npm run release:package    # 当前架构发布包 → release/v*
./scripts/bump-version.sh 0.2.1   # 同步版本号
```

推送 `v*` tag 后，GitHub Actions 会构建 **aarch64 + x86_64** 并写入 Release。

### 校验脚本

```bash
npx tsx scripts/verify-quiet-schedule.ts   # 眨眼 / 单击逻辑
npx tsx scripts/verify-pet-roster.ts       # 图鉴与前后端同步
```

---

## 项目结构（简）

```
fluffnest/
├── src/                 # React 前端（pet 窗 + panel 窗）
│   ├── pet/             # 桌宠行为、Canvas 精灵渲染
│   ├── panel/           # 绒窝面板
│   └── lib/             # 宠物目录、API、动作
├── src-tauri/           # Tauri 2 + Rust（状态、托盘、提醒）
├── public/pets/         # Codex 精灵图集
├── scripts/             # 打包 / 校验 / 升版
└── docs/                # 方案与安装文档
```

---

## 品牌

| | |
|--|--|
| 中文名 | 绒窝 |
| 英文名 | FluffNest |
| Bundle ID | `com.fluffnest.deskpet` |
| 商店 | 绒窝小铺 |
| Slogan | 桌边有个软软的小窝 |

---

## 技术栈

Tauri 2 · React 19 · TypeScript · Vite · Rust · Canvas 2D（Codex 精灵图集）

---

## License

私有 / 未声明许可前请勿二次分发商业素材图集。应用代码以仓库内声明为准。
