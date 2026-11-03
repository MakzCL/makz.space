import { proxy, type Env } from "../edge/proxy.ts";
export const onRequest = (ctx: { request: Request; env: Env }) => proxy(ctx);
