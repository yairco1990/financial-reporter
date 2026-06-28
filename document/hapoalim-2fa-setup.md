# Bank Hapoalim 2FA (device trust) setup

Hapoalim now challenges logins from **unrecognized devices** with an SMS OTP.
Our GitHub Actions runs are unattended (and run on a fresh machine each time),
so they can't type an SMS code. The fix is **device trust**:

1. Log in **once, locally**, complete the OTP, and capture `deviceTrustData`
   (cookies + localStorage that identify the "device" to the bank).
2. Store that blob as a GitHub secret.
3. Every CI run injects it, so Hapoalim recognizes the device and **skips OTP**.

Because device trust is just data (not tied to the hardware), the same blob
works on every ephemeral runner.

## One-time bootstrap (on your own machine)

> Run this locally — never in CI. You need to receive the SMS on your phone.

```bash
# from the financial-reporter repo
npm ci
HAPOALIM_USER_CODE='your-user-code' \
HAPOALIM_PASSWORD='your-password' \
npx ts-node scripts/bootstrap-hapoalim-device-trust.ts
```

- Add `SHOW_BROWSER=1` if you want to watch the browser.
- When the bank sends the SMS, type the code at the prompt.
- On success it prints a one-line JSON `deviceTrustData` blob and the exact
  `gh secret set` command to run.

## Set the secret (on the STATE repo that runs the pipeline)

The reusable workflow uses `secrets: inherit`, so the secret lives on the
**state repo** (e.g. `financial-state-leah`), not the code repo:

```bash
gh secret set HAPOALIM_DEVICE_TRUST --repo <owner>/financial-state-leah --body '<the JSON the script printed>'
```

(Or paste it into the secret via the GitHub UI: Settings → Secrets and
variables → Actions → New repository secret, name `HAPOALIM_DEVICE_TRUST`.)

That's it — the next scheduled run will inject it and Hapoalim should log in
without OTP. You'll see `↳ Hapoalim: injected saved device-trust data` and a
`✅ Hapoalim` in the report's connector summary.

## When it expires

Device trust can be revoked by the bank after a while. If Hapoalim starts
failing again (you'll see `❌ Hapoalim` and a log line telling you to
re-bootstrap), just re-run the bootstrap script and update the secret.

## How it's wired

- `israeli-bank-scrapers` is pinned to a fork
  (`yairco1990/israeli-bank-scrapers#hapoalim-2fa-6.7.8`) = upstream **v6.7.8**
  plus the unmerged 2FA/device-trust PR (eshaham/israeli-bank-scrapers#1084).
  The fork adds a `prepare` build hook so `npm install` of the git URL compiles
  `lib/` automatically.
- `src/scrapers/banks.ts` injects `HAPOALIM_DEVICE_TRUST` (parsed JSON) into the
  scraper options only for the Hapoalim connector.
