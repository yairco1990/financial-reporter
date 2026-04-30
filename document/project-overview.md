# Financial Reporter — Project Overview

A personal finance reporting agent that scrapes Israeli banks/credit cards, classifies transactions, and generates AI-written Hebrew financial reports.

The project is **user-agnostic**: this repo holds only code. Per-user state (config, credentials, custom instructions, transaction cache, reports) lives in a separate **private GitHub repo** owned by each user.

## Architecture

The project ships as a **reusable GitHub Actions workflow**. Users don't fork the code repo — their own private state repo calls our workflow.

```
┌──────────────────────────────────┐
│ Your private state repo          │
│  - config.json                   │
│  - user-context.md               │
│  - .github/workflows/daily.yml   │── uses: yairco1990/financial-reporter/.github/workflows/agent.yml@main
│  - data/      (agent populates)  │
│  - reports/   (agent populates)  │
└──────────────────────────────────┘
                │
                ▼ (in GH Actions runner)
┌──────────────────────────────────┐
│ Reusable agent.yml workflow      │
│  1. checks out state repo        │
│  2. checks out code repo         │
│  3. runs agent on state          │
│  4. commits + pushes back        │
└──────────────────────────────────┘
                │
                ▼ (optional)
        ┌──────────────┐
        │ Drive API    │ ← splits screenshots only
        └──────────────┘
```

## Data flow on every run

1. **Resolve state dir** — `src/state-sync.ts` either uses `STATE_REPO_PATH` (set by reusable workflow to the checked-out state repo) or clones `STATE_REPO`
2. **Load state** — `src/state.ts` reads `config.json` and `user-context.md`
3. **Fetch transactions** — `src/scrapers/banks.ts` scrapes each configured bank (or loads cache if `USE_CACHE=true`)
4. **Process splits** (optional) — `src/scrapers/splits.ts` runs Gemini Vision on screenshots from a Drive folder
5. **Fetch portfolio** (daily mode, optional) — `src/scrapers/portfolio.ts` pulls Telebank securities data
6. **Classify** — `src/classifier.ts` applies regex rules; unknowns batched and sent to AI
7. **Build data** — `src/data.ts` aggregates transactions into structured monthly/daily summaries
8. **Generate report** — `src/reports/{daily,monthly,annual}.ts` calls AI with data + user context
9. **Email** (daily mode) — sent via Gmail SMTP if configured
10. **Commit + push** — handled by the reusable workflow (when called from GH Actions) or by `src/state-sync.ts` (when running standalone with `STATE_REPO`/`STATE_TOKEN`)

## Modules

| Module | Purpose |
|--------|---------|
| `state-sync.ts` | Clone state repo on startup, commit + push at end |
| `drive.ts` | Read-only Drive client for splits inbox (optional) |
| `state.ts` | Loads `config.json` + `user-context.md` from cache |
| `config.ts` | Lazy accessors for banks, AI keys, email, portfolio bank, user context |
| `financial-agent.ts` | Entry point and CLI orchestrator |
| `ai-model.ts` | 4-provider fallback chain (Gemini → OpenAI → Claude Vertex → Claude Direct) |
| `classifier.ts` | Rule-based classification + LLM fallback for unrecognized descriptions |
| `data.ts` | Pure computation: monthly/daily summaries with category breakdowns |
| `email.ts` | Gmail SMTP delivery using config.json email settings |
| `scrapers/banks.ts` | Multi-bank scraping with retries |
| `scrapers/portfolio.ts` | Telebank securities API via Puppeteer |
| `scrapers/splits.ts` | Bit/PayBox screenshot extraction via Gemini Vision |
| `reports/daily.ts` | Daily HTML email report with collapsible category breakdowns |
| `reports/monthly.ts` | Markdown monthly report with category breakdowns |
| `reports/annual.ts` | 12-month aggregation |

## Configuration (state repo `config.json`)

```json
{
  "user": { "name": "..." },
  "banks": [
    { "name": "Discount", "bankId": "discount",
      "credentials": { "id": "...", "num": "...", "password": "..." } }
  ],
  "ai": {
    "geminiApiKey": "...",
    "models": { "gemini": "gemini-2.5-pro" }
  },
  "email": { "gmailAppPassword": "...", "from": "...", "to": "..." },
  "portfolio": { "bank": "Discount" }
}
```

## Env vars

The reusable workflow sets these automatically. For standalone/local runs:

| Variable | When to set |
|----------|-------------|
| `STATE_REPO_PATH` | Path to a local clone of your state repo (recommended for local dev) |
| `STATE_REPO` + `STATE_TOKEN` | Standalone runs without a local clone — clones at runtime |
| `USE_CACHE` | `true` = skip bank scraping |
| `SKIP_EXISTING` | `false` = regenerate existing monthly reports in annual mode |
| `GOOGLE_APPLICATION_CREDENTIALS` | (splits only) path to GCP service account JSON |
| `SPLITS_INBOX_FOLDER_ID` | (splits only) Drive folder ID for screenshots |

## CLI

```bash
node build/financial-agent.js daily              # yesterday + email
node build/financial-agent.js monthly 2026-03    # specific month
node build/financial-agent.js annual 2026-03     # 12 months ending at given month
node build/financial-agent.js process-splits     # only run splits processor
```

## GitHub Actions

`.github/workflows/agent.yml` is a **reusable workflow** that user state repos call:

```yaml
jobs:
  run:
    uses: yairco1990/financial-reporter/.github/workflows/agent.yml@main
    with:
      mode: daily
    secrets: inherit
```

The workflow checks out both repos, runs the agent against the state checkout, and pushes any changes back using the built-in `GITHUB_TOKEN` (no PAT required).

## See also

- [`document/setup.md`](setup.md) — step-by-step setup for new users
- [`examples/config.example.json`](../examples/config.example.json) — config template
- [`examples/user-context.example.md`](../examples/user-context.example.md) — user context template
