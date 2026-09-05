/**
 * @vitest-environment node
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";

describe("socket authentication environment ordering", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not resolve a production secret at module evaluation before bootstrap", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "");
    vi.resetModules();

    await expect(import("../lib/socket/setup")).resolves.toBeDefined();
    await expect(import("../lib/socket/commands")).resolves.toBeDefined();

    vi.stubEnv("JWT_SECRET", "test-secret-loaded-after-import");
    const { setupSocketAuth } = await import("../lib/socket/setup");
    const use = vi.fn();
    setupSocketAuth({ use } as any);
    const middleware = use.mock.calls[0][0];
    const token = await new SignJWT({ participantId: "env-loaded-client" })
      .setProtectedHeader({ alg: "HS256" })
      .sign(new TextEncoder().encode("test-secret-loaded-after-import"));
    const socket = {
      request: { headers: { cookie: `syncwatch_session=${token}` } },
      handshake: { auth: {} },
      data: {},
    };

    await expect(
      new Promise<void>((resolve, reject) =>
        middleware(socket, (error?: Error) =>
          error ? reject(error) : resolve(),
        ),
      ),
    ).resolves.toBeUndefined();
    expect(socket.data).toMatchObject({ participantId: "env-loaded-client" });
  });
});
