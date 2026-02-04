import type pino from 'pino';
import SubscriptionContractResume from '~/graphql/SubscriptionContractResumeMutation';
import {jobs, CustomerSendEmailJob} from '~/jobs';
import type {GraphQLClient} from '~/types';
import {logger} from '~/utils/logger.server';

export class SubscriptionContractResumeService {
  private log: pino.Logger;

  constructor(
    private graphql: GraphQLClient,
    private shopDomain: string,
    private subscriptionContractId: string,
  ) {
    this.log = logger.child({shopDomain, subscriptionContractId});
  }

  async run(): Promise<void> {
    try {
      await this.resumeSubscriptionContract();
      this.log.info('SubscriptionContractResumeService completed successfully');
    } catch (error) {
      this.log.error(
        {error},
        `Failed to process SubscriptionContractResumeService`,
      );
      throw error;
    }
  }

  private async resumeSubscriptionContract() {
    const response = await this.graphql(SubscriptionContractResume, {
      variables: {
        subscriptionContractId: this.subscriptionContractId,
      },
    });

    const json = await response.json();
    const {data} = json;

    if (!data || !data.subscriptionContractActivate) {
      this.log.error(
        'Received invalid response from SubscriptionContractActivate mutation. Expected property `subscriptionContractActivate`, received ',
        json,
      );
      throw new Error(
        'Failed to resume subscription via subscriptionContractActivate',
      );
    }

    const {subscriptionContractActivate} = data;
    const {userErrors} = subscriptionContractActivate;

    if (userErrors.length !== 0) {
      this.log.error(
        {userErrors},
        'Failed to process SubscriptionContractResumeService',
      );
      throw new Error(
        'Failed to resume subscription via SubscriptionContractResumeService',
      );
    }

    if (subscriptionContractActivate.contract?.customer?.id) {
      this.log.info('Sending email for subscription resumed');
      jobs.enqueue(
        new CustomerSendEmailJob({
          payload: {
            admin_graphql_api_id: this.subscriptionContractId,
            admin_graphql_api_customer_id:
              subscriptionContractActivate.contract.customer.id,
            emailTemplate: 'SUBSCRIPTION_RESUMED',
          },
          shop: this.shopDomain,
        }),
      );
    }
  }
}
