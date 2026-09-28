/**
 * Signed download tokens: proof that a job was paid for. Issued by the API Worker after Stripe
 * confirms payment, checked by the convert server. HMAC-SHA256 over the JSON claims (Web Crypto,
 * so it runs in Workers, Node and browsers).
 */
export interface DownloadClaims {
  jobId: string;
  /** Expiry, unix seconds. */
  exp: number;
  /** Stripe PaymentIntent id. */
  pi?: string;
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function key(secret: string) {
  if (secret.length < 32) throw new Error("Token secret must be at least 32 characters.");
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signToken(claims: DownloadClaims, secret: string): Promise<string> {
  const body = b64url(enc.encode(JSON.stringify(claims)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(body)));
  return `${body}.${b64url(sig)}`;
}

/** Returns the claims if the token is authentic and unexpired, otherwise null. Never throws on bad input. */
export async function verifyToken(token: string, secret: string, now = Date.now()): Promise<DownloadClaims | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(body));
    if (!ok) return null;
    const claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as DownloadClaims;
    if (typeof claims.jobId !== "string" || typeof claims.exp !== "number") return null;
    return claims.exp * 1000 > now ? claims : null;
  } catch {
    return null;
  }
}
