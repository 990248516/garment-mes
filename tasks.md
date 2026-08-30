# Tasks

更新：2026-08-30 09:37 +08:00

## 本轮完成

- [x] 按用户明确选择，将订单 `PO-260526` 计划数量从 40 件增加到 44 件，订单明细同步为 44 件，版本 `2 → 3`。
- [x] 修改前创建数据库备份 `/opt/garment-mes/backups/pre-order-increase-20260830-0932.sql.gz` 并确认非空；条件事务同时校验订单、工厂、状态、旧数量和旧版本。
- [x] 通过预览确认仅剩 4 件、将生成 1 扎且下一个扎序为 12；使用幂等键 `0edf8b40-bfca-5eb7-a31b-c0388d38cd6e` 调用真实生成接口。
- [x] 第 11 个有效扎包生成成功：`478-012`，4 件，状态 `CREATED`，不可变时间线包含 `CREATED`。
- [x] 最终验收：订单计划 44 件、已分配 44 件、有效扎包 11 扎、有效总数量 44 件；登录、预览、生成、读取及注销链路均成功。

- [x] 修复已放行裁床无法追加扎包：原状态校验将首次生成后自动进入的 `RELEASED` 误判为禁止状态；现在仅 `CANCELLED` 裁床禁止生成。
- [x] 继续复用剩余数量、尾扎、超投上限、连续扎序和幂等约束；管理端已有扎包时按钮显示“追加扎包”，取消裁床提示单独区分。
- [x] 新增 36/40 件已分配后从序号 10 追加 1 扎/4 件的回归测试；生产模块 6/6 测试、API 与管理端类型检查通过。
- [x] 发布 `/opt/garment-mes/releases/append-bundles-b39793de1fa8`，SSM 命令 `4ff8c58c-18f1-44ab-a5b7-ed45ea849cd4` 成功，API 与管理端均 healthy。
- [x] 无写入线上验收：床号 478 已有 10 扎、40/40 件全部分配，预览返回 `No quantity remains to allocate` 而非“已放行不能重复生成”；线上 JS 已显示“追加扎包”。
- [x] 本轮未调用生成接口，未创建、修改或删除任何业务数据。若要增加第 11 扎，需要选择拆分现有扎包，或先增加订单数量/授权超投。

- [x] 修复管理端扎包卡“查看流转记录”无效：根因是按钮仅有静态文本且后端缺少 OpenAPI 已声明的时间线处理逻辑。
- [x] 新增 `GET /api/v1/bundles/{bundleId}/timeline`，按工厂隔离、倒序游标分页读取不可变扎包事件，并解析用户/员工操作人名称；权限为 `bundle:trace`。
- [x] 管理端接通真实扎包 ID 和时间线请求，弹窗展示加载、空、错误状态及创建、开工、完工、阻塞、工价调整等事件的时间、操作人和关键详情，并适配移动端。
- [x] API、API Client、管理端类型检查通过；API 28/28 测试、API 与管理端生产构建通过。
- [x] 发布 `/opt/garment-mes/releases/bundle-timeline-abb93298acbe`；CSS 追加命令 `04b24414-8340-43ad-87ad-1a42f6251202` 成功；随后修正未定义的 `--soft`/`--green` 变量，命令 `ff596eed-667e-422a-99f1-6d18ffa4f97b` 重建成功，管理端 healthy。
- [x] 线上真实验收：扎包 `478-011` 时间线 HTTP 200，返回 `CREATED`、`STARTED`、`COMPLETED` 和两条 `PRICE_ADJUSTED`，5 条均解析操作人为“演示工人”；管理端、JS、CSS 均 200，按钮请求逻辑和 `.timeline-backdrop` 样式均存在。
- [x] 本次时间线修复及验收未创建、修改或删除任何业务数据；仅登录读取后注销，继续保留现有测试数据。

