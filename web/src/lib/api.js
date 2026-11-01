async function request(path, init) {
  const r = await fetch(path, init);
  if (!r.ok) {
    let message = `HTTP ${r.status}`;
    try { message = (await r.json()).message || message; } catch { /* keep the status */ }
    throw new Error(message);
  }
  return r.status === 204 ? null : r.json();
}
const post = (path, body = {}) => request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const getCatalog = () => request("/api/catalog");
export const runVictim = (task, mode, stage) => post("/api/run-victim", { task, mode, stage });
export const newSession = () => post("/api/mcp-session/new", { trusted: true });
export const listTools = (id) => post(`/api/mcp-session/${id}/list`);
export const approve = (id) => post(`/api/mcp-session/${id}/approve`);
export const endSession = (id) => request(`/api/mcp-session/${id}`, { method: "DELETE" }).catch(() => {});
export const getHealth = () => request("/api/health");
export const getGatewayConfig = () => request("/api/gateway/config");
export const runGateway = (body) => post("/api/gateway/run", body);
