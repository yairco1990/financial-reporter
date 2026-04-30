# Setup Guide

A complete, copy-paste setup. ~5 minutes. No fork required, no GCP, no OAuth.

You'll create one private GitHub repo (your "state repo") with three files. A scheduled GitHub Actions workflow calls our shared agent, scrapes your banks, generates AI reports, emails you, and commits everything back to your repo.

---

## Architecture

```
┌─────────────────────────────────────────┐
│   Your private "state repo"             │
│   ├─ config.json         ← you create   │
│   ├─ user-context.md     ← you create   │
│   ├─ .github/workflows/reports.yml ← you create
│   ├─ data/               ← agent fills  │
│   └─ reports/            ← agent fills  │
└─────────────┬───────────────────────────┘
              │ calls (via scheduled cron)
              ▼
┌─────────────────────────────────────────┐
│ yairco1990/financial-reporter           │
│ Public code repo with the agent logic   │
│ + a reusable GitHub Actions workflow    │
└─────────────────────────────────────────┘
```

---

## Step 1 — Create a private state repo

1. Go to https://github.com/new
2. Repository name: anything (e.g. `financial-state`)
3. Visibility: **Private** ← important, this will hold bank credentials
4. Initialize with a README
5. Click **Create repository**

---

## Step 2 — Add `config.json` to the state repo

In your new repo, click **Add file → Create new file**, name it `config.json`, paste the template below, and edit values for your situation:

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
    },
    {
      "name": "VisaCal",
      "bankId": "visaCal",
      "credentials": {
        "username": "YOUR_USERNAME",
        "password": "YOUR_PASSWORD"
      }
    }
  ],
  "ai": {
    "openaiApiKey": "sk-proj-...",
    "models": { "openai": "gpt-5" }
  },
  "email": {
    "gmailAppPassword": "xxxx xxxx xxxx xxxx",
    "from": "you@gmail.com",
    "to": "you@gmail.com"
  },
  "portfolio": { "bank": "Discount" }
}
```

### Bank reference — what credentials each bank needs

Add or remove entries from the `banks` array. The `name` is any label you choose; the `bankId` and credential field names must match this table:

| Bank type | bankId | Credential fields |
|-----------|--------|-------------------|
| Bank Hapoalim | `hapoalim` | `userCode`, `password` |
| Bank Leumi | `leumi` | `username`, `password` |
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

### AI key — pick one

| Provider | Where to get a key | Notes |
|---|---|---|
| **OpenAI** (recommended) | https://platform.openai.com/api-keys | Requires billing; gpt-5 is the default |
| **Gemini** | https://aistudio.google.com/apikey | Free tier OK for `gemini-2.5-flash`; pro requires billing |
| **Claude** | https://console.anthropic.com/settings/keys | Set `anthropicApiKey` instead |

Multiple keys can be set; providers are tried in order: OpenAI → Gemini → Claude.

### Email — optional but useful

To get the daily report by email, you need a Gmail App Password (NOT your regular Gmail password):
1. Enable 2FA on your Google account if not already: https://myaccount.google.com/signinoptions/two-step-verification
2. Generate an App Password: https://myaccount.google.com/apppasswords (name it anything, copy the 16-char value)
3. Paste into `gmailAppPassword`

If `email` is omitted or `gmailAppPassword` is empty, the agent skips email delivery silently.

### Portfolio — optional

If one of your banks is Mercantile or Discount, the agent can also fetch your investment portfolio from Telebank. Set `portfolio.bank` to the `name` of that bank entry. Otherwise omit `portfolio` entirely.

---

## Step 3 — Add `user-context.md` to the state repo

This is a markdown file the AI reads at the start of every prompt to understand your situation. Without it, reports are generic; with it, they're personal and accurate.

Click **Add file → Create new file**, name it `user-context.md`, paste a short description like:

```markdown
# User Profile

[Name], [age], [occupation]. Lives in [city].

## Key Notes

