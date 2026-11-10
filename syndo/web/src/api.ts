/** Thin fetch wrapper: JSON in/out, cookie session, readable errors. */
import { previewMode } from "./preview-mode.ts";
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public retryAfter?: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  if (previewMode) return (await import("./preview.ts")).previewRequest<T>(method, path, body);
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

/**
 * Big files go straight to storage in pieces (no single request carries the whole file): get a ticket for this
 * channel, send each piece, then finish. Progress covers all pieces; each piece is retried a few times.
 */
export function uploadLarge<T = any>(channelId: string, file: File, fields: Record<string, string>, onProgress: (f: number) => void): { promise: Promise<T>; cancel: () => void } {
  if (previewMode) return { promise: Promise.reject(new ApiError(0, "preview", "Uploads need the live server. No sample files were sent.")), cancel() {} };
  let cancelled = false, xhr: XMLHttpRequest | null = null, abortUrl: string | null = null;
  const json = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { "x-syndo-client": "1" };
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: "same-origin" });
    const d = await r.json().catch(() => null);
    if (!r.ok) throw new ApiError(r.status, d?.code ?? "error", d?.message ?? "Upload failed.");
    return d;
  };
  const sendPart = (url: string, blob: Blob, onBytes: (n: number) => void) => new Promise<{ part_number: number; etag: string }>((res, rej) => {
    xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.setRequestHeader("x-syndo-client", "1");
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => { let d: any = null; try { d = JSON.parse(xhr!.responseText); } catch { /* */ } if (xhr!.status >= 200 && xhr!.status < 300) res(d); else rej(new ApiError(xhr!.status, d?.code ?? "error", d?.message ?? "Upload failed.")); };
    xhr.onerror = () => rej(new ApiError(0, "network", "Upload failed — check your connection."));
    xhr.onabort = () => rej(new ApiError(0, "aborted", "Upload cancelled."));
    xhr.send(blob);
  });
  const promise = (async () => {
    const t = await json("POST", `/api/channels/${channelId}/attachments/large`, { size: file.size });
    const qs = (extra: Record<string, string> = {}) => new URLSearchParams({ key: t.ticket.key, size: String(t.ticket.size), exp: String(t.ticket.exp), sig: t.ticket.sig, ...extra }).toString();
    const start = await json("POST", `${t.endpoint}/start?${qs()}`);
    abortUrl = `${t.endpoint}/abort?${qs({ upload_id: start.upload_id })}`;
    const size = start.part_size as number, count = Math.ceil(file.size / size), parts: { part_number: number; etag: string }[] = [];
    for (let n = 1; n <= count; n++) {
      const blob = file.slice((n - 1) * size, Math.min(file.size, n * size));
      for (let attempt = 1; ; attempt++) {
        if (cancelled) throw new ApiError(0, "aborted", "Upload cancelled.");
        try { parts.push(await sendPart(`${t.endpoint}/part?${qs({ upload_id: start.upload_id, part: String(n) })}`, blob, (b) => onProgress(Math.min(0.99, ((n - 1) * size + b) / file.size)))); break; }
        catch (e) { if (cancelled || attempt >= 3 || (e instanceof ApiError && e.status >= 400 && e.status < 500)) throw e; await new Promise((r) => setTimeout(r, 1500 * attempt)); }
      }
    }
    await json("POST", `${t.endpoint}/complete?${qs({ upload_id: start.upload_id })}`, { parts });
    abortUrl = null;
    const num = (k: string) => (fields[k] !== undefined && fields[k] !== "" && Number.isFinite(+fields[k]!) ? +fields[k]! : undefined);
    const done = await json("POST", `/api/channels/${channelId}/attachments/large/finish`, { ticket: t.ticket, filename: file.name, width: num("width"), height: num("height"), duration: num("duration"), waveform: fields.waveform || undefined });
    onProgress(1);
    return done as T;
  })().catch((e) => { if (abortUrl) fetch(abortUrl, { method: "DELETE", headers: { "x-syndo-client": "1" } }).catch(() => {}); throw e; });
  return { promise, cancel: () => { cancelled = true; (xhr as XMLHttpRequest | null)?.abort(); } };
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
