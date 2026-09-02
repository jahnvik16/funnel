# FunnelCore — Bulk Tracking Link Import

Reference for `/admin/tracking-links/bulk-import` (`src/lib/tracking-link-bulk-import.ts`). Built
to remove the real bottleneck in setting up a large campaign export (e.g. a Paybig export
covering many brands x platforms) without touching FunnelCore's data model or attribution logic
— see DECISIONS.md D056 for the full reasoning.

## What it does, and doesn't, create

Each CSV row describes **one Campaign + one Tracking Link**, which this tool creates and
**publishes** (i.e. it goes live immediately, the same as clicking Publish by hand).

It does **not** create Brands, Platforms, Domains, or Telegram bots — those must already exist.
In practice there are only a handful of each, so setting them up once through the normal admin
pages isn't the bottleneck this tool exists to remove; a CSV row that references one that
doesn't exist yet is reported as an invalid row, not auto-created.

## CSV columns

| Column | Required | Notes |
|---|---|---|
| `brand_slug` | Yes | Must match an existing, active `Brand.slug` |
| `platform_slug` | Yes | Must match an existing, active `Platform.slug` |
| `campaign_name` | Yes | Used only when creating a new Campaign — ignored if the campaign already exists |
| `campaign_slug` | Yes | If a Campaign with this slug already exists for the brand, it's reused (see "Reusing an existing campaign" below). Otherwise one is created |
| `paybig_url` | Yes | Must be a valid URL. Becomes the new Campaign's `paybigUrl`, or must exactly match the existing one |
| `domain_hostname` | Yes | Must match an existing, active `Domain.hostname`. If the domain is scoped to a brand, it must match this row's brand |
| `tracking_link_label` | Yes | The Tracking Link's display label |
| `tracking_link_token` | Yes | The routing token — must be unique per domain, same rule as creating one by hand |
| `path_type` | Yes | `direct`, `aggregator`, or `telegram` (case-insensitive) |
| `destination_url` | Required for `direct`/`aggregator` | Must be a valid URL. Ignored for `telegram` rows |
| `telegram_bot_name` | Required for `telegram` | Must match an existing `TelegramBot.name` for this brand, and that bot must already be validated (has a `botUsername` on file — run the bot's Validate action first if not) |
| `social_account_handle` | No | If given, must match an existing `SocialAccount.handle` for this brand + platform |
| `age_gate_enabled` | No | `true`/`false` (or `yes`/`no`, `1`/`0`), case-insensitive. Blank = `false` |

Extra columns are ignored. Rows are processed in order; row numbers in the summary count the
header row as row 1 (so the first data row is row 2), matching the Paybig conversion importer's
convention.

## Reusing an existing campaign

If `campaign_slug` already matches a Campaign for that brand:

- If its `paybigUrl` **matches** the row's `paybig_url` exactly, the row reuses that campaign and
  proceeds — this is what makes multiple rows sharing a campaign, or re-running an import, safe.
- If it **doesn't match**, the row is rejected as invalid. The existing campaign is never
  silently overwritten from a bulk row — fix the CSV, or update the campaign by hand first, then
  re-run the import.

## Re-running an import

Safe by design. A row whose Tracking Link (domain + token combination) already exists is
reported as **skipped**, not duplicated — so a CSV with a few bad rows can be fixed and
re-uploaded without needing to remove the rows that already succeeded.

## What "invalid" looks like

Every row is independent — one invalid row never blocks the rest of the file. Common reasons:

- A `brand_slug`/`platform_slug`/`domain_hostname` that doesn't match anything (or matches
  something archived/inactive).
- A domain that belongs to a different brand than the row specifies.
- An invalid `path_type`, or a missing/invalid `destination_url` for `direct`/`aggregator`.
- A missing `telegram_bot_name` for a `telegram` row, or one naming a bot that hasn't been
  validated yet.
- A `campaign_slug` match whose existing `paybig_url` disagrees with the row's.

The import summary lists every invalid row with its row number and the specific reason — nothing
is silently dropped.

## Example

```csv
brand_slug,platform_slug,campaign_name,campaign_slug,paybig_url,domain_hostname,tracking_link_label,tracking_link_token,path_type,destination_url,telegram_bot_name
bats,x,BATS X,bats-x,https://pb-netw2.com/cc?c=...,fapreel.example.com,BATS X Link,bats-x,direct,https://pb-netw2.com/cc?c=...,
bats,instagram,BATS Telegram exit / Instagram,bats-tg-ig,https://pb-netw2.com/cc?c=...,fapreel.example.com,BATS IG Exit,bats-ig,telegram,,BATS Bot
```
