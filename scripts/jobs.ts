// scripts/jobs.ts  (ESM)
// اجرای Jobها با InlineScheduler؛ manual (--once) یا cron (*/10)

import 'dotenv/config';
import cron from 'node-cron';
import { PrismaClient } from '@prisma/client';

import { logger as rootLogger } from '../app/utils/logger.server';
import { sessionStorage } from '../app/shopify.server';
import { ApiVersion, shopifyApi } from '@shopify/shopify-api';

const prisma = new PrismaClient();
const logger = rootLogger.child({ cron: 'jobs-runner' });

logger.info('🛠️ jobs.ts ready: inline runner active');

// ---- Inline lightweight scheduler/runner (بدون barrel) ----
class InlineSchedulerLite {
  async enqueue(fnOrPromise: (() => Promise<any>) | Promise<any>) {
    if (typeof fnOrPromise === 'function') return await fnOrPromise();
    return await fnOrPromise;
  }
}
class JobRunnerLite {
  private scheduler: InlineSchedulerLite;
  constructor(scheduler: InlineSchedulerLite) { this.scheduler = scheduler; }
  register(..._ctors: any[]) { return this; }
  enqueue(jobOrFn: any) {
    if (typeof jobOrFn === 'function') return this.scheduler.enqueue(jobOrFn);
    const job = jobOrFn;
    const fn =
      (typeof job?.perform === 'function' && job.perform.bind(job)) ||
      (typeof job?.run === 'function' && job.run.bind(job)) ||
      (typeof job?.execute === 'function' && job.execute.bind(job)) ||
      (typeof job?.handle === 'function' && job.handle.bind(job));
    if (!fn) throw new Error(`Unknown job API for ${job?.constructor?.name || 'job'}`);
    return this.scheduler.enqueue(() => fn());
  }
}
const scheduler = new InlineSchedulerLite();
const runner = new JobRunnerLite(scheduler).register();

// ---- Helpers ----
function parseCSV(v?: string | null): string[] {
  if (!v) return [];
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function resolveEffectiveShops(): string[] {
  const fromEnv = parseCSV(process.env.JOBS_SHOPS);
  if (fromEnv.length) {
    logger.info({ fromEnv }, 'Resolved effective shops from JOBS_SHOPS');
    return fromEnv;
  }
  const one = (process.env.SHOPIFY_SHOP || '').trim();
  if (one) {
    logger.info({ shop: one }, 'Resolved effective shop from SHOPIFY_SHOP');
    return [one];
  }
  // آخرین fallback — مطابق صراحت شما
  const fallback = 'scf26q-iq.myshopify.com';
  logger.warn({ fallback }, 'No JOBS_SHOPS / SHOPIFY_SHOP found; using hardcoded fallback');
  return [fallback];
}

async function safeImport<T = any>(path: string, exportName: string) {
  try {
    const mod = await import(path);
    const value = mod[exportName];
    if (!value) {
      logger.warn({ path, exportName }, 'Dynamic import succeeded but export not found');
      return undefined as unknown as T | undefined;
    }
    return value as T;
  } catch (err) {
    logger.error({ err, path, exportName }, 'Dynamic import failed; skipping related plans');
    return undefined as unknown as T | undefined;
  }
}

function resolveCoreApi() {
  const core = (shopifyApi as any)?.api;
  if (core?.clients?.Graphql) return core;

  const hostName = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || 'example.com')
    .replace(/^https?:\/\//, '');

  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    throw new Error('Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET in .env');
  }

  return shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY!,
    apiSecretKey: process.env.SHOPIFY_API_SECRET!,
    apiVersion: ApiVersion.July24, // نسخه پایدار
    hostName,
  });
}

async function getAdminClientForShop(shop: string) {
  const offlineId = `offline_${shop}`;
  let session = await sessionStorage.loadSession(offlineId);

  if (!session) {
    const list = await sessionStorage.findSessionsByShop(shop);
    if (list && list.length > 0) {
      session = list.find((s: any) => !s.isOnline) ?? list[0];
    }
  }

  if (!session?.accessToken) {
    throw new Error(`No valid offline app session found for shop ${shop}`);
  }

  const core = resolveCoreApi();
  const admin = new core.clients.Graphql({ session });
  return admin as InstanceType<typeof core.clients.Graphql>;
}

