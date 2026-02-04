import path from 'path';
import { logger } from '../app/utils/logger.server';

// ——— helpers ———
export async function safeImport<T = any>(modulePath: string, name?: string): Promise<T | null> {
  try {
    const mod = await import(modulePath);
    return name ? mod[name] : mod.default || mod;
  } catch (err) {
    logger.error({ err, modulePath }, 'Failed to import module');
    return null;
  }
}

function parseJsonEnv<T = any>(name: string): T | null {
  const raw = process.env[name];
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.error({ err, raw, name }, 'Invalid JSON in env variable');
    return null;
  }
}


function getShopsFromEnv(): string[] | null {
  const raw = process.env.JOBS_SHOPS;
  if (!raw) return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function buildEnqueuePlan(runner: any) {
  // Dynamic imports for jobs
  const RecurringBillingChargeJob = await safeImport<any>(
    '../app/jobs/billing/RecurringBillingChargeJob',
    'RecurringBillingChargeJob',
  );
  const EnqueueAddFieldsToMetaobjectJob = await safeImport<any>(
    '../app/jobs/migrations/EnqueueAddFieldsToMetaobjectJob',
    'EnqueueAddFieldsToMetaobjectJob',
  );
  const DeleteBillingScheduleJob = await safeImport<any>(
    '../app/jobs/shop/DeleteBillingScheduleJob',
    'DeleteBillingScheduleJob',
  );
  const SendMonthlyInventoryFailureEmailJob = await safeImport<any>(
    '../app/jobs/email/SendMonthlyInventoryFailureEmailJob',
    'SendMonthlyInventoryFailureEmailJob',
  );
  const SendWeeklyInventoryFailureEmailJob = await safeImport<any>(
    '../app/jobs/email/SendWeeklyInventoryFailureEmailJob',
    'SendWeeklyInventoryFailureEmailJob',
  );
  const SendDailyInventoryFailureEmailJob = await safeImport<any>(
    '../app/jobs/email/SendDailyInventoryFailureEmailJob',
    'SendDailyInventoryFailureEmailJob',
  );
  const AddFieldsToMetaobjectJob = await safeImport<any>(
    '../app/jobs/migrations/AddFieldsToMetaobjectJob',
    'AddFieldsToMetaobjectJob',
  );
  const DisableShopJob = await safeImport<any>(
    '../app/jobs/shop/DisableShopJob',
    'DisableShopJob',
  );
  const SendInventoryFailureEmailJob = await safeImport<any>(
    '../app/jobs/email/SendInventoryFailureEmailJob',
    'SendInventoryFailureEmailJob',
  );
  const ScheduleShopsToChargeBillingCyclesJob = await safeImport<any>(
    '../app/jobs/billing/ScheduleShopsToChargeBillingCyclesJob',
    'ScheduleShopsToChargeBillingCyclesJob',
  );
  const TagSubscriptionOrderJob = await safeImport<any>(
    '../app/jobs/tags/TagSubscriptionOrderJob',
    'TagSubscriptionOrderJob',
  );
  const DunningStartJob = await safeImport<any>(
    '../app/jobs/dunning/DunningStartJob',
    'DunningStartJob',
  );
  const DunningStopJob = await safeImport<any>(
    '../app/jobs/dunning/DunningStopJob',
    'DunningStopJob',
  );
  const CreateSellingPlanTranslationsJob = await safeImport<any>(
    '../app/jobs/webhooks/CreateSellingPlanTranslationsJob',
    'CreateSellingPlanTranslationsJob',
  );
  const CustomerSendEmailJob = await safeImport<any>(
    '../app/jobs/email/CustomerSendEmailJob',
    'CustomerSendEmailJob',
  );
  const MerchantSendEmailJob = await safeImport<any>(
    '../app/jobs/email/MerchantSendEmailJob',
    'MerchantSendEmailJob',
  );

  // Newly added dynamic imports for previously skipped payload jobs
  const ChargeBillingCyclesJob = await safeImport<any>(
    '../app/jobs/billing/ChargeBillingCyclesJob',
    'ChargeBillingCyclesJob',
  );
  const RebillSubscriptionJob = await safeImport<any>(
    '../app/jobs/billing/RebillSubscriptionJob',
    'RebillSubscriptionJob',
  );

  // Env-driven payloads
  const CHARGE_PAYLOAD = parseJsonEnv('JOB_CHARGE_BILLING_PAYLOAD') ?? { targetDate: new Date().toISOString() };
  const REBILL_PAYLOAD  = parseJsonEnv('JOB_REBILL_SUBSCRIPTION_PAYLOAD') ?? { daysBack: 1 };

  // Get shops from env or other method
  const effectiveShops = ['scf26q-iq.myshopify.com'];

  const plans: Array<{ name: string; run: () => Promise<void> }> = [];

  // Plans without parameters
  if (EnqueueAddFieldsToMetaobjectJob) {
    plans.push({
      name: 'EnqueueAddFieldsToMetaobjectJob',
      run: async () => {
        await runner.enqueue(new EnqueueAddFieldsToMetaobjectJob({}));
      },
    });
  }
  if (DeleteBillingScheduleJob) {
    plans.push({
      name: 'DeleteBillingScheduleJob',
      run: async () => {
        await runner.enqueue(new DeleteBillingScheduleJob({}));
      },
    });
  }
  if (SendMonthlyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendMonthlyInventoryFailureEmailJob',
      run: async () => {
        await runner.enqueue(new SendMonthlyInventoryFailureEmailJob({}));
      },
    });
  }
  if (SendWeeklyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendWeeklyInventoryFailureEmailJob',
      run: async () => {
        await runner.enqueue(new SendWeeklyInventoryFailureEmailJob({}));
      },
    });
  }
  if (SendDailyInventoryFailureEmailJob) {
    plans.push({
      name: 'SendDailyInventoryFailureEmailJob',
      run: async () => {
        await runner.enqueue(new SendDailyInventoryFailureEmailJob({}));
      },
    });
  }

  // Per-shop plans
  for (const shop of effectiveShops) {
    if (RecurringBillingChargeJob) {
      plans.push({
        name: `RecurringBillingChargeJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new RecurringBillingChargeJob();
          (job as any).parameters = { shop };
          if (typeof job.perform === 'function') { await job.perform(); }
          else if (typeof job.run === 'function') { await job.run(); }
          else if (typeof job.execute === 'function') { await job.execute(); }
          else if (typeof job.handle === 'function') { await job.handle(); }
        }),
      });
    }
    if (AddFieldsToMetaobjectJob) {
      plans.push({
        name: `AddFieldsToMetaobjectJob [${shop}]`,
        run: async () => {
          await runner.enqueue(new AddFieldsToMetaobjectJob({ shop }));
        },
      });
    }
    if (DisableShopJob) {
      plans.push({
        name: `DisableShopJob [${shop}]`,
        run: async () => {
          await runner.enqueue(new DisableShopJob({ shop }));
        },
      });
    }
    if (SendInventoryFailureEmailJob) {
      plans.push({
        name: `SendInventoryFailureEmailJob [${shop}]`,
        run: async () => {
          await runner.enqueue(new SendInventoryFailureEmailJob({ shop }));
        },
      });
    }
  }

  // ScheduleShopsToChargeBillingCyclesJob with targetDate now
  if (ScheduleShopsToChargeBillingCyclesJob) {
    plans.push({
      name: 'ScheduleShopsToChargeBillingCyclesJob [now]',
      run: async () => {
        await runner.enqueue(
          new ScheduleShopsToChargeBillingCyclesJob({
            targetDate: new Date().toISOString(),
          }),
        );
      },
    });
  }

  // Per-shop plans for ChargeBillingCyclesJob with payload
  if (ChargeBillingCyclesJob) {
    for (const shop of effectiveShops) {
      plans.push({
        name: `ChargeBillingCyclesJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new ChargeBillingCyclesJob();
          (job as any).parameters = { shop, payload: CHARGE_PAYLOAD };
          if (typeof job.perform === 'function') { await job.perform(); }
          else if (typeof job.run === 'function') { await job.run(); }
          else if (typeof job.execute === 'function') { await job.execute(); }
          else if (typeof job.handle === 'function') { await job.handle(); }
        }),
      });
    }
  }

  // Per-shop plans for RebillSubscriptionJob with payload
  if (RebillSubscriptionJob) {
    for (const shop of effectiveShops) {
      plans.push({
        name: `RebillSubscriptionJob [${shop}]`,
        run: () => runner.enqueue(async () => {
          const job = new RebillSubscriptionJob();
          (job as any).parameters = { shop, payload: REBILL_PAYLOAD };
          if (typeof job.perform === 'function') { await job.perform(); }
          else if (typeof job.run === 'function') { await job.run(); }
          else if (typeof job.execute === 'function') { await job.execute(); }
          else if (typeof job.handle === 'function') { await job.handle(); }
        }),
      });
    }
  }

  // Skipped jobs (excluding ChargeBillingCyclesJob and RebillSubscriptionJob)
  const skippedNames = [
    TagSubscriptionOrderJob?.name,
    DunningStartJob?.name,
    DunningStopJob?.name,
    CreateSellingPlanTranslationsJob?.name,
    CustomerSendEmailJob?.name,
    MerchantSendEmailJob?.name,
  ].filter(Boolean);

  for (const name of skippedNames) {
    plans.push({
      name: `${name} [skipped: needs payload]`,
      run: async () => {
        logger.info(
          `Skip ${name}: requires payload (shop + payload). Provide a payload factory to enable.`,
        );
      },
    });
  }

  return plans;
}