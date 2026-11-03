// Workspace id (rule 13): the visitor's own scope. This app has no shared writes to
// scope — sessions, MCP list counters and visitor states are already keyed per visitor
// (server-minted ids; see uivisitor.js and mockonly.js) — so the workspace IS the
// visitor identity, and 'default' is what an unauthenticated API caller gets.
// The middleware just makes the id explicit on every request and validates its shape.
export const DEFAULT_WORKSPACE = 'default';
const ID = /^[a-z0-9][a-z0-9-]{0,62}$/;

export const validWorkspaceId = (id) => typeof id === 'string' && ID.test(id);

/** Reads the workspace id for a request: the x-workspace header if well-formed, else 'default'. */
export function workspaceId(req) {
  const header = req.headers['x-workspace'];
  return validWorkspaceId(header) ? header : DEFAULT_WORKSPACE;
}

/** Express middleware: sets req.workspaceId, refuses a malformed id (400). */
export function workspaceMiddleware() {
  return (req, res, next) => {
    const header = req.headers['x-workspace'];
    if (header !== undefined && !validWorkspaceId(header)) return res.status(400).json({ error: 'bad_workspace' });
    req.workspaceId = workspaceId(req);
    next();
  };
}
