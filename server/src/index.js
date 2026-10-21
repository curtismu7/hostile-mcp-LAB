import { fileURLToPath } from 'node:url';
import { startHttpServer, TOOLS } from './app.js';
import { allPassed, runChecks } from './doctor.js';

// Local runs read the repo-root .env (real env vars win).
try { process.loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url))); } catch { /* no .env */ }

const checks = runChecks();
if (!allPassed(checks)) {
  for (const c of checks.filter((x) => x.level === 'fail')) console.error(`[hostile-mcp] refusing to start: ${c.id}: ${c.detail}`);
  process.exit(1);
}
const { url } = await startHttpServer();
console.log(`[hostile-mcp] ${TOOLS.length} tools at ${url} (loopback unless HOSTILE_BIND is set)`);
console.log(`[hostile-mcp] MCP: POST ${url} | SSE: GET ${url}sse | API: ${url}api/health`);
