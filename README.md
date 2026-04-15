# Private Equity Watch

A Chrome extension that warns you when you're on a website or YouTube channel owned by a private equity firm. The extension icon displays a red **PE** badge when a match is detected.

The extension currently covers YouTube channels, with support for any website as the list grows. Users can suggest additions directly from the extension popup.

---

## Table of Contents

- [How It Works](#how-it-works)
- [Installing the Extension](#installing-the-extension)
- [Adding Channels to the List](#adding-channels-to-the-list)
- [Publishing a New Version](#publishing-a-new-version)
- [Backend Infrastructure](#backend-infrastructure)
  - [Architecture](#architecture)
  - [Prerequisites](#prerequisites)
  - [Deploying](#deploying)
  - [Connecting the Extension to the API](#connecting-the-extension-to-the-api)
  - [Spending Cap](#spending-cap)
  - [Tearing Down](#tearing-down)

---

## How It Works

The extension runs a content script on every page. When a page loads or navigates, it checks the current URL against two lists:

- **YouTube channels** — matched by `@handle`, channel ID, or by inspecting `ytInitialData` on watch/shorts pages
- **Websites** — matched by bare domain (e.g. `buzzfeed.com`)

If there's a match, the content script messages the background service worker, which sets a red **PE** badge on the extension icon. On YouTube, the check re-runs on every navigation event (YouTube is a single-page app) using YouTube's own `yt-navigate-finish` event.

The extension is built on **Manifest V3**.

---

## Installing the Extension

The extension is loaded as an unpacked extension during development, and distributed through the Chrome Web Store for end users.

### Local / Development

1. Clone this repository.
2. Open Chrome and navigate to `chrome://extensions`.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the root of this repository (the folder containing `manifest.json`).
5. The Private Equity Watch icon will appear in your toolbar. Visit `youtube.com/@veritasium` to confirm the red **PE** badge appears.

### Chrome Web Store

> Published versions are distributed through the Chrome Web Store. Existing users receive updates automatically within a few hours of a new release — no action required on their part.

To install from the store, search for **Private Equity Watch** on the [Chrome Web Store](https://chrome.google.com/webstore) and click **Add to Chrome**.

---

## Adding Entries to the List

The PE entity list lives in `pe-channels.js`.

**To add a YouTube channel:**

1. Find the channel on YouTube and note its `@handle` from the URL (e.g. `youtube.com/@veritasium` → handle is `veritasium`).
2. Open `pe-channels.js` and add the lowercase handle to `youtubeHandles` under the appropriate PE firm comment:
   ```js
   // --- Acme Capital Partners ---
   "newchannelhandle",
   ```
3. Add a matching entry to `ownerInfo`:
   ```js
   "newchannelhandle": "Acme Capital Partners",
   ```

**To add a website:**

1. Add the bare domain (no `www`, no protocol) to `domains`:
   ```js
   "buzzfeed.com",
   ```
2. Add a matching entry to `ownerInfo`:
   ```js
   "buzzfeed.com": "IAC",
   ```

Then bump the version in `manifest.json` and publish a new release (see below).

---

## Publishing a New Version

1. Make your changes to `pe-channels.js` (and any other files).
2. Increment `"version"` in `manifest.json` (e.g. `1.0.0` → `1.1.0`).
3. Zip the extension files:
   ```bash
   zip -r private-equity-watch.zip . \
     --exclude "*.git*" \
     --exclude "infrastructure/*" \
     --exclude "*.py" \
     --exclude "node_modules/*"
   ```
4. Log in to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), select the Private Equity Watch listing, upload the zip, and publish.

Existing users will receive the update automatically — no reinstall needed.

---

## Backend Infrastructure

The backend handles channel suggestions submitted through the extension popup. It is entirely serverless and hosted on AWS.

### Architecture

```
Extension Popup
      |
      | HTTPS POST /suggestions
      v
CloudFront  ←── WAF (rate limiting + managed rules)
      |
      v
API Gateway  →  Lambda: submit-suggestion
                    |
                    ├── SSM Parameter (/pe-blocker/submissions-enabled)
                    │   checked on every request (60s in-memory cache)
                    └── DynamoDB: pe-blocker-suggestions

Budget Guard:
  AWS Budgets ($20/mo) ──SNS──▶ Lambda: budget-enforcer ──▶ SSM = "false"

Monthly Reset:
  EventBridge Scheduler (1st of month, 00:00 UTC) ──▶ Lambda: budget-resetter ──▶ SSM = "true"
```

**All resources are deployed to `us-east-1`** — this is required because WAF WebACLs scoped to CloudFront must reside in us-east-1.

| Resource | Purpose |
|---|---|
| CloudFront | HTTPS termination, DDoS protection, routes to API Gateway |
| WAF WebACL | Rate limit (100 req / 5 min / IP) + AWS managed common rule set |
| API Gateway | `POST /suggestions` endpoint |
| Lambda: submit-suggestion | Validates input, checks SSM flag, writes to DynamoDB |
| Lambda: budget-enforcer | Triggered by SNS when $20 is exceeded; sets SSM flag to `"false"` |
| Lambda: budget-resetter | Triggered on 1st of each month; resets SSM flag to `"true"` |
| DynamoDB | Stores suggestions with status `pending` for manual review |
| SSM Parameter | Kill-switch: `"true"` = accepting submissions, `"false"` = silently dropping |
| SNS Topic | Bridge between AWS Budgets and the budget-enforcer Lambda |
| AWS Budget | Monitors actual monthly spend; fires SNS alert at 100% of $20 |
| EventBridge Scheduler | Cron `0 0 1 * ? *` — resets the kill-switch at the start of each billing cycle |

### Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) — v2 is required for SSO support
- [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html) v2 — installed automatically via `npm install`

### AWS SSO Setup (one-time)

The project uses AWS SSO for credentials. Run this once to configure the `pe-blocker` profile:

```bash
aws configure sso --profile pe-blocker
```

When prompted, enter:

| Prompt | Value |
|---|---|
| SSO session name | `pe-blocker` |
| SSO start URL | `https://d-9066081ad5.awsapps.com/start` |
| SSO region | `us-east-1` |
| SSO registration scopes | `sso:account:access` |

Your browser will open to complete the login. Once authenticated, the CLI will list the accounts and roles available to you — select the appropriate one.

### Logging In

SSO sessions expire (typically after 8 hours). Run this at the start of each working session:

```bash
aws sso login --profile pe-blocker
```

Verify it's working:

```bash
aws sts get-caller-identity --profile pe-blocker
```

### Deploying

```bash
cd infrastructure
npm install

# Bootstrap CDK in your account/region (only needed once per account)
npx cdk bootstrap --profile pe-blocker

# Deploy everything
npx cdk deploy --profile pe-blocker
```

The deployment takes 5–10 minutes, mostly due to CloudFront propagation. When it completes, the terminal will print:

```
Outputs:
PeBlockerStack.ApiUrl = https://xxxxxxxxxxxxxx.cloudfront.net/suggestions
PeBlockerStack.SuggestionsTableName = pe-blocker-suggestions
```

### Connecting the Extension to the API

After deploying, paste the `ApiUrl` output value into `popup.js`:

```js
// popup.js — line 3
const API_URL = 'https://xxxxxxxxxxxxxx.cloudfront.net/suggestions';
```

Reload the unpacked extension in Chrome (or publish a new Web Store release) for the change to take effect.

### Spending Cap

The infrastructure includes a hard $20/month spending cap.

- When AWS detects that actual spend has exceeded $20 in the current billing cycle, it publishes an alert to an SNS topic. The **budget-enforcer** Lambda receives this and sets the SSM parameter `/pe-blocker/submissions-enabled` to `"false"`.
- From that point on, the submit-suggestion Lambda checks the flag and silently returns a success response without writing to DynamoDB. Users see the same confirmation message — there is no error shown.
- On the 1st of the following month, the **budget-resetter** Lambda (triggered by EventBridge Scheduler) resets the flag to `"true"` and submissions resume normally.

To manually re-enable or disable submissions at any time:
```bash
# Disable
aws ssm put-parameter \
  --name /pe-blocker/submissions-enabled \
  --value "false" \
  --overwrite \
  --region us-east-1 \
  --profile pe-blocker

# Re-enable
aws ssm put-parameter \
  --name /pe-blocker/submissions-enabled \
  --value "true" \
  --overwrite \
  --region us-east-1 \
  --profile pe-blocker
```

### Reviewing Submissions

Submitted channels are stored in DynamoDB with `status: "pending"`. To view them:

```bash
aws dynamodb scan \
  --table-name pe-blocker-suggestions \
  --region us-east-1 \
  --filter-expression "#s = :pending" \
  --expression-attribute-names '{"#s": "status"}' \
  --expression-attribute-values '{":pending": {"S": "pending"}}' \
  --profile pe-blocker
```

### Tearing Down

To remove all infrastructure (except the DynamoDB table, which is retained by default):

```bash
cd infrastructure
npx cdk destroy --profile pe-blocker
```

To also delete the DynamoDB table:
```bash
aws dynamodb delete-table \
  --table-name pe-blocker-suggestions \
  --region us-east-1 \
  --profile pe-blocker
```
