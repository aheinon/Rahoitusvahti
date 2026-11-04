// Rahoitusvahti idea search - Cloudflare Worker
//
// Keeps the Claude API key off the browser. For every request it:
// 1. checks the caller's Firebase ID token by reading allowlist/{email} from Firestore WITH that token
//    (Firestore verifies the token and the security rules only allow allowlisted users),
// 2. applies an optional daily per-user limit (KV binding USAGE),
// 3. reads the team description from settings/profile (also with the user's token),
//    builds the prompt from the idea + the call list and asks Claude,
// 4. returns {matches, strengthen, note} with only ids that were in the list.
// With {mode: "develop"} it instead analyses one linked project idea against one call, using the
// call's full text that the collector stores in texts/{callId}, and returns {fit, verdict, gaps, ...}.
// With {mode: "describe"} it writes a short description of one partner organisation with web search
// (and reads the website the team gave, if any) and returns the orgInfo fields; the app saves them.

import { buildDescribePrompt, cleanDescription, DESCRIBE_LIMITS } from "../../web/describe-prompt.js";
import { buildDevelopPrompt, buildIdeaPrompt, cleanDevelop, cleanMatches, DEFAULT_PROFILE, DEVELOP_LIMITS, IDEA_LIMITS } from "../../web/idea-prompt.js";

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
    const docs = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
    const fs = await fetch(`${docs}/allowlist/${encodeURIComponent(email)}`, { headers: { Authorization: `Bearer ${token}` } });
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

    let org = "";
    try {
      const pr = await fetch(`${docs}/settings/profile`, { headers: { Authorization: `Bearer ${token}` } });
      if (pr.ok) org = (await pr.json()).fields?.organisation?.stringValue || "";
    } catch { /* fall back below */ }
    org = org || env.ORG_PROFILE || DEFAULT_PROFILE.organisation;
    const today = new Date().toISOString().slice(0, 10);

    if (body.mode === "describe") {
      const str = (x, n) => String(x || "").trim().slice(0, n);
      const name = str(body.name, DESCRIBE_LIMITS.name);
      if (!name) return reply({ error: "No organisation name." }, 400);
      const website = /^https?:\/\/[^\s]+$/i.test(str(body.website, DESCRIBE_LIMITS.website)) ? str(body.website, DESCRIBE_LIMITS.website) : "";
      const input = { name, website, hint: str(body.hint, DESCRIBE_LIMITS.hint), country: str(body.country, 2), type: str(body.type, 3),
        alt: (Array.isArray(body.alt) ? body.alt : []).slice(0, DESCRIBE_LIMITS.alt).map((x) => str(x, DESCRIBE_LIMITS.name)).filter(Boolean),
        projects: (Array.isArray(body.projects) ? body.projects : []).slice(0, DESCRIBE_LIMITS.projects).map((x) => str(x, DESCRIBE_LIMITS.project)).filter(Boolean) };
      const res = await askClaudeWithWeb(env, buildDescribePrompt(input), !!website);
      if (res.error) return reply({ error: res.error }, 502);
      console.log("describe", email, name, res.usage?.input_tokens, "in", res.usage?.server_tool_use?.web_search_requests, "searches");
      return reply({ ...cleanDescription(res.json, res.sources, env.MODEL || "claude-haiku-5-5"), usage: res.usage });
    }

    if (body.mode === "develop") {
      const ideaName = String(body.ideaName || "").trim().slice(0, IDEA_LIMITS.name);
      const idea = String(body.idea || "").trim().slice(0, IDEA_LIMITS.idea);
      const call = String(body.call || "").slice(0, 1500);
      const callId = String(body.callId || "");
      if (!ideaName || !call || !callId) return reply({ error: "Link the call to a project idea first." }, 400);
      let callText = "";
      try {
        const tr = await fetch(`${docs}/texts/${encodeURIComponent(callId.replace(/\//g, "\u2215"))}`, { headers: { Authorization: `Bearer ${token}` } });
        if (tr.ok) callText = (await tr.json()).fields?.text?.stringValue || "";
      } catch { /* summary only */ }
      const prompt = buildDevelopPrompt({ org, ideaName, idea, call, callText: callText.slice(0, DEVELOP_LIMITS.text), today });
      const res = await askClaude(env, prompt, 6000);
      if (res.error) return reply({ error: res.error }, 502);
      console.log("develop", email, callId, res.usage?.input_tokens, "in", res.usage?.output_tokens, "out");
      return reply({ ...cleanDevelop(res.json), hadCallText: !!callText, usage: res.usage });
    }

    const idea = String(body.idea || "").trim().slice(0, IDEA_LIMITS.idea);
    const ideaName = String(body.ideaName || "").trim().slice(0, IDEA_LIMITS.name);
    const lines = (Array.isArray(body.lines) ? body.lines : []).slice(0, IDEA_LIMITS.lines).map((l) => String(l).slice(0, IDEA_LIMITS.line));
    if (idea.length < 15) return reply({ error: "Describe the idea in at least a sentence." }, 400);
    if (!lines.length) return reply({ error: "No calls to compare against." }, 400);
    const knownIds = new Set(lines.map((l) => l.split(" | ")[0]));

    const prompt = buildIdeaPrompt({ idea, ideaName, lines, org, today });
    const res = await askClaude(env, prompt, 8000);
    if (res.error) return reply({ error: res.error }, 502);
    const out = cleanMatches(res.json, knownIds);
    console.log("idea search", email, lines.length, "calls", res.usage?.input_tokens, "in", res.usage?.output_tokens, "out");
    return reply({ ...out, usage: res.usage });
  },
};

