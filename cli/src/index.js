import { exec, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

const BANNER = `
${c.cyan}${c.bold}=======================================================
               JARVIS WORKSPACE CLI
       AR & Voice-Controlled Autonomous Workspace
=======================================================${c.reset}
`;

function checkPort(port, host = '127.0.0.1', timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
    socket.connect(port, host);
  });
}

async function runDoctor() {
  console.log(`${c.yellow}${c.bold}Running JARVIS System Diagnostics...${c.reset}\n`);

  // Node check
  const nodeVer = process.version;
  const major = parseInt(nodeVer.replace('v', '').split('.')[0], 10);
  if (major >= 20) {
    console.log(` ${c.green}✓${c.reset} Node.js: ${nodeVer} (Supported)`);
  } else {
    console.log(` ${c.yellow}!${c.reset} Node.js: ${nodeVer} (Recommended v20+)`);
  }

  // Python check
  try {
    const { stdout } = await execAsync('python --version');
    console.log(` ${c.green}✓${c.reset} Python: ${stdout.trim()}`);
  } catch {
    console.log(` ${c.red}✗${c.reset} Python not found in PATH (Requires Python 3.11+)`);
  }

  // Virtualenv check
  const venvWin = path.join(ROOT_DIR, 'orchestrator/venv/Scripts/python.exe');
  const venvUnix = path.join(ROOT_DIR, 'orchestrator/venv/bin/python');
  if (fs.existsSync(venvWin) || fs.existsSync(venvUnix)) {
    console.log(` ${c.green}✓${c.reset} Orchestrator virtualenv detected`);
  } else {
    console.log(` ${c.yellow}!${c.reset} Orchestrator virtualenv missing (Run: npm run jarvis init)`);
  }

  // Redis port check
  const redisOk = await checkPort(6379);
  if (redisOk) {
    console.log(` ${c.green}✓${c.reset} Redis active on port 6379`);
  } else {
    console.log(` ${c.yellow}!${c.reset} Redis not active on port 6379 (Start via: docker compose up -d redis)`);
  }

  // Orchestrator port check
  const orchOk = await checkPort(8000);
  if (orchOk) {
    console.log(` ${c.green}✓${c.reset} Orchestrator active on port 8000`);
  } else {
    console.log(` ${c.dim}-${c.reset} Orchestrator not currently running`);
  }

  // Obsidian port check
  const obsOk = await checkPort(27123);
  if (obsOk) {
    console.log(` ${c.green}✓${c.reset} Obsidian Local REST API detected on port 27123`);
  } else {
    console.log(` ${c.dim}-${c.reset} Obsidian Local REST API not active on port 27123`);
  }

  console.log(`\n${c.cyan}Diagnostics completed.${c.reset}\n`);
}

async function runInit() {
  console.log(`${c.cyan}${c.bold}Initializing JARVIS Environment...${c.reset}\n`);

  // Env check
  const envPath = path.join(ROOT_DIR, '.env');
  const envExample = path.join(ROOT_DIR, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envPath);
    console.log(` ${c.green}✓${c.reset} Created .env from .env.example`);
  } else {
    console.log(` ${c.dim}-${c.reset} .env file ready`);
  }

  // Virtualenv setup
  const orchDir = path.join(ROOT_DIR, 'orchestrator');
  const venvPath = path.join(orchDir, 'venv');
  if (!fs.existsSync(venvPath)) {
    console.log(` ${c.cyan}...${c.reset} Creating Python virtualenv...`);
    try {
      await execAsync('python -m venv venv', { cwd: orchDir });
      console.log(` ${c.green}✓${c.reset} Python virtualenv created`);
    } catch (err) {
      console.log(` ${c.red}✗${c.reset} Failed to create virtualenv: ${err.message}`);
    }
  } else {
    console.log(` ${c.green}✓${c.reset} Python virtualenv already configured`);
  }

  // Build workspaces
  console.log(` ${c.cyan}...${c.reset} Building browser-client and obsidian-plugin...`);
  try {
    await execAsync('npm run build --workspace=browser-client', { cwd: ROOT_DIR });
    await execAsync('npm run build --workspace=obsidian-plugin', { cwd: ROOT_DIR });
    console.log(` ${c.green}✓${c.reset} Workspaces built successfully`);
  } catch (err) {
    console.log(` ${c.red}✗${c.reset} Build step error: ${err.message}`);
  }

  console.log(`\n${c.green}${c.bold}Setup complete! Run 'npm run jarvis start' to launch.${c.reset}\n`);
}

