# Threat catalog

Generated from `server/src/catalog.js` by `node scripts/build-threat-catalog.mjs`. Do not edit by hand; the same data is served at `GET /api/catalog`.

"Scanner" means a metadata scanner that reads tool descriptions and schemas at ingest. This repo ships none; the answers follow the source demo. "Pinning" is the pinned client in `server/src/pinning.js`.

| Poison | Kind | Where it hides | Scanner | Pinning |
| --- | --- | --- | --- | --- |
| `description_injection` (`get_weather`) | tool | description | Yes | No |
| `schema_exfiltration` (`search_docs`) | tool | schema | Yes | Partly |
| `tool_shadowing` (`get_balance`) | tool | name | Yes | Yes |
| `action_exfil_sink` (`send_email`) | tool | schema | Yes | Partly |
| `credential_harvest` (`verify_identity`) | tool | schema | Yes | No |
| `imperative_injection` (`summarize_ticket`) | tool | description | Yes | No |
| `rug_pull` (`get_stock_price`) | tool | dynamic | Partly | Yes |
| `result_injection` (`read_ticket`) | tool | result | No | No |
| `resource_poisoning` (`mcp://hostile/account-verification`) | resource | resource | No | No |
| `prompt_poisoning` (`account_review`) | prompt | prompt | No | No |

## `description_injection`

Subject: tool `get_weather`. Hides in: description.

- What it does: An <IMPORTANT> block in a harmless-looking tool description tells the agent to move money and keep quiet.
- How it lands: The agent reads the description as trusted context and obeys it.
- Scanner (Yes): A scanner reading the description at ingest sees the block.
- Pinning (No): Approved on first sight, the hash only proves it has not changed since.

## `schema_exfiltration`

Subject: tool `search_docs`. Hides in: schema.

- What it does: The inputSchema carries a callback_url whose default is an off-box address, with a note to include the full context.
- How it lands: An agent that auto-fills arguments from the schema leaks on every call.
- Scanner (Yes): The off-box default is visible in the schema.
- Pinning (Partly): Not caught if it was there at approval. Flagged as off-origin-sink if it is added later.

## `tool_shadowing`

Subject: tool `get_balance`. Hides in: name.

- What it does: Reuses the name of a trusted tool, claims to be the authoritative one, and smuggles a transfer.
- How it lands: An agent that resolves tools by name picks the hostile definition.
- Scanner (Yes): The primacy claim and the instruction are in the description.
- Pinning (Yes): Caught as shadowed when the name is already approved from another server.

## `action_exfil_sink`

Subject: tool `send_email`. Hides in: schema.

- What it does: send_email hides an off-box bcc default with an instruction to include credentials and tokens.
- How it lands: The leak rides along on every send.
- Scanner (Yes): The off-box default and the instruction are in the schema.
- Pinning (Partly): Not caught if it was there at approval. Flagged as off-origin-sink if it is added later.

## `credential_harvest`

Subject: tool `verify_identity`. Hides in: schema.

- What it does: verify_identity asks for the password and one-time code as ordinary parameters.
- How it lands: The agent asks the user for secrets and passes them to the server.
- Scanner (Yes): Credential-named parameters and the instruction are visible.
- Pinning (No): Nothing changed after approval, so nothing is flagged.

## `imperative_injection`

Subject: tool `summarize_ticket`. Hides in: description.

- What it does: A plain "ignore all previous instructions" sentence, with no tag, tells the agent to transfer money.
- How it lands: Same as the tagged form: the agent obeys text in the description.
- Scanner (Yes): Pattern and intent are visible in the description.
- Pinning (No): Approved on first sight.

## `rug_pull`

Subject: tool `get_stock_price`. Hides in: dynamic.

- What it does: get_stock_price is clean on the first tools/list of a session and poisoned on later ones.
- How it lands: The client approved the clean version; the next list swaps the description.
- Scanner (Partly): A scanner that runs once at ingest only sees the clean list. One that rescans every list catches it.
- Pinning (Yes): Caught as changed, with the field diff.

## `result_injection`

Subject: tool `read_ticket`. Hides in: result.

- What it does: read_ticket has clean metadata; the injection is in the text a call returns.
- How it lands: It reaches the model only when the result is read back.
- Scanner (No): There is nothing in the metadata to scan.
- Pinning (No): Only metadata is hashed.

## `resource_poisoning`

Subject: resource `mcp://hostile/account-verification`. Hides in: resource.

- What it does: A resource whose text tells the agent to bypass approval and call create_transfer.
- How it lands: The agent reads the resource as reference material.
- Scanner (No): A tool-metadata scanner does not read resources.
- Pinning (No): Resources are not pinned.

## `prompt_poisoning`

Subject: prompt `account_review`. Hides in: prompt.

- What it does: A prompt whose message tells the agent to bypass approval and call create_transfer.
- How it lands: The prompt arrives as the user turn.
- Scanner (No): A tool-metadata scanner does not read prompts.
- Pinning (No): Prompts are not pinned.

## What pinning catches

- A tool whose name, description or inputSchema changed after approval (the field diff is shown).
- A tool that reuses a name already approved from a different origin.
- A new or changed tool that carries a URL or email default pointing away from the approved origin.
- A tool that was never approved.

## What pinning does not catch

- A poisoned tool approved on first sight stays approved. Pinning records what was accepted; it does not judge it. A scanner or a human must vet the first list.
- An off-origin sink already present at approval is recorded, not blocked.
- Only tool metadata is hashed. Instructions inside a tool call result are never seen.
- Resources and prompts are not tools and are not pinned.
- The sink scan reads at most 100 levels and 20000 nodes of a schema. A tool that exceeds either is flagged scanTruncated and whatever lies beyond the budget was not examined (it is still hashed in full, so any change is still caught).
- If a person approves a changed tool again, the new definition becomes the pin.
- Sink detection reads only schema values (default, const, enum, examples and URLs inside pattern). A URL or email written in a free-text description, a title, or inside a non-string default (an object or array) is not found as a sink.
- A hostile instruction or a sink on the approved origin's own host is not flagged as a sink.
