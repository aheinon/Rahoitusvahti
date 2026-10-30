// Run: node test.mjs  - exercises the worker with mocked Firestore and Claude API.
import worker from "./src/index.js";
import assert from "node:assert/strict";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const token = (email, verified = true) => `x.${b64({ email, email_verified: verified })}.sig`;
const env = { FIREBASE_PROJECT_ID: "p", ALLOWED_ORIGINS: "https://aheinon.github.io", ANTHROPIC_API_KEY: "k", MODEL: "claude-haiku-5-5" };
let sentPrompt = "";
globalThis.fetch = async (url, opts) => {
  if (url.includes("firestore")) {
    const ok = url.endsWith("allowlist/aleksi%40turkuamk.fi") && opts.headers.Authorization.includes("x.");
    return new Response(ok ? JSON.stringify({ fields: { role: { stringValue: "member" } } }) : "{}", { status: ok ? 200 : 403 });
  }
  sentPrompt = JSON.parse(opts.body).messages[0].content;
  return new Response(JSON.stringify({
    content: [{ type: "text", text: 'Here: {"matches":[{"id":"eu:A","fit":91,"why":"PV","angle":"pilot"},{"id":"eu:FAKE","fit":99,"why":"x"}],"note":"ok"}' }],
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

r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("stranger@x.com")), env); assert.equal(r.status, 403);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi", false)), env); assert.equal(r.status, 401);
r = await worker.fetch(req({ idea: "short", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 400);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi"), "https://evil.example"), env); assert.equal(r.status, 403);
r = await worker.fetch(new Request("https://w.example/", { method: "OPTIONS", headers: { Origin: "https://aheinon.github.io" } }), env);
assert.equal(r.status, 204); assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://aheinon.github.io");

// daily limit with an in-memory KV
const kv = new Map(); env.USAGE = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) }; env.DAILY_LIMIT = "1";
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 200);
r = await worker.fetch(req({ idea: "Pilot of shared rooftop PV and storage", lines }, token("aleksi@turkuamk.fi")), env); assert.equal(r.status, 429);
console.log("worker tests passed");
