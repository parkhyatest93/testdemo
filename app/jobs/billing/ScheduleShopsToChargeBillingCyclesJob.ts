import type {Jobs} from '~/types';
import {DateTime} from 'luxon';
import {Job} from '~/lib/jobs';
import {findActiveBillingSchedulesInBatches} from '~/models/BillingSchedule/BillingSchedule.server';
import {BillingScheduleCalculatorService} from '~/services/BillingScheduleCalculatorService';

export class ScheduleShopsToChargeBillingCyclesJob extends Job<Jobs.ScheduleShopsForBillingChargeParameters> {
  public queue: string = 'billing';

  async perform(): Promise<Jobs.ChargeBillingCyclesParameters[]> {
    const targetDateUtc = DateTime.fromISO(this.parameters.targetDate, {
      setZone: true,
    });
    const shopsToCharge: Jobs.ChargeBillingCyclesParameters[] = [];

    await findActiveBillingSchedulesInBatches(async (batch) => {
      this.logger.debug(`Processing batch of ${batch.length} records`);

      const results = batch
        .map(
          (billingSchedule) =>
            new BillingScheduleCalculatorService(
              billingSchedule,
              targetDateUtc,
            ),
        )
        .filter((calc) => calc.isBillable());

      this.logger.info(
        {
          targetDate: targetDateUtc.toISO(),
          billingScheduleCount: results.length,
        },
        `Found ${results.length} shops for billing in batch`,
      );

      for (const result of results) {
        const {
          billingStartTimeUtc,
          billingEndTimeUtc,
          record: billingSchedule,
        } = result;

        shopsToCharge.push({
          shop: billingSchedule.shop,
          payload: {
            startDate: billingStartTimeUtc.toISO() as string,
            endDate: billingEndTimeUtc.toISO() as string,
          },
        });
      }
    });

    this.logger.info(
      {shopsToCharge: shopsToCharge.length, targetDate: targetDateUtc.toISO()},
      'Processed shops for ScheduleShopsToChargeBillingCyclesJob',
    );

    return shopsToCharge;
  }
}