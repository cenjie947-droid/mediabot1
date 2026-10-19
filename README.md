# MediaBot v7

AI 内容运营 SaaS：真实热点 → AI 评分 → AI 内容生产 → 内容库 → 发布队列 → 抖音官方发布适配 → 云端定时任务 → 日志。

## v7 完成内容

- 公网部署准备：Render Web + Cron Blueprint
- Supabase Auth 公网回跳准备（`PUBLIC_APP_URL`）
- 默认真实热点源：Google News RSS 四类主题，可通过 `HOT_FEEDS` 覆盖
- AI 热点评分与 AI 自动内容生产
- 抖音官方 OAuth 授权适配
- 抖音视频上传 + `/video/create/` 官方发布适配；必须先上传视频素材并取得 `video.create` 权限
- 小红书账号接入结构与发布适配器预留；不伪造“模拟发布”，需官方开放平台审核参数
- 发布队列 `publish_jobs`、私有账号 token、私有 OAuth state
- `publish-media` 私有 Storage bucket，用户只能访问自己的素材
- Cron 自动化：抓热点、AI 评分、AI 生产、发布队列

## 本地运行

```powershell
Copy-Item .env.example .env
# 填入 Supabase Publishable/Secret Key 与 AI_API_KEY
npm.cmd install
npm.cmd run build
npm.cmd start
```

打开 `http://localhost:10000`。

## Render 必填

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `PUBLIC_APP_URL`（Render 公网地址）
- `AI_API_KEY`

抖音真实发布另外需要：
- `DOUYIN_CLIENT_KEY`
- `DOUYIN_CLIENT_SECRET`
- `DOUYIN_REDIRECT_URI`
- 在抖音开放平台申请并获得 `video.create` 权限

## 安全

`.env` 不提交 Git。Supabase Secret Key 和平台 access token 只在服务端使用。`private.social_account_secrets` 不授予 anon/authenticated。

## Supabase v7 schema

本版本需要已执行 `v7_real_social_publish` 与 `v7_publish_media_storage` 两个迁移。

## 爆款市场雷达（手动数据 MVP）

此分支新增「爆款雷达」：手动录入公开视频指标，按同一视频的多次快照计算每小时播放增长，并按赛道汇总样本播放、点赞、评论和转发。支持关注赛道、爆款跟随 / 账号垂直两种生产模式；完播率、平均观看时长和 3/5/10 秒留存仅在你确实从账号后台获得时填写。

### 启用方式

1. 在 Supabase SQL Editor 执行 `supabase/migrations/20261020_viral_market_radar.sql`。
2. 重新构建并部署：`npm run build`，然后按现有方式部署到 Render。
3. 登录后打开左侧「爆款雷达」，录入视频链接、标题、赛道和公开指标。
4. 过一段时间后，再录入同一视频的最新播放/互动数据。链接相同会归入同一个视频样本，系统才可以计算增速。

### 数据来源与边界

- 目前没有假设你已获得抖音官方热点 API 权限，也不会伪造全平台视频数、总播放或留存指标。
- 录入的数据仅代表你收集的样本，不代表抖音全平台。只有一条快照时只显示累计指标；至少两次快照才能计算增长速度。
- 公开网页、平台创作者后台、官方授权 API 或合法授权的数据供应商可作为后续来源。请遵守平台条款、隐私和数据使用限制；不要绕过登录、验证码、访问控制或反爬机制。
- 外部公开视频通常无法提供他人视频的完播率、留存曲线和平均观看时长；这些字段应留空，而不是用 AI 猜测。
