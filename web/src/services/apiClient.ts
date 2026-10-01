export class ApiError extends Error {
  status: number;
  code: string;
  /** The whole error body (e.g. 409 call_in_progress carries `callId`). */
  data: any;
  constructor(status: number, code: string, message: string, data: any = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}
type FetchLike = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
type Opts = { baseUrl: string; getToken: () => string | null; onUnauthorized: () => void; fetchImpl?: FetchLike };

export function createApiClient({ baseUrl, getToken, onUnauthorized, fetchImpl = fetch }: Opts) {
  async function call<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.status === 401) {
      onUnauthorized();
      throw new ApiError(401, data.tokenError || data.code || 'unauthorized', data.message || 'Not signed in');
    }
    if (!res.ok)
      throw new ApiError(res.status, data.code || 'error', data.message || `Request failed (${res.status})`, data);
    return data as T;
  }
  return {
    get: <T = any>(p: string) => call<T>('GET', p),
    post: <T = any>(p: string, b?: unknown) => call<T>('POST', p, b ?? {}),
    patch: <T = any>(p: string, b?: unknown) => call<T>('PATCH', p, b ?? {}),
    put: <T = any>(p: string, b?: unknown) => call<T>('PUT', p, b ?? {}),
    del: <T = any>(p: string) => call<T>('DELETE', p),
  };
}
export type ApiClient = ReturnType<typeof createApiClient>;
