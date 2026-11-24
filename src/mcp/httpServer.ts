import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { VetoBoardTaskStore } from "../core/taskStore.js";
import { createVetoBoardMcpServer, type CreateVetoBoardMcpServerOptions } from "./server.js";

export interface StartVetoBoardHttpServerOptions extends CreateVetoBoardMcpServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** Optional Bearer token(s) for VetoBoard Cloud remote authentication. */
  readonly bearerTokens?: readonly string[];
}

async function nodeRequestToWebRequest(req: IncomingMessage, baseOrigin: string): Promise<Request> {
  const url = new URL(req.url ?? "/", baseOrigin);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) {
      for (const item of v) headers.append(k, item);
    } else if (typeof v === "string") {
      headers.set(k, v);
    }
  }

  const method = req.method ?? "GET";
  if (method === "GET" || method === "HEAD") {
    return new Request(url, { headers, method });
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  }
  const body = Buffer.concat(chunks);
  return new Request(url, {
    body: body.length > 0 ? body : undefined,
    headers,
    method,
  });
}

async function writeWebResponseToNode(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webRes.body) {
    res.end();
    return;
  }
  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) res.write(Buffer.from(value));
    }
  } finally {
    res.end();
  }
}

export async function startVetoBoardHttpServer(
  options?: StartVetoBoardHttpServerOptions,
): Promise<{ readonly server: Server; readonly port: number; readonly url: string; readonly close: () => Promise<void> }> {
  const store = options?.store ?? new VetoBoardTaskStore();
  const allowedTokens = new Set(
    (
      options?.bearerTokens ??
      (process.env.VETOBOARD_SERVER_TOKENS
        ? process.env.VETOBOARD_SERVER_TOKENS.split(",").map((s) => s.trim()).filter(Boolean)
        : [])
    ),
  );

  const handler = createMcpHandler(() =>
    createVetoBoardMcpServer({
      defaultLocale: options?.defaultLocale,
      store,
      version: options?.version,
    }),
  );

  const host = options?.host ?? "127.0.0.1";
  const requestedPort = options?.port ?? Number(process.env.VETOBOARD_PORT || 4399);

  const httpServer = createServer(async (req, res) => {
    try {
      const pathname = (req.url ?? "/").split("?")[0] ?? "/";
      if (pathname === "/health") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(JSON.stringify({ mode: "cloud-http", ok: true, service: "vetoboard-mcp" }));
        return;
      }

      if (allowedTokens.size > 0) {
        const auth = req.headers.authorization ?? "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (!token || !allowedTokens.has(token)) {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: "Unauthorized: valid Bearer token required." }));
          return;
        }
      }

      if (pathname === "/mcp" || pathname === "/") {
        const origin = `http://${req.headers.host ?? `${host}:${requestedPort}`}`;
        const webReq = await nodeRequestToWebRequest(req, origin);
        const webRes = await handler.fetch(webReq);
        await writeWebResponseToNode(webRes, res);
        return;
      }

      res.statusCode = 404;
      res.end("Not Found");
    } catch (err) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(requestedPort, host, () => resolveListen());
  });

  const addr = httpServer.address();
  const actualPort = typeof addr === "object" && addr ? addr.port : requestedPort;
  const url = `http://${host}:${actualPort}/mcp`;

  return {
    close: () =>
      new Promise<void>((resolveClose) => {
        httpServer.close(() => resolveClose());
      }),
    port: actualPort,
    server: httpServer,
    url,
  };
}
