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
