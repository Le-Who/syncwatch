/** @vitest-environment node */
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/metadata/route";

const dials: Array<{
  url: URL;
  address: string;
  family: number;
  options: any;
}> = [];
let status = 200;
let body = "<title>Public media</title>";
const get = (url: string) =>
  GET(
    new NextRequest(
      `http://localhost/api/metadata?url=${encodeURIComponent(url)}`,
      { headers: { "x-syncwatch-client-ip": crypto.randomUUID() } },
    ),
  );
beforeEach(() => {
  dials.length = 0;
  status = 200;
  body = "<title>Public media</title>";
  vi.spyOn(dns, "resolve").mockResolvedValue(["8.8.8.8"]);
  vi.spyOn(dns, "lookup").mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ] as any);
  // Prevent the old unsafe fetch boundary from reaching a network during RED.
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response("<title>Unsafe independent resolution</title>"),
    ),
  );
  const request = ((url: URL, options: any, callback: any) => {
    const req = new EventEmitter() as any;
    req.end = () => {
      options.lookup(
        url.hostname,
        { all: false },
        (error: Error | null, address: string, family: number) => {
          if (error) {
            req.emit("error", error);
            return;
          }
          dials.push({ url, address, family, options });
          const res = new PassThrough() as any;
          res.statusCode = status;
          res.headers = { location: "http://127.0.0.1/private" };
          callback(res);
          res.end(body);
        },
      );
    };
    req.destroy = (error?: Error) => {
      if (error) queueMicrotask(() => req.emit("error", error));
    };
    req.setTimeout = () => req;
    return req;
  }) as any;
  vi.spyOn(http, "request").mockImplementation(request);
  vi.spyOn(https, "request").mockImplementation(request);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("pins the checked public address into the actual HTTP lookup and keeps hostname/SNI", async () => {
  const response = await get("https://media.example/video.mp4");
  expect(await response.json()).toMatchObject({ title: "Public media" });
  expect(dials).toHaveLength(1);
  expect(dials[0]).toMatchObject({
    address: "8.8.8.8",
    family: 4,
    url: new URL("https://media.example/video.mp4"),
  });
  expect(dials[0].options.agent).toBe(false);
  // A second lookup would now resolve privately; dialing still uses the pin.
  vi.mocked(dns.lookup).mockResolvedValue([
    { address: "127.0.0.1", family: 4 },
  ] as any);
  let pinned = "";
  dials[0].options.lookup(
    "media.example",
    {},
    (_err: unknown, address: string) => {
      pinned = address;
    },
  );
  expect(pinned).toBe("8.8.8.8");
  expect(dns.lookup).toHaveBeenCalledTimes(1);
});
it("does not follow a public-to-private redirect", async () => {
  status = 302;
  body = "";
  expect((await get("http://public.example/clip.mp4")).status).toBe(200);
  expect(dials).toHaveLength(1);
  expect(dials[0].url.hostname).toBe("public.example");
});
it.each([
  "http://127.0.0.1/a",
  "http://[::1]/a",
  "http://[fc00::1]/a",
  "http://[::ffff:127.0.0.1]/a",
  "https://user:pass@public.example/a",
])("blocks unsafe destination %s before dialing", async (url) => {
  expect((await get(url)).status).toBe(403);
  expect(dials).toHaveLength(0);
});
it("blocks a private IPv6 DNS result even alongside public IPv4", async () => {
  vi.mocked(dns.lookup).mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
    { address: "fe80::1", family: 6 },
  ] as any);
  expect((await get("https://mixed.example/a")).status).toBe(403);
  expect(dials).toHaveLength(0);
});
it("pins public IPv6 literals", async () => {
  await get("https://[2606:4700:4700::1111]/a");
  expect(dials[0]).toMatchObject({
    address: "2606:4700:4700::1111",
    family: 6,
  });
});
it.each([
  "http://240.0.0.1/a",
  "http://[2002:7f00:1::]/a",
  "http://[64:ff9b::7f00:1]/a",
])("blocks special-use or translated private destinations %s", async (url) => {
  expect((await get(url)).status).toBe(403);
  expect(dials).toHaveLength(0);
});
it("retains useful YouTube oEmbed and valid-URL fallback", async () => {
  body = JSON.stringify({
    title: "Public YouTube",
    thumbnail_url: "https://i.ytimg.com/example.jpg",
  });
  expect(
    await (await get("https://www.youtube.com/watch?v=M7lc1UVf-VE")).json(),
  ).toMatchObject({ title: "Public YouTube" });
  vi.mocked(dns.lookup).mockRejectedValue(new Error("offline"));
  expect(
    await (await get("https://www.youtube.com/watch?v=M7lc1UVf-VE")).json(),
  ).toMatchObject({ title: "YouTube video" });
});
