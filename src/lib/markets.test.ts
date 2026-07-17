import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_MARKETS, isSupportedMarket } from "./markets.js";

test("SUPPORTED_MARKETS is exactly [LB] today", () => {
  assert.deepEqual(SUPPORTED_MARKETS, ["LB"]);
});

test("isSupportedMarket accepts LB", () => {
  assert.equal(isSupportedMarket("LB"), true);
});

test("isSupportedMarket is case-sensitive -- rejects lb", () => {
  assert.equal(isSupportedMarket("lb"), false);
});

test("isSupportedMarket rejects an empty string", () => {
  assert.equal(isSupportedMarket(""), false);
});

test("isSupportedMarket rejects an unsupported real market code", () => {
  assert.equal(isSupportedMarket("US"), false);
  assert.equal(isSupportedMarket("AE"), false);
});

test("isSupportedMarket rejects a 3-letter code", () => {
  assert.equal(isSupportedMarket("USA"), false);
});

test("isSupportedMarket rejects non-string values", () => {
  assert.equal(isSupportedMarket(null), false);
  assert.equal(isSupportedMarket(undefined), false);
  assert.equal(isSupportedMarket(123), false);
  assert.equal(isSupportedMarket(["LB"]), false);
});
