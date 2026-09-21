import assert from "node:assert/strict";
import test from "node:test";
import { loginPathWithNext, sanitizeNextPath } from "../src/lib/auth/redirect.ts";

test("keeps internal paths for the post-login redirect", () => {
  assert.equal(sanitizeNextPath("/mypage?section=plan"), "/mypage?section=plan");
  assert.equal(
    sanitizeNextPath("/mypage?section=plan&plan=Starter"),
    "/mypage?section=plan&plan=Starter",
  );
  assert.equal(sanitizeNextPath("  /dashboard  "), "/dashboard");
});

test("drops external and malformed redirect targets", () => {
  assert.equal(sanitizeNextPath("//evil.example.com"), null);
  assert.equal(sanitizeNextPath("/\\evil.example.com"), null);
  assert.equal(sanitizeNextPath("https://evil.example.com"), null);
  assert.equal(sanitizeNextPath("mypage"), null);
  assert.equal(sanitizeNextPath(""), null);
  assert.equal(sanitizeNextPath(null), null);
});

test("builds the login link with an encoded return path", () => {
  assert.equal(
    loginPathWithNext("/mypage?section=plan&plan=Pro"),
    "/login?next=%2Fmypage%3Fsection%3Dplan%26plan%3DPro",
  );
  assert.equal(loginPathWithNext("https://evil.example.com"), "/login");
});
