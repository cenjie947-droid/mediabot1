# 贴吧需求雷达 V2.2

独立部署在 Render，不修改 MediaBot 的 main 分支或原 Supabase 项目。

## 当前功能
- 手机端需求池、JSON 备份、导入与需求分类
- 书籍、影视、游戏、音乐、软件工具、设计创作、开发技术、写作翻译、数据办公、资料等规则分类
- 线下/实物需求与部分广告风险词过滤、需求评分、重复线索过滤
- 百度千帆网页搜索接口适配器，服务端密钥，不暴露给浏览器
- 搜索结果只保留 HTTPS 的 tieba.baidu.com 主域名链接
- 需求加入、来源链接、候选记录、人工联系草稿
- 独立 Supabase 项目及 RLS 用户隔离
- 服务启动前检查前端内嵌 JavaScript 语法

## 搜索启用
Render 服务 Environment 中设置 BAIDU_QIANFAN_API_KEY。
API: POST https://qianfan.baidubce.com/v2/ai_search/web_search
调用时用 search_filter.match.site 限定 tieba.baidu.com。百度官方文档目前说明每月免费额度 1,500 次、按天发放，超出免费额度需要后付费开通；本应用不自动开通后付费，也不擅自产生费用。

## 真实边界
- 搜索引擎收录结果，不等于贴吧全量实时数据；未收录/已删除帖子不会被可靠发现。
- 当前规则分类不是大模型语义判断；结果需人工复核。
- 当前尚无定时扫描及云端自动入库；未配置 API Key 前搜索不会返回假结果。
- 不自动登录贴吧、不绕过验证码或访问控制、不自动发私信。
- Render 免费服务可能休眠。

## 本地测试
npm test