// ---- GraphQL ----
const GET_CONTRACTS_QUERY = `
  query getSubscriptionContracts($first: Int!, $after: String, $query: String) {
    subscriptionContracts(first: $first, after: $after, query: $query) {
      edges {
        node {
          id
          status
          nextBillingDate
           customerPaymentMethod {
            id
            revokedAt
          }
        }
        cursor
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

// گرفتن همه کانترکت‌ها با صفحه‌بندی از طریق GraphQL ادمین (offline session)
async function getAllContractsViaAdmin(shop: string, filter: string = 'status:ACTIVE'): Promise<{id: string; nextBillingDate?: string | null ,hasPaymentMethod: boolean}[]> {
  const admin = await getAdminClientForShop(shop);
  const items: {id: string; nextBillingDate?: string | null , hasPaymentMethod}[] = [];
  let after: string | null = null;
  const first = 100;

  while (true) {
    const resp: any = await (admin as any).query({
      data: {
        query: GET_CONTRACTS_QUERY,
        variables: { first, after, query: filter },
      },
    });

    const body = resp?.body;
    if (body?.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    const edges = body?.data?.subscriptionContracts?.edges || [];
    for (const e of edges) {
      const node = e?.node;
      const id = e?.node?.id;
      const nextBillingDate = e?.node?.nextBillingDate ?? null;
      const hasPaymentMethod =
        Boolean(node?.customerPaymentMethod?.id) &&
        !Boolean(node?.customerPaymentMethod?.revokedAt);

      if (id) items.push({ id, nextBillingDate, hasPaymentMethod });
    }
    const pageInfo = body?.data?.subscriptionContracts?.pageInfo;
    if (pageInfo?.hasNextPage && pageInfo?.endCursor) {
      after = pageInfo.endCursor;
    } else {
      break;
    }
  }

  return items;
}

// ---- Plans builder ----
async function buildEnqueuePlan() {
  const plans: { name: string; run: () => Promise<void> }[] = [];

  // Dynamic imports (بدون barrel)
  const RecurringBillingChargeJob = await safeImport<any>('../app/jobs/billing/RecurringBillingChargeJob', 'RecurringBillingChargeJob');
  const DeleteBillingScheduleJob = await safeImport<any>('../app/jobs/shop/DeleteBillingScheduleJob', 'DeleteBillingScheduleJob');
  const SendMonthlyInventoryFailureEmailJob = await safeImport<any>('../app/jobs/email/SendMonthlyInventoryFailureEmailJob', 'SendMonthlyInventoryFailureEmailJob');
  const SendDailyInventoryFailureEmailJob = await safeImport<any>('../app/jobs/email/SendDailyInventoryFailureEmailJob', 'SendDailyInventoryFailureEmailJob');
  const SendWeeklyInventoryFailureEmailJob = await safeImport<any>('../app/jobs/email/SendWeeklyInventoryFailureEmailJob', 'SendWeeklyInventoryFailureEmailJob');
  const DisableShopJob = await safeImport<any>('../app/jobs/shop/DisableShopJob', 'DisableShopJob');
  const SendInventoryFailureEmailJob = await safeImport<any>('../app/jobs/email/SendInventoryFailureEmailJob', 'SendInventoryFailureEmailJob');
  const ScheduleShopsToChargeBillingCyclesJob = await safeImport<any>('../app/jobs/billing/ScheduleShopsToChargeBillingCyclesJob', 'ScheduleShopsToChargeBillingCyclesJob');
  const ChargeBillingCyclesJob = await safeImport<any>('../app/jobs/billing/ChargeBillingCyclesJob', 'ChargeBillingCyclesJob');
  const RebillSubscriptionJob  = await safeImport<any>('../app/jobs/billing/RebillSubscriptionJob', 'RebillSubscriptionJob');

  // تابع برای ایجاد Billing Attempt
  async function createBillingAttempt(shop: string, subscriptionContractId: string, amount: number, currency: string) {
    const admin = await getAdminClientForShop(shop);

    const input = {
      subscriptionContractId,
      billingDate: new Date().toISOString(), // تاریخ فعلی برای billing
      amount,
      currencyCode: currency,  // ارز پرداخت
    };

    try {
      // ارسال درخواست به GraphQL API برای ایجاد billing attempt
      const response = await admin.query({
        data: {
          query: `
          mutation subscriptionBillingAttemptCreate($input: SubscriptionBillingAttemptInput!) {
            subscriptionBillingAttemptCreate(input: $input) {
              subscriptionContract {
                id
                status
              }
              userErrors {
                field
                message
              }
            }
          }
        `,
          variables: { input },
        },
      });

      const { userErrors } = response.body.data.subscriptionBillingAttemptCreate;

      if (userErrors.length > 0) {
        throw new Error(`Failed to create billing attempt: ${userErrors[0].message}`);
      }

      return response.body.data.subscriptionBillingAttemptCreate.subscriptionContract;
    } catch (error) {
      logger.error({ error, shop, subscriptionContractId }, 'Error creating billing attempt');
      throw error;
    }
  }

  // فقط از env (یا fallback) بخوان
  const effectiveShops = resolveEffectiveShops();

  // ===== بدون پارامتر =====
  if (RecurringBillingChargeJob) {
    plans.push({
      name: 'RecurringBillingChargeJob',
      run: () => runner.enqueue(() =>
        new RecurringBillingChargeJob().perform?.() ??
        new RecurringBillingChargeJob().run?.() ??
        Promise.resolve()
      ),
    });
  }
  if (SendMonthlyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendMonthlyInventoryFailureEmailJob',
      run: () => runner.enqueue(() =>
        new SendMonthlyInventoryFailureEmailJob().perform?.() ??
        new SendMonthlyInventoryFailureEmailJob().run?.() ?? Promise.resolve()
      ),
    });
  }
  // تاکید شما: حذف نکن — اضافه شد
  if (SendDailyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendDailyInventoryFailureEmailJob',
      run: () => runner.enqueue(() =>
        new SendDailyInventoryFailureEmailJob().perform?.() ??
        new SendDailyInventoryFailureEmailJob().run?.() ?? Promise.resolve()
      ),
    });
  }
  if (SendWeeklyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendWeeklyInventoryFailureEmailJob',
      run: () => runner.enqueue(() =>
        new SendWeeklyInventoryFailureEmailJob().perform?.() ??
        new SendWeeklyInventoryFailureEmailJob().run?.() ?? Promise.resolve()
      ),
    });
  }

  // ===== فقط shop =====
  for (const shop of effectiveShops) {
    if (DeleteBillingScheduleJob) {
      plans.push({
        name: `DeleteBillingScheduleJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new DeleteBillingScheduleJob();
          (job as any).parameters = { payload: { shop_domain: shop } };
          if (typeof job.perform === 'function') await job.perform();
          else if (typeof job.run === 'function') await job.run();
          else if (typeof job.execute === 'function') await job.execute();
          else if (typeof job.handle === 'function') await job.handle();
        }),
      });
    }
    if (DisableShopJob) {
      plans.push({
        name: `DisableShopJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new DisableShopJob();
          (job as any).parameters = { shop };
          if (typeof job.perform === 'function') await job.perform();
          else if (typeof job.run === 'function') await job.run();
          else if (typeof job.execute === 'function') await job.execute();
          else if (typeof job.handle === 'function') await job.handle();
        }),
      });
    }
    if (SendInventoryFailureEmailJob) {
      plans.push({
        name: `SendInventoryFailureEmailJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new SendInventoryFailureEmailJob();
          (job as any).parameters = { shop };
          if (typeof job.perform === 'function') await job.perform();
          else if (typeof job.run === 'function') await job.run();
          else if (typeof job.execute === 'function') await job.execute();
          else if (typeof job.handle === 'function') await job.handle();
        }),
      });
    }
  }

  // ===== زمان‌بندی آنی =====

  if (ScheduleShopsToChargeBillingCyclesJob) {
    plans.push({
      name: 'ScheduleShopsToChargeBillingCyclesJob [now]',
      run: () => runner.enqueue(async () => {
        const job = new ScheduleShopsToChargeBillingCyclesJob();

        // ✅ شکل صحیح: پارامتر را روی job.parameters بگذار، داخل payload
        (job as any).parameters = {
          payload: { targetDate: new Date().toISOString() },
        };

        if (typeof job.perform === 'function') await job.perform();
        else if (typeof job.run === 'function') await job.run();
        else if (typeof job.execute === 'function') await job.execute();
        else if (typeof job.handle === 'function') await job.handle();
      }),
    });
  }

  // ===== ChargeBillingCyclesJob =====
  if (ChargeBillingCyclesJob) {
    for (const shop of effectiveShops) {
      plans.push({
        name: `ChargeBillingCyclesJob [${shop}]`,
        run: async () => {
          let payload: any | null = null;

          // اگر خود جاب plan داشت از همون بخونیم
          try {
            if (typeof (ChargeBillingCyclesJob as any).plan === 'function') {
              const p = await (ChargeBillingCyclesJob as any).plan(shop);
              payload = p?.payload ?? null;
            } else {
              const inst = new (ChargeBillingCyclesJob as any)();
              if (typeof inst.plan === 'function') {
                const p = await inst.plan(shop);
                payload = p?.payload ?? null;
              }
            }
          } catch (err) {
            logger.error({ err, shop }, 'ChargeBillingCyclesJob.plan failed; will fallback');
          }

          // fallback: کانترکت‌ها از GraphQL ادمین (offline) — بدون نیاز به AccessToken
          if (!payload) {
            const contracts = await getAllContractsViaAdmin(shop, 'status:ACTIVE');
            const ids = contracts.map(c => c.id);
            const start = new Date().toISOString();
            const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            payload = { billingCycleIds: ids, startDate: start, endDate: end };
          }

          const job = new (ChargeBillingCyclesJob as any)();
          (job as any).parameters = { shop, payload };

          if (typeof job.perform === 'function') await job.perform();
          else if (typeof job.run === 'function') await job.run();
          else if (typeof job.execute === 'function') await job.execute();
          else if (typeof job.handle === 'function') await job.handle();
        },
      });
    }
  }

  // ===== CreateBillingAttemptJob =====
  // Job جدید برای ایجاد Billing Attempt
  class CreateBillingAttemptJob {
    async perform() {
      const effectiveShops = resolveEffectiveShops();
      for (const shop of effectiveShops) {
        const contracts = await getAllContractsViaAdmin(shop, 'status:ACTIVE');
        if (!contracts.length) {
          logger.warn({ shop }, 'No active subscription contracts found for billing attempt');
          continue;
        }

        for (const contract of contracts) {
          if (!contract.hasPaymentMethod) {
            logger.error({ shop, id: contract.id }, 'Skipping billing attempt: contract has no payment method');
            continue;
          }

          const amount = 100.00;  // فرض بر این است که مبلغ ثابت است
          const currency = 'USD'; // ارز پرداخت
          try {
            // فرض: createBillingAttempt باید تعریف شود یا import شود
            const result = await createBillingAttempt(shop, contract.id, amount, currency);
            logger.info({ shop, contractId: result.id }, 'Billing attempt created successfully');
          } catch (error) {
            logger.error({ shop, contractId: contract.id, error }, 'Failed to create billing attempt');
          }
        }
      }
    }
  }

  if (CreateBillingAttemptJob) {
    plans.push({
      name: 'CreateBillingAttemptJob',
      run: () => runner.enqueue(() =>
        new CreateBillingAttemptJob().perform?.() ??
        Promise.resolve()
      ),
    });
  }

  // ===== RebillSubscriptionJob (برای هر کانترکت جدا) =====
  if (RebillSubscriptionJob) {
    for (const shop of effectiveShops) {
      plans.push({
        name: `RebillSubscriptionJob [${shop}]`,
        run: async () => {
          const contracts = await getAllContractsViaAdmin(shop, 'status:ACTIVE');
          if (!contracts.length) {
            logger.warn({ shop }, 'No subscription contracts found; skipping RebillSubscriptionJob');
            return;
          }

          const now = new Date();
          const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

          for (const c of contracts) {
            if (!c.hasPaymentMethod) {
              logger.error(
                { shop, id: c.id },
                'Skipping rebill: contract has NO payment method (customer removed card)'
              );
              continue;
            }

            // اگر nextBillingDate خیلی جلوتر از 24 ساعت آینده است، طبق خطای Shopify اسکپ کن
            const nb = c.nextBillingDate ? new Date(c.nextBillingDate) : null;
            if (nb && nb > in24h) {
              logger.info({ shop, id: c.id, nextBillingDate: c.nextBillingDate }, 'Skipping rebill; nextBillingDate is more than 24h in the future');
              continue;
            }

            const ts = (nb ? nb : now).toISOString();

            const job = new (RebillSubscriptionJob as any)();
            (job as any).parameters = {
              shop,
              payload: {
                subscriptionContractId: c.id,
                subscriptionId: c.id,
                originTime: ts,
                targetDate: ts,
              },
            };
            if (typeof job.perform === 'function') await job.perform();
            else if (typeof job.run === 'function') await job.run();
            else if (typeof job.execute === 'function') await job.execute();
            else if (typeof job.handle === 'function') await job.handle();
          }
        },
      });
    }
  }

  return plans;
}