program
  .command('start')
  .description('Start all JARVIS processes (Redis, Orchestrator, Browser HUD)')
  .option('--no-redis', 'Skip auto-starting Redis container')
  .option('--demo', 'Launch in interactive demo simulation mode (no camera/Obsidian required)')
  .action(async (options) => {
    console.log(`${c.cyan}${c.bold}Starting JARVIS Services${options.demo ? ' [DEMO MODE]' : ''}...${c.reset}\n`);

    if (!options.demo) {
      const redisRunning = await checkPort(6379);
      if (!redisRunning && options.redis) {
        console.log(` ${c.yellow}!${c.reset} Redis not detected on 6379. Trying Docker...`);
        try {
          await execAsync('docker compose up -d redis', { cwd: ROOT_DIR });
          console.log(` ${c.green}✓${c.reset} Redis started via Docker Compose`);
        } catch {
          console.log(` ${c.dim}-${c.reset} Continuing with local services...`);
        }
      } else if (redisRunning) {
        console.log(` ${c.green}✓${c.reset} Redis ready on port 6379`);
      }

      const orchDir = path.join(ROOT_DIR, 'orchestrator');
      const uvicornCmd = process.platform === 'win32'
        ? path.join(orchDir, 'venv/Scripts/uvicorn.exe')
        : path.join(orchDir, 'venv/bin/uvicorn');

      console.log(` ${c.cyan}Starting Orchestrator on http://localhost:8000...${c.reset}`);
      spawn(uvicornCmd, ['main:app', '--host', '0.0.0.0', '--port', '8000'], {
        cwd: orchDir,
        stdio: 'inherit',
        shell: true,
      });
    }

    const browserUrl = options.demo ? 'http://localhost:5173/?demo=true' : 'http://localhost:5173';
    console.log(` ${c.cyan}Starting Browser HUD on ${browserUrl}...${c.reset}`);
    const browser = spawn('npm', ['run', 'dev', '--workspace=browser-client'], {
      cwd: ROOT_DIR,
      stdio: 'inherit',
      shell: true,
    });

  const onExit = () => {
    console.log(`\n${c.yellow}Shutting down JARVIS services...${c.reset}`);
    orch.kill();
    browser.kill();
    process.exit();
  };

  process.on('SIGINT', onExit);
  process.on('SIGTERM', onExit);
}

function runObsidianInstall(vaultPath) {
  if (!vaultPath) {
    console.log(`${c.red}Please provide your vault path:${c.reset} npm run jarvis obsidian-install <path-to-vault>`);
    return;
  }
  const resolved = path.resolve(vaultPath);
  const target = path.join(resolved, '.obsidian', 'plugins', 'jarvis');
  fs.mkdirSync(target, { recursive: true });

  const pluginDir = path.join(ROOT_DIR, 'obsidian-plugin');
  fs.copyFileSync(path.join(pluginDir, 'main.js'), path.join(target, 'main.js'));
  fs.copyFileSync(path.join(pluginDir, 'manifest.json'), path.join(target, 'manifest.json'));

  console.log(`${c.green}✓ Plugin files copied to ${target}${c.reset}`);
  console.log(`${c.dim}Open Obsidian → Settings → Community Plugins → Enable JARVIS.${c.reset}\n`);
}

function showHelp() {
  console.log(`Available commands:
  ${c.bold}doctor${c.reset}                    Inspect system prerequisites and ports
  ${c.bold}init${c.reset}                      Set up environments and compile packages
  ${c.bold}start${c.reset}                     Launch Redis, Orchestrator, and Browser HUD
  ${c.bold}obsidian-install <path>${c.reset}   Copy plugin to specified Obsidian vault
`);
}

async function main() {
  console.log(BANNER);
  const command = process.argv[2];

  switch (command) {
    case 'doctor':
      await runDoctor();
      break;
    case 'init':
      await runInit();
      break;
    case 'start':
      await runStart();
      break;
    case 'obsidian-install':
      runObsidianInstall(process.argv[3]);
      break;
    case '--help':
    case '-h':
    default:
      showHelp();
      break;
  }
}

main().catch((err) => {
  console.error(`${c.red}CLI execution error:${c.reset}`, err);
});
