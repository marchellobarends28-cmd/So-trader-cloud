import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/db";
import { mt5Accounts } from "@/db/schema";
import { cookies } from "next/headers";

const COOKIE_NAME = "so_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days (iPhone friendly)

export function dashboardPassword(): string {
  return process.env.DASHBOARD_PASSWORD?.trim() || "";
}

export function usingDefaultPassword(): boolean {
  return !process.env.DASHBOARD_PASSWORD?.trim();
}

function sign(value: string): string {
  return createHmac("sha256", dashboardPassword()).update(value).digest("hex");
}

export function createSessionValue(): string {
  const issued = Date.now().toString();
  return `${issued}.${sign(issued)}`;
}

export function verifySessionValue(value: string | undefined | null): boolean {
  if (!value) return false;
  const [issued, signature] = value.split(".");
  if (!issued || !signature) return false;
  const expected = sign(issued);
  if (expected.length !== signature.length) return false;
  try {
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return false;
  } catch {
    return false;
  }
  const age = (Date.now() - Number(issued)) / 1000;
  return Number.isFinite(age) && age >= 0 && age < SESSION_MAX_AGE;
}

export async function isDashboardAuthenticated(): Promise<boolean> {
  const jar = await cookies();
  return verifySessionValue(jar.get(COOKIE_NAME)?.value);
}

export async function setSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, createSessionValue(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Constant-time API key comparison for the MT5 bridge. */
export async function verifyApiKey(provided: unknown): Promise<{ ok: boolean; reason?: string }> {
  if (typeof provided !== "string" || provided.trim().length === 0) {
    return { ok: false, reason: "Missing API key" };
  }
  const [account] = await db.select().from(mt5Accounts).limit(1);
  if (!account?.apiKey) return { ok: false, reason: "No bridge key configured" };

  const a = Buffer.from(provided);
  const b = Buffer.from(account.apiKey);
  if (a.length !== b.length) return { ok: false, reason: "Invalid API key" };
  try {
    if (!timingSafeEqual(a, b)) return { ok: false, reason: "Invalid API key" };
  } catch {
    return { ok: false, reason: "Invalid API key" };
  }
  return { ok: true };
}

export interface AuthResult {
  ok: boolean
  status: number;
  reason?: string;
  via?: "DASHBOARD_SESSION" | "BRIDGE_KEY";
}

/**
 * Every private/mutating endpoint calls this.
 * Accepts either a dashboard session cookie (iPhone/browser) or the bridge API key (EA).
 */
export async function requireAuth(request?: Request, apiKeyFromBody?: unknown): Promise<AuthResult> {
  if (await isDashboardAuthenticated()) {
    return { ok: true, status: 200, via: "DASHBOARD_SESSION" };
  }

  let key = apiKeyFromBody;
  if (key === undefined && request) {
    const headerKey = request.headers.get("x-api-key");
    if (headerKey) key = headerKey;
  }

  const keyCheck = await verifyApiKey(key);
  if (keyCheck.ok) return { ok: true, status: 200, via: "BRIDGE_KEY" };

  return {
    ok: false,
    status: 401,
    reason: keyCheck.reason ?? "Authentication required: sign in to the dashboard or provide a valid bridge API key",
  };
}

export function unauthorized(result: AuthResult) {
  return Response.json(
    {
      success: false,
      error: result.reason ?? "Unauthorized",
      hint: "POST /api/auth/login with the dashboard password, or send x-api-key with the MT5 bridge key.",
    },
    { status: result.status }
  );
}

export { COOKIE_NAME };
