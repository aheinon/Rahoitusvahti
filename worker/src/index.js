// Rahoitusvahti idea search - Cloudflare Worker
//
// Keeps the Claude API key off the browser. For every request it:
// 1. checks the caller's Firebase ID token by reading allowlist/{email} from Firestore WITH that token
//    (Firestore verifies the token and the security rules only allow allowlisted users),
// 2. applies an optional daily per-user limit (KV binding USAGE),
// 3. builds the prompt from the idea + the call list and asks Claude,
// 4. returns {matches, note} with only ids that were in the list.

import { buildIdeaPrompt, cleanMatches, DEFAULT_ORG, IDEA_LIMITS } from "../../web/idea-prompt.js";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0] || "*",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const reply = (body, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return reply({ error: "Use POST." }, 405);
    if (allowed.length && !allowed.includes(origin)) return reply({ error: "This site is not allowed to use the idea search." }, 403);

    // 1) who is asking
    const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const email = emailFromToken(token);
    if (!email) return reply({ error: "Sign in again and retry." }, 401);
    const fs = await fetch(
      `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents/allowlist/${encodeURIComponent(email)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (fs.status === 401) return reply({ error: "Your sign-in has expired. Reload the page." }, 401);
    if (!fs.ok) return reply({ error: "Your address is not on the user list." }, 403);

    // 2) optional daily limit
    if (env.USAGE) {
      const day = new Date().toISOString().slice(0, 10);
      const key = `${email}:${day}`;
      const used = Number((await env.USAGE.get(key)) || 0);
      const limit = Number(env.DAILY_LIMIT || 40);
      if (used >= limit) return reply({ error: `Daily limit of ${limit} idea searches reached. Try again tomorrow.` }, 429);
      await env.USAGE.put(key, String(used + 1), { expirationTtl: 2 * 86400 });
    }

    // 3) input
    let body;
    try { body = await request.json(); } catch { return reply({ error: "Request body is not JSON." }, 400); }
    const idea = String(body.idea || "").trim().slice(0, IDEA_LIMITS.idea);
    const ideaName = String(body.ideaName || "").trim().slice(0, IDEA_LIMITS.name);
    const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, IDEA_LIMITS.lines).map((l) => String(l).slice(0, IDEA_LIMITS.line));
    if (idea.length < 15) return reply({ error: "Describe the idea in at least a sentence." }, 400);
    if (!lines.length) return reply({ error: "No calls to compare against." }, 400);
    const knownIds = new Set(lines.map((l) => l.split(" | ")[0]));

    const prompt = buildIdeaPrompt({ idea, ideaName, lines, org: env.ORG_PROFILE || DEFAULT_ORG, today: new Date().toISOString().slice(0, 10) });
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 1800, messages: [{ role: "user", content: prompt }] }),
    });
    if (!ar.ok) {
      const detail = await ar.text();
      console.log("Claude API error", ar.status, detail.slice(0, 500));
      return reply({ error: ar.status === 429 ? "Claude is busy right now. Try again in a minute." : "Claude could not answer. Try again." }, 502);
    }
    const data = await ar.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed = {};
    try { parsed = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* handled below */ }
    const out = cleanMatches(parsed, knownIds);
    console.log("idea search", email, lines.length, "calls", data.usage?.input_tokens, "in", data.usage?.output_tokens, "out");
    return reply({ ...out, usage: data.usage || null });
  },
};

function emailFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email_verified && payload.email ? String(payload.email).toLowerCase() : null;
  } catch {
    return null;
  }
}
