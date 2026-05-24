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

// ── Multi-bot state ────────────────────────────────────────────
interface BotEntry {
  process: ChildProcess;
  name: string;
  tableUrl: string;
  startedAt: string;
}

const bots = new Map<string, BotEntry>();
let nextBotId = 1;

let logClients: Response[] = [];

// SSE: stream logs to all connected browsers
// Each message is JSON: { id, name, msg }
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

function broadcast(id: string, name: string, msg: string) {
  const data = `data: ${JSON.stringify({ id, name, msg })}\n\n`;
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

// List running bots
app.get("/bots", (_req: Request, res: Response) => {
  const list = Array.from(bots.entries()).map(([id, b]) => ({
    id,
    name: b.name,
    tableUrl: b.tableUrl,
    startedAt: b.startedAt,
  }));
  res.json(list);
});

// Launch a new bot instance (no limit — call multiple times)
app.post("/start", (req: Request, res: Response) => {
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
  const id               = `bot${nextBotId++}`;
  const readsFile        = `player_reads_${id}.json`;

  // Save config back to .env as the new default
  saveToEnv({
    TABLE_URL: tableUrl,
    BOT_NAME:  resolvedName,
    STACK:     resolvedStack,
    STRATEGY:  resolvedStrategy,
  });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TABLE_URL:  tableUrl,
    BOT_NAME:   resolvedName,
    STACK:      resolvedStack,
    STRATEGY:   resolvedStrategy,
    READS_FILE: readsFile,
  };

  broadcast(id, resolvedName, `[server] launching bot — name="${resolvedName}" stack=${resolvedStack} table=${tableUrl}`);

  const proc = spawn("npx", ["ts-node", "index.ts"], {
    env,
    cwd: __dirname,
  });

  bots.set(id, {
    process: proc,
    name: resolvedName,
    tableUrl,
    startedAt: new Date().toISOString(),
  });

  proc.stdout?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach(line => broadcast(id, resolvedName, line));
  });

  proc.stderr?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach(line => {
      if (!line.includes("ExperimentalWarning") && !line.includes("DeprecationWarning")) {
        broadcast(id, resolvedName, `[err] ${line}`);
      }
    });
  });

  proc.on("exit", (code) => {
    broadcast(id, resolvedName, `[server] bot process exited (code ${code})`);
    bots.delete(id);
    // Notify UI that this bot is gone
    const data = `data: ${JSON.stringify({ id, name: resolvedName, msg: "__exited__" })}\n\n`;
    logClients.forEach(c => c.write(data));
  });

  res.json({ ok: true, id, name: resolvedName });
});

// Stop a specific bot by ID
app.post("/stop", (req: Request, res: Response) => {
  const { id } = req.body as { id?: string };

  if (id) {
    const bot = bots.get(id);
    if (bot) {
      bot.process.kill("SIGTERM");
      bots.delete(id);
      broadcast(id, bot.name, "[server] stopped by user");
    }
  } else {
    // Stop all bots (legacy / "stop all" behaviour)
    for (const [bid, bot] of bots.entries()) {
      bot.process.kill("SIGTERM");
      broadcast(bid, bot.name, "[server] stopped by user");
    }
    bots.clear();
  }

  res.json({ ok: true });
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n🃏 PokerNow Bot UI → ${url}\n`);
  const cmd = process.platform === "darwin" ? `open ${url}`
            : process.platform === "win32"  ? `start ${url}`
            : `xdg-open ${url}`;
  exec(cmd);
});
