// One Express app: the demo API under /api, the hostile MCP endpoints at the root (as the source served them), and the
// built web UI when web/dist exists. createApp() is what the tests use.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createMcpRouter, TOOLS } from './mcp/hostile.js';
import { assertBindAllowed, bindHost, payloadCorpus, scanPayloads } from './safety.js';
import { catalog } from './catalog.js';
import { createVisitorStates, mockOnly, mockOnlyGuard } from './mockonly.js';
import { createHealth } from './health.js';
import { createSessions } from './session.js';
import { runScenario } from './scenario.js';
import { CATCHES, LIMITS, reveal } from './pinning.js';
import { VICTIM_RULES } from './victim.js';

const WEB_DIST = process.env.WEB_DIST || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (res, message, status = 400) => res.status(status).json({ error: status === 404 ? 'not_found' : 'bad_request', message });

const MODES = ['ungoverned', 'pinned'];
const STAGES = ['first', 'later'];
const MAX_TASK = 300;

export function createApp({ env = process.env, health = createHealth({ env }), sessions = createSessions() } = {}) {
  const mock = mockOnly(env);
  const app = express();
  app.disable('x-powered-by');

  const api = express.Router();
  api.use(express.json({ limit: '8kb' }));
  api.use(mockOnlyGuard(mock));
  api.use('/health', health.router);
  api.get('/catalog', (_req, res) => res.json(catalog()));
  // The payload host scan, run on demand: every payload the server can put on the wire, checked for any non-reserved host.
  api.get('/safety-scan', (_req, res) => {
    const offenders = scanPayloads();
    res.json({ ok: offenders.length === 0, scanned: payloadCorpus().length, offenders });
  });
  api.get('/victim-rules', (_req, res) => res.json({ rules: VICTIM_RULES, pinningCatches: CATCHES, pinningLimits: LIMITS }));

  api.post('/run-victim', wrap(async (req, res) => {
    const { task, mode, stage = 'later' } = req.body || {};
    if (typeof task !== 'string' || !task.trim() || task.trim().length > MAX_TASK) return bad(res, `task must be a non-empty string of at most ${MAX_TASK} characters`);
    if (!MODES.includes(mode)) return bad(res, `mode must be one of ${MODES.join(', ')}`);
    if (!STAGES.includes(stage)) return bad(res, `stage must be one of ${STAGES.join(', ')}`);
    res.json(await runScenario({ task: task.trim(), mode, stage }));
  }));

  api.post('/mcp-session/new', wrap(async (req, res) => {
    const trusted = req.body?.trusted === undefined ? true : req.body.trusted;
    if (typeof trusted !== 'boolean') return bad(res, 'trusted must be a boolean');
    const session = await sessions.create({ trusted });
    res.status(201).json({ sessionId: session.id, trusted, pins: session.pinned.pins() });
  }));
  const withSession = (fn) => wrap(async (req, res) => {
    const session = sessions.get(req.params.id);
    if (!session) return bad(res, 'no such session (it may have expired)', 404);
    await fn(session, req, res);
  });
  api.post('/mcp-session/:id/list', withSession(async (session, _req, res) => {
    const list = await session.list();
    const approved = session.pinned.pins().some((p) => p.origin !== 'mcp://bank-demo.invalid');
    // Revealed descriptions, so an invisible character in the plain description view shows as a [U+XXXX] chip.
    const descriptionsRevealed = Object.fromEntries(list.tools.map((t) => [t.name, reveal(t.description ?? '')]));
    res.json({ listNumber: list.listNumber, tools: list.tools, descriptionsRevealed, check: approved ? session.check() : null });
  }));
  api.post('/mcp-session/:id/approve', withSession(async (session, _req, res) => {
    const result = session.approve();
    if (!result) return bad(res, 'list the tools first; there is nothing to approve', 409);
    res.json({ ...result, listNumber: session.lastList.listNumber, note: 'Approval records the list as it is. It does not read the content.' });
  }));
  api.delete('/mcp-session/:id', wrap(async (req, res) => {
    if (!(await sessions.delete(req.params.id))) return bad(res, 'no such session', 404);
    res.status(204).end();
  }));
  api.use((_req, res) => bad(res, 'no such endpoint', 404));
  api.use((err, _req, res, _next) => {
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'request body is too large' });
    if (err.type === 'entity.parse.failed') return bad(res, 'request body is not valid JSON');
    console.error('[hostile-mcp] api error:', err.message);
    return res.status(500).json({ error: 'server_error' });
  });
  app.use('/api', api);

  // Mock-only: refuse URL/credential carriers on the MCP endpoints too (their body is parsed inside the router).
  if (mock) app.use((req, res, next) => (req.headers.authorization ? res.status(403).json({ error: 'mock_only', message: 'Disabled in the hosted mock.' }) : next()));
  app.use(createMcpRouter(mock ? { stateFor: createVisitorStates() } : undefined));

  if (fs.existsSync(path.join(WEB_DIST, 'index.html'))) {
    app.use(express.static(WEB_DIST));
    app.get(/^\/(?!api\/|sse$|messages$|mcp$|health$).*/, (_req, res) => res.sendFile(path.join(WEB_DIST, 'index.html')));
  }
  return app;
}

// Boot on `port` (0 = ephemeral). Refuses a non-loopback host unless HOSTILE_BIND is set.
export function startHttpServer(port = Number(process.env.PORT) || 4701, host = bindHost(process.env), opts) {
  assertBindAllowed(host);
  return new Promise((resolve, reject) => {
    const httpServer = createApp(opts).listen(port, host);
    httpServer.once('error', reject);
    httpServer.once('listening', () => {
      const { port: bound } = httpServer.address();
      resolve({
        port: bound,
        url: `http://127.0.0.1:${bound}/`,
        sseUrl: `http://127.0.0.1:${bound}/sse`,
        close: () => new Promise((r) => { httpServer.closeAllConnections?.(); httpServer.close(r); }),
      });
    });
  });
}

export { TOOLS };
