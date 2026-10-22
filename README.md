# 创作中枢 Creator OS

一个参考 BnsBot 核心工作流、面向 **公众号 + 今日头条 + 抖音短视频机会** 的内容运营系统。

核心不是普通 CMS，而是：

`多平台热点 → Event 聚合 → 内容机会评分 → 平台独立创作 → 发布排期 → 效果回流`

## 产品结构

- **总览**：自动化状态、热点机会、内容资产、发布排期
- **热点雷达**：统一接入 RedFox 等数据供应商，把抖音/小红书/快手/公众号/头条等热点归一为 Event
- **创作者台**：一条热点分别生成公众号深度稿、头条高密度图文、抖音独立短视频导演方案
- **账号**：多公众号、多头条号管理；敏感配置只在服务端处理
- **发帖记录**：草稿、排期、发布、失败统一记录
- **效果**：阅读、点赞、评论、分享等真实数据
- **排行榜**：按历史表现查看内容冠军
- **模板**：模板是内容策略，不只是文字占位符
- **素材库**：封面、图片、参考链接等创作资产
- **AI 助手**：选题、标题、正文、视频脚本与结构分析

## 热点数据层

第一版采用 **Provider Adapter** 架构，不把产品锁死在某一家数据商。

### RedFox

RedFox 当前提供跨平台新媒体数据服务，覆盖抖音、小红书、公众号、快手、视频号、B站、今日头条等，并提供内容搜索、作品详情、账号、热榜洞察等能力。urlRedFox API 文档https://redfox.hk/apis

当前代码**不会猜测或伪造 RedFox 的热榜 endpoint**。实际热榜接口通过 `REDFOX_TREND_ENDPOINTS_JSON` 显式配置，收到真实接口文档后即可接入。这样以后更换数据商只需要新增 Provider，不需要重写 Creator OS。

示例结构：

```json
{
  "douyin": {
    "hot": {"method":"POST","url":"/实际的抖音热榜接口","body":{}},
    "rising": {"method":"POST","url":"/实际的抖音上升榜接口","body":{}}
  },
  "xiaohongshu": {
    "hot": {"method":"POST","url":"/实际的小红书热榜接口","body":{}}
  }
}
```

适配器会统一读取 `title / keyword / hot / growth / rank / url / views / likes / comments / shares / favorites` 等常见字段，并保存原始 JSON，避免丢失供应商数据。

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

REDFOX_API_KEY
REDFOX_BASE_URL=https://redfox.hk
REDFOX_TREND_ENDPOINTS_JSON={}
TREND_SYNC_MINUTES=60
```

**不要把 `REDFOX_API_KEY` 提交到 GitHub 或前端。**生产环境放 Render Environment Variables。

## 平台发布

### 微信公众号

使用微信公众号官方接口：

`AppID/AppSecret → Access Token → 上传封面 → 新建草稿 → 提交发布`

### 今日头条

不伪造不存在的官方发布 API。当前使用独立浏览器自动化桥接服务承接真实登录态；Creator OS 只发送内容 payload，不把 Cookie 放进前端。

### 抖音

第一阶段重点是**热点与视频创作智能**，不是把文章改成视频。视频会独立生成：

`Event → Hook → 时长 → 镜头 → 旁白 → 屏幕文字 → CTA → 后续渲染`

发布适配器后续再接入，不与热点数据层耦合。

## Supabase

先执行：

- `supabase/migrations/20261022_creator_os.sql`
- `supabase/migrations/20261023_multiplatform_trend_radar.sql`

趋势表与旧的素材表分开。热点是**机会来源**，不是普通图片素材。

本次迁移是 additive，不会删除线上旧表或旧数据。GitHub 中移除旧 MediaBot 文件，也不会自动删除已经部署的 Supabase 数据；线上数据清理必须单独确认。

## Render

`render.yaml` 已配置：

- Web：Vite + Express
- Cron：每 5 分钟执行发布 worker；热点按 `TREND_SYNC_MINUTES` 控制，默认每 60 分钟检查一次

## 本地运行

```bash
npm install
npm run build
npm start
```

开发：

```bash
npm run dev
```

## 安全原则

- 不在前端保存 AppSecret、Cookie、Service Role Key、RedFox API Key
- 数据供应商失败时不伪造热点或发布成功
- AI 输出必须人工核验事实
- 视频素材和音乐必须由使用者确认拥有合法使用权
- 不绕过登录、验证码、访问控制或平台反爬机制
