import assert from "node:assert/strict";
import test from "node:test";

import {
  eventNamesMatch,
  leaderboardSessionStatus,
  recordsMatch,
  rowsHavePlayersOnCourse,
  totalsHavePlayersOnCourse,
} from "../lib/leaderboard-lifecycle.ts";

test("event names match across punctuation, sponsor suffixes, and containing names", () => {
  assert.equal(eventNamesMatch("U.S. Open", "u.s. open"), true);
  assert.equal(eventNamesMatch("Travelers Championship presented by Acme", "Travelers Championship"), true);
  assert.equal(eventNamesMatch("The Memorial Tournament", "Memorial Tournament"), true);
  assert.equal(eventNamesMatch("U.S. Open", "The Open Championship"), false);
  assert.equal(eventNamesMatch("", "U.S. Open"), false);
});

test("actively playing detection recognizes live holes and playoffs", () => {
  assert.equal(rowsHavePlayersOnCourse([
    { name: "A", position: 1, positionLabel: "1", total: "-4", thru: "Thru 7" },
  ]), true);
  assert.equal(rowsHavePlayersOnCourse([
    { name: "A", position: 1, positionLabel: "1", total: "-4", thru: " PLAYOFF 1 " },
  ]), true);
  assert.equal(rowsHavePlayersOnCourse([
    { name: "A", position: 1, positionLabel: "1", total: "-4", thru: "F" },
  ]), false);
  assert.equal(totalsHavePlayersOnCourse({ a: "-4||Thru 12||" }), true);
  assert.equal(totalsHavePlayersOnCourse({ a: "-4||Tee 8:10 AM CT||" }), false);
});

test("record comparison is independent of key insertion order and detects changes", () => {
  assert.equal(recordsMatch({ a: 1, b: null }, { b: null, a: 1 }), true);
  assert.equal(recordsMatch(undefined, {}), true);
  assert.equal(recordsMatch({ a: 1 }, { a: 2 }), false);
  assert.equal(recordsMatch({ a: "-4||F||" }, { a: "-4||Thru 17||" }), false);
});

test("leaderboard payload lifecycle derives draft, scored, and finalized statuses", () => {
  assert.equal(leaderboardSessionStatus({ notStarted: true }), "draft_complete");
  assert.equal(leaderboardSessionStatus({}), "scored");
  assert.equal(leaderboardSessionStatus({ finalized: true }), "finalized");
  assert.equal(leaderboardSessionStatus({ finalized: true, notStarted: true }), "finalized");
});