/** Asks Claude and parses the JSON object in its answer. Thinking tokens count toward max_tokens. */
async function askClaude(env, prompt, maxTokens) {
  const ar = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: maxTokens, output_config: { effort: "medium" }, messages: [{ role: "user", content: prompt }] }),
  });
  if (!ar.ok) {
    const detail = await ar.text();
    console.log("Claude API error", ar.status, detail.slice(0, 500));
    return { error: ar.status === 429 ? "Claude is busy right now. Try again in a minute." : "Claude could not answer. Try again." };
  }
  const data = await ar.json();
  const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
  let json = {};
  try { json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* empty result */ }
  return { json, usage: data.usage || null };
}

/** Asks Claude with the web search tool (and web fetch when a website is given). Falls back to the
 * older tool versions if the account or model does not accept the newer ones. */
async function askClaudeWithWeb(env, prompt, fetchSite) {
  const versions = [
    { search: "web_search_20260209", fetch: "web_fetch_20260209", beta: null },
    { search: "web_search_20250305", fetch: "web_fetch_20250910", beta: "web-fetch-2025-09-10" },
  ];
  for (const [i, v] of versions.entries()) {
    const tools = [{ type: v.search, name: "web_search", max_uses: DESCRIBE_LIMITS.searches }];
    if (fetchSite) tools.push({ type: v.fetch, name: "web_fetch", max_uses: 2, max_content_tokens: 12000 });
    const headers = { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    if (v.beta && fetchSite) headers["anthropic-beta"] = v.beta;
    const ar = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers,
      body: JSON.stringify({ model: env.MODEL || "claude-haiku-5-5", max_tokens: 2000, tools, messages: [{ role: "user", content: prompt }] }),
    });
    if (!ar.ok) {
      const detail = await ar.text();
      if (ar.status === 400 && i === 0 && /web_(search|fetch)/.test(detail)) continue;     // try the older tool versions
      console.log("Claude API error", ar.status, detail.slice(0, 500));
      return { error: ar.status === 429 ? "Claude is busy right now. Try again in a minute."
        : /web search|web_search/i.test(detail) ? "Web search is not enabled for the Claude account." : "Claude could not answer. Try again." };
    }
    const data = await ar.json();
    const blocks = data.content || [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
    const sources = [];
    for (const b of blocks) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) for (const r of b.content) if (r.url) sources.push(r.url);
      if (b.type === "web_fetch_tool_result" && b.content?.url) sources.unshift(b.content.url);
    }
    let json = {};
    try { json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { /* empty */ }
    return { json, sources, usage: data.usage || null };
  }
  return { error: "Claude could not answer. Try again." };
}

function emailFromToken(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload.email_verified && payload.email ? String(payload.email).toLowerCase() : null;
  } catch {
    return null;
  }
}
