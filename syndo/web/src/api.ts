/** Thin fetch wrapper: JSON in/out, cookie session, readable errors. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "x-syndo-client": "1" };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
  let r: Response;
  try {
    r = await fetch(path, { method, headers, body: payload, credentials: "same-origin" });
  } catch {
    throw new ApiError(0, "network", "Can't reach the server. Check your connection.");
  }
  const text = await r.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!r.ok) throw new ApiError(r.status, data?.code ?? "error", data?.message ?? `Request failed (${r.status}).`, data?.retry_after);
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>("GET", p),
  post: <T = any>(p: string, b: unknown = {}) => request<T>("POST", p, b),
  patch: <T = any>(p: string, b: unknown = {}) => request<T>("PATCH", p, b),
  put: <T = any>(p: string, b: unknown = {}) => request<T>("PUT", p, b),
  del: <T = any>(p: string, b?: unknown) => request<T>("DELETE", p, b),
};

/** Upload with progress + cancel (XHR, because fetch can't report upload progress). */
export function upload<T = any>(path: string, form: FormData, onProgress: (f: number) => void): { promise: Promise<T>; cancel: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<T>((res, rej) => {
    xhr.open("POST", path);
    xhr.setRequestHeader("x-syndo-client", "1");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let d: any = null; try { d = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) res(d); else rej(new ApiError(xhr.status, d?.code ?? "error", d?.message ?? "Upload failed."));
    };
    xhr.onerror = () => rej(new ApiError(0, "network", "Upload failed — check your connection."));
    xhr.onabort = () => rej(new ApiError(0, "aborted", "Upload cancelled."));
    xhr.send(form);
  });
  return { promise, cancel: () => xhr.abort() };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