- [x] 按用户要求暂停清空测试数据，本轮未删除或修改任何生产业务数据。
- [x] 定位管理端和工人端刷新后退出登录：访问令牌、刷新令牌和当前用户原先只保存在 JavaScript 模块内存，页面重载后全部丢失。
- [x] 两个前端改为仅在当前标签页 `sessionStorage` 保存刷新令牌；访问令牌继续只驻留内存，页面启动自动调用刷新接口轮换令牌并恢复用户、工厂和实时数据。
- [x] 主动退出会清除持久化会话；关闭标签页后仍要求重新登录，降低公网 HTTP 演示环境中长期保存令牌的风险。
- [x] 管理端和工人端类型检查、生产构建通过；发布 `/opt/garment-mes/releases/session-restore-9fd9e5573dca`，两个前端容器 healthy。
- [x] 线上资源均为 200 且包含各自会话存储键和刷新接口；登录 200、连续两次刷新 201、令牌每次轮换、最终注销 204。

- [x] 标准工序调价新增可选“同步调整历史扎包”，覆盖未开工、加工中和已完成；历史同步时调整原因必填。
- [x] 未开工扎包更新工序单价快照，加工中扎包同时更新 STARTED 报工快照；已完成报工的原始单价和原始计件金额保持不变。
- [x] 已完成计件通过关联原记录的 PENDING 正负差额调整，保存原因和操作人，并写入 PRICE_ADJUSTED 扎包事件；恢复原价时自动生成反向差额。
- [x] 数据库取消每个报工仅一条计件的唯一约束，增加 work_report_id 索引和 reason 字段；条件检查约束仅对调整记录允许负数，原始记录安全边界继续保留。
- [x] 部署前数据库备份 `/opt/garment-mes/backups/pre-historical-price-d716b25f8b5a.sql.gz` 已确认存在且非空；条件式升级 SQL 已成功执行。
- [x] 历史调价路由改为 `/api/v1/processes/{processId}/adjust-rate`，修复 Nest/Express 新路由解析器对参数后冒号的不兼容并恢复 API healthy。
- [x] 真实 4 件报工验收：原始金额 `2.0000`；上调生成总差额 `+0.4000`，恢复生成 `-0.4000`；最终计件总额 `2.0000`、工序价格 `0.5000`。
- [x] 生产总览改为按 work_report_id 预汇总计件差额，避免多条调整记录重复累计良品；同时修复 PostgreSQL `date AT TIME ZONE` 重载导致新加坡午夜至 08:00 报工被漏计。
- [x] API 28 项测试、类型检查和构建通过；发布 `/opt/garment-mes/releases/historical-price-final-87336de3090f`，API healthy。
- [x] 公网最终验收：管理端和资源 200，包含“同步调整历史扎包”和“调整原因”；生产总览 `completedQty=4`、计件 `2.0000`、员工良品 `4`，数量未重复。

- [x] 管理端新增“工序价格与员工分配”：逐项维护标准工序单价，并为员工分配扫码时可选工序及 L1–L5 技能等级。
- [x] 工序调价只传播到仍沿用旧默认价的工艺路线；自定义路线价格不被覆盖，已生成扎包、历史报工和工资快照保持不变。
- [x] 工序单价更新使用 If-Match 乐观锁和幂等键，支持最多 4 位小数，并显示保存中、成功及错误反馈。
- [x] API 27 项测试、API/管理端类型检查及生产构建通过；发布 `/opt/garment-mes/releases/process-pricing-ad9cedd1926c`，API healthy、管理端 200。
- [x] 线上调价回滚验收：工序/未来路线 `0.5000 → 0.5500 → 0.5000`，已有扎包单价快照全过程保持 `0.5000`。

- [x] 定位“员工技能管理”不可用根因：按钮缺少点击事件，已有员工、工序和技能 API 从未被页面调用。
- [x] 新增页内技能管理面板：选择员工、勾选多个标准工序、设置 L1–L5 等级并保存。
- [x] 保存时保留既有技能生效/失效日期；历史报工不受技能调整影响，并显示加载、保存、成功或错误状态。
- [x] 管理端类型检查和生产构建通过；发布 `/opt/garment-mes/releases/worker-skills-final-aad1a89be397`，公网管理端及静态资源 200、控制台 0 错误。
- [x] 公网无损验收：员工/工序/技能读取均 200，技能原样保存 200，保存前后数量和有效期一致。

