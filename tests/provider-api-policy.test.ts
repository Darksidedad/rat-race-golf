import assert from "node:assert/strict";
import test from "node:test";
import { bearerToken, canonicalProviderOrigin, decideProviderCredential, providerResponseHeaders, quotaAllowsProviderCall } from "../lib/provider-api-policy.ts";

test("provider credential decisions fail closed", () => {
  assert.deepEqual(decideProviderCredential({ configured: false, internalCredentialMatches: false, authorization: null }), { kind: "misconfigured" });
  assert.deepEqual(decideProviderCredential({ configured: true, internalCredentialMatches: false, authorization: null }), { kind: "unauthenticated" });
  assert.deepEqual(decideProviderCredential({ configured: true, internalCredentialMatches: false, authorization: "Basic abc" }), { kind: "unauthenticated" });
});

test("internal and authenticated user credentials are distinguished", () => {
  assert.deepEqual(decideProviderCredential({ configured: true, internalCredentialMatches: true, authorization: null }), { kind: "internal" });
  assert.deepEqual(decideProviderCredential({ configured: true, internalCredentialMatches: false, authorization: "Bearer user-token" }), { kind: "user", token: "user-token" });
  assert.equal(bearerToken("bearer token-value"), "token-value");
});

test("provider calls proceed only after an explicit successful quota result", () => {
  assert.equal(quotaAllowsProviderCall({ allowed: true, error: null }), true);
  assert.equal(quotaAllowsProviderCall({ allowed: false, error: null }), false);
  assert.equal(quotaAllowsProviderCall({ allowed: true, error: { code: "rpc_failed" } }), false);
  assert.equal(quotaAllowsProviderCall({ allowed: "true", error: null }), false);
});

test("authenticated provider responses are private at the application boundary", () => {
  assert.deepEqual(providerResponseHeaders(), {
    "Cache-Control": "private, no-store, max-age=0",
    Vary: "Authorization, x-rrg-internal-key",
  });
});

test("refresh provider calls accept only configured canonical origins", () => {
  assert.equal(canonicalProviderOrigin("https://golf.example.com", true), "https://golf.example.com");
  assert.equal(canonicalProviderOrigin("https://golf.example.com/", true), "https://golf.example.com");
  assert.equal(canonicalProviderOrigin("http://localhost:3000", false), "http://localhost:3000");
  assert.equal(canonicalProviderOrigin("http://golf.example.com", true), null);
  assert.equal(canonicalProviderOrigin("https://golf.example.com/api", true), null);
  assert.equal(canonicalProviderOrigin(undefined, true), null);
});
