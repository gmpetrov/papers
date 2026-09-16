import type { Database } from "@agentinfra/db";
import { TelnyxProvider } from "@agentinfra/providers";
import { recordSmsOptOut } from "./sms-opt-out";
import { assert } from "./errors";

/** Explicit maintenance import. No sends, unblocks, or provider mutations. */
export async function importSmsOptOuts(
  db: Database,
  provider: Pick<TelnyxProvider, "listOptOuts">,
  profileId: string,
  maxPages = 100,
) {
  assert(
    profileId.length > 0 && Number.isInteger(maxPages) && maxPages > 0,
    400,
    "invalid_input",
    "A profile and positive page limit are required",
  );
  let records = 0;
  let updated = 0;
  for (let page = 1; page <= maxPages; page++) {
    const result = await provider.listOptOuts(profileId, page);
    // Each page commits independently. Retrying after any failure is safe.
    updated += await db.$transaction(async (tx) => {
      let changes = 0;
      for (const row of [...result.data].sort((a, b) =>
        a.to.localeCompare(b.to),
      )) {
        if (
          await recordSmsOptOut(
            tx,
            profileId,
            row.to,
            "STOP",
            row.created_at,
            `telnyx-opt-out-import:${row.created_at.toISOString()}`,
          )
        )
          changes++;
      }
      return changes;
    });
    records += result.data.length;
    if (page >= result.meta.total_pages)
      return { pages: page, records, updated, complete: true };
  }
  // Explicit incomplete result; caller must not claim a complete snapshot.
  return { pages: maxPages, records, updated, complete: false };
}
