import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type ControlPlaneData = {
  orgs: Array<{ id: string; name: string }>;
  workspaces: Array<{ id: string; orgId: string; name: string }>;
  policies: Array<{ id: string; orgId: string; payload: Record<string, unknown> }>;
  auditEvents: Array<Record<string, unknown>>;
  metrics: Array<Record<string, unknown>>;
};

type Envelope = {
  version: 1;
  alg: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
  updatedAt: string;
};

type CreateEncryptedMetadataStoreOptions = {
  dataDir: string;
  encryptionKey?: string;
};

export type EncryptedMetadataStore = {
  load: () => ControlPlaneData;
  save: (data: ControlPlaneData) => void;
  exportBackup: () => string;
  importBackup: (path: string) => ControlPlaneData;
  getDataPath: () => string;
};

const KEY_BYTES = 32;

function nowIso(): string {
  return new Date().toISOString();
}

function defaultData(): ControlPlaneData {
  return {
    orgs: [],
    workspaces: [],
    policies: [],
    auditEvents: [],
    metrics: []
  };
}

function cloneData(data: ControlPlaneData): ControlPlaneData {
  return JSON.parse(JSON.stringify(data)) as ControlPlaneData;
}

function normalizeData(input: Partial<ControlPlaneData> | null | undefined): ControlPlaneData {
  const fallback = defaultData();
  return {
    orgs: Array.isArray(input?.orgs) ? input.orgs : fallback.orgs,
    workspaces: Array.isArray(input?.workspaces) ? input.workspaces : fallback.workspaces,
    policies: Array.isArray(input?.policies) ? input.policies : fallback.policies,
    auditEvents: Array.isArray(input?.auditEvents) ? input.auditEvents : fallback.auditEvents,
    metrics: Array.isArray(input?.metrics) ? input.metrics : fallback.metrics
  };
}

function deriveKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("encryption key cannot be empty");
  }
  if (/^[a-fA-F0-9]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  return createHash("sha256").update(trimmed).digest();
}

function readOrCreateKey(path: string, override?: string): Buffer {
  if (override) {
    return deriveKey(override);
  }

  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").trim();
    if (existing) {
      return deriveKey(existing);
    }
  }

  const seeded = randomBytes(KEY_BYTES).toString("hex");
  writeFileSync(path, `${seeded}\n`, "utf8");
  return Buffer.from(seeded, "hex");
}

function encryptJson(data: ControlPlaneData, key: Buffer): Envelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(data), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    alg: "aes-256-gcm",
    iv: iv.toString("base64"),
    tag: tag.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    updatedAt: nowIso()
  };
}

function decryptEnvelope(envelope: Envelope, key: Buffer): ControlPlaneData {
  const iv = Buffer.from(envelope.iv, "base64");
  const tag = Buffer.from(envelope.tag, "base64");
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(plaintext) as Partial<ControlPlaneData>;
  return normalizeData(parsed);
}

function readEnvelope(path: string): Envelope | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as Envelope;
  } catch {
    return null;
  }
}

export function createEncryptedMetadataStore(
  options: CreateEncryptedMetadataStoreOptions
): EncryptedMetadataStore {
  const keyPath = join(options.dataDir, "security", "metadata.key");
  const dataPath = join(options.dataDir, "metadata.enc");
  const backupDir = join(options.dataDir, "backups");
  const key = readOrCreateKey(keyPath, options.encryptionKey);

  function save(data: ControlPlaneData): void {
    mkdirSync(dirname(dataPath), { recursive: true });
    const envelope = encryptJson(normalizeData(data), key);
    writeFileSync(dataPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");
  }

  function load(): ControlPlaneData {
    const envelope = readEnvelope(dataPath);
    if (!envelope) {
      return defaultData();
    }
    try {
      return cloneData(decryptEnvelope(envelope, key));
    } catch {
      return defaultData();
    }
  }

  function exportBackup(): string {
    mkdirSync(backupDir, { recursive: true });
    if (!existsSync(dataPath)) {
      save(defaultData());
    }
    const target = join(backupDir, `metadata-backup-${Date.now()}.enc`);
    copyFileSync(dataPath, target);
    return target;
  }

  function importBackup(path: string): ControlPlaneData {
    if (!existsSync(path)) {
      throw new Error("backup file not found");
    }
    mkdirSync(dirname(dataPath), { recursive: true });
    copyFileSync(path, dataPath);
    return load();
  }

  return {
    load,
    save,
    exportBackup,
    importBackup,
    getDataPath(): string {
      return dataPath;
    }
  };
}