- [x] 定位“生成扎包”无反应根因：管理端按钮缺少 `onClick`，此前未调用任何生成 API。
- [x] 接通真实批量生成接口，按钮显示生成中、成功或错误状态，并在成功后自动刷新二维码卡片。
- [x] 演示订单与裁床统一为 40 件可分扎数据；保留原 4 件扎包后生成剩余 9 扎/36 件。
- [x] 管理端与 API 类型检查、生产构建通过；发布 `/opt/garment-mes/releases/bundle-generate-state-16c7dfb403a7`，API healthy。
- [x] 公网完整链路验收：登录 200、生成 201，扎包由 1 扎变为 10 扎，总数量 40 件；控制台 0 错误。

- [x] 定位公网 HTTP 白页根因：非安全上下文不提供 `crypto.randomUUID()`，两个前端在模块初始化阶段异常退出。
- [x] 管理端和工人端增加 UUID v4 兼容生成；HTTPS/localhost 优先使用原生安全 API，明文测试环境使用后备实现。
- [x] 设备 ID、登录注销、员工写操作及开工/完工幂等键全部改用兼容 UUID，格式仍满足后端 UUID 校验。
- [x] 两前端类型检查和生产构建通过；发布 `/opt/garment-mes/releases/http-uuid-acaaf7d88936e83c`，管理端、工人端和 Gateway healthy。
- [x] 公网管理端已渲染管理员登录表单；工人扫码深链已渲染员工登录表单；浏览器控制台 0 错误。

- [x] Gateway 端口绑定改为 `HTTP_BIND_ADDRESS` 可配置，代码默认仍为安全的 `127.0.0.1`。
- [x] 远端测试环境显式设为 `0.0.0.0:8080`，二维码员工端基址设为 `http://18.143.137.92:8080/worker/`。
- [x] 公网直连验证 `/healthz`、`/admin/` 和 `/worker/?bundle=D106052SG` 均返回 HTTP 200；浏览器标题正确且控制台 0 错误。
- [x] 发布 `/opt/garment-mes/releases/public-ip-test-f2a3948ab26e3ec3`，管理端与 Gateway 均 healthy。
- [ ] 公网测试结束后将远端 `HTTP_BIND_ADDRESS` 恢复为 `127.0.0.1` 并清空 `WORKER_PUBLIC_URL`；自动回滚命令被安全策略拦截，需手动执行。

- [x] 扎包二维码改为工人端深链并携带数据库 `shortCode`；支持 `WORKER_PUBLIC_URL` 配置跨设备可访问地址，未配置时回退同源 `/worker/`。
- [x] 工人扫码后未登录先进入员工登录；登录成功自动恢复原扎包，并仅展示该员工技能匹配的 READY 标准工序。
- [x] 开工继续由 `WorkReport` 持久化员工、扎包、标准工序、设备与时间；完工保存良品/次品/短缺并生成计件记录。
- [x] 生产总览新增“员工 × 标准工序”统计：完成扎数、加工中任务、良品、次品、短缺和预计计件金额。
- [x] 管理端接通真实登录、真实扎包列表和员工工种统计页；打印卡二维码使用真实短码，不再只编码演示文字。
- [x] 演示库补充真实扎包 `10605-2 / D106052SG` 与合肩缝制 READY 工序；远端 seed 明确保留既有随机密码和 PIN。
- [x] OpenAPI 客户端重新生成；API 27 项测试、四工作区类型检查、Prisma 校验和三个生产构建通过。
- [x] 增量发布 `/opt/garment-mes/releases/scan-worker-stats-30653ad08b36df5d`；聚合 SQL、线上 JS/CSS 和真实扎包校验通过，五容器全部 healthy。

