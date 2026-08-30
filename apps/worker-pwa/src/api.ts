import { ApiError, createApiClient, type components } from '@garment-mes/api-client';

type AuthSession = components['schemas']['AuthSession'];
type BundleScanView = components['schemas']['BundleScanView'];
type WorkStartResult = components['schemas']['WorkStartResult'];
type WorkCompleteRequest = components['schemas']['WorkCompleteRequest'];
type WorkCompleteResult = components['schemas']['WorkCompleteResult'];
type MyPieceworkView = components['schemas']['MyPieceworkView'];
export type PieceworkPeriod = 'TODAY' | 'WEEK' | 'MONTH';

const REFRESH_TOKEN_STORAGE_KEY = 'garment-mes.worker.refresh-token';

let accessToken: string | undefined;
let refreshToken = readSessionStorage();
let factoryId: string | undefined;
let restorePromise: Promise<AuthSession | null> | undefined;

function readSessionStorage(): string | undefined {
  try {
    return window.sessionStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSessionStorage(value?: string): void {
  try {
    if (value) window.sessionStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, value);
    else window.sessionStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
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

const deviceId = `worker-pwa-${randomUuid()}`;

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? window.location.origin,
  getAccessToken: () => accessToken,
});

export async function loginWorker(account: string, secret: string, organizationCode?: string): Promise<AuthSession> {
  const session = await apiClient.request('/api/v1/auth/login', 'post', {
    body: {
      account,
      secret,
      ...(organizationCode ? { organizationCode } : {}),
      deviceId,
      deviceName: 'Worker PWA',
    },
  });
  return applySession(session);
}

export function restoreWorkerSession(): Promise<AuthSession | null> {
  if (!refreshToken) return Promise.resolve(null);
  restorePromise ??= apiClient.request('/api/v1/auth/refresh', 'post', {
    body: { refreshToken },
  }).then(applySession).catch(() => {
    clearSession();
    return null;
  });
  return restorePromise;
}

function applySession(session: AuthSession): AuthSession {
  const firstFactory = session.user.factories[0];
  if (!session.user.workerId || !firstFactory) {
    throw new Error('该账号未绑定员工或可用工厂，请联系主管。');
  }
  accessToken = session.accessToken;
  refreshToken = session.refreshToken;
  factoryId = firstFactory.factoryId;
  writeSessionStorage(session.refreshToken);
  return session;
}

export function clearSession(): void {
  accessToken = undefined;
  refreshToken = undefined;
  factoryId = undefined;
  restorePromise = undefined;
  writeSessionStorage();
}

export async function checkCurrentSession(): Promise<void> {
  await apiClient.request('/api/v1/me', 'get');
}

export async function resolveBundle(code: string): Promise<BundleScanView> {
  return apiClient.request('/api/v1/bundles/resolve', 'post', {
    headers: factoryHeaders(),
    body: { code, deviceId },
  });
}

export async function startWork(bundleId: string, bundleRouteStepId: string): Promise<WorkStartResult> {
  return apiClient.request('/api/v1/work-reports:start', 'post', {
    headers: factoryHeaders(),
    idempotencyKey: randomUuid(),
    body: {
      bundleId,
      bundleRouteStepId,
      deviceId,
      clientStartedAt: new Date().toISOString(),
      skipPrerequisite: false,
    },
  });
}

export async function completeWork(workReportId: string, input: WorkCompleteRequest): Promise<WorkCompleteResult> {
  return apiClient.request('/api/v1/work-reports/{workReportId}:complete', 'post', {
    pathParams: { workReportId },
    headers: factoryHeaders(),
    idempotencyKey: randomUuid(),
    body: { ...input, deviceId, clientCompletedAt: new Date().toISOString() },
  });
}

export async function getPiecework(period: PieceworkPeriod): Promise<MyPieceworkView> {
  return apiClient.request('/api/v1/me/piecework', 'get', {
    headers: factoryHeaders(),
    query: { period, limit: 50 },
  });
}

export function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.status === 401) {
    return '工号、密码或 PIN、组织代码不正确，请检查后重试。';
  }
  return errorMessage(error);
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return '登录已失效，请重新登录。';
    if (error.status === 403) return '当前账号没有执行此操作的权限。';
    if (error.status === 404) return '未找到该扎包，请检查短码或扎包号。';
    if (error.status === 409) return '当前状态已变化，请重新扫码后再试。';
    if (error.status === 410) return '该扎包或二维码已作废。';
    if (error.status === 422) return error.message || '数量或工序信息不符合要求。';
    return error.message || '请求失败，请稍后重试。';
  }
  return error instanceof Error ? error.message : '请求失败，请稍后重试。';
}

function factoryHeaders(): Record<string, string> {
  if (!factoryId) throw new Error('尚未选择工厂，请重新登录。');
  return { 'X-Factory-Id': factoryId };
}
