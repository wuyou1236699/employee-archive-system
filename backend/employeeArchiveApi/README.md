# employeeArchiveApi

CommonJS 云函数源码，入口 index.main，目标 Node.js 18.15。附件、合同、车辆业务实现来源于已验收版本；环境映射、显示术语与季度演示维度已脱敏，不带真实数据或部署配置。

npm ci --ignore-scripts --no-audit --no-fund 按 npm-shrinkwrap.json 安装，npm run check 检查语法，npm test 使用本地虚构数据库与存储适配器。SDK 固定 3.18.3。完整后端测试的已知注册诊断计数失败见根 README，不能宣称全部测试通过。

image-registration.fixture.cjs 仅供本地联通回归，不能纳入部署包。虚构 storage authority 不能用于真实云端。默认运行测试不初始化真实 SDK 或连接数据库；不要配置真实凭据运行不受控测试。新环境部署与验收请参阅 ../../docs/CLOUDBASE_DEPLOYMENT.md。
