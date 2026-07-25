import { createServerFn } from "@tanstack/react-start";
import { clearSession, getSession, updateSession } from "@tanstack/react-start/server";

import { getCloudflareEnv } from "./cloudflareEnv";
import type { ScanStatus } from "./threedlook";

// TanStack Start's built-in session helpers (an encrypted, signed, HTTP-only
// cookie — no separate session store needed). The encryption key must be at
// least 32 characters (enforced by the underlying iron-webcrypto seal) and
// must never be hardcoded — it lives in the SESSION_SECRET server env var,
// set the same way THREEDLOOK_API_KEY already is.
type SessionData = { username?: string };

function sessionConfig() {
  const password = process.env.SESSION_SECRET;
  if (!password) {
    throw new Error("SESSION_SECRET não configurada no servidor.");
  }
  return {
    password,
    name: "vclothes_session",
    cookie: { httpOnly: true, secure: true, sameSite: "lax" as const },
    maxAge: 60 * 60 * 24 * 30,
  };
}

// Users live in the same KV namespace the old QR-code flow used for scan
// sessions (that flow is gone, the binding wasn't doing anything else) —
// keyed separately so the two never collide.
type StoredUser = {
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
  scanResult?: ScanStatus;
};

function userKey(username: string) {
  return `user:${username}`;
}

function normalizeUsername(raw: string) {
  return raw.trim().toLowerCase();
}

const PBKDF2_ITERATIONS = 100_000;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function randomHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

// PBKDF2 via Web Crypto (available in the Workers runtime) — never store or
// compare plaintext passwords, even for a demo.
async function hashPassword(password: string, saltHex: string): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(saltHex) as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    256,
  );
  return bytesToHex(new Uint8Array(derived));
}

export type AuthResult = { username: string; hasScan: boolean };

// Shared between the server check and the client-side hint on the signup
// form, so the two can't drift out of sync. Special characters are never
// required, just never blocked (no restriction on which characters are
// allowed at all).
export function validatePassword(password: string): string | null {
  if (password.length < 6) return "A senha precisa ter pelo menos 6 caracteres.";
  if (!/\d/.test(password)) return "A senha precisa ter pelo menos um número.";
  return null;
}

// POST, not GET, even for the calls that only read — same reasoning as
// getScanResult: keeps every one of these off any HTTP cache path.
export const registerUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResult> => {
    const username = normalizeUsername(data.username);
    if (username.length < 3) {
      throw new Error("O usuário precisa ter pelo menos 3 caracteres.");
    }
    const passwordError = validatePassword(data.password);
    if (passwordError) throw new Error(passwordError);

    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const existing = await kv.get(userKey(username));
    if (existing) {
      throw new Error("Esse usuário já existe. Tente entrar em vez de criar conta.");
    }

    const salt = randomHex(16);
    const user: StoredUser = {
      username,
      salt,
      passwordHash: await hashPassword(data.password, salt),
      createdAt: new Date().toISOString(),
    };
    await kv.put(userKey(username), JSON.stringify(user));
    await updateSession<SessionData>(sessionConfig(), { username });

    return { username, hasScan: false };
  });

export const loginUser = createServerFn({ method: "POST" })
  .validator((data: { username: string; password: string }) => data)
  .handler(async ({ data }): Promise<AuthResult> => {
    const username = normalizeUsername(data.username);
    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const raw = await kv.get(userKey(username));
    if (!raw) throw new Error("Usuário ou senha incorretos.");
    const user = JSON.parse(raw) as StoredUser;

    const passwordHash = await hashPassword(data.password, user.salt);
    if (passwordHash !== user.passwordHash) {
      throw new Error("Usuário ou senha incorretos.");
    }

    await updateSession<SessionData>(sessionConfig(), { username });
    return { username, hasScan: !!user.scanResult };
  });

export const logoutUser = createServerFn({ method: "POST" }).handler(async (): Promise<void> => {
  await clearSession(sessionConfig());
});

export const getCurrentUser = createServerFn({ method: "POST" }).handler(
  async (): Promise<AuthResult | null> => {
    const session = await getSession<SessionData>(sessionConfig());
    const username = session.data.username;
    if (!username) return null;

    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    const raw = kv ? await kv.get(userKey(username)) : null;
    if (!raw) return null;

    const user = JSON.parse(raw) as StoredUser;
    return { username: user.username, hasScan: !!user.scanResult };
  },
);

// Called once a scan finishes, so the next login skips straight to the shop
// instead of asking the same person to scan again.
export const saveUserScanResult = createServerFn({ method: "POST" })
  .validator((data: { scanResult: ScanStatus }) => data)
  .handler(async ({ data }): Promise<void> => {
    const session = await getSession<SessionData>(sessionConfig());
    const username = session.data.username;
    if (!username) throw new Error("Não autenticado.");

    const kv = getCloudflareEnv()?.VCLOTHES_SCANS;
    if (!kv) throw new Error("Armazenamento indisponível no servidor.");

    const raw = await kv.get(userKey(username));
    if (!raw) throw new Error("Usuário não encontrado.");

    const user = JSON.parse(raw) as StoredUser;
    user.scanResult = data.scanResult;
    await kv.put(userKey(username), JSON.stringify(user));
  });