- [x] 为管理端固定添加 `qrcode@1.5.4` 与 `@types/qrcode@1.5.5`；依赖安装审计为 0 漏洞。
- [x] 每张扎包卡在浏览器本地生成二维码，编码内容为扎包号，并同时显示可人工核对的扫码内容。
- [x] 打印介质将二维码放大为 32 mm，仅输出已选卡片；Playwright WebKit 验证屏幕和打印布局，控制台 0 错误。
- [x] 管理端严格类型检查和生产构建通过；二维码增量 release 已发布，线上资源校验通过且管理端/网关 healthy。

- [x] 修复工人登录凭证错误被误报为“登录已失效”：登录提交的 401 现提示工号、密码/PIN 或组织代码不正确。
- [x] 保留登录后访问令牌真正失效时的原会话提示，不混淆凭证错误与会话过期。
- [x] 工人 PWA 严格类型检查和生产构建通过，PWA 预缓存 7 个资源。
- [x] 增量发布工人端 release；线上 JS 已包含新提示，工人端和网关容器均为 healthy。

- [x] 修复管理端“打印所选卡片”静态占位：增加卡片复选、已选数量、无选择禁用和浏览器原生打印调用。
- [x] 增加 A4 打印介质样式，仅输出用户已选扎包卡片，并隐藏导航、操作按钮和未选卡片。
- [x] 管理端严格类型检查和 Vite 生产构建通过；Playwright WebKit 验证单选、多选、计数、禁用状态和打印点击，控制台 0 错误。
- [x] 增量发布新管理端 release；远端 JS/CSS 已包含打印逻辑与样式，管理端和网关容器均为 healthy。

- [x] 通过 15 个 SSM 分块将 200,138 字节部署包传至现有 EC2，远端 SHA-256 复核为 `77e35690a16808de389004f1a4d2ea2917ae34aa50f8ee35ce61e58d5ab6d7ca`。
- [x] 解包到哈希命名 release 并切换 `/opt/garment-mes/current`；实例本地 `.env` 使用随机数据库密码/令牌密钥且权限为 `600`。
- [x] 修复远端 Compose v5.5.0 缺少新版 Buildx：下载 Docker 官方 ARM64 Buildx v0.17.1，官方 SHA-256 校验通过。
- [x] 远端串行构建并启动 PostgreSQL、API、管理端、工人 PWA、Nginx Gateway；网关仍仅绑定 `127.0.0.1:8080`。
- [x] 最终确认 PostgreSQL、API、管理端、工人 PWA、Nginx Gateway 五容器全部 healthy，网关只绑定 `127.0.0.1:8080`。
- [x] 实例回环烟雾通过：`/healthz`、`/api/v1/health`、根重定向、两个 SPA 资源前缀及 PWA start_url/scope 均正确。
- [x] 本机缺少系统级 Session Manager Plugin；使用 Homebrew 已校验的官方 1.2.835.0 pkg 在会话暂存目录运行，未提升权限或修改系统安装目录。
- [x] 建立临时 SSM 端口转发 `127.0.0.1:50794 → instance:8080`，从本机复核全部 HTTP/PWA 检查并关闭会话。


- [x] 只读枚举账户 82 个 S3 桶并核对区域；未发现名称或用途明确属于 garment-mes 的部署/暂存桶。
- [x] 新加坡现有桶属于 CloudFormation 模板或用途不明确，未擅自写入其他工作负载资源。

- [x] 当前工作区不是 Git 仓库，无法通过远端提交精确部署；已改用会话隔离部署包。
- [x] 生成 200,138 字节精简部署包，排除 `.env`、node_modules、dist、日志和其他非部署内容。
- [x] 部署包 SHA-256 为 `77e35690a16808de389004f1a4d2ea2917ae34aa50f8ee35ce61e58d5ab6d7ca`。

