/**
 * Desktop credential store — the GitHub PAT, encrypted at rest with Electron's
 * safeStorage (macOS Keychain-backed). The plaintext token never leaves the
 * main process: the renderer sets/clears it over IPC and the git engine reads
 * it lazily via getCredentials when a network op needs onAuth.
 */
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { safeStorage } from 'electron';

export interface Credentials {
  username: string;
  token: string;
}

interface Stored {
  username: string;
  /** base64 of the encrypted (or, if encryption is unavailable, plain) token. */
  token: string;
  encrypted: boolean;
}

export function setCredentials(file: string, creds: Credentials): void {
  // The PAT must never sit in plain text on disk. safeStorage is Keychain-backed
  // and available on any ready macOS session; if it somehow isn't, refuse rather
  // than fall back to base64 cleartext (base64 is not encryption).
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure credential storage (Keychain) is unavailable; not saving token.');
  }
  const bytes = safeStorage.encryptString(creds.token);
  const stored: Stored = {
    username: creds.username,
    token: bytes.toString('base64'),
    encrypted: true,
  };
  writeFileSync(file, JSON.stringify(stored), { mode: 0o600 });
}

export function getCredentials(file: string): Credentials | null {
  let stored: Stored;
  try {
    stored = JSON.parse(readFileSync(file, 'utf8')) as Stored;
  } catch {
    return null;
  }
  try {
    const bytes = Buffer.from(stored.token, 'base64');
    const token = stored.encrypted ? safeStorage.decryptString(bytes) : bytes.toString('utf8');
    return { username: stored.username, token };
  } catch {
    return null; // key rotated / unreadable — treat as no credentials
  }
}

export function hasCredentials(file: string): boolean {
  return getCredentials(file) !== null;
}

export function clearCredentials(file: string): void {
  rmSync(file, { force: true });
}
