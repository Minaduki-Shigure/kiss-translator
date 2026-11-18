import assert from "node:assert/strict";

/** Tie Apple's acceptance to the exact submitted bytes, not just a UUID. */
export function validateNotaryLog(log, submission, codeHashes = []) {
  assert.equal(log.jobId, submission.id, "Notary log UUID mismatch");
  assert.equal(log.status, "Accepted", "Apple did not accept this archive");
  assert.equal(log.statusCode, 0, "Unexpected notary status code");
  assert.equal(
    log.archiveFilename,
    submission.archiveFilename,
    "Notary archive name mismatch"
  );
  assert.equal(
    log.sha256?.toLowerCase(),
    submission.sha256,
    "Notary archive digest mismatch"
  );
  assert.ok(
    Array.isArray(log.ticketContents) && log.ticketContents.length > 0,
    "Accepted log has no ticket contents"
  );
  for (const signature of codeHashes) {
    assert.ok(
      log.ticketContents.some(
        (ticket) =>
          ticket.cdhash?.toLowerCase() === signature.cdhash &&
          (!signature.architecture || ticket.arch === signature.architecture)
      ),
      `Notary log lacks expected code hash ${signature.cdhash} (${signature.architecture || "disk image"})`
    );
  }
  assert.ok(
    !log.issues?.some((issue) => issue.severity === "error"),
    "Notary log contains errors"
  );
}
