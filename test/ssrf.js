import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { afterEach, describe, it, mock } from "node:test";

import { isPrivateIp, isPrivateUrl, safeFetch } from "../lib/media/proxy.js";

const PUBLIC = "93.184.215.14";

/**
 * Stub DNS: every name resolves to the given addresses
 * @param {...string} addresses - IP addresses
 */
function resolveTo(...addresses) {
  mock.method(dns, "lookup", async () =>
    addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
  );
}

afterEach(() => mock.restoreAll());

describe("isPrivateIp", () => {
  it("blocks private and reserved ranges", () => {
    for (const ip of [
      "0.0.0.0", "10.1.2.3", "100.64.0.1", "100.100.100.200", "127.0.0.1",
      "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.170",
      "192.168.1.1", "198.18.0.1", "198.19.255.255", "224.0.0.1",
      "255.255.255.255", "::", "::1", "fc00::1", "fd12::1", "fe80::1",
      "febf::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe",
    ]) {
      assert.equal(isPrivateIp(ip), true, ip);
    }
  });

  it("allows public addresses", () => {
    for (const ip of [PUBLIC, "8.8.8.8", "100.63.255.255", "172.32.0.1", "2606:4700::1111"]) {
      assert.equal(isPrivateIp(ip), false, ip);
    }
  });
});

describe("isPrivateUrl", () => {
  it("blocks a name if any resolved address is private", async () => {
    resolveTo(PUBLIC, "10.0.0.5");
    assert.equal(await isPrivateUrl("https://mixed.example/"), true);
  });

  it("blocks IPv6 literals in brackets", async () => {
    assert.equal(await isPrivateUrl("http://[::1]/"), true);
    assert.equal(await isPrivateUrl("http://[::ffff:127.0.0.1]/"), true);
    assert.equal(await isPrivateUrl("http://[fd00::1]/"), true);
  });

  it("allows a name that resolves only to public addresses", async () => {
    resolveTo(PUBLIC);
    assert.equal(await isPrivateUrl("https://public.example/"), false);
  });
});

describe("safeFetch", () => {
  it("re-checks every redirect hop", async () => {
    resolveTo(PUBLIC);
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1:8080/admin" } }),
    );

    await assert.rejects(safeFetch("https://public.example/"), /private/);
    assert.equal(fetchMock.mock.callCount(), 1);
    assert.equal(fetchMock.mock.calls[0].arguments[1].redirect, "manual");
  });

  it("follows public redirects and stops after five", async () => {
    resolveTo(PUBLIC);
    let hop = 0;
    const fetchMock = mock.method(globalThis, "fetch", async () =>
      new Response(null, { status: 301, headers: { location: `/hop${++hop}` } }),
    );

    await assert.rejects(safeFetch("https://public.example/"), /redirects/);
    assert.equal(fetchMock.mock.callCount(), 6);
  });

  it("returns the final response", async () => {
    resolveTo(PUBLIC);
    const responses = [
      new Response(null, { status: 303, headers: { location: "https://other.example/b" } }),
      new Response("ok", { status: 200 }),
    ];
    const fetchMock = mock.method(globalThis, "fetch", async () => responses.shift());

    const response = await safeFetch("https://public.example/a", {
      method: "POST",
      body: "x=1",
    });
    assert.equal(await response.text(), "ok");
    const second = fetchMock.mock.calls[1].arguments;
    assert.equal(second[0], "https://other.example/b");
    assert.equal(second[1].method, "GET");
    assert.equal(second[1].body, undefined);
  });

  it("refuses a private first URL without fetching", async () => {
    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("x"));
    await assert.rejects(safeFetch("http://169.254.169.254/latest/meta-data"), /private/);
    assert.equal(fetchMock.mock.callCount(), 0);
  });
});

describe("media proxy signature", () => {
  it("does not accept signatures made with the old public fallback key", async () => {
    const crypto = await import("node:crypto");
    const { handleMediaProxy } = await import("../lib/media/proxy.js");
    const url = "https://public.example/a.png";
    const sig = crypto
      .createHmac("sha256", "microsub-default-secret")
      .update(url)
      .digest("hex")
      .slice(0, 16);

    const saved = process.env.SECRET;
    delete process.env.SECRET;
    let status;
    await handleMediaProxy(
      { query: { url, sig } },
      { status: (s) => ((status = s), { send() {} }) },
    );
    if (saved !== undefined) process.env.SECRET = saved;
    assert.equal(status, 403);
  });
});

it("blocks localhost spelled with a trailing dot", async () => {
  assert.equal(await isPrivateUrl("http://localhost./"), true);
});
