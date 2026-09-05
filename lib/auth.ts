import { createHash } from "node:crypto";
export const COOKIE = "sv_auth";
export const tokenFor = (pw: string) => createHash("sha256").update("srivaruni:" + pw).digest("hex");
export const validToken = (t: string | undefined | null) => !!t && !!process.env.APP_PASSWORD && t === tokenFor(process.env.APP_PASSWORD);
export const validPassword = (pw: string | undefined | null) => !!pw && !!process.env.APP_PASSWORD && pw === process.env.APP_PASSWORD;