// ===== Runner =====
function parseListEnv(name: string): Set<string> | null {
  const raw = process.env[name];
  if (!raw) return null;
  const items = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return new Set(items);
}
function filterPlansByEnv(plans: { name: string; run: () => Promise<void> }[]) {
  const include = parseListEnv('JOBS_INCLUDE');
  const exclude = parseListEnv('JOBS_EXCLUDE');
  let out = plans;
  if (include && include.size > 0) {
    out = out.filter(p =>
      include.has(p.name) ||
      Array.from(include).some(i => i.endsWith('*') ? p.name.startsWith(i.slice(0, -1)) : false)
    );
  }
  if (exclude && exclude.size > 0) {
    out = out.filter(p =>
      !(exclude.has(p.name) ||
        Array.from(exclude).some(i => i.endsWith('*') ? p.name.startsWith(i.slice(0, -1)) : false))
    );
  }
  if (include || exclude) {
    logger.info(
      { include: include ? Array.from(include) : undefined,
        exclude: exclude ? Array.from(exclude) : undefined,
        before: plans.length, after: out.length },
      'Filtered plans by env'
    );
  }
  return out;
}

async function runAllJobsOnce() {
  const plansAll = await buildEnqueuePlan();
  const plans = filterPlansByEnv(plansAll);
  logger.info({ count: plans.length }, 'Enqueue plan built');
  logger.info({ plans: plans.map(p => p.name) }, 'Plans to run');
  for (const p of plans) {
    try {
      logger.info(`→ Running: ${p.name}`);
      await p.run();
      logger.info(`✓ Done: ${p.name}`);
    } catch (err) {
      console.error('RAW ERROR in job:', p.name, err);
      logger.error({ err }, `✗ Failed: ${p.name}`);
    }
  }
}

async function main() {
  await prisma.$connect();
  logger.info('✅ Prisma connected');

  const once = process.argv.includes('--once') || process.env.JOBS_RUN_ONCE === '1';
  if (once) {
    await runAllJobsOnce();
    logger.info('Manual runAllJobsOnce completed');
    process.exit(0);
  }

  if (process.env.CRON_DISABLED === '1') {
    logger.warn('CRON is disabled (CRON_DISABLED=1). Idling…');
    return;
  }

  logger.info('⏱️ Cron scheduled: */10 * * * * (every 10 minutes)');
  cron.schedule('*/10 * * * *', async () => {
    logger.info({ at: new Date().toISOString() }, 'Cron tick');
    await runAllJobsOnce();
  });
}

main().catch((err) => {
  logger.error({ err }, 'Boot failed');
  process.exit(1);
});