/**
 * Shared async hash — uses Web Crypto API (crypto.subtle.digest).
 * Works in both Node.js 20+ and Convex V8 isolates.
 */
export async function sha256Hex(input: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(bytes)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256HexShort(input: string, len = 32): Promise<string> {
  return (await sha256Hex(input)).slice(0, len);
}
