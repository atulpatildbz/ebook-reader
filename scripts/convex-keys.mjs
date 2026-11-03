// Generate a fresh signing key pair for Convex Auth's session tokens and set it on a deployment.
//   node scripts/convex-keys.mjs          # dev deployment
//   node scripts/convex-keys.mjs --prod   # production deployment
// The keys go straight to `convex env set` and are never printed.
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { execFileSync } from "node:child_process";

const extra = process.argv.slice(2);
const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = (await exportPKCS8(keys.privateKey)).trimEnd().replace(/\n/g, " ");
const jwks = JSON.stringify({ keys: [{ use: "sig", ...(await exportJWK(keys.publicKey)) }] });
for (const [name, value] of [["JWT_PRIVATE_KEY", privateKey], ["JWKS", jwks]]) {
  execFileSync("npx", ["convex", "env", "set", ...extra, name, "--", value], { stdio: ["ignore", "inherit", "inherit"] });
}
