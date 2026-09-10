import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { draftStatusAfterPickCount, snakeDraftPosition } from "../lib/draft-order.ts";

test("snake draft positions reverse on even rounds", () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, pickCount) => snakeDraftPosition(pickCount, 3)),
    [
      { pickNumber: 1, roundNumber: 1, teamIndex: 0 },
      { pickNumber: 2, roundNumber: 1, teamIndex: 1 },
      { pickNumber: 3, roundNumber: 1, teamIndex: 2 },
      { pickNumber: 4, roundNumber: 2, teamIndex: 2 },
      { pickNumber: 5, roundNumber: 2, teamIndex: 1 },
      { pickNumber: 6, roundNumber: 2, teamIndex: 0 },
      { pickNumber: 7, roundNumber: 3, teamIndex: 0 },
      { pickNumber: 8, roundNumber: 3, teamIndex: 1 },
    ],
  );
});

test("draft status follows the four-player roster rule", () => {
  assert.equal(draftStatusAfterPickCount(0, 3), "setup");
  assert.equal(draftStatusAfterPickCount(1, 3), "drafting");
  assert.equal(draftStatusAfterPickCount(11, 3), "drafting");
  assert.equal(draftStatusAfterPickCount(12, 3), "draft_complete");
});

test("invalid snake draft inputs fail closed", () => {
  assert.throws(() => snakeDraftPosition(-1, 3), RangeError);
  assert.throws(() => snakeDraftPosition(0, 0), RangeError);
  assert.throws(() => snakeDraftPosition(1.5, 3), RangeError);
});

test("draft integrity migration owns session lifecycle transitions", () => {
  const migration = readFileSync(new URL("../supabase-draft-pick-integrity.sql", import.meta.url), "utf8");

  assert.match(migration, /when next_pick_number >= ordered_team_count \* 4 then 'draft_complete'/);
  assert.match(migration, /else 'drafting'/);
  assert.match(migration, /status = 'drafting'/);
  assert.match(migration, /perform public\.submit_draft_pick\(target_session_id, player_name #>> '\{\}'\)/);
});

test("direct-write revocation is isolated to post-deploy hardening", () => {
  const additiveMigration = readFileSync(new URL("../supabase-draft-pick-integrity.sql", import.meta.url), "utf8");
  const hardeningMigration = readFileSync(new URL("../supabase-draft-pick-permission-hardening.sql", import.meta.url), "utf8");

  assert.doesNotMatch(additiveMigration, /revoke insert, delete on public\.draft_picks from authenticated/i);
  assert.match(hardeningMigration, /revoke insert, delete on public\.draft_picks from authenticated/i);
  assert.match(hardeningMigration, /only after the compatible application release is deployed/i);
});