- [x] AWS MCP 只读确认 EC2 `i-003d3c9496ae37661` 为 `running`，实例、系统和 EBS 三项健康检查均为 `ok/passed`。
- [x] 记录实例公网 IP `18.143.137.92`、私网 IP `172.31.39.132`、可用区 `ap-southeast-1a`；现有全公网入站安全组风险仍保留。
- [x] SSM `PingStatus=Online`，Amazon Linux 2023 ARM64，SSM Agent `3.3.4624.0`；命令通道验证成功。
- [x] 定位 User Data 失败根因为 Amazon Linux 2023 的 `curl-minimal` 与显式安装 `curl` 冲突，cloud-final 在 Docker 安装前退出。
- [x] 通过 SSM 去除冲突包后完成剩余引导：Docker 服务 active、Docker `25.0.14`、Bootstrap 标记存在、`ec2-user` 已加入 docker 组。
- [x] Amazon Linux 仓库无 Compose 包；从 Docker 官方 Release 固定安装 ARM64 Compose `v5.5.0`，官方 SHA-256 校验通过。

- [x] 使用 ARM64 Docker Desktop 成功构建 PostgreSQL、API、管理端、工人 PWA 和 Nginx 五服务镜像。
- [x] 修复 API 运行时镜像未复制工作区 Prisma Client，消除容器启动时 `Cannot find module '@prisma/client'`。
- [x] 修复 Nginx 绝对重定向丢失 `127.0.0.1:8080` 外部端口，兼容本机和后续 SSM 端口转发。
- [x] 全新隔离数据卷成功执行完整 DDL；五容器最终全部 healthy。
- [x] 网关烟雾通过：`/healthz`、`/api/v1/health`、根路径到 `/admin/`、管理端与工人端资源、PWA start_url/scope 均正确。
- [x] 烟雾容器和网络已停止移除，未删除或复用任何既有数据卷。

- [x] 管理端新增真实登录、刷新、当前用户和注销请求；访问令牌与刷新令牌仅保存在模块内存。
- [x] 登录后自动选择授权工厂，并支持显式切换且校验工厂范围；所有业务请求统一注入 `X-Factory-Id`。
- [x] 补齐员工列表/创建/详情/乐观锁更新、技能查询/完整替换及工序、车间、生产线类型化请求。
- [x] 创建与写操作统一支持幂等键，员工更新发送带引号版本 ETag，并提供管理端结构化错误消息。
- [x] 管理端严格类型检查和 Vite 生产构建通过，既有五页骨架保持兼容且未引入持久化令牌。

