import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 32;

export async function hashSecret(secret: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(secret, salt, KEY_LENGTH)) as Buffer;
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifySecret(secret: string, encoded: string | null): Promise<boolean> {
  if (!encoded) return false;

  const [algorithm, saltHex, hashHex, extra] = encoded.split('$');
  if (algorithm !== 'scrypt' || !saltHex || !hashHex || extra !== undefined) return false;

  try {
    const salt = Buffer.from(saltHex, 'hex');
    const expected = Buffer.from(hashHex, 'hex');
    if (salt.length < 8 || expected.length !== KEY_LENGTH) return false;
    const actual = (await scrypt(secret, salt, expected.length)) as Buffer;
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
