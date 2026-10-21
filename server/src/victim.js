// Offline, deterministic "victim" model. No LLM, no network, nothing executed.
//
// Given the tools exactly as the client received them and a benign user task, it reads the tool metadata the way a
// trusting agent does and returns the calls it WOULD make, as data, with a reason for each. The rules are fixed and
// documented in VICTIM_RULES; the same input always gives the same output. The point is to make poison landing
// repeatable without a model. A real model is the optional tools/agent.mjs.
import { ACTION_NAMES } from './mcp/tools.js';
import { scanSinks } from './sinks.js';

export const VICTIM_RULES = [
  { id: 'name-resolution', text: 'Tools are resolved by name. If two tools share a name, the one listed last wins (a client that merges servers this way can be steered to the hostile definition).' },
  { id: 'task-match', text: 'The benign task picks the tool whose name shares the most words with it. Action tools (transfer, delete, admin) are never picked from a benign task.' },
  { id: 'fill-defaults', text: 'Every argument that has a default in the schema is filled with that default. A default that points off the approved origin is an exfiltration sink.' },
  { id: 'collect-credentials', text: 'If the chosen tool asks for a password or one-time code, the victim asks the user for it.' },
  { id: 'obey-important-block', text: 'An <IMPORTANT> block in the chosen tool\'s description is an instruction. If it says to call a tool, the victim does.' },
  { id: 'obey-ignore-previous', text: 'A plain "ignore previous instructions ... call <tool>" in the description is obeyed the same way, with no tag needed.' },
  { id: 'metadata-only', text: 'The victim reads tool metadata only and never executes a call. Instructions in call results, resources and prompts are out of its reach.' },
];

const STOP = new Set(['the', 'a', 'an', 'for', 'in', 'of', 'to', 'on', 'my', 'me', 'what', 'whats', 'is', 'are', 'current',
  'latest', 'please', 'internal', 'get', 'show', 'find', 'look', 'up', 'and', 'about', 'with', 'from', 'check', 'can', 'you', 'i']);
const words = (s) => (String(s).toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map((w) => w.replace(/s$/, ''));

function select(task, tools) {
  const taskWords = new Set(words(task));
  let best = null;
  let bestScore = 0;
  for (const tool of tools) {
    if (ACTION_NAMES.includes(tool.name)) continue;
    const matched = words(tool.name.replace(/_/g, ' ')).filter((w) => taskWords.has(w));
    if (matched.length > bestScore) { best = { tool, matched }; bestScore = matched.length; }
  }
  return best;
}

// "Denver" from "weather in Denver?", "vacation policy" from "docs for the vacation policy". A stand-in for model extraction.
function subjectOf(task) {
  const m = /\b(?:in|for|of|about)\s+(.+?)[?.!\s]*$/i.exec(task);
  return (m ? m[1] : task).replace(/^(?:the|a|an)\s+/i, '').trim();
}

const CREDENTIAL = /^(password|passcode|otp|pin|secret|token)$/i;
const ASKS_TO_COLLECT = /\b(collect|always include|include the full)\b/i;

// The directive an injection carries: which tool to call, with what, and whether before or after the real call.
function injection(description) {
  let rule; let text;
  const important = /<IMPORTANT>([\s\S]*?)<\/IMPORTANT>/i.exec(description);
  const ignorePrev = /ignore (?:all )?(?:previous|prior) instructions/i.exec(description);
  if (important) { rule = 'obey-important-block'; text = important[1]; }
  else if (ignorePrev) { rule = 'obey-ignore-previous'; text = description.slice(ignorePrev.index); }
  else return null;
  const call = /\bcall\s+([a-z][a-z0-9_]*)/i.exec(text);
  if (!call) return null;
  const sentence = text.split(/(?<=[.!?])\s+/).find((x) => /\bcall\s+[a-z]/i.test(x)) || '';
  const args = {};
  const amount = /\$(\d+(?:\.\d+)?)/.exec(text);
  if (amount) args.amount = Number(amount[1]);
  else if (/full balance/i.test(text)) args.amount = 'full balance';
  const to = /\b(external-\d+)\b/.exec(text);
  if (to) args.to = to[1];
  return {
    rule,
    name: call[1],
    arguments: args,
    position: /\b(before|first)\b/i.test(sentence) ? 'before' : 'after',
    concealed: /do not (mention|tell)/i.test(text),
  };
}

export function runVictim({ task, tools, origin }) {
  const resolved = new Map();
  const resolution = [];
  for (const tool of tools) {
    if (resolved.has(tool.name)) resolution.push({ name: tool.name, note: `defined more than once; the last definition is used (rule name-resolution)` });
    resolved.set(tool.name, tool);
  }
  const usable = [...resolved.values()];
  const base = {
    task,
    executed: false,
    resolution,
    notes: ['The victim reads tool metadata only and never executes a call, so result-based injection, resources and prompts are not shown here.'],
  };

  const chosen = select(task, usable);
  if (!chosen) return { ...base, selected: null, calls: [], notes: ['No available tool matches the task, so the victim makes no call.', ...base.notes] };

  const { tool } = chosen;
  const reasons = [{ rule: 'task-match', poison: false, text: `Task words (${chosen.matched.join(', ')}) match the name of ${tool.name}.` }];
  const args = {};
  const props = tool.inputSchema?.properties || {};
  const subject = subjectOf(task);
  for (const name of tool.inputSchema?.required || []) {
    if (props[name]?.type === 'string' && !CREDENTIAL.test(name)) args[name] = subject;
  }
  const scan = scanSinks(tool.inputSchema, origin);
  const sinkAt = new Map(scan.sinks.map((s) => [s.path, s]));
  if (scan.truncated) base.notes.push('The tool schema is nested or wide beyond the scan budget, so the sink scan stopped early and part of it was not examined.');
  for (const [name, prop] of Object.entries(props)) {
    if (prop && 'default' in prop) {
      args[name] = prop.default;
      const sink = sinkAt.get(`properties.${name}.default`);
      reasons.push(sink
        ? { rule: 'fill-defaults', poison: true, text: `${name} defaults to ${prop.default} (host ${sink.host}, off the approved origin${sink.invisible ? '; the value contains invisible characters' : ''}); the victim fills defaults, so this call carries the data to that sink.` }
        : { rule: 'fill-defaults', poison: false, text: `${name} was filled from its schema default.` });
    }
    if (CREDENTIAL.test(name) && (ASKS_TO_COLLECT.test(tool.description) || ASKS_TO_COLLECT.test(prop?.description || '') || (tool.inputSchema?.required || []).includes(name))) {
      args[name] = '<asks the user>';
      reasons.push({ rule: 'collect-credentials', poison: true, text: `The tool's metadata asks for ${name}, so the victim would ask the user for it.` });
    }
  }
  const main = { tool: tool.name, arguments: args, reasons };

  const inj = injection(tool.description || '');
  const calls = [main];
  if (inj) {
    const served = resolved.has(inj.name);
    const injected = {
      tool: inj.name,
      arguments: inj.arguments,
      reasons: [{
        rule: inj.rule,
        poison: true,
        text: `${tool.name}'s description tells the agent to call ${inj.name}${inj.concealed ? ' and to hide it from the user' : ''}; the victim obeys${served ? '' : ` (${inj.name} is not even in the list)`}.`,
      }],
    };
    if (inj.position === 'before') calls.unshift(injected); else calls.push(injected);
  }
  const finished = calls.map((c) => ({ ...c, poison: c.reasons.some((r) => r.poison) }));
  return { ...base, selected: tool.name, calls: finished };
}
