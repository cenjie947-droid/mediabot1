# 贴吧需求雷达 V2.3

线上入口：https://tieba-demand-radar.onrender.com

本项目独立部署在 Render 和独立 Supabase 项目中，不修改 MediaBot 的 main 分支或原 Supabase 项目。

## 已实现
- 手机端需求池、JSON 备份、导入、分类、去重、评分、私信草稿
- 需求类型：书籍、影视、游戏、音乐、软件工具、设计创作、开发技术、写作翻译、数据办公、资料
- 线下/实物需求及广告风险过滤
- 手动扫描：前端调用 Supabase Edge Function，需登录
- 自动归档：扫描后结果自动加入用户需求池并同步
- 全局扫描库：public.scanned_demands，登录用户只读
- 每日自动扫描：Supabase pg_cron，每天 09:00 新加坡时间；仅当 Vault 中已配置百度千帆 API Key 才会发起调用
- API Key 在设置页提交后加密存入 Supabase Vault，不写入浏览器存储或 Git 仓库
- 每日 API 调用安全上限 40 次，低于百度公开免费额度上限
- 搜索仅限 HTTPS tieba.baidu.com 主域名，近 30 天，结果按 URL 去重
- 私信只生成草稿，不自动发送

## 自动扫描配置
在应用“设置与备份”中登录后，填写百度千帆 API Key 并点击“安全保存密钥”。保存后每日定时任务自动启用。密钥由 Supabase Vault 加密保存。

Supabase Edge Function 源码位于 supabase/functions/tieba-demand-scan/index.ts。数据库使用 pg_cron + pg_net 调度，运行记录在 cron.job_run_details。

## 重要边界
- 数据来源是百度搜索引擎收录的公开贴吧页面，不是贴吧全量数据或官方实时数据接口。
- 搜索范围近 30 天，未收录或已删除内容无法保证发现。
- 分类/评分是规则初筛，不是大模型判断；结果仍需人工核实。
- 不绕过贴吧登录、验证码或访问控制，不自动发送私信。
- 百度 API 免费额度以其控制台和官方文档为准；应用每天最多预留 40 次搜索调用，不自动开通后付费。
- Render 免费 Web Service 可能休眠；定时任务由 Supabase 数据库调度，不依赖 Render 常驻进程。

## 开发
- `npm test --prefix tieba-demand-radar`
- `deno check supabase/functions/tieba-demand-scan/index.ts`
- `npm start --prefix tieba-demand-radar`
