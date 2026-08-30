import { ApiError, createApiClient, type components } from '@garment-mes/api-client';

export type ProductionOverview = components['schemas']['ProductionOverview'];
export type PieceworkEntry = components['schemas']['PieceworkEntry'];
export type PieceworkEntryPage = components['schemas']['PieceworkEntryPage'];
export type PieceworkSummary = components['schemas']['PieceworkSummary'];
export type Order = components['schemas']['Order'];
export type OrderPage = components['schemas']['OrderPage'];
export type OrderCreate = components['schemas']['OrderCreate'];
export type OrderPatch = components['schemas']['OrderPatch'];
export type OrderItemInput = components['schemas']['OrderItemInput'];
export type Bundle = components['schemas']['Bundle'];
export type BundlePage = components['schemas']['BundlePage'];
export type BundleEvent = components['schemas']['BundleEvent'];
export type BundleEventPage = components['schemas']['BundleEventPage'];
export type BundleWorkDetail = components['schemas']['BundleWorkDetail'];
export type OrderBundleWorkDetail = components['schemas']['OrderBundleWorkDetail'];
export type BundleGenerationRequest = components['schemas']['BundleGenerationRequest'];
export type BundleGenerationResult = components['schemas']['BundleGenerationResult'];
export type CuttingBed = components['schemas']['CuttingBed'];
export type CuttingBedCreate = components['schemas']['CuttingBedCreate'];
export type RouteVersion = components['schemas']['RouteVersion'];
export type RouteVersionPage = components['schemas']['RouteVersionPage'];
export type RouteVersionCreate = components['schemas']['RouteVersionCreate'];
export type RouteVersionReplace = components['schemas']['RouteVersionReplace'];
export type RouteStepInput = components['schemas']['RouteStepInput'];
export type CurrentUser = components['schemas']['CurrentUser'];
export type FactoryScope = components['schemas']['FactoryScope'];
export type Worker = components['schemas']['Worker'];
export type WorkerPage = components['schemas']['WorkerPage'];
export type WorkerCreate = components['schemas']['WorkerCreate'];
export type WorkerPatch = components['schemas']['WorkerPatch'];
export type WorkerSkill = components['schemas']['WorkerSkill'];
export type WorkerSkillInput = components['schemas']['WorkerSkillInput'];
export type Workshop = components['schemas']['Workshop'];
export type WorkshopPage = components['schemas']['WorkshopPage'];
export type ProductionLine = components['schemas']['ProductionLine'];
export type ProductionLinePage = components['schemas']['ProductionLinePage'];
export type MasterDataItem = components['schemas']['MasterDataItem'];
export type MasterDataCreate = components['schemas']['MasterDataCreate'];
export type WorkerAccount = components['schemas']['WorkerAccount'];
export type WorkerAccountPage = components['schemas']['WorkerAccountPage'];
export type WorkerAccountCreate = components['schemas']['WorkerAccountCreate'];
export type MasterDataPatch = components['schemas']['MasterDataPatch'];
export type ProcessRateAdjustmentRequest = components['schemas']['ProcessRateAdjustmentRequest'];
export type ProcessRateAdjustmentResult = components['schemas']['ProcessRateAdjustmentResult'];
export type MasterDataPage = components['schemas']['MasterDataPage'];

type AuthSession = components['schemas']['AuthSession'];
type ActiveStatus = components['schemas']['ActiveStatus'];
type WorkerStatus = components['schemas']['WorkerStatus'];

export interface AdminLoginInput {
  account: string;
  secret: string;
  organizationCode?: string;
}

export interface AdminSessionState {
  user: CurrentUser;
  activeFactoryId: string;
}

export interface PageQuery {
  cursor?: string;
  limit?: number;
  q?: string;
}

export interface WorkerListQuery extends PageQuery {
  status?: WorkerStatus;
  workshopId?: string;
  productionLineId?: string;
  processId?: string;
}

export interface OrganizationResourceListQuery extends PageQuery {
  status?: ActiveStatus;
}

export interface PieceworkListQuery extends PageQuery {
  workerId?: string;
  bundleNo?: string;
  settlementStatus?: 'PENDING' | 'CONFIRMED' | 'SETTLED' | 'REVERSED';
  from?: string;
  to?: string;
}

