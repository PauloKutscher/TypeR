const fs = require("fs");
const http = require("http");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const testDir = path.join(rootDir, ".update-test");
const zipPath = path.resolve(process.argv[2] || path.join(testDir, "TypeR-3.0.0.zip"));
const port = Number(process.argv[3] || 17831);
const host = "127.0.0.1";
const baseUrl = `http://${host}:${port}`;
const eventsPath = path.join(testDir, "events.jsonl");

if (!fs.existsSync(zipPath)) {
  throw new Error(`Update test ZIP not found: ${zipPath}`);
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid update test port: ${port}`);
}

fs.mkdirSync(testDir, { recursive: true });
const record = (event, details = {}) => {
  const entry = { time: new Date().toISOString(), event, ...details };
  fs.appendFileSync(eventsPath, JSON.stringify(entry) + "\n");
  process.stdout.write(`[update-test] ${event}${details.url ? ` ${details.url}` : ""}\n`);
};

const server = http.createServer((request, response) => {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Accept, Content-Type");
  response.setHeader("Cache-Control", "no-store");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  record("request", { method: request.method, url: request.url });
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, version: "3.0.0" }));
    return;
  }
  if (request.url === "/releases") {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify([{
      tag_name: "3.0.0",
      name: "TypeR 3.0.0 local update test",
      draft: false,
      prerelease: false,
      published_at: new Date().toISOString(),
      body_html: "<p>Test local de la mise à jour TypeR 3.0.0 — aucune release GitHub n’a été publiée.</p>",
      assets: [{
        name: "TypeR-3.0.0.zip",
        browser_download_url: `${baseUrl}/TypeR-3.0.0.zip`,
      }],
    }]));
    return;
  }
  if (request.url === "/TypeR-3.0.0.zip") {
    const stat = fs.statSync(zipPath);
    response.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": stat.size,
    });
    fs.createReadStream(zipPath).pipe(response);
    return;
  }

  response.writeHead(404, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: "not found" }));
});

server.listen(port, host, () => {
  fs.writeFileSync(path.join(testDir, "server.json"), JSON.stringify({
    pid: process.pid,
    baseUrl,
    zipPath,
    startedAt: new Date().toISOString(),
  }, null, 2));
  record("server-started", { url: baseUrl, pid: process.pid });
});

const stop = () => server.close(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