- Rent = ₪X,XXX/month paid by [check / cash / direct debit]. (If by check it won't appear in transactions; mention it so the AI doesn't expect it.)
- Recurring donations: [name 1] (₪X/mo), [name 2] (₪Y/mo)
- Standing orders for savings: ₪X/mo, ₪Y/mo (so the AI knows these aren't expenses)
- Salary appears in transactions as "[employer name in Hebrew]"
- Paybox/Bit can be both incoming (friend reimbursements) and outgoing
- All investment activity (securities, FX, Keren Hishtalmut) shown separately, not in expenses
```

The more specific the context, the better the AI insights. You can edit this file any time on github.com — next run picks it up automatically.

---

## Step 4 — Add the workflow file

Click **Add file → Create new file**, name it **`.github/workflows/reports.yml`** (GitHub will create the folders), paste exactly this — no edits needed:

```yaml
name: Financial Reporter

on:
  schedule:
    - cron: '5 23 * * *'      # Daily at 01:05 Israel time
    - cron: '15 23 1 * *'     # Monthly: 1st of every month at 01:15
    - cron: '25 23 1 1 *'     # Annual: Jan 1 at 01:25
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
      mode: >-
        ${{
          github.event_name == 'workflow_dispatch' && inputs.mode ||
          github.event.schedule == '25 23 1 1 *' && 'annual' ||
          github.event.schedule == '15 23 1 * *' && 'monthly' ||
          'daily'
        }}
      arg: ${{ inputs.arg || '' }}
    secrets: inherit
```

This file:
- **Runs daily at 01:05 IL** — generates yesterday's report
- **Runs on the 1st of every month at 01:15** — generates monthly report for the previous month
- **Runs on Jan 1 at 01:25** — generates annual report for the previous year
- **Can be run manually** via the Actions tab (with mode dropdown)

---

## Step 5 — Allow the workflow to push to your repo

Open your state repo's **Settings → Actions → General**.

Scroll to **Workflow permissions** and:
- Select **Read and write permissions**
- Click **Save**

This lets the agent commit reports and cached data back to your repo using GitHub's built-in `GITHUB_TOKEN` — no Personal Access Token to manage.

---

## Step 6 — Run it once to verify

In your state repo: **Actions → Financial Reporter → Run workflow** (top-right) → leave defaults → **Run workflow**.

Wait ~3 minutes. Once green, your repo will contain new files:

```
your-state-repo/
├── config.json
├── user-context.md
├── .github/workflows/reports.yml
├── data/
│   ├── all_transactions.json
│   ├── portfolio.json            (if portfolio configured)
│   └── portfolio/2026-XX-XX.json (daily snapshot)
└── reports/
    └── daily/2026-XX-XX.html     (yesterday's report)
    └── daily/2026-XX-XX.md
```

If you configured email, you'll also receive the daily report in your inbox.

---

## What runs automatically from now on

| Event | Time (Israel) | What runs |
|---|---|---|
| Every day | 01:05 | Daily report for yesterday |
| 1st of every month | 01:15 | Monthly report for previous month |
| Jan 1 | 01:25 | Annual report for previous year |

You never need to think about it again. The state repo is a complete, browsable, version-controlled history of your finances.

---

## Updating later

To change anything (add a bank, rotate a password, edit your context, switch AI model), edit the file directly on github.com (pencil icon → edit → commit). The next run picks up the change automatically — no redeploy.

---

## Optional: process Bit/PayBox screenshots

If you split bills with friends and want screenshots auto-processed by AI:

1. Create a Google Cloud service account, download its JSON key
2. Create a Drive folder, share with that service account email (Editor)
3. In your state repo: **Settings → Secrets and variables → Actions** add:
   - `GCP_SA_KEY` — paste the entire service account JSON
   - `SPLITS_INBOX_FOLDER_ID` — the Drive folder ID
4. Drop screenshots into the Drive folder — they'll be analyzed and removed on the next daily run, with structured records committed to `data/splits/` in your state repo

---

## Troubleshooting

**Workflow rejected with "config.json not found"** — Make sure `config.json` is at the repo root, not inside a folder.

**"Permission denied to push"** — Check Step 5: Workflow permissions must be **Read and write**.

**Bank login fails** — Verify credentials by logging in manually on the bank website. Hapoalim is particularly slow/flaky from CI runners.

**`All models failed`** — Check your AI key has billing/quota. For OpenAI, gpt-5 needs a project with billing enabled. For Gemini, free tier `gemini-2.5-flash` works without billing; pro requires billing.

**Email not sent** — Check `gmailAppPassword` is a 16-character App Password (not your Gmail password). Requires 2FA on the Google account.

---

## Local development (optional)

```bash
git clone https://github.com/yairco1990/financial-reporter.git
cd financial-reporter
npm install
npm run build

# Point the agent at a local clone of your state repo
git clone https://github.com/your-username/financial-state.git ~/financial-state
export STATE_REPO_PATH=~/financial-state

node build/financial-agent.js daily
node build/financial-agent.js monthly 2026-03
node build/financial-agent.js annual
```

Useful env vars:
- `USE_CACHE=true` — skip slow bank scraping, use cached transactions

After the run, manually commit + push from `~/financial-state` to persist the results.
