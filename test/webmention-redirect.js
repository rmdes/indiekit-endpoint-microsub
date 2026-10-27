import assert from "node:assert/strict";
import dnsCallback from "node:dns";
import dns from "node:dns/promises";
import http from "node:http";
import { after, before, it, mock } from "node:test";

import { verifyWebmention } from "../lib/webmention/verifier.js";

// Imports only verifyWebmention, so it also runs against the old guard
let internal;
let redirector;
let internalHits = 0;
let redirectorHits = 0;

const listen = (server) =>
  new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

before(async () => {
  internal = http.createServer((request, response) => {
    internalHits++;
    response.end('<a href="https://me.example/post">secret</a>');
  });
  redirector = http.createServer((request, response) => {
    redirectorHits++;
    response.writeHead(302, {
      location: `http://127.0.0.1:${internal.address().port}/admin`,
    });
    response.end();
  });
  await listen(internal);
  await listen(redirector);
});

after(() => {
  internal.close();
  redirector.close();
  mock.restoreAll();
});

it("does not follow a webmention source's redirect to loopback", async () => {
  // The guard's lookup sees a public address for the redirector, as it
  // would for an attacker's host; the connection itself reaches loopback
  mock.method(dns, "lookup", async (hostname, options) =>
    options?.all
      ? [{ address: "93.184.215.14", family: 4 }]
      : { address: "93.184.215.14", family: 4 },
  );

  mock.method(dnsCallback, "lookup", (hostname, options, callback) =>
    options?.all
      ? callback(null, [{ address: "127.0.0.1", family: 4 }])
      : callback(null, "127.0.0.1", 4),
  );

  const source = `http://redirector.test:${redirector.address().port}/`;
  const result = await verifyWebmention(source, "https://me.example/post");

  assert.equal(result.verified, false);
  assert.equal(redirectorHits, 1, "first hop was not fetched");
  assert.equal(internalHits, 0, "internal service was reached");
});
