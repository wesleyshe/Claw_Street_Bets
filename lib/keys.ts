import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const API_KEY_PREFIX = "csb";
const API_HASH_SIZE = 64;

export function buildApiKey(agentId: string) {
  const secret = randomBytes(24).toString("base64url");
  return `${API_KEY_PREFIX}.${agentId}.${secret}`;
}

export function hashApiKey(apiKey: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(apiKey, salt, API_HASH_SIZE).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyApiKey(apiKey: string, storedHash: string) {
  const [salt, hashHex] = storedHash.split(":");
  if (!salt || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(apiKey, salt, API_HASH_SIZE);

  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}

export function buildClaimToken() {
  return randomBytes(24).toString("base64url");
}

export function extractAgentIdFromApiKey(apiKey: string) {
  const [prefix, agentId] = apiKey.split(".");
  if (prefix !== API_KEY_PREFIX || !agentId) return null;
  return agentId;
}
