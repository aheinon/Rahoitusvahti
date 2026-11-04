// Run: node test.mjs  - exercises the worker with mocked Firestore and Claude API.
import worker from "./src/index.js";
import assert from "node:assert/strict";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (email, verified = true) => `x.${b64({ email, email_verified: verified })}.sig`;
const env = { FIREBASE_PROJECT_ID: "p", ALLOWED_ORIGINS: "https://aheinon.github.io", ANTHROPIC_API_KEY: "k", MODEL: "claude-haiku-5-5" };
let sentPrompt = "";
let claudeReply = 'Here: {"matches":[{"id":"eu:A","fit":91,"why":"PV","angle":"pilot"},{"id":"eu:FAKE","fit":99,"why":"x"}],"strengthen":["Name a pilot site", 5],"note":"ok"}';
let textUrl = "", sentTools = [], sentHeaders = {}, rejectNewTools = false;
globalThis.fetch = async (url, opts) => {
  if (url.endsWith("/settings/profile")) {
    return new Response(JSON.stringify({ fields: { organisation: { stringValue: "PROFILE FROM FIRESTORE: NERC energy team" } } }), { status: 200 });
  }
  if (url.includes("/texts/")) {
    textUrl = url;
    return new Response(JSON.stringify({ fields: { text: { stringValue: "EXPECTED OUTCOME: demonstrate battery durability at TRL 6-7" } } }), { status: 200 });
  }
  if (url.includes("firestore")) {
    const ok = url.endsWith("allowlist/aleksi%40turkuamk.fi") && opts.headers.Authorization.includes("x.");
    return new Response(ok ? JSON.stringify({ fields: { role: { stringValue: "member" } } }) : "{}", { status: ok ? 200 : 403 });
  }
  const sent = JSON.parse(opts.body);
  sentPrompt = sent.messages[0].content; sentTools = sent.tools || []; sentHeaders = opts.headers;
  if (sentTools.some((t) => t.type === "web_search_20260209") && rejectNewTools) return new Response('{"error":{"message":"tools.0: unknown web_search_20260209"}}', { status: 400 });
  if (sentTools.length) return new Response(JSON.stringify({ content: [
    { type: "server_tool_use", name: "web_search" },
    { type: "web_search_tool_result", content: [{ url: "https://www.hu.nl" }, { url: "https://en.wikipedia.org/wiki/HU" }] },
    { type: "text", text: claudeReply }], usage: { input_tokens: 9000, output_tokens: 200, server_tool_use: { web_search_requests: 2 } } }), { status: 200 });
  return new Response(JSON.stringify({
    content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: claudeReply }],
    usage: { input_tokens: 1000, output_tokens: 80 },
  }), { status: 200 });
};
const req = (body, t, origin = "https://aheinon.github.io") => new Request("https://w.example/", {
  method: "POST", headers: { Origin: origin, Authorization: `Bearer ${t}`, "content-type": "application/json" }, body: JSON.stringify(body) });
const lines = ["eu:A | EC / Horizon Europe | Solar PV production | opens 2026-12-03 | deadline 2027-03-31", "bf:B | Business Finland | Co-Innovation | opens - | deadline continuous"];

let r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage in a housing company", lines }, token("Aleksi@turkuamk.fi")), env);
let j = await r.json();
assert.equal(r.status, 200); assert.deepEqual(j.matches.map((m) => m.id), ["eu:A"]); assert.equal(j.note, "ok");
assert.ok(sentPrompt.includes("Solar PV production") && sentPrompt.includes("housing company"));
assert.ok(sentPrompt.includes("PROFILE FROM FIRESTORE"));
assert.deepEqual(j.strengthen, ["Name a pilot site"]);

