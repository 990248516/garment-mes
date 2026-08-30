# Roadmap

## Phase 1 — 产品与契约（完成）

- 完成 PRD、数据库设计、PostgreSQL DDL、可点击原型和 OpenAPI 3.1。
- 验证工人扫码、数量守恒、计件更新和移动端布局。

## Phase 2 — AWS 开发环境（进行中）

- 创建 EC2 IAM Role、Instance Profile、安全组和新加坡 ARM64 开发实例。
- 验证实例运行状态、SSM Online、User Data 完成和 Docker 可用。
- 保留当前全公网入站配置的醒目风险标记。

## Phase 3 — MVP Monorepo

- 建立 `apps/api`、`apps/admin-web`、`apps/worker-pwa` 和 `packages/api-client`。
- 以现有 OpenAPI 和数据库设计实现认证、主数据、订单、扎包、扫码报工和计件纵向切片。
- 添加 PostgreSQL、API、Web 和反向代理的容器化开发环境。

## Phase 4 — 验证与部署

- 运行针对性单元测试、类型检查、数据库迁移检查和关键业务烟雾测试。
- 通过 SSM 部署到开发实例，验证移动端扫码流程和管理看板。
- 补充备份、监控、最小权限和安全组收敛方案。
