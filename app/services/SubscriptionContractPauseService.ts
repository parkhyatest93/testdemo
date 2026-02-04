import type pino from 'pino';
import SubscriptionContractPause from '~/graphql/SubscriptionContractPauseMutation';
import {jobs, CustomerSendEmailJob} from '~/jobs';
import type {GraphQLClient} from '~/types';
import {logger} from '~/utils/logger.server';

export class SubscriptionContractPauseService {
  private log: pino.Logger;
  constructor(
    private graphql: GraphQLClient,
    private shopDomain: string,
    private subscriptionContractId: string,
    private sendCustomerEmail: boolean = true,
  ) {
    this.log = logger.child({shopDomain, subscriptionContractId});
  }

  async run(): Promise<void> {
    try {
      await this.pauseSubscriptionContract();
      this.log.info('SubscriptionContractPauseService completed successfully');
    } catch (error) {
      this.log.error(
        {error},
        `Failed to process SubscriptionContractPauseService`,
      );
      throw error;
    }
  }

  private async pauseSubscriptionContract() {
    const response = await this.graphql(SubscriptionContractPause, {
      variables: {
        subscriptionContractId: this.subscriptionContractId,
      },
    });

    const json = await response.json();
    const {data} = json;

    if (!data || !data.subscriptionContractPause) {
      this.log.error(
        'Received invalid response from SubscriptionContractPause mutation. Expected property `subscriptionContractPause`, received ',
        json,
      );
      throw new Error(
        'Failed to pause subscription via SubscriptionContractPause',
      );
    }

    const {subscriptionContractPause} = data;
    const {userErrors} = subscriptionContractPause;

    if (userErrors && userErrors.length !== 0) {
      this.log.error(
        {userErrors},
        'Failed to process SubscriptionContractPause',
      );
      throw new Error(
        'Failed to cancel subscription via SubscriptionContractPause',
      );
    }

    if (
      subscriptionContractPause.contract?.customer?.id &&
      this.sendCustomerEmail
    ) {
      jobs.enqueue(
        new CustomerSendEmailJob({
          payload: {
            admin_graphql_api_id: this.subscriptionContractId,
            admin_graphql_api_customer_id:
              subscriptionContractPause.contract.customer.id,
            emailTemplate: 'SUBSCRIPTION_PAUSED',
          },
          shop: this.shopDomain,
        }),
      );
    }
  }
}