// develop a linked idea for one call: reads the call text from texts/{id}
claudeReply = '{"fit": 140, "verdict": "Good fit.", "gaps": ["No TRL 6 pilot yet"], "consortium": [], "risks": ["Deadline is close"], "next_steps": ["Find an OEM partner"], "matches": "x"}';
r = await worker.fetch(req({ mode: "develop", callId: "eu:HORIZON-CL5-2027-03-D5-18", ideaName: "Battery life", idea: "Battery ageing models", call: "eu:HORIZON | Enhanced electric operation" }, token("aleksi@turkuamk.fi")), env);
j = await r.json();
assert.equal(r.status, 200); assert.equal(j.fit, 100); assert.deepEqual(j.gaps, ["No TRL 6 pilot yet"]); assert.deepEqual(j.matches, []); assert.ok(j.hadCallText);
assert.ok(textUrl.endsWith("/texts/eu%3AHORIZON-CL5-2027-03-D5-18"));
assert.ok(sentPrompt.includes("TRL 6-7") && sentPrompt.includes("Battery ageing models") && sentPrompt.includes("PROFILE FROM FIRESTORE"));
r = await worker.fetch(req({ mode: "develop", callId: "eu:x", ideaName: "", call: "c" }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 400);
claudeReply = 'Here: {"matches":[{"id":"eu:A","fit":91,"why":"PV","angle":"pilot"}],"note":"ok"}';

r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("stranger@x.com")), env); assert.equal(r.status, 403);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi", false)), env); assert.equal(r.status, 401);
r = await worker.fetch(req({ idea: "short", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 400);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi"), "https://evil.example"), env); assert.equal(r.status, 403);
r = await worker.fetch(new Request("https://w.example/", { method: "OPTIONS", headers: { Origin: "https://aheinon.github.io" } }), env);
assert.equal(r.status, 204); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://aheinon.github.io");

// describe one organisation with web search (+ web fetch when a website is given)
claudeReply = 'Result: {"found": true, "official_name": "HU University of Applied Sciences Utrecht", "website": "https://www.hu.nl", "description": "A Dutch university of applied sciences in Utrecht.", "city": "Utrecht", "country": "nl", "lat": 52.08, "lon": 5.17, "type": "HES"}';
r = await worker.fetch(req({ mode: "describe", name: "Stichting Hogeschool Utrecht", hint: "the UAS, not the university", website: "https://www.hu.nl/", projects: ["CoVE (Erasmus+, 2024)"] }, token("aleksi@turkuamk.fi")), env);
j = await r.json();
assert.equal(r.status, 200); assert.equal(j.country, "NL"); assert.equal(j.notFound, false); assert.equal(j.sources[0], "https://www.hu.nl");
assert.deepEqual(sentTools.map((t) => t.type), ["web_search_20260209", "web_fetch_20260209"]);
assert.ok(sentPrompt.includes("the UAS, not the university") && sentPrompt.includes("https://www.hu.nl/"));
rejectNewTools = true;
r = await worker.fetch(req({ mode: "describe", name: "Stichting Hogeschool Utrecht", website: "https://www.hu.nl/" }, token("aleksi@turkuamk.fi")), env);
assert.equal(r.status, 200); assert.equal(sentTools[0].type, "web_search_20250305"); assert.equal(sentHeaders["anthropic-beta"], "web-fetch-2025-09-10");
rejectNewTools = false;
claudeReply = '{"found": true, "description": "Its activities could not be confirmed because the search tool reached its usage limit."}';
r = await worker.fetch(req({ mode: "describe", name: "X Ltd" }, token("aleksi@turkuamk.fi")), env);
j = await r.json(); assert.equal(j.notFound, true); assert.equal(sentTools.length, 1);
r = await worker.fetch(req({ mode: "describe", name: "" }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 400);
claudeReply = 'Here: {"matches":[{"id":"eu:A","fit":91,"why":"PV","angle":"pilot"}],"note":"ok"}';

// daily limit with an in-memory KV
const kv = new Map(); env.USAGE = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) }; env.DAILY_LIMIT = "1";
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 200);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 429);
console.log("worker tests passed");
