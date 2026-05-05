import * as fs from "node:fs";
import * as path from "node:path";
import { safeStorage } from "electron";

// Persists the user-selected gateway binary path. Uses Electron's safeStorage
// when available (encrypts via OS keychain on macOS/Windows, falls back to
// passthrough on Linux without kwallet/gnome-libsecret per Electron docs).
// The binary path is not a secret — it's just a setting — so degraded
// passthrough is acceptable. Encryption is defense-in-depth.
//
// File layout under <userData>/:
//   gateway-binary-path.enc — base64-encoded ciphertext (or plaintext when
//                              safeStorage is unavailable)

const FILENAME = "gateway-binary-path.enc";

export interface BinaryPathStore {
  read(): string | null;
  write(absPath: string): void;
  clear(): void;
}

export class SafeStorageBinaryPathStore implements BinaryPathStore {
  private readonly filePath: string;

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, FILENAME);
  }

  read(): string | null {
    let raw: Buffer;
    try {
      raw = fs.readFileSync(this.filePath);
    } catch {
      return null;
    }
    if (raw.length === 0) return null;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(raw).trim() || null;
      } catch {
        // Possibly file was written when safeStorage wasn't available;
        // fall through to plaintext interpretation.
      }
    }
    const text = raw.toString("utf8").trim();
    return text || null;
  }

  write(absPath: string): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const data = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(absPath)
        : Buffer.from(absPath, "utf8");
      fs.writeFileSync(this.filePath, data);
    } catch (err) {
      process.stderr.write(
        `[gateway-storage] failed to persist binary path: ${(err as Error).message}\n`,
      );
    }
  }

  clear(): void {
    try {
      fs.unlinkSync(this.filePath);
    } catch {
      // missing-file is fine; nothing to clear
    }
  }
}

// In-memory store for tests. Avoids electron imports in test runtime.
export class InMemoryBinaryPathStore implements BinaryPathStore {
  private value: string | null = null;
  read(): string | null {
    return this.value;
  }
  write(absPath: string): void {
    this.value = absPath;
  }
  clear(): void {
    this.value = null;
  }
}
