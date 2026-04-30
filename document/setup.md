# Setup Guide

This project is fully user-agnostic. **You don't need to fork this repo.** The code is published as a reusable GitHub Actions workflow — your own private repo just calls it with your config.

**Total setup time: ~5 minutes. No GCP. No OAuth. No PAT.**

## Architecture

```
┌─────────────────────────────────────┐
│   Your private repo                 │
│   (the "state repo")                │
│                                     │
│   ├─ config.json     ← you create   │
│   ├─ user-context.md ← you create   │
│   ├─ .github/workflows/daily.yml ← calls our reusable workflow
│   ├─ data/           ← agent fills  │
│   └─ reports/        ← agent fills  │
└─────────────┬───────────────────────┘
              │ uses:
              ▼
┌─────────────────────────────────────┐
│ yairco1990/financial-reporter       │
│ - Code                              │
│ - .github/workflows/agent.yml ← reusable workflow
└─────────────────────────────────────┘
```

When the schedule fires (or you click Run), GitHub Actions:
1. Checks out your state repo (your data)
2. Checks out the financial-reporter code repo
3. Runs the agent against your data
4. Commits and pushes any new reports/cache files back to your state repo (using the built-in `GITHUB_TOKEN` — no manual PAT needed)

## Step 1 — Create your private state repo

1. Go to https://github.com/new
2. Name: anything (e.g. `financial-state`)
3. **Private** ← important, contains bank credentials
4. Initialize with a README
5. Create

## Step 2 — Add three files to the state repo

Copy these from [`examples/state-repo/`](../examples/state-repo/) of this code repo, OR create them via github.com web UI:

### `config.json` (root of repo)
```json
{
  "user": { "name": "Your Name" },
  "banks": [
    {
      "name": "Discount",
      "bankId": "discount",
      "credentials": {
        "id": "YOUR_TZ",
        "num": "YOUR_ACCOUNT_NUM",
        "password": "YOUR_PASSWORD"
      }
    }
  ],
  "ai": {
    "geminiApiKey": "AIza...",
    "models": { "gemini": "gemini-2.5-pro" }
  },
  "email": {
    "gmailAppPassword": "xxxx xxxx xxxx xxxx",
    "from": "you@gmail.com",
    "to": "you@gmail.com"
  }
}
```

Add banks for your situation — see the bank table below.

### `user-context.md` (root of repo)
Free-form markdown describing your financial situation so the AI can generate accurate reports. Example:
```markdown
# User Profile

[Your Name], [age], [occupation]. Lives in [city], renting (₪X,XXX/month).

## Key Notes
- Rent paid via [check/transfer] — won't appear as a bank transaction
- Recurring donations: [name] (₪X/mo), [name] (₪Y/mo)
- Salary appears as "[employer name in Hebrew]"
- Paybox/Bit can be both incoming and outgoing
```

### `.github/workflows/daily.yml`
```yaml
name: Daily Financial Report

on:
  schedule:
    - cron: '5 23 * * *'  # 01:05 Israel time
  workflow_dispatch:
    inputs:
      mode:
        description: 'daily | monthly | annual | process-splits'
        type: choice
        options: [daily, monthly, annual, process-splits]
        default: daily
      arg:
        description: 'YYYY-MM (for monthly/annual)'
        type: string
        default: ''

jobs:
  run:
    uses: yairco1990/financial-reporter/.github/workflows/agent.yml@main
    with:
      mode: ${{ inputs.mode || 'daily' }}
      arg: ${{ inputs.arg || '' }}
    secrets: inherit
```

## Step 3 — Get an AI API key (free)

Pick at least one — they're tried in order Gemini → OpenAI → Claude:

- **Gemini** (recommended, has free tier): https://aistudio.google.com/apikey
- **OpenAI**: https://platform.openai.com/api-keys
- **Claude**: https://console.anthropic.com/settings/keys

Paste the key into your `config.json` under `ai`.

## Step 4 — Allow Actions to push to your repo

In your state repo: **Settings → Actions → General → Workflow permissions**:
- Select **Read and write permissions**
- Save

