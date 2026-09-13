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
const backupMethod = "30000000-0000-0000-0000-000000000012";

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
    "20260914010000_primary_backup_payment_methods.sql",
    "20260914020000_scheduled_plan_changes.sql",
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

  await t.test(
    "a second card stays backup and can be promoted without revoking the first",
    async () => {
      const secondRegistration = await scalar(
        "select billing_begin_registration($1,$2,'backup-hash','{\"version\":\"v1\",\"termsVersion\":\"v1\"}','{}') as value",
        [workspace, user],
      );
      await query(
        "update billing_registration_sessions set status='processing' where id=$1",
        [secondRegistration],
      );
      await query(
        "select billing_complete_registration($1,$2,$3,'backup-ciphertext','v1','{\"maskedNumber\":\"****5678\"}')",
        [secondRegistration, user, backupMethod],
      );

      assert.deepEqual(
        (
          await query(
            "select id,is_default,status from payment_methods where workspace_id=$1 and provider='toss' order by registered_at,id",
            [workspace],
          )
        ).rows,
        [
          { id: method, is_default: true, status: "active" },
          { id: backupMethod, is_default: false, status: "active" },
        ],
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) as value from billing_credentials where workspace_id=$1 and status='active'",
            [workspace],
          ),
        ),
        2,
      );

      await query(
        "select billing_set_default_payment_method($1,$2,$3)",
        [workspace, backupMethod, user],
      );
      assert.deepEqual(
        (
          await query(
            "select id,is_default from payment_methods where workspace_id=$1 and provider='toss' order by id",
            [workspace],
          )
        ).rows,
        [
          { id: method, is_default: false },
          { id: backupMethod, is_default: true },
        ],
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) as value from billing_operator_actions where workspace_id=$1 and action='primary_payment_method_changed'",
            [workspace],
          ),
        ),
        1,
      );
    },
  );

  await t.test("a third active Toss card is rejected before registration", async () => {
    await assert.rejects(
      () =>
        query(
          "select billing_begin_registration($1,$2,'third-hash','{\"version\":\"v1\",\"termsVersion\":\"v1\"}','{}')",
          [workspace, user],
        ),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /BILLING_PAYMENT_METHOD_LIMIT/);
        assert.equal((error as Error & { code?: string }).code, "RB429");
        return true;
      },
    );

    await assert.rejects(
      () =>
        query(
          "insert into payment_methods(id,workspace_id,provider,masked_number,status,is_default) values(gen_random_uuid(),$1,'toss','****9999','active',false)",
          [workspace],
        ),
      /BILLING_PAYMENT_METHOD_LIMIT/,
    );
  });

  await t.test("primary switching waits for an unresolved charge", async () => {
    const invoice = await createInvoice(8);
    const claimed = (await scalar(
      "select billing_claim_invoice($1) as value",
      [invoice],
    )) as Record<string, unknown>;
    assert.equal(claimed.payment_method_id, backupMethod);

    await assert.rejects(
      () =>
        query("select billing_set_default_payment_method($1,$2,$3)", [
          workspace,
          method,
          user,
        ]),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /BILLING_PAYMENT_IN_PROGRESS/);
        assert.equal((error as Error & { code?: string }).code, "RB423");
        return true;
      },
    );
    await query("select billing_defer_attempt($1,'TEST_CLEANUP')", [claimed.id]);
  });

  await t.test("pause immediately before dispatch adds a 30 minute backoff", async () => {
    const invoice = await createInvoice(1);
    const claimed = (await scalar(
      "select billing_claim_invoice($1) as value",
      [invoice],
    )) as Record<string, unknown>;
    assert.equal(claimed.payment_method_id, backupMethod);
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

  await t.test(
    "plan changes preserve old invoices and authorize the new monthly amount",
    async () => {
      const policy = {
        version: "v1",
        termsVersion: "v1",
        vat: "excluded",
        firstCharge: "contract_date",
        cardChangeArrears: "manual_approval",
        cancellationInstructions: "담당자 문의",
        retry: { basis: "billing_date", days: [1, 3, 5] },
      };
      await query(
        "update subscriptions set plan_name='Lite',monthly_fee=590000,included_tickets=200,billing_policy=$2,auto_charge_start_date='2026-09-01',first_period_start='2026-09-01',billing_anchor_day=1,enrollment_confirmed_at=null,updated_at=now() where id=$1",
        [subscription, JSON.stringify(policy)],
      );
      const oldInvoice = await scalar(
        "insert into billing_invoices(workspace_id,subscription_id,billing_date,period_start,period_end,amount,policy_snapshot,next_billing_date,next_attempt_at) values($1,$2,'2029-01-01','2029-01-01','2029-02-01',649000,$3,'2029-02-01',now()) returning id as value",
        [workspace, subscription, JSON.stringify(policy)],
      );
      const effectiveOn = String(
        await scalar(
          "select ((date_trunc('month',now() at time zone 'Asia/Seoul')+interval '1 month')::date)::text as value",
        ),
      );
      const conditions = (code: string, name: string, fee: number, tickets: number) => ({
        termsVersion: "v1",
        fromPlan: "Lite",
        planCode: code,
        planName: name,
        monthlyFee: fee,
        includedTickets: tickets,
        vat: "excluded",
        vatAmount: fee / 10,
        totalAmount: fee + fee / 10,
        effectiveOn,
      });

      await assert.rejects(
        () =>
          query(
            "select billing_schedule_plan_change($1,$2,$3,'Enterprise',$4,$5,$6)",
            [
              workspace,
              subscription,
              user,
              effectiveOn,
              JSON.stringify(policy),
              JSON.stringify({}),
            ],
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /BILLING_PLAN_REQUIRES_QUOTE/);
          assert.equal((error as Error & { code?: string }).code, "RB425");
          return true;
        },
      );

      await assert.rejects(
        () =>
          query(
            "select billing_schedule_plan_change($1,$2,$3,'Basic',$4,$5,$6)",
            [
              workspace,
              subscription,
              user,
              effectiveOn,
              JSON.stringify({
                ...policy,
                retry: { basis: "billing_date", days: [99] },
              }),
              JSON.stringify(conditions("Basic", "베이직", 990000, 500)),
            ],
          ),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /BILLING_PLAN_CONSENT_CHANGED/);
          assert.equal((error as Error & { code?: string }).code, "RB426");
          return true;
        },
      );

      const basicChange = await scalar(
        "select billing_schedule_plan_change($1,$2,$3,'Basic',$4,$5,$6) as value",
        [
          workspace,
          subscription,
          user,
          effectiveOn,
          JSON.stringify(policy),
          JSON.stringify(conditions("Basic", "베이직", 990000, 500)),
        ],
      );
      assert.deepEqual(
        (
          await query(
            "select plan_name,monthly_fee::integer as monthly_fee,included_tickets from subscriptions where id=$1",
            [subscription],
          )
        ).rows[0],
        { plan_name: "Lite", monthly_fee: 590000, included_tickets: 200 },
      );
      await assert.rejects(
        () =>
          query(
            "update subscription_plan_changes set consent_conditions='{}' where id=$1",
            [basicChange],
          ),
        /PLAN_CHANGE_CONSENT_IMMUTABLE/,
      );

      const proChange = await scalar(
        "select billing_schedule_plan_change($1,$2,$3,'Pro',$4,$5,$6) as value",
        [
          workspace,
          subscription,
          user,
          effectiveOn,
          JSON.stringify(policy),
          JSON.stringify(conditions("Pro", "프로", 1790000, 1000)),
        ],
      );
      assert.equal(
        await scalar(
          "select status as value from subscription_plan_changes where id=$1",
          [basicChange],
        ),
        "canceled",
      );
      assert.equal(
        Number(
          await scalar(
            "select count(*) as value from subscription_plan_changes where subscription_id=$1 and status='scheduled'",
            [subscription],
          ),
        ),
        1,
      );
      await query(
        "update subscription_plan_changes set status='canceled',canceled_at=now(),updated_at=now() where id=$1",
        [proChange],
      );
      const dueEffectiveOn = String(
        await scalar(
          "select ((now() at time zone 'Asia/Seoul')::date)::text as value",
        ),
      );
      const dueConditions = {
        ...conditions("Pro", "프로", 1790000, 1000),
        effectiveOn: dueEffectiveOn,
      };
      const appliedChange = await scalar(
        "insert into subscription_plan_changes(workspace_id,subscription_id,requested_by,from_plan_name,from_monthly_fee,from_included_tickets,to_plan_code,to_monthly_fee,to_included_tickets,billing_policy_snapshot,consent_conditions,effective_on) values($1,$2,$3,'Lite',590000,200,'Pro',1790000,1000,$4,$5,$6) returning id as value",
        [
          workspace,
          subscription,
          user,
          JSON.stringify(policy),
          JSON.stringify(dueConditions),
          dueEffectiveOn,
        ],
      );
      assert.equal(
        Number(
          await scalar(
            "select billing_apply_due_plan_changes(50) as value",
          ),
        ),
        1,
      );
      assert.deepEqual(
        (
          await query(
            "select plan_name,monthly_fee::integer as monthly_fee,included_tickets,billing_policy->>'vat' as vat,active_plan_change_id from subscriptions where id=$1",
            [subscription],
          )
        ).rows[0],
        {
          plan_name: "Pro",
          monthly_fee: 1790000,
          included_tickets: 1000,
          vat: "excluded",
          active_plan_change_id: appliedChange,
        },
      );
      assert.equal(
        Number(
          await scalar(
            "select amount as value from billing_invoices where id=$1",
            [oldInvoice],
          ),
        ),
        649000,
      );

      await query(
        "update subscriptions set enrollment_confirmed_at=now(),updated_at=now() where id=$1",
        [subscription],
      );
      const updatedAt = await scalar(
        "select updated_at as value from subscriptions where id=$1",
        [subscription],
      );
      assert.equal(
        await scalar(
          "select billing_create_invoice($1,$2,$3) as value",
          [
            subscription,
            updatedAt,
            JSON.stringify({
              billing_date: "2030-01-01",
              period_start: "2030-01-01",
              period_end: "2030-02-01",
              amount: 1969000,
              policy_snapshot: policy,
              next_billing_date: "2030-02-01",
              next_attempt_at: "2030-01-01T00:00:00+09:00",
            }),
          ],
        ),
        true,
      );
      assert.equal(
        Number(
          await scalar(
            "select amount as value from billing_invoices where subscription_id=$1 and period_start='2030-01-01'",
            [subscription],
          ),
        ),
        1969000,
      );
    },
  );
});
