// fetch helpers with timeouts and readable errors.

export class HttpError extends Error {
  status: number;
  code: string;
  body: any;
  constructor(message: string, status: number, code: string, body: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  credentials?: 'omit' | 'same-origin' | 'include';
}

export interface RawResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
}

export async function request(url: string, options: RequestOptions = {}): Promise<RawResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 20000);
  const headers: Record<string, string> = {Accept: 'application/json', ...(options.headers || {})};
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    if (!headers['Content-Type']) {
      headers['Content-Type'] = 'application/json';
    }
  }
  try {
    const response = await fetch(url, {
      method: options.method || (body ? 'POST' : 'GET'),
      headers,
      body,
      signal: controller.signal,
      ...(options.credentials ? {credentials: options.credentials} : {}),
    });
    const text = await response.text();
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, name: string) => {
      responseHeaders[name.toLowerCase()] = value;
    });
    return {status: response.status, ok: response.ok, headers: responseHeaders, text};
  } catch (error: any) {
    if (error && error.name === 'AbortError') {
      throw new HttpError(`Timed out contacting ${hostOf(url)}`, 0, 'timeout', null);
    }
    throw new HttpError(`Cannot reach ${hostOf(url)}: ${String(error?.message || error)}`, 0, 'network', null);
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestJson<T = any>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(url, options);
  let data: any = null;
  try {
    data = response.text ? JSON.parse(response.text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = (data && (data.message || data.error?.message)) || `HTTP ${response.status} from ${hostOf(url)}`;
    const code = (data && (typeof data.error === 'string' ? data.error : data.error?.code)) || `http_${response.status}`;
    throw new HttpError(String(message), response.status, String(code), data);
  }
  if (data === null) {
    throw new HttpError(`Unexpected response from ${hostOf(url)}`, response.status, 'bad_json', response.text);
  }
  return data as T;
}

export function hostOf(url: string): string {
  const match = /^[a-z]+:\/\/([^/?#]+)/i.exec(url);
  return match ? match[1] : url;
}

export function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '');
}