- [x] 实现车间和生产线列表及幂等创建 API，支持搜索、状态、车间筛选和游标分页。
- [x] 车间/生产线按工厂隔离；负责人必须是当前工厂 ACTIVE 员工，生产线必须归属当前工厂 ACTIVE 车间。
- [x] 新增 Workshop/ProductionLine Prisma 映射，补齐负责人、版本、查询索引和负责人数据库外键。
- [x] 将员工真实烟雾中的车间/产线 SQL 直写替换为正式 HTTP 创建与查询契约。
- [x] 全新 PostgreSQL 从零加载 DDL，验证车间→产线→员工归属以及路线、订单、计件完整链路。
- [x] Prisma 生成/校验、API 类型检查、27 项针对性测试及 NestJS 生产构建通过；临时 PostgreSQL 已停止。
- [x] 实现员工列表、创建、详情和更新 API，支持搜索、状态、车间、产线、工序筛选及游标分页。
- [x] 员工创建支持账号、PIN、车间/产线、入职日期和初始多技能；PIN 仅保存 scrypt 哈希且任何响应均不返回凭证字段。
- [x] 账号必须属于当前工厂组织且不可重复绑定；车间/产线必须 ACTIVE、同工厂且归属一致，单独指定产线时自动推导车间。
- [x] 员工更新强制 `If-Match` 乐观锁，支持账号解绑、PIN 清除、状态和离职日期更新，并保留历史技能与报工事实。
- [x] 为员工补齐 `version/createdBy/updatedBy`；全新 PostgreSQL 真实验证创建→详情→筛选→版本更新及数据库关联事实。
- [x] Prisma 生成/校验、API 类型检查、24 项针对性测试及 NestJS 生产构建通过；原路线和生产计件烟雾继续通过。
- [x] 实现工艺路线版本列表、创建、详情、草稿完整替换、发布和克隆 API，并按工厂与 route 权限隔离。
- [x] 路线替换强制 `If-Match` 乐观锁且仅允许 DRAFT；发布要求恰好一个末工序，并自动退役同款旧发布版本。
- [x] 持久化可跳过、并行、质检点、末工序、标准工时、可空计件价、允许车间、最低技能和前置步骤配置。
- [x] 补齐路线 `version/createdBy/updatedBy` 审计字段；空路线计件价在扎包快照时沿用工序默认价。
- [x] 全新 PostgreSQL 验证 V2 创建→替换→详情→发布→筛选、V1 退役、V3 克隆草稿及原生产计件完整链路。
- [x] Prisma 生成/校验、API 类型检查、20 项针对性测试及 NestJS 生产构建通过；临时 PostgreSQL 已停止。
- [x] 实现 customers/styles/colors/sizes/processes 五类主数据统一列表、创建、详情和更新 API。
- [x] 主数据按工厂隔离，支持搜索、状态筛选、游标分页、数据库幂等创建/更新及 `If-Match` 乐观锁。
- [x] 补齐款式客户归属与版本名称、五类主数据版本号、员工技能 UUID 主键，并对齐 OpenAPI 字段长度。
- [x] 实现员工多工种技能查询和幂等完整集合替换，校验技能等级、有效期、重复期间及工序工厂归属。
- [x] 使用全新 PostgreSQL 集群从零加载更新 DDL，真实验证主数据创建→查询→版本更新、2 个员工技能及完整生产计件链路。
- [x] Prisma 生成/校验、API 类型检查、16 项针对性测试及 NestJS 生产构建通过。
- [x] 工人 PWA 接入真实登录，令牌仅保存在内存并自动选择账号授权工厂。
- [x] 接入短码/扎包号解析、技能工序开工、当前任务及幂等完工，移除模拟扫码和全部静态任务数据。
- [x] 完工表单即时校验 `投入 = 良品 + 次品 + 短缺`，次品支持缺陷代码，并展示本次计件金额。
- [x] 接入 TODAY/WEEK/MONTH 计件汇总与真实明细，移除静态演示金额。
- [x] 修复 WebKit/Safari 原生 `fetch` 接收者绑定，并新增回归测试；API Client 3 项测试通过。
- [x] 登录、订单下达、扫码解析和完工成功状态码已与 OpenAPI 对齐。
- [x] 使用 WebKit 390×844 验证真实登录、短码解析和计件页；控制台 0 errors、0 warnings。
- [x] PostgreSQL 纵向烟雾、API 12 项测试、API/PWA/Client 类型检查及 `/worker/` 生产构建通过。
- [x] 添加可重复开发种子，幂等建立演示组织、工厂、账号、角色、员工、技能、客户、款色码、工序和已发布工艺路线。
- [x] 连续两次执行开发种子成功，确认不会重复或冲突，并允许通过环境变量覆盖演示密码和 PIN。
- [x] 使用会话隔离的真实 PostgreSQL 14.18 加载完整 `database/schema.sql`，完成“登录→订单→下达→裁床→分扎→扫码→开工→完工→计件”HTTP 纵向烟雾测试。
- [x] 烟雾测试断言订单 `COMPLETED`、数量 `10 = 9 + 1 + 0`、1 条质量问题及计件金额 `4.5000`，并直接复核数据库事实。
- [x] 真实 HTTP 验证发现并修复 `bundles:generate` 误命中 preview 的字面冒号路由缺陷；API 类型检查、12 项测试和生产构建通过。
- [x] 实现短码/扎包号扫码解析，返回扎包详情、历史、活动报工和当前工人技能匹配的可执行工序。
- [x] 实现幂等开工，校验员工有效性、技能、READY 状态、前置工序、活动任务及车间/产线范围。
- [x] 实现幂等完工，在单一事务内强制 `投入 = 良品 + 次品 + 短缺`，完成步骤并解锁下一工序。
- [x] 最终工序完成时更新扎包完成数量和订单状态，所有状态变化写入扎包追溯事件。
- [x] 完工时按良品数量和单价快照生成计件条目，并可同步创建内联质量问题。
- [x] 实现本人 TODAY/WEEK/MONTH/CUSTOM 计件汇总和明细，覆盖预计、确认、结算金额及良品/次品数量。
- [x] 新增员工技能、报工、质量问题和计件 Prisma 映射；生成与 schema 校验通过。
- [x] API 严格类型检查、12 项针对性测试及 NestJS 生产构建通过。
- [x] 实现订单创建、列表、详情和幂等下达；下达前校验款式已有已发布工艺路线。
- [x] 实现裁床创建、列表和详情；校验订单状态、工厂归属和主管员工有效性。
- [x] 实现分扎预览与幂等生成，覆盖剩余数量、尾扎、超投上限、最多 1,000 扎和连续扎序。
- [x] 生成扎包时事务性固化工艺路线步骤、单价快照、二维码短码哈希和 `CREATED` 追溯事件。
- [x] 实现扎包列表的游标分页及订单、床次、状态、工序、车间、产线和滞留时间筛选。
- [x] 新增数据库幂等记录复用、稳定请求哈希和同键异体冲突检测。
- [x] Prisma 映射生成与校验、API 类型检查、11 项针对性测试及 NestJS 生产构建通过。
- [x] 实现用户名/工号登录、15 分钟 HS256 访问令牌、刷新令牌轮换、注销撤销和 `/api/v1/me`。
- [x] 新增 `auth_sessions` DDL 与 Prisma 模型，账号停用、会话撤销和过期可在每次请求时即时生效。
- [x] 实现 `X-Factory-Id` UUID 校验、用户工厂数据范围和按工厂 `dashboard:production` 权限校验。
- [x] 实现 `/api/v1/dashboards/production-overview`，支持日期、车间和产线筛选及订单/WIP/计件/工序指标聚合。
- [x] Prisma Client 生成与 schema 校验、API 严格类型检查、7 项针对性测试和 NestJS 构建通过。
- [x] 添加 PostgreSQL、NestJS API、管理端、工人 PWA 和 Nginx 网关的 Docker Compose 拓扑。
- [x] 为 API、管理端和工人 PWA 添加固定基础镜像的多阶段 Dockerfile。
- [x] 将 `/admin/`、`/worker/` 和 `/api/` 路由整合到单一网关。
- [x] 网关仅绑定 `127.0.0.1:8080`；数据库与 API 不发布宿主机端口，适配 SSM 端口转发。
- [x] PostgreSQL 首次启动自动执行现有 `database/schema.sql`。
- [x] 两个 Vite 应用支持根路径与 Docker 子路径构建，工人 PWA scope 随 `/worker/` 调整。

