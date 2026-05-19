import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import router from "./routes";
import { logger } from "./lib/logger";

// Robust __dirname definition that works in ES modules and bundles
const getDirname = () => {
  try {
    return __dirname;
  } catch {
    return path.dirname(fileURLToPath(import.meta.url));
  }
};
const dirName = getDirname();

const getFrontendDistPath = () => {
  // Try resolving relative to dist folder (production build)
  const prodPath = path.resolve(dirName, "../../chat/dist");
  // Try resolving relative to src folder (development)
  const devPath = path.resolve(dirName, "../../../chat/dist");
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }
  return devPath;
};
const frontendDistPath = getFrontendDistPath();

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Serve static assets from frontend build
app.use(express.static(frontendDistPath));

// Fallback for Single Page Application routing (serve index.html)
app.get("/(.*)", (req, res, next) => {
  // Avoid capturing API requests or websocket requests
  if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
    return next();
  }
  const indexPath = path.join(frontendDistPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Frontend assets not found. Please build the frontend first.");
  }
});

export default app;
