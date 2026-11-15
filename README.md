# Telegram Public Channel Scraper

Extract messages from public Telegram channel web previews without an account, login, or Telegram API credentials. Collect plain text, publication dates, view counts, message links, photo URLs, and media indicators.

## Input

```json
{
  "channels": ["telegram"],
  "maxMessagesPerChannel": 20
}
```

| Field | Type | Default | Description |
| --- | --- | --- | --- |
| `channels` | Array | Required | Between 1 and 50 channel names, `@handles`, public channel URLs, or objects such as `{"channel":"telegram"}`. Accepted URLs are `https://t.me/channel` and `https://t.me/s/channel`. |
| `maxMessagesPerChannel` | Integer | 50 | Between 1 and 1,000 messages collected per channel before keyword filtering. The Console example uses 20. |
| `sinceDate` | String | Omitted | Inclusive earliest publication date. Accepts an ISO date such as `2026-11-01` or an ISO timestamp with a timezone. |
| `keywords` | Array of strings | Empty | Keep messages whose text contains any supplied keyword, ignoring case. An empty list includes all collected messages. |

Channel names must match `^[A-Za-z][A-Za-z0-9_]{3,31}$`.

## Dataset output

Each saved message contains these fields:

| Field | Type | Description |
| --- | --- | --- |
| `channel` | String | Public channel handle. |
| `messageId` | Number | Message identifier within the channel. |
| `url` | String | Direct Telegram message URL. |
| `date` | String | Publication timestamp in ISO format, normalized to UTC. |
| `text` | String | Plain text with line breaks and decoded HTML entities. |
| `views` | Number or null | Displayed view count converted to a number. Abbreviated counts are approximate. |
| `hasPhoto` | Boolean | Whether the preview includes a photo attachment. |
| `hasVideo` | Boolean | Whether the preview includes a video player. |
| `photoUrls` | Array of strings | Photo URLs exposed by the preview. Images are not downloaded. |
| `links` | Array of strings | Unique HTTP and HTTPS links found in the message text. |
| `forwardedFrom` | String or null | Displayed forwarding source name, when available. |
| `isReply` | Boolean | Whether the preview contains a reply indicator. |

Messages are processed in input channel order, newest first within each channel. Repeated messages are omitted within a run. There is no persistent deduplication between runs.

## Run summary

The key-value store record `OUTPUT` contains `report` and `totals`. Each report row contains `channel`, `messages` (saved count), `pages` (attempted page requests), and `error` (null on success).

Totals contain `requestedChannels`, `succeededChannels`, `failedChannels`, `skippedChannels`, `messages`, and `pages`. A channel request failure is reported while processing continues with the remaining channels. Storage and charging failures stop the run.

## Limits and collection behavior

Only public channels with an accessible `https://t.me/s/` web preview are supported. The Actor does not collect groups, comments, member lists, phone numbers, or search results about individual users.

Telegram previews usually contain about 20 messages per page. Collection stops at the message limit, after encountering messages older than `sinceDate`, when no earlier page is available, or after 50 pages per channel. Requests between pages are spaced by 500 milliseconds. Each HTTP attempt has a 30-second timeout; HTTP 429 and 5xx responses receive at most one retry.

Keyword filtering happens after collection. It can produce fewer saved messages than the requested limit; the Actor does not fetch additional pages to replace nonmatching messages.

A redirect outside the public preview produces `Channel is not public or does not exist`. Preview availability and HTML structure can change. Media links may expire, and the public preview may omit content available in Telegram applications.

## Pricing and spending limits

Pay per event: `run-started` costs $0.005 per valid run and `message` costs $0.0008 per saved message ($0.80 per 1,000 messages). Channels that fail and messages removed by filters are not charged.

Billing events are `run-started` for a valid run and `message` for each saved message. Message capacity is calculated before requesting pages and allocated to channels in input order. Channels without an allocation are skipped. Unused capacity from errors or keyword filtering is not reassigned to later channels. Charges are not retried automatically.

## What can you do with it?

### Collect public announcements
Gather messages from a public channel for editorial review. This example uses the Telegram channel already included in the local examples and tests.

```json
{
  "channels": ["telegram"],
  "maxMessagesPerChannel": 40
}
```

### Prepare a recent-content research sample
Collect public channel content with an inclusive date cutoff. The result depends on the available public pages and the configured message limit.

```json
{
  "channels": ["telegram"],
  "maxMessagesPerChannel": 100,
  "sinceDate": "2026-11-01"
}
```

### Select posts by topic
Filter collected messages using case-insensitive text keywords. This example selects messages containing either keyword; a run can return no matches.

```json
{
  "channels": ["telegram"],
  "maxMessagesPerChannel": 100,
  "keywords": ["update", "feature"]
}
```

### Create a small editorial review batch
Limit collection to a small number of public channel messages for manual review. Export the resulting dataset to continue your review outside the run.

```json
{
  "channels": ["telegram"],
  "maxMessagesPerChannel": 20
}
```

## How much does it cost?

The event prices are USD 0.005 per run plus USD 0.0008 per message event.

- A run with 40 billed message events: USD 0.005 + (40 × USD 0.0008) = **USD 0.037**.
- A run with 1000 billed message events: USD 0.005 + (1000 × USD 0.0008) = **USD 0.805**.

These examples use actual billed message counts, not the requested collection maximum. They cover the listed event prices; check your Apify account for any additional applicable platform charges.

## FAQ

### Does it access private chats or groups?
The Actor reads public channel pages. It does not provide access to private chats, private groups or content requiring an account login.

### What are the collection limits?
Input accepts 1–50 channels and `maxMessagesPerChannel` from 1 to 1000, with a runtime default of 50. The message limit applies before keyword filtering, so the final dataset can contain fewer matching messages.

### How do date and keyword filters work?
`sinceDate` accepts an ISO date or timestamp and includes messages at the boundary. Keyword matching ignores case and accepts a message when at least one supplied keyword appears in its text.

### What if a public channel cannot be read?
Review the run's channel errors before using its results. An inaccessible or nonexistent channel is not evidence that the channel has no messages, and public-page availability limits what can be collected.

### How do I run it daily?
Save the input as an Apify Task and create a daily Schedule for that Task. Choose the channels, date cutoff and collection limit to suit each scheduled collection.

### How do I export CSV or JSON?
Open the run's default dataset in Apify and select CSV or JSON export. Exported records reflect the messages collected and retained by that run's filters.

## Integrations

Start runs through the Apify API with public channel inputs and collection settings. Configure Apify webhooks to notify your system about run lifecycle events. In an automation workflow, wait for completion, check run errors and retrieve the message dataset for editorial or research processing.

## Responsible use

Use public channel content for purposes you are authorized to pursue. Respect applicable terms, privacy, and content rights when collecting or sharing messages. Do not use the Actor to bypass access restrictions or target individuals.

## Development

`npm test` runs the offline suite (Node 22, no network: a saved page of the official `telegram` channel is the fixture).