(This lets the workflow's built-in `GITHUB_TOKEN` commit reports back to your state repo.)

## Step 5 — Run

In your state repo: **Actions → Daily Financial Report → Run workflow**

Done. Reports will be committed to `reports/daily/` in your repo. If email is configured, you'll also get the daily report by email.

The workflow runs automatically every day at **01:05 Israel time**. Edit the cron in `daily.yml` to change.

---

## Bank credential reference

Each entry in `config.json` → `banks` needs `name` (any label), `bankId`, and `credentials`:

| Bank type | bankId | Credential fields |
|-----------|--------|-------------------|
| Hapoalim | `hapoalim` | `userCode`, `password` |
| Leumi | `leumi` | `username`, `password` |
| Discount | `discount` | `id`, `num`, `password` |
| Mercantile | `mercantile` | `id`, `num`, `password` |
| Mizrahi | `mizrahi` | `username`, `password` |
| Otsar Hahayal | `otsarHahayal` | `username`, `password` |
| Beinleumi | `beinleumi` | `username`, `password` |
| Massad | `massad` | `username`, `password` |
| Yahav | `yahav` | `username`, `nationalID`, `password` |
| Visa Cal | `visaCal` | `username`, `password` |
| MAX | `max` | `username`, `password` |
| Isracard | `isracard` | `id`, `card6Digits`, `password` |
| Amex | `amex` | `id`, `card6Digits`, `password` |
| Beyahad Bishvilha | `beyahadBishvilha` | `id`, `password` |

---

## Email setup (optional)

For daily reports by email:
1. Generate a Gmail App Password: https://myaccount.google.com/apppasswords (requires 2FA)
2. Add to `config.json`:
   ```json
   "email": {
     "gmailAppPassword": "xxxx xxxx xxxx xxxx",
     "from": "you@gmail.com",
     "to": "you@gmail.com"
   }
   ```

---

## Investment portfolio (optional)

Currently supports Mercantile and Discount (via Telebank). Add to `config.json`:
```json
"portfolio": { "bank": "Discount" }
```
The value matches the `name` of the bank entry that holds your portfolio.

---

## Splits processing (optional, advanced)

If you want Bit/PayBox screenshots auto-processed:
1. Create a GCP service account, share a Drive folder with it
2. In your state repo: **Settings → Secrets and variables → Actions** add:
   - `GCP_SA_KEY` — full service account JSON
   - `SPLITS_INBOX_FOLDER_ID` — Drive folder ID
3. Drop screenshots into the Drive folder; they get processed and removed on the next daily run

---

## Local development

```bash
git clone https://github.com/yairco1990/financial-reporter.git
cd financial-reporter
npm install
npm run build

# Point at a local clone of your state repo
git clone https://github.com/your-username/financial-state.git ~/financial-state
export STATE_REPO_PATH=~/financial-state

node build/financial-agent.js daily
```

After the run, commit and push from `~/financial-state` yourself.

### CLI modes
```bash
node build/financial-agent.js daily              # yesterday's report + email
node build/financial-agent.js monthly 2026-03    # specific month
node build/financial-agent.js annual             # past 12 months
node build/financial-agent.js process-splits     # process Bit/PayBox screenshots
```

### Useful env vars
- `USE_CACHE=true` — skip bank scraping, reuse cached transactions
- `SKIP_EXISTING=false` — regenerate existing monthly reports in annual mode

---

## State repo structure (after first run)

```
your-state-repo/
├── config.json               ← you create
├── user-context.md           ← you create
├── .github/workflows/daily.yml  ← you create
├── data/                     ← agent populates
│   ├── all_transactions.json
│   ├── portfolio.json
│   ├── portfolio/
│   └── splits/
└── reports/                  ← agent populates
    ├── daily/
    ├── monthly/
    └── annual/
```

---

## Troubleshooting

**`config.json not found`** — commit it to the root of your state repo.

**`Permission denied to push`** — see Step 4 (Workflow permissions must be Read and write).

**Bank login fails** — verify credentials by logging in manually. Hapoalim is particularly slow/flaky.

**`All models failed`** — check API keys have credit/quota.

**Email not sent** — check `gmailAppPassword` is a real App Password (not Gmail password); requires 2FA.

---

## Updating your config

Just edit `config.json` or `user-context.md` directly on github.com (pencil → edit → commit). Next run picks up the changes automatically.
