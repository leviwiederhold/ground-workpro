const fs = require("fs");
const os = require("os");
const path = require("path");
const jwt = require("jsonwebtoken");
const authContract = require("../config/auth-contract.json");

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const teamId = requireEnv("APPLE_TEAM_ID");
const keyId = requireEnv("APPLE_KEY_ID");
const clientId = requireEnv("APPLE_CLIENT_ID");

if (clientId !== authContract.apple.webServicesId) {
  throw new Error(
    `APPLE_CLIENT_ID must be the web Services ID ${authContract.apple.webServicesId}; ` +
      `the native bundle ID belongs after it in Supabase's Client IDs list, not in the OAuth secret sub`
  );
}

const configuredPrivateKeyPath = process.env.APPLE_PRIVATE_KEY_PATH?.trim();
const defaultPrivateKeyPath = `/private/AuthKey_${keyId}.p8`;
const userPrivateKeyPath = path.join(os.homedir(), ".private", `AuthKey_${keyId}.p8`);
const privateKeyPath =
  configuredPrivateKeyPath ||
  (fs.existsSync(defaultPrivateKeyPath) ? defaultPrivateKeyPath : userPrivateKeyPath);

if (!fs.existsSync(privateKeyPath)) {
  throw new Error(`Apple private key not found: ${path.resolve(privateKeyPath)}`);
}

const now = Math.floor(Date.now() / 1000);
const privateKey = fs.readFileSync(privateKeyPath, "utf8");
const token = jwt.sign(
  {
    iss: teamId,
    iat: now,
    exp: now + 180 * 24 * 60 * 60,
    aud: "https://appleid.apple.com",
    sub: clientId,
  },
  privateKey,
  {
    algorithm: "ES256",
    keyid: keyId,
  }
);

process.stdout.write(token);
