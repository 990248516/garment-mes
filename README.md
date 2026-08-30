# Garment MES

一套面向服装生产现场的“一扎一码”MES/WIP 系统，帮助工厂实现生产过程数字化、在制品可视化和计件数据可追溯。

## 项目介绍

Garment MES 围绕服装工厂从订单、裁床、扎包到工序报工的核心流程构建。系统为每个扎包生成唯一二维码，工人通过移动端扫码完成开工、完工、异常和计件操作；管理人员可通过后台实时掌握订单进度、在制品（WIP）、质量、返工、异常和员工计件数据。

本项目目前定位为可部署的 MVP，适合用于服装制造数字化方案验证、二次开发和现场试点。

## 核心功能

- **订单与基础资料**：维护订单、款式、颜色、尺码、裁床、缸号和工艺数据。
- **一扎一码**：为扎包分配唯一二维码，建立从裁剪到生产完工的追溯链路。
- **扫码报工**：支持工人开工、完工、良品、次品、短缺及异常上报。
- **生产进度**：实时查看订单进度、工序流转和在制品状态。
- **质量与返工**：记录质量问题、返工过程和相关生产事件。
- **员工与计件**：管理员工、工种技能及本次、当日和当月计件数据。
- **管理看板与导出**：提供生产总览、订单/WIP/异常看板及订单级数据导出。
- **接口契约**：使用 OpenAPI 3.1 维护前后端接口定义。

## 技术架构

- **后端**：NestJS、Prisma、PostgreSQL
- **管理端**：React、Vite
- **工人端**：React/Vite PWA
- **接口契约**：OpenAPI 3.1
- **部署**：Docker Compose、Nginx

## 项目结构

- `apps/api` — NestJS API 与 Prisma 数据模型
- `apps/admin-web` — 管理后台
- `apps/worker-pwa` — 工人扫码报工 PWA
- `packages/api-client` — 前后端共享的类型化 API 客户端
- `api/openapi.yaml` — OpenAPI 接口契约
- `database/schema.sql` — 数据库结构参考
- `infra/nginx` — 网关与前端 Nginx 配置
- `docs` — 产品与数据库设计文档
- `prototype` — 产品原型

## 环境要求

- Node.js 22+
- npm 11+
- Docker 与 Docker Compose

## 本地运行

```bash
cp .env.example .env
npm ci
npm run typecheck
npm run test
npm run build
```

根据 `.env.example` 填写本地环境变量后启动 Docker 服务：

```bash
docker compose up --build
```

请勿提交 `.env`、访问凭据、生产数据或数据库备份。

## 联系方式

如需交流项目、现场试点或二次开发，可添加微信：`zhogn98`
