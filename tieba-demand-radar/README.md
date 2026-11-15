# 贴吧需求雷达 V2.1

独立部署，不修改 MediaBot 的 main 分支或原有 Supabase 项目。

## 线上入口
https://tieba-demand-radar.onrender.com

## 已实现
- 移动端响应式需求池、批量导入、JSON 备份、CSV 导出
- 规则分类、线下/广告排除、评分、规范化去重
- 检索词生成、候选作品/来源/匹配证据记录
- 私信草稿保存（不会自动发送，也不会把草稿误标为已联系）
- 独立 Supabase 项目：demands、candidates、research_runs、contact_drafts
- Supabase Auth 邮箱注册/登录；登录后需求、候选、联系草稿云同步
- 所有业务表启用 RLS，按 auth.uid() 隔离用户数据；anon 角色无业务表读取权限
- 服务启动前用 Node vm.Script 校验内嵌前端 JavaScript 语法
- Node 内置单元测试、HTTP 集成测试及 GitHub Actions 自动测试工作流

## 首次使用
1. 打开线上入口。
2. 在“账号与云端同步”区域输入邮箱和密码注册。
3. 如系统要求邮箱验证，先点击邮件中的确认链接。
4. 回到页面登录；登录后开始云端同步。
5. 可继续批量粘贴公开帖子：标题 | 正文 | 贴吧 | 原帖链接。

## 当前限制
- 规则评分不是大模型推理；尚未配置外部 LLM API。
- 尚未接通贴吧授权/官方数据接口，因此没有后台自动抓帖。
- 公开检索链接由用户手动打开，候选作品需要核实作者、版本、年份和情节。
- 不绕过验证码、登录保护或平台访问控制。
- 私信仅保存草稿，必须人工检查后发送。
- 数据库和 Render 当前使用已确认的免费方案；免费实例可能休眠或受配额限制。

## 开发
`npm test` 运行单元和 HTTP 集成测试。
`npm start` 启动 Web 服务。
`GET /healthz` 健康检查。
`POST /api/analyze` 规则分析 API。
