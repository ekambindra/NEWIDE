import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuthManager } from "./auth.js";

describe("auth manager", () => {
  it("seeds oidc/saml providers and default session", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-auth-"));
    const auth = createAuthManager(root);
    await auth.initialize();

    const providers = await auth.listProviders();
    expect(providers.some((provider) => provider.protocol === "oidc")).toBe(true);
    expect(providers.some((provider) => provider.protocol === "saml")).toBe(true);

    const session = await auth.getSession();
    expect(session).not.toBeNull();
    expect(session?.roles.includes("developer")).toBe(true);
  });

  it("supports login role changes and rbac authorization", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-auth-login-"));
    const auth = createAuthManager(root);
    await auth.initialize();

    await auth.login({
      providerId: "saml-default",
      email: "viewer@example.com",
      roles: ["viewer"]
    });
    const denied = await auth.authorize("auto.project_builder");
    expect(denied.allowed).toBe(false);

    await auth.login({
      providerId: "oidc-default",
      email: "sec@example.com",
      roles: ["security_admin"]
    });
    const allowed = await auth.authorize("audit.export");
    expect(allowed.allowed).toBe(true);
  });

  it("upserts provider configurations", async () => {
    const root = await mkdtemp(join(tmpdir(), "atlas-auth-provider-"));
    const auth = createAuthManager(root);
    await auth.initialize();

    await auth.upsertProvider({
      id: "oidc-corp",
      name: "Corp OIDC",
      protocol: "oidc",
      issuer: "https://id.corp.local",
      entrypoint: "https://id.corp.local/auth",
      clientId: "atlas-corp",
      enabled: true
    });

    const providers = await auth.listProviders();
    expect(providers.some((provider) => provider.id === "oidc-corp")).toBe(true);
  });
});
