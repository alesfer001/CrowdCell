import * as fs from "fs";
import * as path from "path";

/**
 * DEPLOYER_PRIVATE_KEY from off-chain/transaction-builder/.env, or "" if the file or the line
 * is missing. Handles CRLF line endings and quoted values. The key is for testnet only.
 */
export function deployerKeyFromEnvFile(): string {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return "";
  const line = fs
    .readFileSync(envPath, "utf-8")
    .split(/\r?\n/)
    .find((l) => l.startsWith("DEPLOYER_PRIVATE_KEY="));
  if (!line) return "";
  return line.slice("DEPLOYER_PRIVATE_KEY=".length).trim().replace(/^(["'])(.*)\1$/, "$2");
}
