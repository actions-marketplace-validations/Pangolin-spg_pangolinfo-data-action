# Pangolinfo Data Export

[![CI](https://github.com/Pangolin-spg/pangolinfo-data-action/actions/workflows/ci.yml/badge.svg)](https://github.com/Pangolin-spg/pangolinfo-data-action/actions/workflows/ci.yml)

Export structured Amazon research or Google AI Overview data from Pangolinfo during a GitHub Actions workflow. The Action writes the response to a private-permission JSON file that can be analyzed in later steps, committed to a private data repository, or retained as a GitHub Actions artifact.

It supports four intentionally bounded products:

| `product` | What it helps automate | Product and API documentation |
|---|---|---|
| `amazon-scraper` | Product detail, keyword search, seller catalog, best sellers, new releases, and reviews | [Amazon Scraper API](https://www.pangolinfo.com/amazon-scraper-api/?utm_source=github_marketplace&utm_medium=integration&utm_campaign=amazon_scraper_api) · [API docs](https://docs.pangolinfo.com/en-api-reference/amazonApi/amazonScrapeAPI) |
| `ai-overview` | Monitor Google AI Overviews, citations, organic results, and optional screenshots | [AI Overview SERP API](https://www.pangolinfo.com/ai-overview-serp-api/?utm_source=github_marketplace&utm_medium=integration&utm_campaign=ai_overview_serp_api) · [API docs](https://docs.pangolinfo.com/en-api-reference/aiModeSerpApi/serpSubmit) |
| `amazon-niche` | Filter Amazon niches using demand, competition, click-share, and return metrics | [Amazon Niche Data API](https://www.pangolinfo.com/amazon-niche-data-api/?utm_source=github_marketplace&utm_medium=integration&utm_campaign=amazon_niche_data_api) · [API docs](https://docs.pangolinfo.com/en-api-reference/nicheFilterAPI/nicheFilterAPI) |
| `amazon-alexa` | Research Alexa for Shopping recommendations, contextual answers, and follow-up questions | [Amazon Alexa API](https://www.pangolinfo.com/amazon-alexa-api/?utm_source=github_marketplace&utm_medium=integration&utm_campaign=amazon_alexa_api) · [API docs](https://docs.pangolinfo.com/en-api-reference/amazonAlexaAPI/amazonAlexaAPI) |

## Why use this Action?

- Schedule repeatable market and search research without maintaining request code.
- Preserve dated JSON snapshots as workflow artifacts for comparisons and audits.
- Keep the API token in GitHub Secrets; the Action masks it and never prints response bodies.
- Retry transient network, HTTP 429, and HTTP 5xx errors with bounded backoff.
- Record product, endpoint, status, request ID, attempt count, and generation time in an optional provenance envelope.
- Restrict requests to four fixed Pangolinfo HTTPS endpoints and validate product-specific fields.

## Five-minute quickstart

1. Create a Pangolinfo API token in the [Pangolinfo Console](https://console.pangolinfo.com/).
2. In your repository, open **Settings → Secrets and variables → Actions** and add a repository secret named `PANGOLINFO_TOKEN`.
3. Save this workflow as `.github/workflows/amazon-product.yml`, replacing the sample ASIN if needed:

```yaml
name: Export Amazon product data

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  export:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5

      - name: Fetch structured Amazon product data
        id: pangolinfo
        uses: Pangolin-spg/pangolinfo-data-action@v1
        with:
          token: ${{ secrets.PANGOLINFO_TOKEN }}
          product: amazon-scraper
          request: |
            {
              "parserName": "amzProductDetail",
              "site": "amz_us",
              "content": "B0DYTF8L2W",
              "format": "json",
              "bizContext": { "zipcode": "10041" }
            }
          output-file: data/amazon-product.json

      - name: Retain the result for 14 days
        uses: actions/upload-artifact@v4
        with:
          name: amazon-product-data
          path: ${{ steps.pangolinfo.outputs.output-file }}
          retention-days: 14
```

The response is not displayed in logs. Download `amazon-product-data` from the completed workflow run.

## Scheduled AI Overview monitoring

This example captures a daily SERP snapshot. The cron expression uses UTC, so adjust it to the reporting timezone you need.

```yaml
name: Daily AI Overview snapshot

on:
  schedule:
    - cron: "17 1 * * *"
  workflow_dispatch:

permissions:
  contents: read

jobs:
  snapshot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - id: pangolinfo
        uses: Pangolin-spg/pangolinfo-data-action@v1
        with:
          token: ${{ secrets.PANGOLINFO_TOKEN }}
          product: ai-overview
          request: |
            {
              "parserName": "googleSearch",
              "url": "https://www.google.com/search?q=best+portable+fan",
              "screenshot": false
            }
          output-file: snapshots/ai-overview.json
      - uses: actions/upload-artifact@v4
        with:
          name: ai-overview-${{ github.run_id }}
          path: ${{ steps.pangolinfo.outputs.output-file }}
          retention-days: 30
```

See [`examples/`](examples/) for niche filtering and Alexa for Shopping workflows.

## Inputs

| Input | Required | Default | Description |
|---|---:|---|---|
| `token` | Yes | — | Pangolinfo API token. Always pass a GitHub secret. |
| `product` | Yes | — | `amazon-scraper`, `ai-overview`, `amazon-niche`, or `amazon-alexa`. |
| `request` | Yes | — | JSON object accepted by the selected product endpoint. |
| `output-file` | No | `pangolinfo-result.json` | Relative path inside `GITHUB_WORKSPACE`; parent directories are created. |
| `output-format` | No | `envelope` | `envelope` adds provenance metadata; `raw` writes the unmodified API response. |
| `timeout-seconds` | No | `180` | Per-attempt timeout from 10 to 300 seconds. |
| `max-attempts` | No | `3` | One to five attempts. Only network failures, 429, and 5xx are retried. |

## Outputs

| Output | Description |
|---|---|
| `output-file` | Absolute path to the saved result. |
| `status-code` | Successful API HTTP status. |
| `request-id` | Pangolinfo request identifier, when the response provides one. |
| `product` | Normalized product identifier. |
| `endpoint` | Fixed Pangolinfo endpoint used for the request. |

## Request examples

### Amazon Niche Data API

```yaml
product: amazon-niche
request: |
  {
    "marketplaceId": "US",
    "searchVolumeT90Min": 10000,
    "top5BrandsClickShareMax": 0.4,
    "page": 1,
    "size": 10
  }
```

### Amazon Alexa for Shopping API

```yaml
product: amazon-alexa
request: |
  {
    "parserName": "amazonAlexa",
    "param": ["Recommend a quiet portable fan under $30"],
    "url": "https://www.amazon.com/",
    "screenshot": false
  }
```

Alexa accepts one to five prompts per request. The Action rejects other parser names and non-Amazon context domains before making a request.

## Error behavior

The step fails with an actionable category rather than printing the response body:

- `401` / `403`: token or permission problem;
- `402`: insufficient account credits or quota;
- `429`: rate limit exceeded after bounded retries;
- `5xx`: Pangolinfo service error after bounded retries;
- timeout or network error: retried up to `max-attempts`.

Because a successful response can contain commercially sensitive research, inspect access settings before uploading it as an artifact. GitHub artifacts are visible to people who can read the repository's Actions runs. Do not commit responses to a public repository unless the data is intended to be public.

## Security and data handling

- The token is registered with GitHub's masking mechanism before use.
- Only `https://scrapeapi.pangolinfo.com` is contacted.
- AI Overview URLs must be HTTPS Google domains; Alexa context URLs must be HTTPS Amazon domains.
- Output paths cannot be absolute or escape `GITHUB_WORKSPACE`.
- Result bodies are written with owner-only file permissions and are not copied into Action logs or outputs.
- Pin the Action to a full commit SHA when your threat model requires immutable dependencies.

Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## Support and policies

- [Pangolinfo documentation](https://docs.pangolinfo.com/)
- [Pangolinfo Console](https://console.pangolinfo.com/)
- [Privacy Policy](https://www.pangolinfo.com/privacy-policy/)
- [Terms of Service](https://www.pangolinfo.com/terms-of-service/)
- [GitHub issues](https://github.com/Pangolin-spg/pangolinfo-data-action/issues)

The source code is available under the [MIT License](LICENSE). Pangolinfo names and logos are trademarks and are not licensed by the MIT License.
