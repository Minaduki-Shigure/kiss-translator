import test from "node:test";
import assert from "node:assert/strict";
import { validateNotaryLog } from "./notary-evidence.mjs";
const submission = {
  id: "20fdcd0c-c3aa-429e-b3e1-d5e0737cf53c",
  archiveFilename: "app-submission.zip",
  sha256: "d".repeat(64),
};
const accepted = {
  jobId: submission.id,
  archiveFilename: submission.archiveFilename,
  sha256: submission.sha256,
  status: "Accepted",
  statusCode: 0,
  ticketContents: [{ path: "Kiss Translator.app", cdhash: "example" }],
  issues: null,
};
test("acceptance is tied to exact submission identity and archive bytes", () => {
  assert.doesNotThrow(() => validateNotaryLog(accepted, submission));
  for (const patch of [
    { jobId: "different" },
    { archiveFilename: "another.zip" },
    { sha256: "e".repeat(64) },
    { status: "In Progress" },
    { status: "Invalid" },
    { statusCode: 4000 },
    { ticketContents: [] },
    { issues: [{ severity: "error" }] },
  ])
    assert.throws(() =>
      validateNotaryLog({ ...accepted, ...patch }, submission)
    );
});

test("tickets must include every signed architecture and the submitted image code hash", () => {
  const signatures = [
    { cdhash: "a".repeat(40), architecture: "arm64" },
    { cdhash: "b".repeat(40), architecture: "x86_64" },
  ];
  const log = {
    ...accepted,
    ticketContents: signatures.map(({ cdhash, architecture }) => ({
      cdhash,
      arch: architecture,
    })),
  };
  assert.doesNotThrow(() => validateNotaryLog(log, submission, signatures));
  assert.throws(() =>
    validateNotaryLog(
      { ...log, ticketContents: log.ticketContents.slice(0, 1) },
      submission,
      signatures
    )
  );
  assert.throws(() =>
    validateNotaryLog(log, submission, [{ cdhash: "c".repeat(40) }])
  );
});