## 当前可执行最高优先级

- [x] 确认网关 healthy，完成实例回环 HTTP/PWA 烟雾，并通过临时 SSM 端口转发从本机复核。

### 当前阻塞

无。

## 容器验证状态

- [x] `docker-compose -f compose.yaml config --quiet` 解析通过。
- [x] 使用 `/admin/`、`/worker/` 构建参数重建两个 Web 应用；资源前缀正确，PWA `start_url` 与 `scope` 均为 `/worker/`。
- [x] 构建并启动五个容器，确认全部 healthy 并完成 `127.0.0.1:8080` 网关烟雾测试。

Docker CLI 仍提示受限进程无法读取 `~/.docker/config.json`，且 Compose 缺少 buildx 插件；本轮自动回退 classic builder 后镜像构建、启动和烟雾均成功，不构成部署阻塞。

## 已完成的管理端

- [x] 建立 React/Vite 管理端五页骨架：生产总览、生产订单、裁床扎包、员工工种、计件工资。
- [x] 接入共享 `@garment-mes/api-client@0.1.0` 和类型化生产总览接口。
- [x] 管理端类型检查及 Vite `7.3.6` 生产构建通过。
- [x] 使用 Playwright CLI WebKit 在 1440×900 验证总览，并验证订单与计件导航切页。
- [x] 在 TIGHT 资源状态下仅执行单工作区构建，未运行全仓任务。

## 已完成的工人 PWA

