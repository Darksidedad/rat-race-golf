import assert from "node:assert/strict";
import test from "node:test";
import { changedLeagueId, changedSessionId, shouldReconcileAfterSubscribe, shouldRunClientRefresh } from "../lib/refresh-reconciliation.ts";

test("client refreshes run only while visible and outside the dedup window", () => {
  assert.equal(shouldRunClientRefresh({ isVisible: true, now: 10_000, lastRefreshAt: undefined }), true);
  assert.equal(shouldRunClientRefresh({ isVisible: false, now: 10_000, lastRefreshAt: undefined }), false);
  assert.equal(shouldRunClientRefresh({ isVisible: true, now: 11_999, lastRefreshAt: 10_000 }), false);
  assert.equal(shouldRunClientRefresh({ isVisible: true, now: 12_000, lastRefreshAt: 10_000 }), true);
});

test("realtime payloads resolve inserted, updated, and deleted session ids", () => {
  assert.equal(changedSessionId({ new: { id: "new-session" }, old: {} }), "new-session");
  assert.equal(changedSessionId({ new: {}, old: { id: "deleted-session" } }), "deleted-session");
  assert.equal(changedSessionId({ new: null, old: null }), null);
});

test("league identity is available for inserts and updates but optional for deletes", () => {
  assert.equal(changedLeagueId({ new: { league_id: "league-one" }, old: {} }), "league-one");
  assert.equal(changedLeagueId({ new: {}, old: { id: "deleted-session" } }), null);
});

test("only a repeat subscribed status signals reconnect reconciliation", () => {
  assert.equal(shouldReconcileAfterSubscribe("SUBSCRIBED", false), false);
  assert.equal(shouldReconcileAfterSubscribe("SUBSCRIBED", true), true);
  assert.equal(shouldReconcileAfterSubscribe("CHANNEL_ERROR", true), false);
});
