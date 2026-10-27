import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { hasScope, requireScope } from "../lib/utils/auth.js";

/**
 * Run the middleware and report what it passed to `next`
 * @param {object} request - Fake Express request
 * @returns {unknown} Error given to `next`, or `undefined` if allowed
 */
function run(request) {
  let result = "not called";
  requireScope({ query: {}, body: {}, ...request }, {}, (error) => {
    result = error;
  });
  return result;
}

const api = (method, scope, parameters) => ({
  method,
  path: "/",
  session: { scope },
  ...(method === "GET" ? { query: parameters } : { body: parameters }),
});

describe("hasScope", () => {
  it("matches whole words only", () => {
    assert.equal(hasScope("read follow", "read"), true);
    assert.equal(hasScope("unfollow", "follow"), false);
    assert.equal(hasScope("readonly", "read"), false);
    assert.equal(hasScope("", "read"), false);
    assert.equal(hasScope(undefined, "read"), false);
  });
});

describe("requireScope", () => {
  it("refuses a media-only token on every action", () => {
    for (const request of [
      api("GET", "media", { action: "channels" }),
      api("GET", "media", { action: "timeline", channel: "x" }),
      api("POST", "media", { action: "channels", name: "Attacker" }),
      api("POST", "media", { action: "channels", method: "delete" }),
      api("POST", "media", { action: "follow", url: "https://a.example" }),
      api("POST", "media", { action: "search", query: "https://a.example" }),
      { method: "GET", path: "/reader/channels", session: { scope: "media" } },
      { method: "POST", path: "/reader/subscribe", session: { scope: "media" } },
    ]) {
      const error = run(request);
      assert.equal(error?.status, 403, `${request.method} ${request.path}`);
      assert.equal(error.code, "insufficient_scope");
    }
  });

  it("takes the action from the query string on POST too", () => {
    const request = api("POST", "read", {});
    request.query = { action: "channels" };
    assert.equal(run(request)?.status, 403);
  });

  it("maps each action to its Microsub scope", () => {
    assert.equal(run(api("GET", "read", { action: "timeline" })), undefined);
    assert.equal(run(api("POST", "read", { action: "timeline" })), undefined);
    assert.equal(run(api("POST", "read", { action: "preview" })), undefined);
    assert.equal(run(api("POST", "channels", { action: "channels" })), undefined);
    assert.equal(run(api("POST", "read", { action: "channels" }))?.status, 403);
    assert.equal(run(api("POST", "follow", { action: "unfollow" })), undefined);
    assert.equal(run(api("POST", "read", { action: "follow" }))?.status, 403);
    assert.equal(run(api("POST", "mute", { action: "unmute" })), undefined);
    assert.equal(run(api("POST", "block", { action: "block" })), undefined);
    assert.equal(run(api("POST", "mute", { action: "block" }))?.status, 403);
  });

  it("allows the owner's admin login session", () => {
    const scope = "create update delete media";
    assert.equal(run(api("POST", scope, { action: "timeline" })), undefined);
    assert.equal(run(api("POST", scope, { action: "channels" })), undefined);
    assert.equal(
      run({ method: "POST", path: "/reader/subscribe", session: { scope } }),
      undefined,
    );
  });

  it("does not treat a partial Micropub token as the owner", () => {
    assert.equal(run(api("GET", "create media", { action: "channels" }))?.status, 403);
  });
});
