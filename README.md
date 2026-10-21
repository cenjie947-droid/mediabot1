# 创作中枢 Creator OS

一个参考成熟内容运营助手工作流、面向 **微信公众号 + 今日头条** 的内容生产与发布 Web 应用。

> 不是 Binance Square 助手，也不包含 Binance、抖音或小红书业务。旧 MediaBot 的平台代码、雷达、视频剪辑模块和旧迁移已从本分支移除。

## 产品结构

- **总览**：内容资产、已发布、待审核、排期、账号状态
- **创作者台**：标题 / 摘要 / 正文 / 封面，AI 生成、润色、保存草稿、立即发布、定时发布
- **账号**：多公众号、多头条号管理；敏感配置只在服务端处理
- **发帖记录**：草稿、排期、已发布、失败统一记录
- **效果**：阅读、点赞、评论、分享等作品表现
- **排行榜**：按历史表现查看自己的内容冠军
- **模板**：公众号深度文章、头条高点击、双平台主稿等可复用模板
- **素材库**：封面、图片、参考链接统一归档
- **AI 助手**：选题、标题、正文、润色、内容体检
- **我的**：工作区和安全设置

## 平台发布

### 微信公众号

使用微信公众号官方接口完成：

`AppID/AppSecret → Access Token → 上传封面 → 新建草稿 → 提交发布`

账号凭据加密保存在 `creator_accounts.secret_payload`，不会发送到浏览器。生产环境请务必设置 `ACCOUNT_ENCRYPTION_KEY`。

### 今日头条

头条没有在本项目里伪造“官方开放 API”。当前设计为 **浏览器自动化桥接适配器**：Creator OS 将标题、正文、封面和作品 ID发送到你配置的桥接服务，由桥接服务使用真实登录态完成发布。这样可以独立替换 Playwright / Chrome 自动化实现，也不会把 Cookie 放进 Creator OS 前端。

社区已有可参考实现，例如 `xc-2000/toutiao-auto-publisher`、`openclaw-cn/toutiao-ops` 等；本项目只借鉴公开的工作流设计，不复制其代码或绕过平台安全机制。

## 环境变量

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
SUPABASE_SECRET_KEY
ACCOUNT_ENCRYPTION_KEY
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY
AI_MODEL=gpt-4o-mini
PUBLIC_APP_URL
TOUTIAO_BRIDGE_URL
```

## 本地运行

```bash
npm install
npm run build
npm start
```

开发模式：

```bash
npm run dev
```

## Supabase

先执行：

`supabase/migrations/20261022_creator_os.sql`

迁移会建立账号、内容、发布任务、模板、素材和效果数据表，并启用按用户隔离的 RLS。

**注意：** 删除旧迁移文件不会自动删除已经部署到 Supabase 的旧表/旧数据。本次改造针对 GitHub 仓库代码和新版本 schema；如果你还要清理线上 Supabase 中旧 MediaBot 数据，应在确认后单独执行数据库清理迁移。

## Render

`render.yaml` 已配置：

- Web 服务：构建 Vite + 启动 Express
- Cron：每 5 分钟执行排期发布 worker

## 安全原则

- 不在前端保存 AppSecret、Cookie、Service Role Key
- 平台未接入或授权失败时绝不伪报“发布成功”
- 头条自动化由独立桥接层承接登录态
- 生产环境必须设置 `ACCOUNT_ENCRYPTION_KEY`
- AI 输出用于辅助创作，热点事实、数据和引用必须人工核验
