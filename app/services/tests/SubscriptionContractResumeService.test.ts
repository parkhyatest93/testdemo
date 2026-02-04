import {mockShopifyServer} from '#/test-utils';
import {jobs, CustomerSendEmailJob} from '~/jobs';
import {describe, expect, afterEach, it, vi} from 'vitest';
import SubscriptionContractResumeMutation from '~/graphql/SubscriptionContractResumeMutation';
import {SubscriptionContractResumeService} from '../SubscriptionContractResumeService';

function defaultGraphQLResponses() {
  return {
    SubscriptionContractCustomerQuery: {
      data: {
        subscriptionContract: {
          customer: {
            id: 'gid://shopify/Customer/1',
          },
        },
      },
    },
    SubscriptionContractResume: {
      data: {
        subscriptionContractActivate: {
          contract: {
            id: 'gid://shopify/SubscriptionContract/1',
            customer: {
              id: 'gid://shopify/Customer/1',
            },
          },
          userErrors: [],
        },
      },
    },
  };
}

function errorGraphQLResponses() {
  return {
    SubscriptionContractCustomerQuery: {
      data: {
        subscriptionContract: {
          customer: {
            id: 'gid://shopify/Customer/1',
          },
        },
      },
    },
    SubscriptionContractResume: {
      data: {
        subscriptionContractActivate: {
          contract: {
            id: 'gid://shopify/SubscriptionContract/1',
            customer: {
              id: 'gid://shopify/Customer/1',
            },
          },
          userErrors: [
            {
              field: 'subscriptionContractId',
              message: 'Cannot resume contract',
            },
          ],
        },
      },
    },
  };
}

const subscriptionContractId = 'gid://shopify/SubscriptionContract/1';
const shopDomain = 'shop-example.myshopify.com';

const {graphQL, mockGraphQL} = mockShopifyServer();

describe('SubscriptionContractResumeService', () => {
  afterEach(() => {
    graphQL.mockRestore();
  });
  describe('when mutation is successful', () => {
    it('resumes a subscription contract', async () => {
      mockGraphQL(defaultGraphQLResponses());

      await new SubscriptionContractResumeService(
        graphQL,
        shopDomain,
        subscriptionContractId,
      ).run();

      expect(graphQL).toHavePerformedGraphQLOperation(
        SubscriptionContractResumeMutation,
        {
          variables: {
            subscriptionContractId,
          },
        },
      );
    });

    it('sends a customer email', async () => {
      mockGraphQL(defaultGraphQLResponses());
      const enqueueSpy = vi.spyOn(jobs, 'enqueue');

      await new SubscriptionContractResumeService(
        graphQL,
        shopDomain,
        subscriptionContractId,
      ).run();

      expect(enqueueSpy).toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          payload: {
            admin_graphql_api_id: subscriptionContractId,
            admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
            emailTemplate: 'SUBSCRIPTION_RESUMED',
          },
          shop: shopDomain,
        }),
      );
    });
  });

  describe('when mutation fails', () => {
    it('throws an error and does not send an email for invalid field', async () => {
      mockGraphQL(errorGraphQLResponses());
      const enqueueSpy = vi.spyOn(jobs, 'enqueue');

      const service = new SubscriptionContractResumeService(
        graphQL,
        shopDomain,
        'invalid-subscription-contract-id',
      );

      await expect(() => service.run()).rejects.toThrow(
        'Failed to resume subscription via SubscriptionContractResumeService',
      );

      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });
});