export interface RouteVersionListQuery extends PageQuery {
  styleId?: string;
  routeStatus?: components['schemas']['RouteVersionStatus'];
}

export interface ProductionLineListQuery extends OrganizationResourceListQuery {
  workshopId?: string;
}

const REFRESH_TOKEN_STORAGE_KEY = 'garment-mes.admin.refresh-token';
const FACTORY_STORAGE_KEY = 'garment-mes.admin.factory-id';

let accessToken: string | undefined;
let refreshToken = readSessionStorage(REFRESH_TOKEN_STORAGE_KEY);
let currentUser: CurrentUser | undefined;
let activeFactoryId = readSessionStorage(FACTORY_STORAGE_KEY);
let restorePromise: Promise<AdminSessionState | null> | undefined;

function readSessionStorage(key: string): string | undefined {
  try {
    return window.sessionStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionStorage(key: string, value?: string): void {
  try {
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage can be unavailable in private or restricted browser contexts.
  }
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === 'function') globalThis.crypto.getRandomValues(bytes);
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const deviceId = `admin-web-${randomUuid()}`;

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
  getAccessToken: () => accessToken,
});

export async function loginAdmin(input: AdminLoginInput): Promise<AdminSessionState> {
  const session = await apiClient.request('/api/v1/auth/login', 'post', {
    body: {
      ...input,
      deviceId,
      deviceName: 'MES Admin Web',
    },
  });
  return applySession(session);
}

export function restoreAdminSession(): Promise<AdminSessionState | null> {
  if (!refreshToken) return Promise.resolve(null);
  restorePromise ??= refreshAdminSession().catch(() => {
    clearAdminSession();
    return null;
  });
  return restorePromise;
}

export async function refreshAdminSession(): Promise<AdminSessionState> {
  if (!refreshToken) throw new Error('当前没有可刷新的登录会话。');
  const session = await apiClient.request('/api/v1/auth/refresh', 'post', {
    body: { refreshToken },
  });
  return applySession(session);
}

export async function loadCurrentUser(): Promise<AdminSessionState> {
  const user = await apiClient.request('/api/v1/me', 'get');
  currentUser = user;
  activeFactoryId = resolveFactoryId(user, activeFactoryId);
  return getAdminSession();
}

export async function logoutAdmin(): Promise<void> {
  try {
    if (accessToken) {
      await apiClient.request('/api/v1/auth/logout', 'post', {
        idempotencyKey: randomUuid(),
      });
    }
  } finally {
    clearAdminSession();
  }
}

export function clearAdminSession(): void {
  accessToken = undefined;
  refreshToken = undefined;
  currentUser = undefined;
  activeFactoryId = undefined;
  restorePromise = undefined;
  writeSessionStorage(REFRESH_TOKEN_STORAGE_KEY);
  writeSessionStorage(FACTORY_STORAGE_KEY);
}

export function selectFactory(factoryId: string): AdminSessionState {
  if (!currentUser?.factories.some((factory) => factory.factoryId === factoryId)) {
    throw new Error('当前账号无权访问所选工厂。');
  }
  activeFactoryId = factoryId;
  writeSessionStorage(FACTORY_STORAGE_KEY, factoryId);
  return getAdminSession();
}

export function getAdminSession(): AdminSessionState {
  if (!currentUser || !activeFactoryId) throw new Error('尚未登录或选择工厂。');
  return { user: currentUser, activeFactoryId };
}

export async function loadProductionOverview(factoryId?: string): Promise<ProductionOverview> {
  return apiClient.request('/api/v1/dashboards/production-overview', 'get', {
    headers: factoryHeaders(factoryId),
  });
}

