// Generates a VAPID key pair for Web Push.
//   npx tsx scripts/vapid.ts
// Put VAPID_PUBLIC_KEY into wrangler.jsonc "vars" and VAPID_PRIVATE_JWK into a secret.
const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
console.log("VAPID_PUBLIC_KEY=" + b64url(raw));
console.log("VAPID_PRIVATE_JWK=" + JSON.stringify(await crypto.subtle.exportKey("jwk", pair.privateKey)));

export {};
