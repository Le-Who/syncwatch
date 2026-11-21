/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

import { POST } from "../app/api/auth/session/route";
import { getJwtSecret } from "../lib/jwt-config";
import { checkRedisRateLimit } from "../lib/redis-rate-limit";
import { verifySessionToken, verifyUpgradeToken } from "../lib/session-auth";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn(),
}));

function request(
  body: unknown = {},
  options: {
    cookie?: string;
    forwardedFor?: string;
    upgradeRoom?: string;
  } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.forwardedFor) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }
  const url = new URL("http://localhost/api/auth/session");
  if (options.upgradeRoom)
    url.searchParams.set("upgradeRoom", options.upgradeRoom);
  return new Request(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/session", () => {
  beforeEach(() => {
    vi.mocked(checkRedisRateLimit).mockResolvedValue(true);
    vi.stubEnv("ALLOW_LEGACY_SOCKET_TOKEN", "false");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("does not sign an arbitrary participant id from the request body", async () => {
    const response = await POST(request({ participantId: "known-owner-id" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.participantId).not.toBe("known-owner-id");
    expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(body).not.toHaveProperty("token");
    const session = response.headers
      .get("set-cookie")!
      .split(";", 1)[0]
      .split("=", 2)[1];
    expect(decodeJwt(session)).toMatchObject({
      participantId: body.participantId,
    });
    expect(response.headers.get("set-cookie")).toContain("syncwatch_session=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });

  it("reuses the participant id from a valid session cookie", async () => {
    const first = await POST(request());
    const firstBody = await first.json();
    const cookie = first.headers.get("set-cookie")!.split(";", 1)[0];

    const second = await POST(
      request({ participantId: "stale-local-id" }, { cookie }),
    );
    const secondBody = await second.json();

    expect(secondBody.participantId).toBe(firstBody.participantId);
    expect(secondBody).toEqual(firstBody);
    expect(second.headers.has("set-cookie")).toBe(false);
  });

  it("issues an expiring upgrade proof for one room from the current cookie", async () => {
    const initial = await POST(request());
    const cookie = initial.headers.get("set-cookie")!.split(";", 1)[0];
    const { participantId } = await initial.json();
    const upgrade = await POST(
      request({}, { cookie, upgradeRoom: "current-room" }),
    );
    const { token } = await upgrade.json();
    const secret = getJwtSecret();
    const claims = decodeJwt(token);

    expect(claims.exp! - claims.iat!).toBe(30);
    expect(upgrade.headers.has("set-cookie")).toBe(false);
    await expect(
      verifyUpgradeToken(token, "current-room", secret, false),
    ).resolves.toMatchObject({ participantId });
    await expect(
      verifyUpgradeToken(token, "other-room", secret, false),
    ).rejects.toThrow("Invalid session upgrade audience");
    await expect(verifySessionToken(token, secret)).rejects.toThrow(
      "Invalid session audience",
    );
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime((claims.exp! + 1) * 1_000);
      await expect(
        verifyUpgradeToken(token, "current-room", secret, false),
      ).rejects.toMatchObject({ code: "ERR_JWT_EXPIRED", claim: "exp" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the legacy response and live upgrade available only during explicit migration", async () => {
    vi.stubEnv("ALLOW_LEGACY_SOCKET_TOKEN", "true");
    const response = await POST(request());
    const { participantId, token } = await response.json();
    const secret = getJwtSecret();
    expect(response.headers.get("set-cookie")).toContain(
      `syncwatch_session=${token}`,
    );
    await expect(
      verifyUpgradeToken(token, "legacy-room", secret, true),
    ).resolves.toMatchObject({ participantId });
    await expect(
      verifyUpgradeToken(token, "legacy-room", secret, false),
    ).rejects.toThrow("Invalid session upgrade audience");
  });

  it("replaces a malformed cookie without logging its token", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const rejectedToken = "malformed-sensitive-token";

    const response = await POST(
      request({}, { cookie: `syncwatch_session=${rejectedToken}` }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.participantId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(JSON.stringify(error.mock.calls)).not.toContain(rejectedToken);
  });

  it("applies the auth rate limit even when Redis is not configured", async () => {
    vi.mocked(checkRedisRateLimit).mockResolvedValueOnce(false);

    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(checkRedisRateLimit).toHaveBeenCalledWith(
      "api:auth:unknown",
      1000,
      60_000,
    );
  });
});

describe("getJwtSecret", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("requires JWT_SECRET in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("JWT_SECRET", "");

    expect(() => getJwtSecret()).toThrow(/JWT_SECRET/);
  });
});
