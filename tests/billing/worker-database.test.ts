import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { retryAt } from "../../src/lib/billing/toss/domain.ts";

const workspace = "00000000-0000-0000-0000-000000000011";
const otherWorkspace = "00000000-0000-0000-0000-000000000012";
const user = "10000000-0000-0000-0000-000000000011";
const subscription = "20000000-0000-0000-0000-000000000011";
const method = "30000000-0000-0000-0000-000000000011";

test("worker hardening migration enforces backoff and circuit breakers", async (t) => {
  const db = new PGlite();
  const query = (sql: string, args: unknown[] = []) => db.query(sql, args);
  const scalar = async (sql: string, args: unknown[] = []) => {
    const result = await query(sql, args);
    return (result.rows[0] as Record<string, unknown>)?.value;
  };

  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create schema private; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create table public.workspaces(id uuid primary key);
  create table public.workspace_members(id uuid default gen_random_uuid(),workspace_id uuid references public.workspaces(id),user_id uuid references auth.users(id),role text,status text,created_at timestamptz default now());
  create function private.can_read_workspace(w uuid) returns boolean language sql security definer as $$select exists(select 1 from public.workspace_members where workspace_id=w and user_id=auth.uid() and status='active')$$;
  create table public.subscriptions(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),steppay_subscription_id text,plan_name text,monthly_fee numeric(12,2),included_tickets integer,status text,next_billing_date date,created_at timestamptz default now(),updated_at timestamptz default now());
  create table public.payment_methods(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),masked_number text,status text,created_at timestamptz default now());
  create table public.billing_events(id uuid primary key default gen_random_uuid(),workspace_id uuid not null references public.workspaces(id),subscription_id uuid,event_type text,status text,message text,created_at timestamptz default now());
  grant usage on schema public,auth,private to authenticated,service_role;
  grant select on public.workspace_members to authenticated,service_role;
  grant all on public.subscriptions,public.payment_methods,public.billing_events to anon,authenticated;`);

  for (const file of [
    "20260913062551_toss_billing_mvp.sql",
    "20260913132850_harden_toss_billing_workers.sql",
    "20260913154000_split_billing_failure_counters.sql",
  ])
    await db.exec(
      await readFile(
        new URL(`../../supabase/migrations/${file}`, import.meta.url),
        "utf8",
      ),
    );

  await query("insert into auth.users values($1)", [user]);
  await query("insert into workspaces values($1),($2)", [
    workspace,
    otherWorkspace,
  ]);
  await query(
    "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
    [workspace, user],
  );
  await query(
    "insert into subscriptions(id,workspace_id,monthly_fee,status,next_billing_date,enrollment_confirmed_at) values($1,$2,590000,'active','2026-09-01',now())",
    [subscription, workspace],
  );

  const registration = await scalar(
    "select billing_begin_registration($1,$2,'initial-hash','{\"version\":\"v1\",\"termsVersion\":\"v1\"}','{}') as value",
    [workspace, user],
  );
  await query(
    "update billing_registration_sessions set status='processing' where id=$1",
    [registration],
  );
  await query(
    "select billing_complete_registration($1,$2,$3,'ciphertext','v1','{\"maskedNumber\":\"****1234\"}')",
    [registration, user, method],
  );
  await query("update billing_runtime_settings set charges_enabled=true");
  await query(
    "update billing_profiles set auto_charge_enabled=true,billing_status='active' where workspace_id=$1",
    [workspace],
  );

  async function createInvoice(month: number) {
    const start = `2027-${String(month).padStart(2, "0")}-01`;
    const nextMonth = month + 1;
    const end = `2027-${String(nextMonth).padStart(2, "0")}-01`;
    return scalar(
      "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,$3,$3,$4,590000,'{}',$4,now()) returning id as value",
      [workspace, subscription, start, end],
    );
  }

  await t.test("active registration gets a stable conflict code", async () => {
    const pending = await scalar(
      "select billing_begin_registration($1,$2,'pending-hash','{\"version\":\"v1\",\"termsVersion\":\"v1\"}','{}') as value",
      [workspace, user],
    );
    await assert.rejects(
      () =>
        query(
          "select billing_begin_registration($1,$2,'duplicate-hash','{\"version\":\"v1\",\"termsVersion\":\"v1\"}','{}')",
          [workspace, user],
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /BILLING_REGISTRATION_IN_PROGRESS/);
        assert.equal(
          (error as Error & { code?: string }).code,
          "RB409",
        );
        return true;
      },
    );
    await query(
      "update billing_registration_sessions set status='failed' where id=$1",
      [pending],
    );
  });

  await t.test("pause immediately before dispatch adds a 30 minute backoff", async () => {
    const invoice = await createInvoice(1);
    const claimed = (await scalar(
      "select billing_claim_invoice($1) as value",
      [invoice],
    )) as Record<string, unknown>;
    await query("update billing_runtime_settings set charges_enabled=false");
    assert.equal(
      await scalar("select billing_authorize_attempt($1,$2) as value", [
        claimed.id,
        claimed.lease_token,
      ]),
      false,
    );
    assert.deepEqual(
      (
        await query(
          "select retry_count,technical_failure_count from billing_invoices where id=$1",
          [invoice],
        )
      ).rows[0],
      { retry_count: 0, technical_failure_count: 1 },
    );
    assert.equal(
      await scalar(
        "select next_attempt_at > now() + interval '29 minutes' as value from billing_invoices where id=$1",
        [invoice],
      ),
      true,
    );
    await query("update billing_runtime_settings set charges_enabled=true");
  });

  await t.test("an expired undispatched attempt is delayed before replacement", async () => {
    const invoice = await createInvoice(2);
    const claimed = (await scalar(
      "select billing_claim_invoice($1) as value",
      [invoice],
    )) as Record<string, unknown>;
    await query(
      "update payment_attempts set lease_until=now()-interval '1 second' where id=$1",
      [claimed.id],
    );
    assert.equal(
      await scalar("select billing_claim_reconciliation($1) as value", [
        claimed.id,
      ]),
      null,
    );
    assert.deepEqual(
      (
        await query(
          "select retry_count,technical_failure_count from billing_invoices where id=$1",
          [invoice],
        )
      ).rows[0],
      { retry_count: 0, technical_failure_count: 1 },
    );
    assert.equal(
      await scalar("select billing_claim_invoice($1) as value", [invoice]),
      null,
    );
  });

  await t.test("ten preflight failures stop automatic attempt creation", async () => {
    const invoice = await createInvoice(3);
    for (let index = 0; index < 10; index++) {
      await query(
        "update billing_invoices set status='payment_pending',next_attempt_at=now() where id=$1",
        [invoice],
      );
      const claimed = (await scalar(
        "select billing_claim_invoice($1) as value",
        [invoice],
      )) as Record<string, unknown>;
      assert.ok(claimed?.id);
      await query("select billing_defer_attempt($1,'TEST_PREFLIGHT')", [
        claimed.id,
      ]);
    }
    assert.deepEqual(
      (
        await query(
          "select status,retry_count,technical_failure_count,next_attempt_at from billing_invoices where id=$1",
          [invoice],
        )
      ).rows[0],
      {
        status: "failed",
        retry_count: 0,
        technical_failure_count: 10,
        next_attempt_at: null,
      },
    );
    assert.equal(
      await scalar("select status as value from subscriptions where id=$1", [
        subscription,
      ]),
      "active",
    );
    await query(
      "update billing_invoices set status='payment_pending',next_attempt_at=now() where id=$1",
      [invoice],
    );
    assert.equal(
      (
        await query(
          "select id from billing_due_invoice_ids(10) where id=$1",
          [invoice],
        )
      ).rows.length,
      0,
    );
    await query("update billing_invoices set status='failed' where id=$1", [
      invoice,
    ]);
    await query(
      "select billing_approve_arrears_retry($1,$2,'reviewed technical failures')",
      [invoice, user],
    );
    assert.deepEqual(
      (
        await query(
          "select retry_count,technical_failure_count from billing_invoices where id=$1",
          [invoice],
        )
      ).rows[0],
      { retry_count: 0, technical_failure_count: 0 },
    );
  });

  await t.test(
    "technical failures do not consume the customer retry schedule",
    async () => {
      const invoice = await createInvoice(5);
      for (let index = 0; index < 3; index++) {
        await query(
          "update billing_invoices set status='payment_pending',next_attempt_at=now() where id=$1",
          [invoice],
        );
        const claimed = (await scalar(
          "select billing_claim_invoice($1) as value",
          [invoice],
        )) as Record<string, unknown>;
        await query("select billing_defer_attempt($1,'TEST_PREFLIGHT')", [
          claimed.id,
        ]);
      }

      assert.deepEqual(
        (
          await query(
            "select retry_count,technical_failure_count from billing_invoices where id=$1",
            [invoice],
          )
        ).rows[0],
        { retry_count: 0, technical_failure_count: 3 },
      );

      await query(
        "update billing_invoices set status='payment_pending',next_attempt_at=now() where id=$1",
        [invoice],
      );
      const chargedAttempt = (await scalar(
        "select billing_claim_invoice($1) as value",
        [invoice],
      )) as Record<string, unknown>;
      assert.equal(
        await scalar("select billing_authorize_attempt($1,$2) as value", [
          chargedAttempt.id,
          chargedAttempt.lease_token,
        ]),
        true,
      );

      const customerRetryCount = Number(
        await scalar(
          "select retry_count as value from billing_invoices where id=$1",
          [invoice],
        ),
      );
      const retryAtFirstPolicyOffset = retryAt(
        { basis: "previous_failure", days: [1, 3, 5] },
        "2027-05-01",
        "2027-05-01T00:00:00.000Z",
        customerRetryCount,
      );
      assert.equal(
        retryAtFirstPolicyOffset,
        "2027-05-02T00:00:00.000Z",
      );

      await query(
        "select billing_record_failure($1,'retryable','NOT_ENOUGH_BALANCE','재시도 예정',$2)",
        [chargedAttempt.id, retryAtFirstPolicyOffset],
      );
      assert.deepEqual(
        (
          await query(
            "select status,retry_count,technical_failure_count from billing_invoices where id=$1",
            [invoice],
          )
        ).rows[0],
        {
          status: "payment_pending",
          retry_count: 1,
          technical_failure_count: 3,
        },
      );
    },
  );

  await t.test("billing event references cannot cross workspaces", async () => {
    const invoice = await createInvoice(6);
    await assert.rejects(
      () =>
        query(
          "insert into billing_events(workspace_id,invoice_id,event_type) values($1,$2,'invalid.cross_workspace')",
          [otherWorkspace, invoice],
        ),
      /foreign key/,
    );
  });
});
