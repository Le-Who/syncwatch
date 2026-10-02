import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { isBogon } from "./ip";

export class UnsafeMetadataDestination extends Error {}

/** Resolve through the OS, validate every candidate, and dial only that pin.
 * The original URL retains Host, TLS SNI and certificate validation.
 * Neither pooling nor redirects can introduce an unvalidated destination.
 */
export async function getMetadataText(url: URL): Promise<string> {
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new UnsafeMetadataDestination("Invalid destination");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const family = isIP(hostname);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Metadata timeout")), 5000);
  });
  try {
    const addresses = family
      ? [{ address: hostname, family }]
      : await Promise.race([
          dns.lookup(hostname, { all: true, verbatim: true }),
          deadline,
        ]);
    if (!addresses.length || addresses.some((item) => isBogon(item.address))) {
      throw new UnsafeMetadataDestination(
        "Access to private network forbidden",
      );
    }
    const pin = addresses[0];
    const lookup = ((
      _hostname: string,
      options: { all?: boolean },
      callback: any,
    ) => {
      if (options.all) callback(null, [pin]);
      else callback(null, pin.address, pin.family);
    }) as LookupFunction;
    return await Promise.race([
      deadline,
      new Promise<string>((resolve, reject) => {
        const transport = url.protocol === "https:" ? https : http;
        const request = transport.request(
          url,
          {
            lookup,
            agent: false,
            signal: AbortSignal.timeout(5000),
            headers: {
              "User-Agent": "SyncWatch metadata",
              "Accept-Encoding": "identity",
            },
          },
          (response) => {
            if (
              !response.statusCode ||
              response.statusCode < 200 ||
              response.statusCode >= 300
            ) {
              response.destroy();
              reject(new Error("Metadata HTTP response unavailable"));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on("data", (chunk: Buffer) => {
              const remaining = 50 * 1024 - size;
              const bounded = Buffer.from(chunk).subarray(0, remaining);
              chunks.push(bounded);
              size += bounded.length;
              if (size >= 50 * 1024) {
                resolve(Buffer.concat(chunks).toString("utf8"));
                response.destroy();
              }
            });
            response.on("end", () =>
              resolve(Buffer.concat(chunks).toString("utf8")),
            );
            response.on("error", reject);
          },
        );
        request.on("error", reject);
        deadline.catch(() => request.destroy());
        request.end();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
