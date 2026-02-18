import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export type SsoProtocol = "oidc" | "saml";

export type RbacRole = "viewer" | "developer" | "admin" | "security_admin";

export type RbacAction =
  | "workspace.read"
  | "workspace.write"
  | "diff.apply"
  | "diff.allow_secrets"
  | "terminal.approved_run"
  | "auto.project_builder"
  | "auto.multi_refactor"
  | "auto.multi_refactor_sensitive"
  | "audit.export"
  | "auth.manage";

export type SsoProvider = {
  id: string;
  name: string;
  protocol: SsoProtocol;
  issuer: string;
  entrypoint: string;
  clientId: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AuthSession = {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  providerId: string;
  protocol: SsoProtocol;
  roles: RbacRole[];
  issuedAt: string;
  expiresAt: string;
};

type AuthorizeResult = {
  allowed: boolean;
  reason: string;
  session: AuthSession | null;
};

type LoginRequest = {
  providerId: string;
  email: string;
  displayName?: string;
  roles?: RbacRole[];
};

type UpsertProviderInput = {
  id: string;
  name: string;
  protocol: SsoProtocol;
  issuer: string;
  entrypoint: string;
  clientId?: string;
  enabled?: boolean;
};

const ALL_ROLES: RbacRole[] = ["viewer", "developer", "admin", "security_admin"];

const ROLE_PERMISSIONS: Record<RbacRole, Set<RbacAction>> = {
  viewer: new Set<RbacAction>(["workspace.read"]),
  developer: new Set<RbacAction>([
    "workspace.read",
    "workspace.write",
    "diff.apply",
    "auto.project_builder",
    "auto.multi_refactor"
  ]),
  admin: new Set<RbacAction>([
    "workspace.read",
    "workspace.write",
    "diff.apply",
    "diff.allow_secrets",
    "terminal.approved_run",
    "auto.project_builder",
    "auto.multi_refactor",
    "auto.multi_refactor_sensitive",
    "audit.export",
    "auth.manage"
  ]),
  security_admin: new Set<RbacAction>([
    "workspace.read",
    "workspace.write",
    "diff.apply",
    "diff.allow_secrets",
    "terminal.approved_run",
    "auto.project_builder",
    "auto.multi_refactor",
    "auto.multi_refactor_sensitive",
    "audit.export",
    "auth.manage"
  ])
};

function nowIso(): string {
  return new Date().toISOString();
}

function plusDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) {
    return fallback;
  }
  try {
    const raw = await fs.readFile(path, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  await fs.writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function normalizeRoles(input: RbacRole[] | undefined): RbacRole[] {
  const roles = (input ?? []).filter((role) => ALL_ROLES.includes(role));
  if (roles.length === 0) {
    return ["developer"];
  }
  return [...new Set(roles)];
}

function seedProviders(): SsoProvider[] {
  const createdAt = nowIso();
  return [
    {
      id: "oidc-default",
      name: "Atlas Meridian OIDC",
      protocol: "oidc",
      issuer: "https://accounts.atlasmeridian.local",
      entrypoint: "https://accounts.atlasmeridian.local/oauth2/authorize",
      clientId: "atlas-desktop",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    },
    {
      id: "saml-default",
      name: "Atlas Meridian SAML",
      protocol: "saml",
      issuer: "https://idp.atlasmeridian.local",
      entrypoint: "https://idp.atlasmeridian.local/saml/login",
      clientId: "atlas-desktop",
      enabled: true,
      createdAt,
      updatedAt: createdAt
    }
  ];
}

export type AuthManager = {
  initialize: () => Promise<void>;
  listProviders: () => Promise<SsoProvider[]>;
  upsertProvider: (input: UpsertProviderInput) => Promise<SsoProvider>;
  getSession: () => Promise<AuthSession | null>;
  login: (input: LoginRequest) => Promise<AuthSession>;
  logout: () => Promise<void>;
  authorize: (action: RbacAction) => Promise<AuthorizeResult>;
  listRoles: () => RbacRole[];
};

export function createAuthManager(root: string): AuthManager {
  const providersPath = join(root, "auth", "providers.json");
  const sessionPath = join(root, "auth", "session.json");

  async function listProviders(): Promise<SsoProvider[]> {
    return readJson<SsoProvider[]>(providersPath, []);
  }

  async function getSession(): Promise<AuthSession | null> {
    const session = await readJson<AuthSession | null>(sessionPath, null);
    if (!session) {
      return null;
    }
    if (new Date(session.expiresAt).getTime() <= Date.now()) {
      return null;
    }
    return {
      ...session,
      roles: normalizeRoles(session.roles)
    };
  }

  return {
    async initialize(): Promise<void> {
      const providers = await listProviders();
      if (providers.length === 0) {
        await writeJson(providersPath, seedProviders());
      }

      const session = await getSession();
      if (!session) {
        await writeJson(sessionPath, {
          sessionId: randomUUID(),
          userId: "local-developer",
          email: "developer@atlasmeridian.local",
          displayName: "Local Developer",
          providerId: "oidc-default",
          protocol: "oidc",
          roles: ["developer"],
          issuedAt: nowIso(),
          expiresAt: plusDays(30)
        } satisfies AuthSession);
      }
    },

    async listProviders(): Promise<SsoProvider[]> {
      const providers = await listProviders();
      return providers.sort((a, b) => a.name.localeCompare(b.name));
    },

    async upsertProvider(input: UpsertProviderInput): Promise<SsoProvider> {
      const providers = await listProviders();
      const now = nowIso();
      const next: SsoProvider = {
        id: input.id.trim(),
        name: input.name.trim(),
        protocol: input.protocol,
        issuer: input.issuer.trim(),
        entrypoint: input.entrypoint.trim(),
        clientId: input.clientId?.trim() || "atlas-desktop",
        enabled: input.enabled !== false,
        createdAt: now,
        updatedAt: now
      };
      const idx = providers.findIndex((provider) => provider.id === next.id);
      if (idx >= 0) {
        const existing = providers[idx] as SsoProvider;
        providers[idx] = {
          ...existing,
          ...next,
          createdAt: existing.createdAt,
          updatedAt: now
        };
      } else {
        providers.push(next);
      }
      await writeJson(providersPath, providers);
      return providers.find((provider) => provider.id === next.id) as SsoProvider;
    },

    async getSession(): Promise<AuthSession | null> {
      return getSession();
    },

    async login(input: LoginRequest): Promise<AuthSession> {
      const providers = await listProviders();
      const provider = providers.find((entry) => entry.id === input.providerId);
      if (!provider || !provider.enabled) {
        throw new Error("selected SSO provider is not available");
      }
      const email = input.email.trim();
      if (!email.includes("@")) {
        throw new Error("valid email is required for login");
      }
      const roles = normalizeRoles(input.roles);
      const session: AuthSession = {
        sessionId: randomUUID(),
        userId: email.toLowerCase(),
        email,
        displayName: input.displayName?.trim() || email,
        providerId: provider.id,
        protocol: provider.protocol,
        roles,
        issuedAt: nowIso(),
        expiresAt: plusDays(30)
      };
      await writeJson(sessionPath, session);
      return session;
    },

    async logout(): Promise<void> {
      if (existsSync(sessionPath)) {
        await fs.rm(sessionPath, { force: true });
      }
    },

    async authorize(action: RbacAction): Promise<AuthorizeResult> {
      const session = await getSession();
      if (!session) {
        return {
          allowed: false,
          reason: "authentication required",
          session: null
        };
      }
      for (const role of session.roles) {
        if (ROLE_PERMISSIONS[role]?.has(action)) {
          return {
            allowed: true,
            reason: "allowed",
            session
          };
        }
      }
      return {
        allowed: false,
        reason: `rbac denied for roles: ${session.roles.join(", ")}`,
        session
      };
    },

    listRoles(): RbacRole[] {
      return [...ALL_ROLES];
    }
  };
}
