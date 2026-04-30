# Financial Reporter

Personal finance reporting agent for Israeli bank/credit-card accounts. Scrapes transactions, classifies them (rules + LLM fallback), and generates AI-written Hebrew financial reports — daily, monthly, annual.

The project is **fully user-agnostic and zero-install**: published as a GitHub Actions reusable workflow. You don't fork or clone this repo. Your own private repo just calls our workflow with your config.

## Quick start (5 minutes, no fork required)

1. Create a private GitHub repo (your "state repo")
2. Add `config.json`, `user-context.md`, and `.github/workflows/daily.yml` (one-line workflow that calls ours)
3. Allow GitHub Actions to push to your repo (Settings → Actions → Read and write permissions)
4. **Actions → Run workflow** — done.

Reports get committed to your state repo. Email delivery optional.

Full guide: [`document/setup.md`](document/setup.md). Templates: [`examples/state-repo/`](examples/state-repo/).

## Features

- **18 banks supported** via [`israeli-bank-scrapers`](https://github.com/eshaham/israeli-bank-scrapers)
- **AI fallback chain**: Gemini → OpenAI → Claude
- **LLM-assisted classification** for unrecognized transactions
- **Investment portfolio tracking** (Mercantile/Discount Telebank)
- **Email delivery** of daily reports (Gmail)
- **Optional**: Bit/PayBox screenshot processing via Google Drive + Gemini Vision
- **Free** to run on GitHub Actions

## CLI modes (also runnable locally)

```bash
node build/financial-agent.js daily             # yesterday's report (and email)
node build/financial-agent.js monthly [YYYY-MM] # specific month
node build/financial-agent.js annual            # past 12 months
node build/financial-agent.js process-splits    # process Bit/PayBox screenshots
```

## License

MIT
