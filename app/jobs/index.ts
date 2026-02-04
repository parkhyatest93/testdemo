import {config} from 'config';
import {logger} from '~/utils/logger.server';
import {
  CloudTaskScheduler,
  InlineScheduler,
  JobRunner,
  TestScheduler,
} from '~/lib/jobs';
import {CreateSellingPlanTranslationsJob} from './webhooks';
import {
  ChargeBillingCyclesJob,
  RebillSubscriptionJob,
  RecurringBillingChargeJob,
  ScheduleShopsToChargeBillingCyclesJob,
} from './billing';

import {DisableShopJob, DeleteBillingScheduleJob} from './shop';

import {
  AddFieldsToMetaobjectJob,
  EnqueueAddFieldsToMetaobjectJob,
} from './migrations';

import {DunningStartJob, DunningStopJob} from './dunning';
import {TagSubscriptionOrderJob} from './tags';
import {CustomerSendEmailJob, MerchantSendEmailJob} from './email';
import {SendWeeklyInventoryFailureEmailJob} from './email/SendWeeklyInventoryFailureEmailJob';
import {SendDailyInventoryFailureEmailJob} from './email/SendDailyInventoryFailureEmailJob';
import {SendMonthlyInventoryFailureEmailJob} from './email/SendMonthlyInventoryFailureEmailJob';
import {SendInventoryFailureEmailJob} from './email/SendInventoryFailureEmailJob';

export {
  ChargeBillingCyclesJob,
  RebillSubscriptionJob,
  RecurringBillingChargeJob,
  ScheduleShopsToChargeBillingCyclesJob,
} from './billing';
export {DisableShopJob, DeleteBillingScheduleJob} from './shop';

export {
  AddFieldsToMetaobjectJob,
  EnqueueAddFieldsToMetaobjectJob,
} from './migrations';

export {DunningStartJob, DunningStopJob} from './dunning';

export {TagSubscriptionOrderJob} from './tags';
export {CreateSellingPlanTranslationsJob} from './webhooks';

export {CustomerSendEmailJob, MerchantSendEmailJob} from './email';
export {SendMonthlyInventoryFailureEmailJob} from './email/SendMonthlyInventoryFailureEmailJob';
export {SendWeeklyInventoryFailureEmailJob} from './email/SendWeeklyInventoryFailureEmailJob';
export {SendDailyInventoryFailureEmailJob} from './email/SendDailyInventoryFailureEmailJob';
export {SendInventoryFailureEmailJob} from './email/SendInventoryFailureEmailJob';

export const jobs = (() => {
  switch (config.jobs.scheduler) {
    case 'INLINE':
      return new JobRunner<InlineScheduler>(
        new InlineScheduler(logger),
        logger,
      );
    case 'TEST':
      return new JobRunner<TestScheduler, Request>(
        new TestScheduler(logger),
        logger,
      );
    case 'CLOUD_TASKS':
      return new JobRunner<CloudTaskScheduler>(
        new CloudTaskScheduler(logger, config.jobs.config),
        logger,
      );
  }
})().register(
  DisableShopJob,
  EnqueueAddFieldsToMetaobjectJob,
  AddFieldsToMetaobjectJob,
  ChargeBillingCyclesJob,
  RecurringBillingChargeJob,
  ScheduleShopsToChargeBillingCyclesJob,
  RebillSubscriptionJob,
  DeleteBillingScheduleJob,
  DunningStartJob,
  DunningStopJob,
  CustomerSendEmailJob,
  MerchantSendEmailJob,
  SendMonthlyInventoryFailureEmailJob,
  SendWeeklyInventoryFailureEmailJob,
  SendDailyInventoryFailureEmailJob,
  SendInventoryFailureEmailJob,
  TagSubscriptionOrderJob,
  CreateSellingPlanTranslationsJob,
);
