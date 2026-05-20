import { spawn } from "child_process";
import path from "path";
import fs from "fs";

// 1. Load env vars
const envFile = fs.readFileSync(path.resolve("c:/Users/digital/Desktop/gm/secure-chat-2/artifacts/api-server/.env"), "utf8");
let databaseUrl = "";
for (const line of envFile.split("\n")) {
  if (line.trim().startsWith("DATABASE_URL=")) {
    databaseUrl = line.split("=", 2)[1].trim().replace(/['"]/g, "");
  }
}

// 2. Start the server on a custom port
const serverProcess = spawn("node", ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: path.resolve("c:/Users/digital/Desktop/gm/secure-chat-2/artifacts/api-server"),
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    PORT: "5001"
  }
});

serverProcess.stdout.on("data", (data) => console.log(`SERVER OUT: ${data}`));
serverProcess.stderr.on("data", (data) => console.error(`SERVER ERR: ${data}`));

// 3. Wait a moment and then send a signup request
setTimeout(async () => {
  try {
    console.log("Sending POST request to http://localhost:5001/api/auth/signup...");
    const res = await fetch("http://localhost:5001/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "testuser_" + Date.now(),
        password: "testpassword",
        publicKey: "testpublickey"
      })
    });
    
    console.log("Response Status:", res.status);
    const text = await res.text();
    console.log("Response Body:", text);
    
  } catch (err) {
    console.error("Fetch failed:", err);
  } finally {
    serverProcess.kill();
    process.exit(0);
  }
}, 3000);
