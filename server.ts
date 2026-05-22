import "dotenv/config";
import express, { Request, Response } from "express";
import { spawn, ChildProcess } from "child_process";
import path from "path";
import fs from "fs";
import { exec } from "child_process";

// Persist config back to .env so the next launch remembers it
function saveToEnv(updates: Record<string, string>) {
  const envPath = path.join(__dirname, ".env");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  for (const [key, value] of Object.entries(updates)) {
    const escaped = value.replace(/\n/g, "\\n");
    const line = `${key}=${escaped}`;
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content = content.trimEnd() + `\n${line}\n`;
    }
  }
  fs.writeFileSync(envPath, content);
}

const app = express();
const PORT = 3001;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let botProcess: ChildProcess | null = null;
let logClients: Response[] = [];

// SSE: stream logs to all connected browsers
app.get("/logs", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();
  logClients.push(res);
  req.on("close", () => {
    logClients = logClients.filter(c => c !== res);
  });
});

function broadcast(msg: string) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  logClients.forEach(c => c.write(data));
}

// Return current config defaults for the UI to pre-fill
app.get("/config", (_req: Request, res: Response) => {
  res.json({
    tableUrl: process.env.TABLE_URL ?? "",
    strategy: process.env.STRATEGY ?? "Play GTO (Game Theory Optimal) poker.",
    botName:  process.env.BOT_NAME  ?? "",
    stack:    process.env.STACK     ?? "1000",
  });
});

// Start the bot
app.post("/start", (req: Request, res: Response) => {
  if (botProcess) {
    res.json({ error: "Bot is already running. Stop it first." });
    return;
  }

  const { tableUrl, botName, stack, strategy } = req.body as {
    tableUrl: string;
    botName:  string;
    stack:    number;
    strategy: string;
  };

  if (!tableUrl) {
    res.json({ error: "tableUrl is required" });
    return;
  }

  const resolvedName     = botName  || "PokerBot";
  const resolvedStack    = String(stack || 1000);
  const resolvedStrategy = strategy || "Play GTO poker.";

  // Save back to .env so next launch remembers these values
  saveToEnv({
    TABLE_URL: tableUrl,
    BOT_NAME:  resolvedName,
    STACK:     resolvedStack,
    STRATEGY:  resolvedStrategy,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TABLE_URL: tableUrl,
    BOT_NAME:  resolvedName,
    STACK:     resolvedStack,
    STRATEGY:  resolvedStrategy,
  };

  broadcast(`[server] launching bot — name="${resolvedName}" stack=${resolvedStack}`);

  botProcess = spawn("npx", ["ts-node", "index.ts"], {
    env,
    cwd: __dirname,
  });

  botProcess.stdout?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach(broadcast);
  });

  botProcess.stderr?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach(line => {
      if (!line.includes("ExperimentalWarning") && !line.includes("DeprecationWarning")) {
        broadcast(`[err] ${line}`);
      }
    });
  });

  botProcess.on("exit", (code) => {
    broadcast(`[server] bot process exited (code ${code})`);
    botProcess = null;
  });

  res.json({ ok: true });
});

// Stop the bot
app.post("/stop", (_req: Request, res: Response) => {
  if (botProcess) {
    botProcess.kill("SIGTERM");
    botProcess = null;
    broadcast("[server] stopped by user");
  }
  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🃏 PokerNow Bot UI → ${url}\n`);
  // auto-open in default browser
  const cmd = process.platform === "darwin" ? `open ${url}`
            : process.platform === "win32"  ? `start ${url}`
            : `xdg-open ${url}`;
  exec(cmd);
});
