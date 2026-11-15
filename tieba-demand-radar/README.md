# 贴吧需求雷达 V2（独立分支）
独立 Render 服务与 Git 分支，不修改 MediaBot main。
## 当前能力
- 手机响应式需求池、规则分类、排除原因、优先级评分
- 搜索策略、人工核验私信草稿、JSON 备份/恢复
- Node API：GET /healthz；POST /api/analyze
- Node 内置测试覆盖分类、排除、评分、去重、检索、联系草稿
## 限制
- 数据仍保存在浏览器 localStorage，未实现跨设备云同步。
- 未连接贴吧授权数据源；不读取 Cookie、不绕过验证码/访问控制。
- 未接入外部大模型；评分为规则引擎，不冒充 AI。
- 私信只生成草稿，需人工核验发送；寻源需核实合法来源。
## 运行
npm test；npm start
POST /api/analyze JSON：{"title":"...","content":"...","forum":"...","url":"..."}
