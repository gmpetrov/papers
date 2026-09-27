# @papers.bot/sdk

## 0.2.0

### Minor Changes

- cac59ed: Simplify inbox creation to require only `username`. This replaces `localPart` in TypeScript/HTTP and `local_part` in Python. Remove the inbox creation idempotency argument; the API handles retries automatically. The optional `name` defaults to a random readable name such as `fierce-zebra`.

  Default both SDKs to `https://www.papers.bot`, so the base URL can be omitted. Custom base URLs remain supported.

### Patch Changes

- 9c116df: Publish the branded Papers SDKs through the verified GitHub release workflow, with package-specific release notes. Include source repository metadata in the npm package.

## 0.1.0

Initial public release of the Papers SDK for email, phone, SMS, attachments, and webhook verification.
