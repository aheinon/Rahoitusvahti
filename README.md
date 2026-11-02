# Rahoitusvahti

A funding call tracker for NERC (Turku UAS). It collects open and upcoming research and innovation
calls from ten sources every night. The team can favourite calls, link them to project ideas,
comment, tag, list the people involved and potential partners, and ask Claude which calls fit a new
idea. Only addresses on the allowlist can sign in.

```
GitHub Actions (nightly)                 GitHub Pages (web/)
  collector/main.py                        index.html + app.js
   ├─ EU Funding & Tenders (API)             │  sign-in with an email link
   ├─ Business Finland (HTML)                │  (Firebase Auth, no passwords)
   ├─ Research Council of Finland (HTML)     ▼
   ├─ EURA 2021: ERDF/ESF+/JTF (JSON)     Firestore
   ├─ Interreg (interreg.eu, Playwright)    index/calls-*   ← written by the collector
   ├─ CETPartnership (HTML)
   ├─ EDUFI / Erasmus+ (oph.fi, HTML)
   ├─ Haeavustuksia.fi: ministries, Jotpa, elinvoimakeskus (JSON)
   ├─ Maaseutu.fi: CAP + Leader selection periods (HTML)
   ├─ Foundations (pages read by Claude)
   └─ scoring: keywords + Claude            notes, comments, partners, users  ← written by the team
        └──────── writes ───────────────▶   allowlist  ← who may sign in
                                              ▲
  Cloudflare Worker (idea search) ────────────┘ checks the user's sign-in, then asks Claude
```

## Features

- **Calls**: deadline timeline (6, 12 or 18 months ahead), search, filters (funder, status, deadline
  window up to 18 months, relevance, favourites, "calls I am involved in", "new this week", project idea,
  tag), sort by deadline, Claude's relevance, team rating or newest.
- **New this week**: calls that appeared in the last 7 days carry a *New* tag. Clicking it (or
  *N new this week* above the list) shows just those calls.
- **Is this relevant for us?** Everyone can answer 👍 / 🤷 / 👎 with an optional reason in the call
  details. The answers show on the list, sort the list (*Team rating*), are given to Claude as examples
  on the next nightly run (`ai.team_examples`), and the Profile tab shows how often Claude's score agrees
  with the team and where they disagree most. Pipeline stages count as answers too (Preparing,
  Submitted, Funded = relevant; Not applying = not relevant). Horizon Europe topics are listed as soon as the work programme puts
  them in the portal as *forthcoming*, so calls closing over a year from now are included.
- **Summaries**: Claude writes a 2-3 sentence English summary of each call (what it funds, who can take
  part, size of funding) from the call text. Shown in the call details and, with *Show summaries*, in the list.
- **Find calls for an idea**: describe a topic or project idea in a few sentences; Claude compares it
  with every open and upcoming call and suggests up to 8, each with a fit score, why it fits and how
  to frame the idea for that call. Suggested calls can be linked to the idea with one click.
- **Idea search also suggests how to strengthen the idea**: 3-5 concrete points based on what the
  matched calls expect.
- **Develop an idea for a call**: when a call is linked to a project idea, Claude reads the call's full
  text (saved by the collector to `texts/{id}`) and the idea description, and gives a fit score, what
  already fits, gaps, partners and roles needed, risks and next steps. The result can be posted to the
  call's comments.
- **Ideas** (team only): an idea bank of project ideas (raw → developing → ready to apply) and the pieces
  they could be built from: pilot sites, needs or challenges, resources such as equipment or data,
  expertise and partners. Any idea or piece can be sent to the idea search with *Find calls*.
- **Call details**: opening date and deadlines, identifier, type of action, region, Claude's relevance
  assessment and reason, link to the funder's page.
- **Team notes** (shared by everyone): project idea, stage (Watching → Preparing → Submitted →
  Funded/Rejected), people involved in preparation, potential partners, tags, comments with @mentions.
