import assert from "node:assert/strict";
import test from "node:test";
import { hasMeaningfulCompletedLeaderboard, historicalPlayerNameKey, historicalResultsCanFinalize, roundTotalToPar } from "../lib/completed-results.ts";

const completedRows = [
  { name: "Winner", position: 1, positionLabel: "1", total: "-12", thru: "F" },
  { name: "Runner Up", position: 2, positionLabel: "2", total: "-10", thru: "F" },
  { name: "Cut Player", position: null, positionLabel: "CUT", total: "+2", thru: "CUT" },
];

test("round totals use actual scores relative to each course par", () => {
  assert.equal(roundTotalToPar([{ score: 68, course_par: 72 }, { score: "70", course_par: "71" }, { score: 73, course_par: 72 }, { score: 69, course_par: 70 }]), -5);
  assert.equal(roundTotalToPar([{ score: 70, course_par: null }]), null);
  assert.equal(roundTotalToPar([]), null);
});

test("placeholder and incomplete completed leaderboards are rejected", () => {
  assert.equal(hasMeaningfulCompletedLeaderboard([
    { name: "A", position: 1, positionLabel: "T1", total: "E", thru: "F" },
    { name: "B", position: 1, positionLabel: "T1", total: "E", thru: "F" },
  ]), false);
  assert.equal(hasMeaningfulCompletedLeaderboard([{ name: "A", position: 1, positionLabel: "1", total: null, thru: "F" }]), false);
  assert.equal(hasMeaningfulCompletedLeaderboard([
    { name: "A", position: 1, positionLabel: "1", total: "-5", thru: "F" },
    { name: "B", position: null, positionLabel: "CUT", total: null, thru: "CUT" },
  ]), false);
});

test("historical event identity mismatches never finalize", () => {
  assert.equal(historicalResultsCanFinalize({ requestedEventId: "42", resultsEventId: "42", roundsEventId: "99", resultsEventName: "U.S. Open", roundsEventName: "U.S. Open", expectedEventName: "U.S. Open", rows: completedRows }), false);
  assert.equal(historicalResultsCanFinalize({ requestedEventId: "42", resultsEventId: "42", roundsEventId: "42", resultsEventName: "U.S. Open", roundsEventName: "The Open Championship", expectedEventName: "U.S. Open", rows: completedRows }), false);
});

test("matched, meaningful historical results can finalize", () => {
  assert.equal(historicalResultsCanFinalize({ requestedEventId: "42", resultsEventId: 42, roundsEventId: "42", resultsEventName: "Travelers Championship", roundsEventName: "Travelers Championship presented by Acme", expectedEventName: "Travelers Championship", rows: completedRows }), true);
});

test("completed results remain populated when provider player-name casing differs", () => {
  const rounds = new Map([
    [historicalPlayerNameKey("van Rooyen, Erik"), { total: 2, roundCount: 2 }],
  ]);
  const roundResult = rounds.get(historicalPlayerNameKey("Van Rooyen, Erik"));
  const rows = [
    ...completedRows.slice(0, 2),
    {
      name: "Erik Van Rooyen",
      position: null,
      positionLabel: "CUT",
      total: roundResult && roundResult.roundCount >= 2 ? `+${roundResult.total}` : null,
      thru: "CUT",
    },
  ];

  assert.equal(roundResult?.total, 2);
  assert.equal(historicalResultsCanFinalize({
    requestedEventId: "11",
    resultsEventId: 11,
    roundsEventId: "11",
    resultsEventName: "THE PLAYERS Championship",
    roundsEventName: "THE PLAYERS Championship",
    expectedEventName: "THE PLAYERS Championship",
    rows,
  }), true);
});
