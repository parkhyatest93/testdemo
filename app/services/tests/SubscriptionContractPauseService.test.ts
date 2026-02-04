import {mockShopifyServer} from '#/test-utils';
import {describe, expect, afterEach, it, vi} from 'vitest';
import SubscriptionContractPauseMutation from '~/graphql/SubscriptionContractPauseMutation';
import {SubscriptionContractPauseService} from '../SubscriptionContractPauseService';
import {CustomerSendEmailJob, jobs} from '~/jobs';

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
    SubscriptionContractPause: {
      data: {
        subscriptionContractPause: {
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
    SubscriptionContractPause: {
      data: {
        subscriptionContractPause: {
          contract: {
            id: 'gid://shopify/SubscriptionContract/1',
            customer: {
              id: 'gid://shopify/Customer/1',
            },
          },
          userErrors: [
            {
              field: 'subscriptionContractId',
              message: 'Cannot pause contract',
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

describe('SubscriptionContractPauseService', () => {
  afterEach(() => {
    graphQL.mockRestore();
    vi.restoreAllMocks();
  });
  describe('with a valid set of params', () => {
    it('pauses a subscription contract', async () => {
      mockGraphQL(defaultGraphQLResponses());

      await new SubscriptionContractPauseService(
        graphQL,
        shopDomain,
        subscriptionContractId,
      ).run();

      expect(graphQL).toHavePerformedGraphQLOperation(
        SubscriptionContractPauseMutation,
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

      await new SubscriptionContractPauseService(
        graphQL,
        shopDomain,
        subscriptionContractId,
      ).run();

      expect(enqueueSpy).toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          shop: shopDomain,
          payload: {
            admin_graphql_api_id: subscriptionContractId,
            admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
            emailTemplate: 'SUBSCRIPTION_PAUSED',
          },
        }),
      );
    });
  });

  describe('with an invalid set of params', () => {
    it('throws an error for invalid field', async () => {
      mockGraphQL(errorGraphQLResponses());

      const service = new SubscriptionContractPauseService(
        graphQL,
        shopDomain,
        'invalid-subscription-contract-id',
      );

      await expect(() => service.run()).rejects.toThrow(
        'Failed to cancel subscription via SubscriptionContractPause',
      );
    });

    it('throws an error and does not send an email for invalid field', async () => {
      mockGraphQL(errorGraphQLResponses());
      const enqueueSpy = vi.spyOn(jobs, 'enqueue');
      const service = new SubscriptionContractPauseService(
        graphQL,
        shopDomain,
        'invalid-subscription-contract-id',
      );

      await expect(() => service.run()).rejects.toThrow();

      expect(enqueueSpy).not.toHaveBeenCalled();
    });
  });
});
