/**
 * Email sign-in: a link Resend didn't accept must be reported as a failure (server), and
 * the form must say "check your email" only when nothing went wrong (client). Pure.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import type { SignInMailer } from "../../lib/signin-email.ts";

const { SignInEmailError, sendSignInEmail } = await import("../../lib/signin-email.ts");
const { emailSignInOutcome } = await import("../../lib/signin-result.ts");

const LINK = "https://attnn.xyz/api/auth/callback/resend?token=secret-token-123&email=amina%40example.com";

function mailer(reply: (msg: Parameters<SignInMailer["emails"]["send"]>[0]) => ReturnType<SignInMailer["emails"]["send"]>) {
  const sent: Parameters<SignInMailer["emails"]["send"]>[0][] = [];
  const m: SignInMailer = { emails: { send: async (msg) => { sent.push(msg); return reply(msg); } } };
  return { m, sent };
}

describe("sendSignInEmail", () => {
  test("Resend accepts it: resolves, and the email carries the link", async () => {
    const { m, sent } = mailer(async () => ({ data: { id: "e1" }, error: null }));
    await sendSignInEmail(m, { to: "amina@example.com", url: LINK });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "amina@example.com");
    assert.equal(sent[0]!.from, "Attnn. <hello@attnn.xyz>");
    assert.ok(sent[0]!.html.includes(LINK) && sent[0]!.text.includes(LINK));
  });

  test("Resend returns an error (it doesn't throw): the send fails", async () => {
    const { m } = mailer(async () => ({ data: null, error: { name: "validation_error", message: "The attnn.xyz domain is not verified" } }));
    await assert.rejects(sendSignInEmail(m, { to: "amina@example.com", url: LINK }), (err: Error) => {
      assert.ok(err instanceof SignInEmailError);
      assert.match(err.message, /domain is not verified/);
      return true;
    });
  });

  test("Resend can't be reached: the send fails", async () => {
    const { m } = mailer(async () => { throw new TypeError("fetch failed"); });
    await assert.rejects(sendSignInEmail(m, { to: "amina@example.com", url: LINK }), SignInEmailError);
  });

  test("the error never contains the sign-in link, its token or the address", async () => {
    const echo = `Rejected ${LINK} for amina@example.com`; // a provider echoing the request back
    for (const reply of [async () => ({ error: { message: echo } }), async () => { throw new Error(echo); }]) {
      const { m } = mailer(reply as never);
      await assert.rejects(sendSignInEmail(m, { to: "amina@example.com", url: LINK }), (err: Error) => {
        assert.doesNotMatch(err.message, /secret-token-123|callback|amina/);
        return true;
      });
    }
  });
});

describe("emailSignInOutcome (what the form says)", () => {
  test("sent only when the request went through with no error", () => {
    assert.deepEqual(emailSignInOutcome({ ok: true, error: undefined }), { sent: true });
    assert.deepEqual(emailSignInOutcome({ ok: true, error: null }), { sent: true });
  });

  test("ok: true with an error is a failure (how next-auth v5 reports a failed send)", () => {
    for (const error of ["Configuration", "EmailSignInError", "AccessDenied"]) {
      const outcome = emailSignInOutcome({ ok: true, error });
      assert.equal(outcome.sent, false, error);
      if (!outcome.sent) assert.match(outcome.description, /wait a minute/);
    }
  });

  test("no answer or a failed request is a failure", () => {
    assert.equal(emailSignInOutcome(undefined).sent, false);
    assert.equal(emailSignInOutcome(null).sent, false);
    assert.equal(emailSignInOutcome({ ok: false }).sent, false);
  });
});
