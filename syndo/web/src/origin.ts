/**
 * Where SEND lives on the internet.
 *
 * In the SEND desktop app the interface ships inside the app and is served from the app itself
 * (sendapp://localhost, or https://sendapp.localhost on Windows): it doesn't load the website. The app passes
 * server calls (/api/…) on to the server, so most code keeps using relative URLs. Only two things need the real
 * address: links people share (invites, message links, webhooks) and the live connection (/gateway), which a
 * page can't route through the app.
 */
const d = (window as any).sendDesktop as { server?: string; bundled?: boolean } | undefined;
export const bundled = location.hostname === "sendapp.localhost" || location.protocol === "sendapp:";
const fromApp = (() => { try { return d?.server ? new URL(d.server).origin : null; } catch { return null; } })();
/** The server's public address: what shared links start with. */
export const publicOrigin: string = bundled ? (fromApp ?? "https://syndo.makz.space") : location.origin;
/** The live connection's address. */
export const gatewayUrl = () => `${publicOrigin.replace(/^http/, "ws")}/gateway`;
