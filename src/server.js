import crypto from "node:crypto";
import http from "node:http";
import { loadConfig } from "./config.js";
import { createApp } from "./proxy.js";

const config = loadConfig();
if (!config.sessionSecret) config.sessionSecret = crypto.randomBytes(32).toString("hex");

const app = createApp(config);
const server = http.createServer({ maxHeaderSize: 65536 }, (req, res) => {
  app.handle(req, res).catch((error) => {
    const status = error.status || 502;
    if (!res.headersSent) {
      const message = status === 413 ? "That upload is too large." : "Chess.com did not answer.";
      res.writeHead(status, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      res.end(message);
    } else {
      res.destroy();
    }
    if (status >= 500) {
      console.error(JSON.stringify({ t: new Date().toISOString(), msg: error.message }));
    }
  });
});

server.on("upgrade", (req, socket, head) => {
  try {
    app.upgrade(req, socket, head);
  } catch {
    socket.destroy();
  }
});

server.listen(config.port, config.bindHost, () => {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      msg: "listening",
      bind: config.bindHost,
      port: config.port,
      auth: Boolean(config.accessKey),
    }),
  );
});