- **Favourites** are personal. Their deadlines can be downloaded to a calendar (.ics, reminder a week before).
- **Pipeline**: calls by stage, with the project idea shown on each card.
- **Partners**: a shared list and which calls each partner is linked to.
- **Profile**: the team description Claude uses for scoring and idea search, plus weighted keywords.
  Everyone can see it; admins edit it in the app. A changed description makes Claude re-assess all calls
  on the next nightly run (about $0.25).
- **Calls we can't apply to** are hidden by default and shown with one click: regional ERDF/ESF+/JTF
  calls from other regions (national calls always show; the home region is set on the Profile tab),
  Interreg calls where Finland is not eligible, calls Claude marked not eligible, and calls the team
  marked *Not applying*. Idea search still considers all of them.
- **Funder filter** grouped into *EU and international* (Horizon Europe, Erasmus+, LIFE, Digital Europe,
  other EU programmes, Interreg, CETPartnership) and *Finland* (Business Finland, Research Council of
  Finland, EURA, Jotpa, ministries and agencies, EDUFI grants, rural development, foundations).
- **Users** (admin): the allowlist and roles. External partners can be invited with the *Partner* role:
  they see the calls and can comment, but cannot change team notes.
- **Add a call**: for foundations, ministries and other funders the collector does not follow.

Demo: serve `web/` locally (`python -m http.server` in that folder). Without Firebase settings the app
starts in demo mode automatically; `?demo` forces it.

---

## Setup (about 45-60 minutes)

### 1. Firebase project
1. https://console.firebase.google.com → **Add project** (e.g. `rahoitusvahti`). Analytics is not needed.
2. **Build → Firestore Database → Create database**, location `eur3` or `europe-north1`, *production mode*.
3. **Firestore → Rules**: paste the contents of `firestore.rules` and **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Email/Password**: enable
   **Email link (passwordless sign-in)**.
5. **Authentication → Settings → Authorized domains**: add `<github-user>.github.io`.
6. **Project settings → General → Your apps → Web (</>)**: register an app and copy `firebaseConfig`
   into `web/config.js` (the `firebase` field). These values are not secrets; access is enforced by the rules.

### 2. First administrator
In Firestore: **Start collection** `allowlist` → Document ID = your email in lower case → fields
`name` (string), `role` = `admin` (string), `org` (string). Add everyone else from the app's *Users* tab.

### 3. Service account for the collector
**Project settings → Service accounts → Generate new private key**. Keep the JSON file safe and out of the repo.

### 4. GitHub
1. Create a repository (e.g. `rahoitusvahti`) and add the contents of this folder.
2. **Settings → Secrets and variables → Actions → New repository secret**:
   - `FIREBASE_SERVICE_ACCOUNT` = the whole contents of the service account JSON file
   - `ANTHROPIC_API_KEY` = (optional) Claude API key for relevance scoring
3. **Settings → Pages → Deploy from a branch**, branch `main`, folder `/ (root)`. The app is then at
   `https://<user>.github.io/rahoitusvahti/web/` (or move the contents of `web/` to the repo root).
4. **Actions → Collect funding calls → Run workflow** for the first run. After that it runs every night,
   and the log shows how many calls came from each source.

GitHub Pages publishes the page code publicly (on a free account the repo is public). That is fine:
the calls, notes and comments live in Firestore, which only signed-in, allowlisted users can read.

### 5. Idea search (Cloudflare Worker, free tier)
The browser must never hold the Claude API key, so idea search goes through a small worker in `worker/`.
For each request it reads `allowlist/{email}` from Firestore **with the user's own sign-in token**; Firestore
checks the token and the security rules, so only allowlisted users get answers. It can also enforce a
daily limit per user.

```bash
cd worker
npm install -g wrangler        # or use npx wrangler ...
wrangler login
# edit wrangler.toml: FIREBASE_PROJECT_ID and ALLOWED_ORIGINS (e.g. https://aheinon.github.io)
wrangler secret put ANTHROPIC_API_KEY
# optional daily limit: wrangler kv namespace create USAGE, then paste the id into wrangler.toml
wrangler deploy
node test.mjs                  # local tests with mocked Firestore and Claude (no network needed)
```
Copy the worker address (`https://rahoitusvahti-ideas.<account>.workers.dev`) to `ideaSearchUrl` in
`web/config.js`. With an empty `ideaSearchUrl` the idea search panel explains that it is not set up.

