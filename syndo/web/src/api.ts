/** Thin fetch wrapper: JSON in/out, cookie session, readable errors. */
import { previewMode } from "./preview-mode.ts";
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (previewMode) return (await import("./preview.ts")).previewRequest<T>(method, path, body);
  const encryptedMessage = path.match(/^\/api\/channels\/(\d+)\/messages(?:\/\d+)?$/);
  if ((method === "POST" || method === "PATCH") && encryptedMessage && body && typeof body === "object" && "content" in body) body = await (await import("./crypto/dm.ts")).encodeBody(encryptedMessage[1]!, body, method === "PATCH" ? path.split("/").at(-1) : undefined);
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
  if (/messages|saved|pins|search/.test(path) && data) return (await (await import("./crypto/dm.ts")).decodeWire(data)) as T;
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
  if (previewMode) return { promise: Promise.reject(new ApiError(0, "preview", "Uploads need the live server. No sample files were sent.")), cancel() {} };
  const xhr = new XMLHttpRequest();
  let cancelled = false;
  const promise = new Promise<T>(async (res, rej) => {
    let meta: any;
    try { const match = path.match(/^\/api\/channels\/(\d+)\/attachments$/); if (match) { const prepared = await (await import("./crypto/dm.ts")).encryptedUpload(match[1]!, form); form = prepared.form; meta = prepared.meta; } } catch (e) { rej(e); return; }
    if (cancelled) { rej(new ApiError(0,"aborted","Upload cancelled.")); return; }
    xhr.open("POST", path);
    xhr.setRequestHeader("x-syndo-client", "1");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => {
      let d: any = null; try { d = JSON.parse(xhr.responseText); } catch { /* */ }
      if (xhr.status >= 200 && xhr.status < 300) { if (meta) import("./crypto/dm.ts").then(m => { m.rememberUpload(d.id, meta); res(d); }).catch(rej); else res(d); } else rej(new ApiError(xhr.status, d?.code ?? "error", d?.message ?? "Upload failed."));
    };
    xhr.onerror = () => rej(new ApiError(0, "network", "Upload failed — check your connection."));
    xhr.onabort = () => rej(new ApiError(0, "aborted", "Upload cancelled."));
    xhr.send(form);
  });
  return { promise, cancel: () => { cancelled = true; xhr.abort(); } };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
