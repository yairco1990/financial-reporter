# Financial Reporter

Personal finance reporting agent for Israeli bank/credit-card accounts. Scrapes transactions, classifies them (rules + LLM fallback), and generates AI-written Hebrew financial reports — daily, monthly, annual — delivered by email.

The project is **fully user-agnostic and zero-install**: this repo ships a reusable GitHub Actions workflow. Every user keeps their config and data in their own private "state repo" that calls our workflow.

## Quick start (~5 minutes)

1. Create a private GitHub repo
2. Add three files: `config.json`, `user-context.md`, `.github/workflows/reports.yml`
3. Enable workflow write permissions
4. Click Run

Full step-by-step guide with copy-paste templates: **[`document/setup.md`](document/setup.md)**

## Features

- **18 banks supported** via [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)
- **AI fallback chain**: OpenAI (gpt-5) → Gemini → Claude
- **LLM-assisted classification** for unrecognized transaction descriptions
- **Investment portfolio tracking** (Mercantile/Discount Telebank)
- **Daily / monthly / annual** reports on automatic schedules
- **Email delivery** of daily reports via Gmail
- **Optional**: Bit/PayBox screenshot processing via Google Drive + Gemini Vision
- **Free** to run on GitHub Actions

## Schedules (auto)

| When | What runs |
|---|---|
| Every day at 01:05 IL | Daily report |
| 1st of every month at 01:15 IL | Monthly report (previous month) |
| Jan 1 at 01:25 IL | Annual report (previous year) |

## CLI modes (also runnable locally)

```bash
node build/financial-agent.js daily             # yesterday's report (and email)
node build/financial-agent.js monthly [YYYY-MM] # specific month
node build/financial-agent.js annual            # past 12 months
node build/financial-agent.js process-splits    # process Bit/PayBox screenshots
```

## License

MIT
