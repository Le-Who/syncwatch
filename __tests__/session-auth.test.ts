/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodeJwt } from "jose";

import { POST } from "../app/api/auth/session/route";
import { getJwtSecret } from "../lib/jwt-config";
import { checkRedisRateLimit } from "../lib/redis-rate-limit";

vi.mock("../lib/redis-rate-limit", () => ({
  checkRedisRateLimit: vi.fn(),
}));

function request(
  body: unknown = {},
  options: { cookie?: string; forwardedFor?: string } = {},
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.forwardedFor) {
    headers.set("x-forwarded-for", options.forwardedFor);
  }
  return new Request("http://localhost/api/auth/session", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("POST /api/auth/session", () => {
  beforeEach(() => {
    vi.mocked(checkRedisRateLimit).mockResolvedValue(true);
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
    expect(decodeJwt(body.token)).toMatchObject({
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
    expect(secondBody.token).toBe(firstBody.token);
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
