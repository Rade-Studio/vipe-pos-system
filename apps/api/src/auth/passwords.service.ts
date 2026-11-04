import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { compare as bcryptCompare } from 'bcryptjs';

export type PasswordAlgo = 'argon2id' | 'bcrypt';

/**
 * argon2id for every new hash; bcrypt only to verify hashes imported from
 * GoTrue, which the caller re-hashes on the first successful login.
 */
@Injectable()
export class PasswordsService {
  /** Verified when the email is unknown, so every failure costs one argon2 verify. */
  private readonly dummyHash = argon2.hash(randomBytes(16).toString('hex'), { type: argon2.argon2id });

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(password: string, stored: { hash: string; algo: string } | undefined): Promise<boolean> {
    if (!stored) {
      await argon2.verify(await this.dummyHash, password);
      return false;
    }
    try {
      if (stored.algo === 'bcrypt') {
        return await bcryptCompare(password, stored.hash);
      }
      return await argon2.verify(stored.hash, password);
    } catch {
      // A malformed stored hash is a failed login, not a server error.
      return false;
    }
  }
}
