import type { paths } from './schema';

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';
export type QueryValue = string | number | boolean | null | undefined;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: typeof globalThis.fetch;
  getAccessToken?: () => string | undefined;
}

export interface ApiRequestOptions<Body> extends Omit<RequestInit, 'body' | 'headers' | 'method'> {
  body?: [Body] extends [never] ? never : Body;
  headers?: HeadersInit;
  idempotencyKey?: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, QueryValue | readonly QueryValue[]>;
}

type AvailableMethod<Path extends keyof paths> = {
  [Method in HttpMethod]: Method extends keyof paths[Path]
    ? Exclude<paths[Path][Method], undefined> extends never
      ? never
      : Method
    : never;
}[HttpMethod];

type OperationAt<
  Path extends keyof paths,
  Method extends AvailableMethod<Path>,
> = Method extends keyof paths[Path] ? Exclude<paths[Path][Method], undefined> : never;

type RequestJson<Operation> = Operation extends {
  requestBody: { content: { 'application/json': infer Body } };
}
  ? Body
  : never;

type ResponseJson<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses]: Responses[Status] extends {
        content: { 'application/json': infer Body };
      }
        ? Body
        : never;
    }[keyof Responses]
  : unknown;

export class ApiError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly getAccessToken: (() => string | undefined) | undefined;

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.getAccessToken = options.getAccessToken;
  }

  async request<
    Path extends keyof paths & string,
    Method extends AvailableMethod<Path>,
  >(
    path: Path,
    method: Method,
    options: ApiRequestOptions<RequestJson<OperationAt<Path, Method>>> = {},
  ): Promise<ResponseJson<OperationAt<Path, Method>>> {
    const url = this.buildUrl(path, options.pathParams, options.query);
    const headers = new Headers(options.headers);
    const token = this.getAccessToken?.();

    headers.set('Accept', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    if (options.idempotencyKey) headers.set('Idempotency-Key', options.idempotencyKey);
    if (options.body !== undefined) headers.set('Content-Type', 'application/json');

    const { body, idempotencyKey: _idempotencyKey, pathParams: _pathParams, query: _query, ...init } = options;
    const response = await this.fetchImpl(url, {
      ...init,
      method: method.toUpperCase(),
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await readPayload(response);

    if (!response.ok) {
      throw new ApiError(response.status, errorMessage(payload, response.status), payload);
    }

    return payload as ResponseJson<OperationAt<Path, Method>>;
  }

  private buildUrl(
    path: string,
    pathParams: Record<string, string | number> | undefined,
    query: Record<string, QueryValue | readonly QueryValue[]> | undefined,
  ): URL {
    const resolvedPath = path.replace(/\{([^}]+)\}/g, (_, key: string) => {
      const value = pathParams?.[key];
      if (value === undefined) throw new Error(`Missing path parameter: ${key}`);
      return encodeURIComponent(String(value));
    });
    const url = new URL(resolvedPath, `${this.baseUrl}/`);

    for (const [key, rawValue] of Object.entries(query ?? {})) {
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      for (const value of values) {
        if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
      }
    }

    return url;
  }
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  return new ApiClient(options);
}

async function readPayload(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const contentType = response.headers.get('content-type') ?? '';
  return contentType.includes('application/json') ? response.json() : response.text();
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return `API request failed with status ${status}`;
}
