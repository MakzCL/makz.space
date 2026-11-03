import { onRequest as __api___path___ts_onRequest } from "/home/user/makz.space/syndo/web/functions/api/[[path]].ts"
import { onRequest as __gateway_ts_onRequest } from "/home/user/makz.space/syndo/web/functions/gateway.ts"

export const routes = [
    {
      routePath: "/api/:path*",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api___path___ts_onRequest],
    },
  {
      routePath: "/gateway",
      mountPath: "/",
      method: "",
      middlewares: [],
      modules: [__gateway_ts_onRequest],
    },
  ]