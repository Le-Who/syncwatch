import { createServer, request, type IncomingHttpHeaders } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

const CONTEXT_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONTEXT_HEADER = "x-syncwatch-e2e-client";

export function createTrustedForwardedAddressResolver() {
  const addresses = new Map<string, string>();

  return (contextId: string | string[] | undefined): string | null => {
    if (typeof contextId !== "string" || !CONTEXT_ID.test(contextId)) {
      return null;
    }

    const existing = addresses.get(contextId);
    if (existing) return existing;

    const next = addresses.size + 1;
    if (next > 254) {
      throw new Error("The E2E proxy supports at most 254 browser contexts.");
    }
    const address = `203.0.113.${next}`;
    addresses.set(contextId, address);
    return address;
  };
}

function forwardedHeaders(
  headers: IncomingHttpHeaders,
  resolveAddress: ReturnType<typeof createTrustedForwardedAddressResolver>,
): IncomingHttpHeaders {
  const next = { ...headers };
  delete next["x-forwarded-for"];
  delete next[CONTEXT_HEADER];

  const address = resolveAddress(headers[CONTEXT_HEADER]);
  if (address) next["x-forwarded-for"] = address;
  return next;
}

export function startTrustedProxy(options: {
  port: number;
  targetPort: number;
}) {
  const resolveAddress = createTrustedForwardedAddressResolver();
  const proxy = createServer((incoming, outgoing) => {
    const upstream = request(
      {
        host: "127.0.0.1",
        port: options.targetPort,
        method: incoming.method,
        path: incoming.url,
        headers: forwardedHeaders(incoming.headers, resolveAddress),
      },
      (response) => {
        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(outgoing);
      },
    );
    upstream.on("error", () => {
      if (!outgoing.headersSent) outgoing.writeHead(502);
      outgoing.end("E2E proxy could not reach the application server.");
    });
    incoming.pipe(upstream);
  });

  proxy.on("upgrade", (incoming, socket, head) => {
    const upstream = connect(options.targetPort, "127.0.0.1");
    upstream.on("connect", () => {
      const headers = forwardedHeaders(incoming.headers, resolveAddress);
      const serializedHeaders = Object.entries(headers)
        .flatMap(([name, value]) =>
          Array.isArray(value)
            ? value.map((entry) => `${name}: ${entry}`)
            : value === undefined
              ? []
              : [`${name}: ${value}`],
        )
        .join("\r\n");
      upstream.write(
        `${incoming.method} ${incoming.url} HTTP/${incoming.httpVersion}\r\n${serializedHeaders}\r\n\r\n`,
      );
      if (head.length > 0) upstream.write(head);
      socket.pipe(upstream).pipe(socket);
    });
    const closeBoth = () => {
      socket.destroy();
      upstream.destroy();
    };
    upstream.on("error", closeBoth);
    socket.on("error", closeBoth);
  });

  return new Promise<void>((resolve) => proxy.listen(options.port, resolve));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void startTrustedProxy({
    port: Number(process.env.PORT ?? 3001),
    targetPort: Number(process.env.TARGET_PORT ?? 3002),
  });
}
