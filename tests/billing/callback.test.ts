import test from "node:test";
import assert from "node:assert/strict";
import { GET } from "../../src/app/mypage/billing/callback/route.ts";

test("billing callback stays isolated, branded and returns to the plan tab", async () => {
  const response = GET();
  const html = await response.text();
  const csp = response.headers.get("content-security-policy") ?? "";
  const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];

  assert.ok(nonce);
  assert.match(csp, new RegExp(`style-src 'nonce-${nonce}'`));
  assert.match(html, new RegExp(`<style nonce="${nonce}">`));
  assert.match(html, new RegExp(`<script nonce="${nonce}">`));
  assert.doesNotMatch(html, /<script[^>]+src=/);
  assert.match(html, /d\.error/);
  assert.match(html, /location\.replace\('\/mypage\?section=plan'\)/);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "no-store");
});
