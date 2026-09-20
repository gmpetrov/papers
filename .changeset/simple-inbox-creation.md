---
"@papers.bot/sdk": minor
"papers-bot": minor
---

Simplify inbox creation to require only `username`. This replaces `localPart` in TypeScript/HTTP and `local_part` in Python. Remove the inbox creation idempotency argument; the API handles retries automatically. The optional `name` defaults to a random readable name such as `fierce-zebra`.

Default both SDKs to `https://www.papers.bot`, so the base URL can be omitted. Custom base URLs remain supported.