## Running the collector locally

```bash
cd collector
pip install -r requirements.txt
python -m playwright install chromium
python -m pytest -q tests              # parser tests
python main.py --dry-run calls.json    # collect without Firebase, write to a file
python main.py --dry-run calls.json --only eu,aka
```

## Settings

`collector/config.yaml`: sources on/off, excluded EU programmes, EURA business grants, Interreg
Finland-only, and the AI model and per-run cap. Its `profile` section is only the starting point: the
first run copies it to Firestore (`settings/profile`), and from then on admins edit the profile in the
app's *Profile* tab.

## Costs

GitHub Pages, GitHub Actions, the Firebase free tier (Spark) and the Cloudflare Workers free tier are
enough for a team. Claude API usage is the only cost. Estimates with Claude Haiku 5.5 (about $0.10 per
million input tokens and $0.50 per million output tokens for prompts under 100k tokens, from a
third-party summary of Anthropic's pricing; check the current prices in the Claude Console):

| Use | Tokens | Cost |
|---|---|---|
| Summary + relevance scoring, first run (~450-500 calls) | ~2,600 in + 250 out per call | about $0.20-0.25 once |
| Summary + relevance scoring, ongoing (100-200 new or changed calls a month) | | under $0.10 a month |
| Idea search, one search over ~450 calls | ~45,000 in + 800 out | about $0.005 |
| Idea search, 100 searches a month | | about $0.50 a month |

A call is scored again only when its content changes. Every EU topic gets a summary by default; set
`ai.eu_min_keyword_score: 1` in `config.yaml` to skip EU topics with no keyword hits and save tokens.
Calls already scored before summaries existed are summarised on the next run.
The collector log and the `meta/collector` document report the tokens used; the worker logs tokens per
search. Set a monthly spend limit in the Claude Console (e.g. $5) to cap costs for certain.

## Sources

Checked against the live sites on 29 Oct 2026. If a funder changes its site, that source fails, the
previous data is kept, and the error shows in the Actions log and at the bottom of the app.

| Source | From | Notes |
|---|---|---|
| EU Funding & Tenders | SEDIA search API | also returns expired "open" topics and duplicates, which are filtered out |
| Business Finland | the site's own search block (HTML) + call pages | deadline taken from the call page text |
| Research Council of Finland | calls page + call pages (HTML) | includes calls "in preparation" |
| EURA 2021 | JSON embedded in the notices page and each notice page | business grants (YRTU) excluded by default |
| Interreg | interreg.eu/calls-for-projects (rendered in a browser) | all Interreg programmes, Finland eligibility as a tag |
| CETPartnership | cetpartnership.eu/calls (HTML) | open joint calls with their calendar and call modules; Business Finland funds Finnish partners |
| EDUFI (Opetushallitus) | oph.fi/fi/rahoitushaut (HTML) | decentralised Erasmus+ (KA2 partnerships etc.) and EDUFI grants for higher education, VET and adult learning (checked 2 Nov 2026) |
| Haeavustuksia.fi | the State Treasury grant service's own search (JSON) | ministries (YM, TEM, MMM, OKM), Jotpa, elinvoimakeskus centres, regional councils, agencies; organisations and titles in `config.yaml` are left out (checked 2 Nov 2026) |
| Maaseutu.fi | the region's *valintajaksot* page (HTML) | rural development projects: elinvoimakeskus and Leader groups, next selection period ends as deadlines (checked 2 Nov 2026) |
| Foundations | each foundation's page (list in `config.yaml`) | Claude reads the page and picks out the next application period; check the list once, as foundations move their pages |

A source that suddenly returns no calls is treated as broken: its previous calls are kept and the
error is shown at the bottom of the app.

## Ideas for later

- weekly digest of new relevant calls to email or Teams (GitHub Action + webhook)
- reminders to @mentioned people and for favourite deadlines
- more sources: Nordic Energy Research, NordForsk, Business Finland partnership calls listed only on partners' sites
- forecasts of upcoming calls from last year's timing
