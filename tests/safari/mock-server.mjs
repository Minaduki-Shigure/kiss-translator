import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const readyPath = process.argv[2];
const requests = [];
const blocked = [];
const translations = {
  "The quiet library opens every morning.": "安静的图书馆每天早晨开放。",
  "Small experiments help us understand the world.": "小实验帮助我们理解世界。",
};
const listen = (server) => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
const readBody = async (request) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  return body ? JSON.parse(body) : {};
};

const fixture = http.createServer((req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (req.url.startsWith("/csp")) {
    res.setHeader("Content-Security-Policy", "script-src 'none'; object-src 'none'");
    res.end("<!doctype html><title>CSP fixture</title><body>CSP response header probe</body>");
  } else res.end(fs.readFileSync(path.join(directory, "fixture.html")));
});
const api = http.createServer(async (req, res) => {
  // Intentionally no Access-Control-Allow-Origin: success must use the extension's host permission.
  requests.push({ path: req.url, method: req.method, origin: req.headers.origin || null });
  if (req.url === "/report") {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify({ requests, blocked }));
  }
  if (req.url === "/sse") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
    res.write('data: {"text":"first"}\n\n');
    setTimeout(() => res.write('data: {"text":"second"}\n\n'), 50);
    setTimeout(() => res.end("data: [DONE]\n\n"), 100);
    return;
  }
  res.setHeader("Content-Type", "application/json");
  if (req.url === "/translate") {
    try {
      const body = await readBody(req);
      const translate = (text) => ({ text: translations[text.trim()] || `译文：${text}`, src: "en" });
      return res.end(JSON.stringify(body.texts ? { translations: body.texts.map(translate) } : translate(body.text)));
    } catch (error) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: error.message }));
    }
  }
  res.end(JSON.stringify({ ok: true, origin: req.headers.origin || null, marker: "local-api-response" }));
});
const proxy = http.createServer((req, res) => {
  blocked.push(req.url);
  res.writeHead(403).end("External network disabled by integration probe");
});
proxy.on("connect", (req, socket, head) => {
  const [host, port] = req.url.split(":");
  if (!["127.0.0.1", "localhost"].includes(host)) {
    blocked.push(req.url);
    socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n");
    return;
  }
  const upstream = net.connect(Number(port), "127.0.0.1", () => {
    socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  upstream.on("error", () => socket.destroy());
  socket.on("error", () => upstream.destroy());
});
const [fixturePort, apiPort, proxyPort] = await Promise.all([listen(fixture), listen(api), listen(proxy)]);
fs.writeFileSync(readyPath, JSON.stringify({ fixtureURL: `http://127.0.0.1:${fixturePort}/fixture`, apiURL: `http://127.0.0.1:${apiPort}`, proxyPort }));
process.on("SIGTERM", () => process.exit(0));
