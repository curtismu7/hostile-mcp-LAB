# Pointing a real MCP client at it

The server speaks MCP over Streamable HTTP and SSE. Run it first (`npm start`, or `docker compose up --build -d`), then connect a **throwaway** client with no real tools or credentials: the client will read hostile text.

| Transport | URL |
| --- | --- |
| Streamable HTTP | `http://127.0.0.1:4701/` or `http://127.0.0.1:4701/mcp` |
| SSE | `http://127.0.0.1:4701/sse` (messages are posted to `/messages`) |

Remember that on these endpoints the first `tools/list` the process answers is clean and every later one is poisoned (see [architecture.md](architecture.md)). Restart to see a clean list again.

## mcp-inspector

```bash
npx @modelcontextprotocol/inspector
```

In the UI choose transport "Streamable HTTP" and URL `http://127.0.0.1:4701/mcp`, connect, and list the tools. Run it a second time to see `get_stock_price` change. Status: **not verified**. The repo's own test (`server/test/mcp-server.test.js`) drives the same endpoints with the official SDK client over both transports; the inspector itself was not run for this document. It downloads from the npm registry, which is outside this demo's no-outbound rule (that rule covers the server, not your tooling).

## Your own client

Any MCP SDK client works. `server/test/mcp-server.test.js` is a working example with `@modelcontextprotocol/sdk`. The optional `npm run agent -w server` is a small real-model agent that needs `LLM_URL` and has not been run against a live model from this repo.

## What a pinned client looks like

A real client has no pinning built in. `server/src/pinning.js` is a small library you can read and copy; the UI shows it against the real server through `/api/mcp-session/*`.

## The call path is a different defence

Pinning defends the **metadata path**: what the model is told a tool is. The [Privilege demo](../../privilege-demo) (sibling repo, no code dependency) defends the **call path**: a policy enforcement point decides allow, deny or hold for every tool call, and it pins tool schema hashes too. This repo's action tools (`create_transfer`, `delete_all_records`, `grant_admin`) are exactly the calls such a PEP would deny. The two controls fail differently: pinning cannot stop a poison approved on day one, and a call-path policy cannot stop the model from being talked into asking, only from being allowed. Use both. The link is a relative path on the author's machine layout (`Development/privilege-demo`); there is no import in either direction.
