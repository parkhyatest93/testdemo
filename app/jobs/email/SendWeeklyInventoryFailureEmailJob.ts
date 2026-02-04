import type {Jobs} from '~/types';
import {loadSettingsMetaobject} from '~/models/Settings/Settings.server';
import {unauthenticated} from '~/shopify.server';
import {findActiveBillingSchedulesInBatches} from '~/models/BillingSchedule/BillingSchedule.server';
import {isFulfilled} from '~/utils/typeGuards/promises';
import {Job} from '~/lib/jobs';

export class SendWeeklyInventoryFailureEmailJob extends Job<{}> {
  async perform(): Promise<string[]> {
    const shopsToEmail: string[] = [];

    await findActiveBillingSchedulesInBatches(async (batch) => {
      this.logger.info(
        `Processing SendWeeklyInventoryFailureEmailJob for ${batch.length} shops`,
      );

      const results = await Promise.allSettled(
        batch.map(async (billingSchedule) => {
          const {admin} = await unauthenticated.admin(billingSchedule.shop);
          const settings = await loadSettingsMetaobject(admin.graphql);

          if (!settings) {
            this.logger.error(
              {shopDomain: billingSchedule.shop},
              'Failed to load settings from metaobject for shop',
            );
            return false;
          }

          const isWeeklyNotificationFrequency: boolean =
            settings.inventoryNotificationFrequency === 'weekly';

          if (isWeeklyNotificationFrequency) {
            shopsToEmail.push(billingSchedule.shop);
            this.logger.info(
              {shop: billingSchedule.shop},
              'Shop added for weekly inventory failure email',
            );
            return true;
          }

          return false;
        }),
      );

      const startedJobsCount = results.filter(
        (result) => isFulfilled(result) && result.value,
      ).length;

      this.logger.info(
        {successCount: startedJobsCount, batchCount: results.length},
        'Processed shops for SendWeeklyInventoryFailureEmailJob',
      );
    });

    return shopsToEmail;
  }
}