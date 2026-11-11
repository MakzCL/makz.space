import { timingSafeEqual } from "node:crypto";

const installer = "SEND-Setup-0.6.3.exe";
const allowed = new Set([installer, `${installer}.blockmap`, "latest.yml"]);

/** Android APK, published to the same public bucket as the Windows installer. */
export const androidApk = "android/SEND.apk";
export async function androidDownload(request: Request, env: Env) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status:405});
  const object = await env.RELEASES.head(androidApk);
  if (!object) return new Response("The Android app is being prepared.", {status:503, headers:{"retry-after":"60"}});
  return Response.redirect(`https://pub-77db39df34ad414fb86b513f573fd57e.r2.dev/${androidApk}?v=${object.etag}`, 302);
}

export async function releaseDownload(request: Request, env: Env) {
  if (!["GET", "HEAD"].includes(request.method)) return new Response(null, {status:405});
  const object = await env.RELEASES.head(installer);
  if (!object) return new Response("The desktop release is being prepared.", {status:503, headers:{"retry-after":"60"}});
  return Response.redirect(`https://pub-77db39df34ad414fb86b513f573fd57e.r2.dev/${installer}`, 302);
}

/** Authenticated, bounded multipart publishing for the current desktop release. */
export async function releaseUpload(request: Request, env: Env) {
  const supplied = new TextEncoder().encode(request.headers.get("authorization") ?? "");
  const expected = new TextEncoder().encode(`Bearer ${env.STORAGE_TOKEN}`);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return new Response(null,{status:404});
  const url = new URL(request.url), key = url.searchParams.get("key") ?? "";
  if (!allowed.has(key)) return new Response(null,{status:400});
  const action = url.pathname.slice("/__release/".length);
  try {
    if (action === "start" && request.method === "POST" && key === installer) {
      const upload = await env.RELEASES.createMultipartUpload(key,{httpMetadata:{contentType:"application/vnd.microsoft.portable-executable",contentDisposition:`attachment; filename="${installer}"`}});
      return Response.json({uploadId:upload.uploadId});
    }
    const uploadId = url.searchParams.get("uploadId");
    const size = Number(request.headers.get("content-length"));
    if (action === "part" && request.method === "PUT" && key === installer && uploadId) {
      const number = Number(url.searchParams.get("partNumber"));
      if (!Number.isInteger(number) || number < 1 || number > 32 || !Number.isSafeInteger(size) || size < 1 || size > 8*1024*1024 || !request.body) return new Response(null,{status:400});
      return Response.json(await env.RELEASES.resumeMultipartUpload(key,uploadId).uploadPart(number,request.body));
    }
    if (action === "complete" && request.method === "POST" && key === installer && uploadId && size > 0 && size < 8192) {
      const body = await request.json<{parts:R2UploadedPart[]}>();
      if (!Array.isArray(body.parts) || !body.parts.length || body.parts.length > 32 || body.parts.some((p,i)=>p.partNumber !== i+1 || typeof p.etag !== "string")) return new Response(null,{status:400});
      const object = await env.RELEASES.resumeMultipartUpload(key,uploadId).complete(body.parts);
      return Response.json({size:object.size});
    }
    if (action === "file" && request.method === "PUT" && key !== installer && Number.isSafeInteger(size) && size > 0 && size <= 1024*1024 && request.body) {
      if (key === "latest.yml" && !await env.RELEASES.head(installer)) return new Response(null,{status:409});
      await env.RELEASES.put(key,request.body,{httpMetadata:{contentType:key === "latest.yml"?"text/yaml":"application/octet-stream",cacheControl:key === "latest.yml"?"no-cache":"public, max-age=31536000, immutable"}});
      return new Response(null,{status:204});
    }
    return new Response(null,{status:400});
  } catch {
    return Response.json({message:"Release upload failed"},{status:400});
  }
}