- [x] 建立 React/Vite 工人 PWA 三页骨架：扫码、任务、计件。
- [x] 接入共享 `@garment-mes/api-client@0.1.0`，令牌仅保存在内存。
- [x] 添加可安装 Manifest、自动更新 Service Worker 和离线预缓存。
- [x] 工人 PWA 类型检查及生产构建通过；PWA 预缓存 7 个资源。
- [x] npm 安全依赖升级完成，最终审计为 0 漏洞。
- [x] 使用 Playwright CLI WebKit 在 390×844 验证首页、扫码成功、任务和计件页面。

## 已完成的 API Client

- [x] 使用 `openapi-typescript@7.9.1` 从 67 个 OpenAPI 路径生成 5,207 行 TypeScript 契约类型。
- [x] 实现零运行时依赖的统一 `ApiClient`，支持路径/查询参数、Bearer Token、幂等键和结构化错误。
- [x] 添加统一请求层针对性测试和严格 TypeScript 配置。
- [x] 安装 API Client 工作区依赖；npm 审计为 0 漏洞。

## 已完成的 API 基础

- [x] 建立 NestJS 启动入口，默认监听 `127.0.0.1`，启用 `/api/v1` 前缀和优雅关闭。
- [x] 实现 `/api/v1/health` 运维健康检查及无第三方依赖的针对性测试。
- [x] 建立 Prisma 生命周期模块与 `organizations`、`factories` 首批模型映射。
- [x] 添加 Nest、TypeScript、Prisma 和环境变量配置。

## 已完成的 Monorepo 基础

- [x] 建立 npm Monorepo 根配置与共享 TypeScript 严格配置。
- [x] 建立 `apps/api`、`apps/admin-web`、`apps/worker-pwa` 和 `packages/api-client` 工作区清单。
- [x] 固定 NestJS、Prisma、React、Vite、PWA 和 OpenAPI 类型生成工具版本。

## 基础设施验证（完成）

- [x] EC2 `i-003d3c9496ae37661` 为 `running`；实例、系统和 EBS 健康检查均通过。
- [x] SSM `PingStatus=Online`，只读及修复命令均成功执行。
- [x] `/opt/garment-mes/BOOTSTRAP_COMPLETE` 已建立，Docker 服务 active，Docker 与 Compose 版本已验证。

### 部署约束

1. 不得再次调用 `RunInstances`；固定实例 ID 为 `i-003d3c9496ae37661`。
2. 继续通过 SSM 管理，网关仅绑定实例 `127.0.0.1:8080`，通过 SSM 端口转发访问。
3. 安全组 `sg-020eb8b04bb79a65a` 仍为用户明确接受的全公网入站风险，部署后必须列入收敛任务。
4. SSM Agent 报告 `IsLatestVersion=false`，不阻塞开发部署，但需纳入后续维护。

## 已完成

- [x] PRD：`docs/garment-mes-prd.md`。
- [x] 数据库设计：`docs/database-design.md` 与 `database/schema.sql`；DDL 静态检查通过。
- [x] 可点击原型：`prototype/`；工人扫码、数量守恒、计件与移动端验收通过。
- [x] OpenAPI 3.1：`api/openapi.yaml`；67 paths、88 operations、134 schemas，严格验证通过。
- [x] AWS IAM Role、Instance Profile 和 SSM 策略。
- [x] 安全组 `sg-020eb8b04bb79a65a`；按用户明确授权开放全部公网入站。
- [x] 创建 EC2 `i-003d3c9496ae37661`，`t4g.medium`、Amazon Linux 2023 ARM64、30 GiB 加密 gp3，创建时私网 IP `172.31.39.132`。

## 后续任务

- [x] 创建 NestJS + Prisma API。
- [x] 创建 React/Vite 管理端。
- [x] 创建 React/Vite 工人 PWA。
- [x] 从 OpenAPI 生成 API Client。
- [x] 添加 Docker Compose 与反向代理。
- [x] 实现认证、主数据、订单、扎包、扫码开工/完工和计件纵向切片。
- [x] 部署开发环境并执行端到端烟雾测试。
