# 贴吧需求雷达 V2.2

独立部署，不修改 MediaBot 的 main 分支或原有 Supabase 项目。

## 线上入口
https://tieba-demand-radar.onrender.com

## 已实现
- 手机端响应式需求池、批量导入、JSON 备份、CSV 导出
- 需求规则分类：书籍、影视、游戏、音乐、软件工具、设计创作、开发技术、写作翻译、数据办公、资料
- 线下/实物需求及广告高风险内容排除、评分、去重
- 新增公开需求扫描界面和服务端 /api/search 接口
- 百度千帆实时网页搜索适配器：服务端密钥 BAIDU_QIANFAN_API_KEY，不会暴露到浏览器
- 搜索结果仅保留贴吧公开链接，展示来源、摘要、日期和原帖链接；用户可逐条加入需求池
- 检索词生成、候选作品/来源/证据记录、私信草稿保存（不自动发送）
- 独立 Supabase 项目：demands、candidates、research_runs、contact_drafts；RLS 按用户隔离
- 服务启动前校验内嵌 JavaScript 语法；Node 单元/HTTP/搜索适配器测试

## 搜索启用条件
在 Render 服务 tieba-demand-radar 的 Environment（环境变量）中设置 BAIDU_QIANFAN_API_KEY。
该密钥只保存在服务端。百度千帆网页搜索 API 官方文档说明接口为 POST https://qianfan.baidubce.com/v2/ai_search/web_search，标准版有免费额度但需开通并取得 API Key。未配置密钥时，界面会明确提示，不会伪造扫描结果。

## 重要限制
- 当前检索来源是百度搜索引擎返回的公开网页引用，不是贴吧全量数据，也不是贴吧官方开放 API。
- 搜索结果是否仍有效、帖子是否真有需求，仍需核验；当前分类为规则初筛，不是大模型语义判断。
- 尚未实现定时自动扫描；需要先配置 API Key 并确认调用额度，再部署定时任务。
- 不绕过验证码、登录保护或平台访问控制；不自动发送私信。
- 免费服务可能休眠或受免费额度限制。

## 开发
- npm test：运行测试
- npm start：启动服务
- GET /healthz：健康检查（含搜索配置状态）
- POST /api/analyze：规则分析
- POST /api/search：百度公开网页搜索
