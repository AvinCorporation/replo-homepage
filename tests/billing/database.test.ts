import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const wid = "00000000-0000-0000-0000-000000000001",
  other = "00000000-0000-0000-0000-000000000002",
  user = "10000000-0000-0000-0000-000000000001",
  sub = "20000000-0000-0000-0000-000000000001",
  method = "30000000-0000-0000-0000-000000000001";
let db: PGlite;
async function sql(s: string, args: unknown[] = []) {
  return db.query(s, args);
}
async function scalar(s: string, args: unknown[] = []) {
  const r = await sql(s, args);
  return (r.rows[0] as Record<string, unknown>)?.value;
}
test("migration and transactional billing invariants", async (t) => {
  db = new PGlite();
  // Minimal existing-main schema fixture. Real SQL functions, constraints and RLS run in PostgreSQL.
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
  create policy legacy_write on public.subscriptions for all to authenticated using(true) with check(true);
  grant all on public.subscriptions,public.payment_methods,public.billing_events to anon,authenticated;
  `);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260913062551_toss_billing_mvp.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await sql("insert into auth.users values($1)", [user]);
  await sql("insert into workspaces values($1),($2)", [wid, other]);
  await sql(
    "insert into workspace_members(workspace_id,user_id,role,status) values($1,$2,'owner','active')",
    [wid, user],
  );
  await sql(
    "insert into subscriptions(id,workspace_id,monthly_fee,status,next_billing_date,enrollment_confirmed_at) values($1,$2,590000,'active','2026-09-01',now())",
    [sub, wid],
  );
  await sql(
    "insert into subscriptions(workspace_id,monthly_fee) values($1,990000)",
    [other],
  );
  await t.test(
    "tenant RLS and browser writes / secrets / RPC forbidden",
    async () => {
      await sql("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec("set role authenticated");
      assert.equal(
        await scalar("select count(*)::int as value from subscriptions"),
        1,
      );
      for (const query of [
        "update subscriptions set monthly_fee=1",
        "insert into billing_events(workspace_id,event_type) values('" +
          wid +
          "','payment.succeeded')",
        "select * from billing_credentials",
        "select billing_pause_workspace('" + wid + "','tamper')",
      ])
        await assert.rejects(() => sql(query), /permission denied/);
      await db.exec("reset role");
    },
  );
  await t.test("cross-workspace foreign keys", async () => {
    await assert.rejects(
      () =>
        sql(
          "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date) values($1,$2,'2026-09-01','2026-09-01','2026-10-01',590000,'{}','2026-10-01')",
          [other, sub],
        ),
      /foreign key/,
    );
  });
  let session: string;
  await t.test(
    "consent and registration require current owner/admin",
    async () => {
      await assert.rejects(
        () =>
          sql("select billing_begin_registration($1,$2,'hash','{}','{}')", [
            other,
            user,
          ]),
        /BILLING_FORBIDDEN/,
      );
      session = (await scalar(
        'select billing_begin_registration($1,$2,\'hash\',\'{"version":"v1","termsVersion":"v1"}\',\'{}\') as value',
        [wid, user],
      )) as string;
      await sql(
        "update billing_registration_sessions set status='processing' where id=$1",
        [session],
      );
      await sql(
        "select billing_complete_registration($1,$2,$3,'ciphertext','v1','{\"maskedNumber\":\"****1234\"}')",
        [session, user, method],
      );
      assert.equal(
        await scalar(
          "select count(*)::int as value from billing_credentials where status='active'",
        ),
        1,
      );
    },
  );
  await t.test(
    "failed replacement rolls back prior card and credential",
    async () => {
      const second = await scalar(
        'select billing_begin_registration($1,$2,\'hash2\',\'{"version":"v1","termsVersion":"v1"}\',\'{}\') as value',
        [wid, user],
      );
      await sql(
        "update billing_registration_sessions set status='processing' where id=$1",
        [second],
      );
      await assert.rejects(
        () =>
          sql(
            "select billing_complete_registration($1,$2,gen_random_uuid(),null,'v1','{}')",
            [second, user],
          ),
        /null value/,
      );
      assert.equal(
        await scalar(
          "select id as value from payment_methods where is_default",
        ),
        method,
      );
      assert.equal(
        await scalar(
          "select status as value from billing_credentials where payment_method_id=$1",
          [method],
        ),
        "active",
      );
      await sql("update workspace_members set role='viewer' where user_id=$1", [
        user,
      ]);
      await assert.rejects(
        () =>
          sql(
            "select billing_complete_registration($1,$2,gen_random_uuid(),'cipher','v1','{}')",
            [second, user],
          ),
        /BILLING_FORBIDDEN/,
      );
      await sql("update workspace_members set role='owner' where user_id=$1", [
        user,
      ]);
    },
  );
  let invoice: string;
  let attempt: Record<string, unknown>;
  await t.test("invoice snapshot and duplicate claim", async () => {
    invoice = (await scalar(
      "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,'2026-09-01','2026-09-01','2026-10-01',590000,'{}','2026-10-01',now()) returning id as value",
      [wid, sub],
    )) as string;
    await sql("update subscriptions set monthly_fee=990000 where id=$1", [sub]);
    await assert.rejects(
      () =>
        sql("update billing_invoices set amount=990000 where id=$1", [invoice]),
      /immutable/,
    );
    await sql("update billing_runtime_settings set charges_enabled=true");
    await sql(
      "update billing_profiles set auto_charge_enabled=true,billing_status='active' where workspace_id=$1",
      [wid],
    );
    const claimed = await Promise.all([
      scalar("select billing_claim_invoice($1) as value", [invoice]),
      scalar("select billing_claim_invoice($1) as value", [invoice]),
    ]);
    assert.equal(claimed.filter(Boolean).length, 1);
    attempt = claimed.find(Boolean) as Record<string, unknown>;
    assert.equal(attempt.amount, 590000);
    assert.equal(
      await scalar("select billing_authorize_attempt($1,$2) as value", [
        attempt.id,
        attempt.lease_token,
      ]),
      true,
    );
    await assert.rejects(
      () =>
        sql("update payment_attempts set order_id='replacement' where id=$1", [
          attempt.id,
        ]),
      /immutable/,
    );
  });
  await t.test(
    "unknown never creates a new attempt; approval recovery idempotent",
    async () => {
      await sql(
        "select billing_record_failure($1,'unknown','TIMEOUT','결과 확인 중',null)",
        [attempt.id],
      );
      assert.equal(
        await scalar("select billing_claim_invoice($1) as value", [invoice]),
        null,
      );
      await sql(
        "select billing_record_success($1,'test-payment',590000,'2026-09-10T00:00:00Z',null)",
        [attempt.id],
      );
      await sql(
        "select billing_record_success($1,'test-payment',590000,'2026-09-10T00:00:00Z',null)",
        [attempt.id],
      );
      assert.equal(
        await scalar(
          "select status as value from billing_invoices where id=$1",
          [invoice],
        ),
        "paid",
      );
      assert.equal(
        await scalar(
          "select next_billing_date::text as value from subscriptions where id=$1",
          [sub],
        ),
        "2026-10-01",
      );
      assert.equal(
        await scalar(
          "select count(*)::int as value from billing_events where event_type='payment.succeeded'",
        ),
        1,
      );
      assert.equal(
        await scalar("select count(*)::int as value from payment_attempts"),
        1,
      );
    },
  );
  await t.test(
    "partial/full refunds are deduplicated separately from invoice cancellation",
    async () => {
      for (let n = 0; n < 2; n++)
        await sql(
          "select billing_record_cancellation($1,'cancel-1',100000,'DONE',now())",
          [attempt.id],
        );
      await sql(
        "select billing_record_cancellation($1,'cancel-2',490000,'DONE',now())",
        [attempt.id],
      );
      assert.equal(
        await scalar(
          "select sum(cancel_amount)::int as value from payment_cancellations",
        ),
        590000,
      );
      await assert.rejects(
        () =>
          sql(
            "select billing_record_cancellation($1,'cancel-3',1,'DONE',now())",
            [attempt.id],
          ),
        /EXCESS_CANCEL_AMOUNT/,
      );
      assert.equal(
        await scalar(
          "select status as value from billing_invoices where id=$1",
          [invoice],
        ),
        "paid",
      );
    },
  );
  await t.test(
    "pause immediately before dispatch blocks provider authorization",
    async () => {
      const inv = await scalar(
        "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,'2026-10-01','2026-10-01','2026-11-01',990000,'{}','2026-11-01',now()) returning id as value",
        [wid, sub],
      );
      const a = (await scalar("select billing_claim_invoice($1) as value", [
        inv,
      ])) as Record<string, unknown>;
      await sql("select billing_pause_workspace($1,'test pause')", [wid]);
      assert.equal(
        await scalar("select billing_authorize_attempt($1,$2) as value", [
          a.id,
          a.lease_token,
        ]),
        false,
      );
    },
  );
  await t.test(
    "all readable billing tables enforce tenant membership; every role is read-only",
    async () => {
      for (const role of ["owner", "admin", "editor", "viewer"]) {
        await sql("update workspace_members set role=$1 where user_id=$2", [
          role,
          user,
        ]);
        await db.exec("set role authenticated");
        for (const table of [
          "subscriptions",
          "payment_methods",
          "billing_invoices",
          "payment_attempts",
          "billing_events",
          "payment_cancellations",
        ]) {
          assert.equal(
            await scalar(
              `select count(*)::int as value from ${table} where workspace_id=$1`,
              [other],
            ),
            0,
          );
          await assert.rejects(
            () => sql(`delete from ${table}`),
            /permission denied/,
          );
        }
        await db.exec("reset role");
      }
      await sql("update workspace_members set role='owner' where user_id=$1", [
        user,
      ]);
      await db.exec("set role anon");
      await assert.rejects(
        () => sql("select * from subscriptions"),
        /permission denied/,
      );
      await db.exec("reset role");
      assert.equal(
        await scalar(
          "select count(*)::int as value from pg_proc where pronamespace='public'::regnamespace and proname like 'billing_%' and has_function_privilege('authenticated',oid,'EXECUTE')",
        ),
        0,
      );
    },
  );
  await t.test(
    "expired undispatched lease is fenced; retry uses a new identity and frozen amount",
    async () => {
      await sql(
        "update billing_profiles set auto_charge_enabled=true,billing_status='active' where workspace_id=$1",
        [wid],
      );
      const inv = await scalar(
        "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,'2026-12-01','2026-12-01','2027-01-01',990000,'{}','2027-01-01',now()) returning id as value",
        [wid, sub],
      );
      const first = (await scalar("select billing_claim_invoice($1) as value", [
        inv,
      ])) as Record<string, unknown>;
      await sql(
        "update payment_attempts set lease_until=now()-interval '1 second' where id=$1",
        [first.id],
      );
      assert.equal(
        await scalar("select billing_claim_reconciliation($1) as value", [
          first.id,
        ]),
        null,
      );
      assert.equal(
        await scalar("select billing_authorize_attempt($1,$2) as value", [
          first.id,
          first.lease_token,
        ]),
        false,
      );
      const second = (await scalar(
        "select billing_claim_invoice($1) as value",
        [inv],
      )) as Record<string, unknown>;
      assert.notEqual(first.order_id, second.order_id);
      assert.notEqual(first.idempotency_key, second.idempotency_key);
      await sql("select billing_authorize_attempt($1,$2)", [
        second.id,
        second.lease_token,
      ]);
      await sql(
        "select billing_record_failure($1,'retryable','NOT_ENOUGH_BALANCE','재시도 예정',now())",
        [second.id],
      );
      const third = (await scalar("select billing_claim_invoice($1) as value", [
        inv,
      ])) as Record<string, unknown>;
      assert.equal(third.amount, 990000);
      assert.notEqual(third.order_id, second.order_id);
      await sql("select billing_authorize_attempt($1,$2)", [
        third.id,
        third.lease_token,
      ]);
      await sql(
        "select billing_record_success($1,'test-retry-payment',990000,now(),null)",
        [third.id],
      );
      assert.equal(
        await scalar(
          "select status as value from billing_invoices where id=$1",
          [inv],
        ),
        "paid",
      );
    },
  );
  await t.test(
    "global DB kill switch blocks a claimed attempt before send",
    async () => {
      const inv = await scalar(
        "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,'2027-01-01','2027-01-01','2027-02-01',990000,'{}','2027-02-01',now()) returning id as value",
        [wid, sub],
      );
      const a = (await scalar("select billing_claim_invoice($1) as value", [
        inv,
      ])) as Record<string, unknown>;
      await sql("update billing_runtime_settings set charges_enabled=false");
      assert.equal(
        await scalar("select billing_authorize_attempt($1,$2) as value", [
          a.id,
          a.lease_token,
        ]),
        false,
      );
      assert.equal(
        (await sql("select * from billing_due_invoice_ids(2)")).rows.length,
        0,
      );
      await sql("update billing_runtime_settings set charges_enabled=true");
    },
  );
  await t.test(
    "generation verifies enrollment and price then atomically advances separate cursor",
    async () => {
      const policy = { vat: "included" };
      await sql(
        "update subscriptions set auto_charge_start_date='2026-09-01',first_period_start='2026-09-01',paid_through='2026-09-01',billing_policy=$1 where id=$2",
        [policy, sub],
      );
      const updated = await scalar(
        "select updated_at::text as value from subscriptions where id=$1",
        [sub],
      );
      const snapshot = {
        billing_date: "2027-02-01",
        period_start: "2027-02-01",
        period_end: "2027-03-01",
        amount: 990000,
        policy_snapshot: policy,
        next_billing_date: "2027-03-01",
        next_attempt_at: "2027-02-01T00:00:00+09:00",
      };
      assert.equal(
        await scalar("select billing_create_invoice($1,$2,$3) as value", [
          sub,
          updated,
          { ...snapshot, period_start: "2026-08-01" },
        ]),
        false,
      );
      await assert.rejects(
        () =>
          sql("select billing_create_invoice($1,$2,$3)", [
            sub,
            updated,
            { ...snapshot, amount: 1 },
          ]),
        /INVOICE_AMOUNT_MISMATCH/,
      );
      await assert.rejects(
        () =>
          sql("select billing_create_invoice($1,$2,$3)", [
            sub,
            updated,
            snapshot,
          ]),
        /BILLING_CONSENT_REQUIRED/,
      );
      await sql(
        "update billing_consents set conditions=$1 where registration_session_id=$2",
        [{ policy, amount: 990000 }, session!],
      );
      assert.equal(
        await scalar("select billing_create_invoice($1,$2,$3) as value", [
          sub,
          updated,
          snapshot,
        ]),
        true,
      );
      assert.equal(
        await scalar("select billing_create_invoice($1,$2,$3) as value", [
          sub,
          updated,
          snapshot,
        ]),
        false,
      );
      assert.equal(
        await scalar(
          "select invoice_generation_date::text as value from subscriptions where id=$1",
          [sub],
        ),
        "2027-03-01",
      );
      assert.equal(
        await scalar(
          "select next_billing_date::text as value from subscriptions where id=$1",
          [sub],
        ),
        "2027-01-01",
      );
    },
  );
  await db.close();
});
