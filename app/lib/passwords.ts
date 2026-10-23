import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const MINIMUM_PASSWORD_LENGTH = 12;
export const MAXIMUM_PASSWORD_LENGTH = 128;

const SCRYPT_VERSION = "scrypt-v1";
const SCRYPT_COST = 16_384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const SALT_LENGTH = 16;
const DERIVED_KEY_LENGTH = 64;
const HASH_PATTERN = /^scrypt-v1\$N=(\d+),r=(\d+),p=(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;

type ScryptParameters = {
  N: number;
  r: number;
  p: number;
};

export class PasswordPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordPolicyError";
  }
}

function deriveKey(password: string, salt: Buffer, parameters: ScryptParameters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      DERIVED_KEY_LENGTH,
      { ...parameters, maxmem: SCRYPT_MAX_MEMORY },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey);
      },
    );
  });
}

function parsePasswordHash(encodedHash: string): { parameters: ScryptParameters; salt: Buffer; derivedKey: Buffer } | null {
  const match = HASH_PATTERN.exec(encodedHash);
  if (!match) return null;

  const parameters = {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
  };
  if (
    parameters.N !== SCRYPT_COST ||
    parameters.r !== SCRYPT_BLOCK_SIZE ||
    parameters.p !== SCRYPT_PARALLELIZATION
  ) {
    return null;
  }

  const salt = Buffer.from(match[4], "base64url");
  const derivedKey = Buffer.from(match[5], "base64url");
  if (salt.length !== SALT_LENGTH || derivedKey.length !== DERIVED_KEY_LENGTH) return null;

  return { parameters, salt, derivedKey };
}

export function validatePassword(password: string): void {
  if (typeof password !== "string") throw new PasswordPolicyError("A senha deve ser um texto.");
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`A senha deve ter pelo menos ${MINIMUM_PASSWORD_LENGTH} caracteres.`);
  }
  if (password.length > MAXIMUM_PASSWORD_LENGTH) {
    throw new PasswordPolicyError(`A senha deve ter no máximo ${MAXIMUM_PASSWORD_LENGTH} caracteres.`);
  }
}

export async function hashPassword(password: string): Promise<string> {
  validatePassword(password);
  const salt = randomBytes(SALT_LENGTH);
  const parameters = { N: SCRYPT_COST, r: SCRYPT_BLOCK_SIZE, p: SCRYPT_PARALLELIZATION };
  const derivedKey = await deriveKey(password, salt, parameters);

  return [
    SCRYPT_VERSION,
    `N=${parameters.N},r=${parameters.r},p=${parameters.p}`,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  if (typeof password !== "string" || password.length === 0 || password.length > MAXIMUM_PASSWORD_LENGTH) return false;
  if (typeof encodedHash !== "string") return false;

  const parsed = parsePasswordHash(encodedHash);
  if (!parsed) return false;

  try {
    const candidate = await deriveKey(password, parsed.salt, parsed.parameters);
    return timingSafeEqual(candidate, parsed.derivedKey);
  } catch {
    return false;
  }
}

export function generateTemporaryPassword(): string {
  return randomBytes(18).toString("base64url");
}
