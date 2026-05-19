import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocket } from "./websocket";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "Server listening");
});