export async function listPieceworkEntries(query: PieceworkListQuery = {}): Promise<PieceworkEntryPage> {
  return apiClient.request('/api/v1/piecework-entries', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}


export async function listOrders(query: PageQuery = {}): Promise<OrderPage> {
  return apiClient.request('/api/v1/orders', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export async function createOrder(input: OrderCreate, idempotencyKey = randomUuid()): Promise<Order> {
  return apiClient.request('/api/v1/orders', 'post', {
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export async function updateOrder(
  orderId: string,
  version: number,
  input: OrderPatch,
  idempotencyKey = randomUuid(),
): Promise<Order> {
  return apiClient.request('/api/v1/orders/{orderId}', 'patch', {
    pathParams: { orderId },
    headers: { ...factoryHeaders(), 'If-Match': `"${version}"` },
    idempotencyKey,
    body: input,
  });
}

export async function releaseOrder(orderId: string, idempotencyKey = randomUuid()): Promise<Order> {
  return apiClient.request('/api/v1/orders/{orderId}:release', 'post', {
    pathParams: { orderId },
    headers: factoryHeaders(),
    idempotencyKey,
  });
}

export async function listCustomers(query: OrganizationResourceListQuery = {}): Promise<MasterDataPage> {
  return listMasterData('customers', query);
}

export async function listStyles(query: OrganizationResourceListQuery = {}): Promise<MasterDataPage> {
  return listMasterData('styles', query);
}

export async function listColors(query: OrganizationResourceListQuery = {}): Promise<MasterDataPage> {
  return listMasterData('colors', query);
}

function createMasterData(
  resource: 'styles' | 'colors' | 'sizes' | 'processes',
  input: MasterDataCreate,
  idempotencyKey = randomUuid(),
): Promise<MasterDataItem> {
  return apiClient.request('/api/v1/master-data/{resource}', 'post', {
    pathParams: { resource },
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export function createStyle(input: MasterDataCreate, idempotencyKey = randomUuid()): Promise<MasterDataItem> {
  return createMasterData('styles', input, idempotencyKey);
}

export function createColor(input: MasterDataCreate, idempotencyKey = randomUuid()): Promise<MasterDataItem> {
  return createMasterData('colors', input, idempotencyKey);
}

export function createSize(input: MasterDataCreate, idempotencyKey = randomUuid()): Promise<MasterDataItem> {
  return createMasterData('sizes', input, idempotencyKey);
}

export function createProcess(input: MasterDataCreate, idempotencyKey = randomUuid()): Promise<MasterDataItem> {
  return createMasterData('processes', input, idempotencyKey);
}

export async function listWorkerAccounts(): Promise<WorkerAccountPage> {
  return apiClient.request('/api/v1/users', 'get', { headers: factoryHeaders() });
}

export async function createWorkerAccount(input: WorkerAccountCreate): Promise<WorkerAccount> {
  return apiClient.request('/api/v1/users', 'post', { headers: factoryHeaders(), body: input });
}

export async function setWorkerAccountStatus(userId: string, status: 'ACTIVE' | 'INACTIVE'): Promise<WorkerAccount> {
  return apiClient.request('/api/v1/users/{userId}/status', 'patch', {
    pathParams: { userId }, headers: factoryHeaders(), body: { status },
  });
}

export async function resetWorkerAccountPassword(userId: string, password: string): Promise<WorkerAccount> {
  return apiClient.request('/api/v1/users/{userId}/password:reset', 'post', {
    pathParams: { userId }, headers: factoryHeaders(), body: { password },
  });
}

export async function listSizes(query: OrganizationResourceListQuery = {}): Promise<MasterDataPage> {
  return listMasterData('sizes', query);
}

function listMasterData(
  resource: MasterDataItem['resourceType'],
  query: OrganizationResourceListQuery,
): Promise<MasterDataPage> {
  return apiClient.request('/api/v1/master-data/{resource}', 'get', {
    pathParams: { resource },
    headers: factoryHeaders(),
    query: { ...query },
  });
}
export async function listBundles(limit = 100): Promise<BundlePage> {
  let page = await apiClient.request('/api/v1/bundles', 'get', {
    headers: factoryHeaders(),
    query: { limit },
  });
  const items = [...page.items];
  while (page.page.hasMore && page.page.nextCursor) {
    page = await apiClient.request('/api/v1/bundles', 'get', {
      headers: factoryHeaders(),
      query: { limit, cursor: page.page.nextCursor },
    });
    items.push(...page.items);
  }
  return { ...page, items, page: { ...page.page, nextCursor: null, hasMore: false } };
}

export async function getBundleTimeline(bundleId: string, limit = 100): Promise<BundleEventPage> {
  return apiClient.request('/api/v1/bundles/{bundleId}/timeline', 'get', {
    pathParams: { bundleId },
    headers: factoryHeaders(),
    query: { limit },
  });
}

export async function getBundleWorkDetails(bundleId: string): Promise<BundleWorkDetail> {
  return apiClient.request('/api/v1/bundles/{bundleId}/work-details', 'get', {
    pathParams: { bundleId },
    headers: factoryHeaders(),
  });
}

export async function getOrderBundleWorkDetails(orderId: string): Promise<OrderBundleWorkDetail> {
  return apiClient.request('/api/v1/orders/{orderId}/bundle-work-details', 'get', {
    pathParams: { orderId },
    headers: factoryHeaders(),
  });
}

export async function createCuttingBed(input: CuttingBedCreate, idempotencyKey = randomUuid()): Promise<CuttingBed> {
  return apiClient.request('/api/v1/cutting-beds', 'post', {
    headers: factoryHeaders(), idempotencyKey, body: input,
  });
}

export async function listRouteVersions(query: RouteVersionListQuery = {}): Promise<RouteVersionPage> {
  return apiClient.request('/api/v1/route-versions', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export async function listPublishedRouteVersions(styleId: string): Promise<RouteVersionPage> {
  return listRouteVersions({ styleId, routeStatus: 'PUBLISHED', limit: 100 });
}

export async function createRouteVersion(
  input: RouteVersionCreate,
  idempotencyKey = randomUuid(),
): Promise<RouteVersion> {
  return apiClient.request('/api/v1/route-versions', 'post', {
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export async function replaceRouteVersion(
  routeVersionId: string,
  version: number,
  input: RouteVersionReplace,
  idempotencyKey = randomUuid(),
): Promise<RouteVersion> {
  return apiClient.request('/api/v1/route-versions/{routeVersionId}', 'put', {
    pathParams: { routeVersionId },
    headers: { ...factoryHeaders(), 'If-Match': `"${version}"` },
    idempotencyKey,
    body: input,
  });
}

export async function publishRouteVersion(
  routeVersionId: string,
  effectiveFrom: string,
  reason?: string,
  idempotencyKey = randomUuid(),
): Promise<RouteVersion> {
  return apiClient.request('/api/v1/route-versions/{routeVersionId}:publish', 'post', {
    pathParams: { routeVersionId },
    headers: factoryHeaders(),
    idempotencyKey,
    body: { effectiveFrom, ...(reason ? { reason } : {}) },
  });
}

export async function generateBundles(
  cuttingBedId: string,
  input: BundleGenerationRequest,
  idempotencyKey = randomUuid(),
): Promise<BundleGenerationResult> {
  return apiClient.request('/api/v1/cutting-beds/{cuttingBedId}/bundles:generate', 'post', {
    pathParams: { cuttingBedId },
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export async function listWorkers(query: WorkerListQuery = {}): Promise<WorkerPage> {
  return apiClient.request('/api/v1/workers', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export async function createWorker(input: WorkerCreate, idempotencyKey = randomUuid()): Promise<Worker> {
  return apiClient.request('/api/v1/workers', 'post', {
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export async function getWorker(workerId: string): Promise<Worker> {
  return apiClient.request('/api/v1/workers/{workerId}', 'get', {
    pathParams: { workerId },
    headers: factoryHeaders(),
  });
}

export async function updateWorker(
  workerId: string,
  version: number,
  input: WorkerPatch,
  idempotencyKey = randomUuid(),
): Promise<Worker> {
  return apiClient.request('/api/v1/workers/{workerId}', 'patch', {
    pathParams: { workerId },
    headers: {
      ...factoryHeaders(),
      'If-Match': `"${version}"`,
    },
    idempotencyKey,
    body: input,
  });
}

export async function listWorkerSkills(workerId: string): Promise<WorkerSkill[]> {
  return apiClient.request('/api/v1/workers/{workerId}/skills', 'get', {
    pathParams: { workerId },
    headers: factoryHeaders(),
  });
}

export async function replaceWorkerSkills(
  workerId: string,
  skills: WorkerSkillInput[],
  idempotencyKey = randomUuid(),
): Promise<WorkerSkill[]> {
  return apiClient.request('/api/v1/workers/{workerId}/skills', 'put', {
    pathParams: { workerId },
    headers: factoryHeaders(),
    idempotencyKey,
    body: { skills },
  });
}

export async function listProcesses(query: OrganizationResourceListQuery = {}): Promise<MasterDataPage> {
  return apiClient.request('/api/v1/master-data/{resource}', 'get', {
    pathParams: { resource: 'processes' },
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export async function adjustProcessRate(
  processId: string,
  input: ProcessRateAdjustmentRequest,
  idempotencyKey = randomUuid(),
): Promise<ProcessRateAdjustmentResult> {
  return apiClient.request('/api/v1/processes/{processId}/adjust-rate', 'post', {
    pathParams: { processId },
    headers: factoryHeaders(),
    idempotencyKey,
    body: input,
  });
}

export async function listWorkshops(query: OrganizationResourceListQuery = {}): Promise<WorkshopPage> {
  return apiClient.request('/api/v1/workshops', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export async function listProductionLines(query: ProductionLineListQuery = {}): Promise<ProductionLinePage> {
  return apiClient.request('/api/v1/production-lines', 'get', {
    headers: factoryHeaders(),
    query: { ...query },
  });
}

export function adminErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400 && error.message.includes('No quantity remains')) {
      return '该裁床计划数量已全部生成扎包。';
    }
    if (error.status === 409 && error.message.includes('cancelled cutting bed')) {
      return '该裁床已取消，不能生成或追加扎包。';
    }
    if (error.status === 409 && error.message.includes('bedNo already exists')) {
      return '该床号已存在，请使用新的床号；如需处理已有裁床，请在下方现有批次中继续操作。';
    }
    if (error.status === 409 && error.message.includes('All order bundles must be completed before export')) {
      const progress = error.message.match(/\((\d+)\/(\d+)\)/)?.slice(1).join(' / ');
      return `该订单还有扎包未完成${progress ? `（已完成 ${progress} 扎）` : ''}，全部完成后才能统一导出。`;
    }
    if (error.status === 409 && error.message.includes('no exportable bundles')) {
      return '该订单还没有可导出的有效扎包。';
    }
    if (error.status === 422 && error.message.includes('A published route is required before order release')) {
      return '该订单款式尚未发布工艺路线，暂不能下达。请先由主管配置并发布该款式的工艺路线。';
    }
    if (error.status === 422 && error.message.includes('A published route for the order style is required')) {
      return '该订单款式尚未发布工艺路线，暂不能生成扎包。请先由主管配置并发布该款式的工艺路线。';
    }
    if (error.status === 422 && error.message.includes('A route must contain at least one step before publishing')) {
      return '工艺路线至少需要一个工序才能发布。';
    }
    if (error.status === 422 && error.message.includes('A published route must contain exactly one final step')) {
      return '工艺路线必须且只能设置一个最终工序后才能发布。';
    }
    if (error.status === 401) return '登录已失效，请重新登录。';
    if (error.status === 403) return '当前账号没有访问该工厂或执行此操作的权限。';
    if (error.status === 404) return '请求的数据不存在或已被移除。';
    if (error.status === 409 && /Version mismatch|concurrently|has changed/i.test(error.message)) return '该记录已被其他操作更新，请关闭编辑后重新打开再试。';
    if (error.status === 409) return error.message || '当前操作与已有数据冲突，请检查后重试。';
    if (error.status === 422) return error.message || '提交的数据不符合要求。';
    if (error.status === 423) return '账号已锁定或停用，请联系管理员。';
    if (error.status === 429) return '登录尝试过于频繁，请稍后再试。';
    return error.message || '请求失败，请稍后重试。';
  }
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}

function applySession(session: AuthSession): AdminSessionState {
  const nextFactoryId = resolveFactoryId(session.user, activeFactoryId);
  accessToken = session.accessToken;
  refreshToken = session.refreshToken;
  currentUser = session.user;
  activeFactoryId = nextFactoryId;
  writeSessionStorage(REFRESH_TOKEN_STORAGE_KEY, session.refreshToken);
  writeSessionStorage(FACTORY_STORAGE_KEY, nextFactoryId);
  return { user: session.user, activeFactoryId: nextFactoryId };
}

function resolveFactoryId(user: CurrentUser, preferredFactoryId?: string): string {
  const factory = user.factories.find((item) => item.factoryId === preferredFactoryId) ?? user.factories[0];
  if (!factory) throw new Error('当前账号没有可访问工厂，请联系管理员。');
  return factory.factoryId;
}

function factoryHeaders(factoryId = activeFactoryId): Record<string, string> {
  if (!factoryId) throw new Error('尚未选择工厂，请先登录。');
  return { 'X-Factory-Id': factoryId };
}
