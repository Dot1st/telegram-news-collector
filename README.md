# Telegram news collector

This standalone reader checks configured public Telegram previews and RSS feeds.
Queueing, deduplication, scores, and publishing remain in Telegram Serverless.
The repository contains generic reader code only, with no source list or bot credentials.

## Setup

1. Deploy the matching bot endpoints first.
2. Add repository Actions secrets TGCLOUD_TOKEN (the Serverless CLI token from BotFather) and COLLECTOR_EDITOR_ID (an authorized numeric editor ID).
3. Add repository Actions variable COLLECTOR_ENABLED with value true.
4. Run the workflow manually, then verify source health and the approval queue.

Never put a token into a committed file, issue, chat, or workflow log.
Anyone able to modify the running workflow can access its token; restrict repository write access.
No code is deployed by this worker. It uses the currently deployed bot modules.

## Timing and limits

The target schedule is every five minutes. GitHub can delay or drop scheduled runs;
this does not provide instant delivery or a 24/7 availability guarantee.
The first collection starts with five recent posts per Telegram channel. Later
collections paginate up to eight preview pages. A gap is reported as an error and
the cursor does not advance after an incomplete run or a failed item.
Media unavailable in Telegram's public preview cannot be recovered by this reader.
Available media is downloaded by the reader, transferred in small authenticated
chunks, and uploaded to the editor chat. The bot saves a reusable Telegram file ID
before allowing publication. Temporary chunks are removed after upload; abandoned
chunks expire after 24 hours. Limits are 10 MiB per photo and 48 MiB per other file.
At most twelve pending candidates are prepared per run, with a four-minute budget.
RSS collection reads the latest twenty entries per feed.
Reaction counts are read once, on the first run at least five minutes after the
original source publication. The bot selects the highest-count permitted emoji,
or thumbs up if the source has no votes. Unavailable source pages are retried;
they never count as zero votes. Selection precedes large media uploads. Exact
five-minute execution is not guaranteed by the scheduler. Channel reaction
settings are never changed. A single reaction is applied on approval or later
when the source snapshot is ready; older published history is not backfilled.
An independent check-reactions workflow checks the same queue without waiting
for the collector's media uploads. It uses the same existing repository secrets.

Standard GitHub-hosted runners are free for public repositories. Private repositories
have a finite free allowance; do not enable paid overages if zero cost is required.
Public scheduled workflows may be disabled after 60 days of repository inactivity.

Sources: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
and https://docs.github.com/en/billing/concepts/product-billing/github-actions
