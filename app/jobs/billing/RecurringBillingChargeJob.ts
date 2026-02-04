import type {Jobs} from '~/types';
import {DateTime} from 'luxon';
import {Job} from '~/lib/jobs';

export class RecurringBillingChargeJob extends Job<{}> {
  async perform(): Promise<Jobs.ScheduleShopsForBillingChargeParameters> {
    const targetDate = DateTime.utc().startOf('hour').toISO() as string;

    const params: Jobs.ScheduleShopsForBillingChargeParameters = {targetDate};

    this.logger.info(
      {params},
      `Preparing to schedule ScheduleShopsToChargeBillingCyclesJob for ${targetDate}`,
    );

    return params;
  }
}