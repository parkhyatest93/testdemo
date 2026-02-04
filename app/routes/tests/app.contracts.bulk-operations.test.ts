import {mockBulkOperations} from 'test/utils/mockBulkOperations';
import {mockShopifyServer} from '#/test-utils';
import {vi} from 'vitest';
import {action} from '../app.contracts.bulk-operation';
import {CustomerSendEmailJob, jobs} from '~/jobs';

const {mockPerformBulkMutation} = mockBulkOperations();
mockShopifyServer();

describe('app.contracts.bulk-operation', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends customer emails for each contract after pausing successfully', async () => {
    const enqueueSpy = vi.spyOn(jobs, 'enqueue');

    const contractIds = [
      'gid://shopify/SubscriptionContract/1',
      'gid://shopify/SubscriptionContract/2',
      'gid://shopify/SubscriptionContract/3',
    ];

    mockPerformBulkMutation(
      contractIds.map((id) => ({
        data: {
          subscriptionContractPause: {
            contract: {id, customer: {id: 'gid://shopify/Customer/1'}},
          },
        },
      })),
    );

    const formData = new FormData();
    formData.append('action', 'bulk-pause');
    formData.append('contracts', contractIds.join(','));

    const mockRequest = {
      request: new Request('https://shopify-subscriptions-app.com', {
        method: 'POST',
        body: formData,
      }),
      params: {},
      context: {},
    };

    const result = await action(mockRequest);

    contractIds.forEach((contractId) => {
      expect(enqueueSpy).toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          shop: 'shop1.myshopify.io',
          payload: {
            admin_graphql_api_id: contractId,
            admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
            emailTemplate: 'SUBSCRIPTION_PAUSED',
          },
        }),
      );
    });

    expect(result.status).toBe(200);
  });

  it('sends customer emails for each contract after resuming successfully', async () => {
    const enqueueSpy = vi.spyOn(jobs, 'enqueue');

    const contractIds = [
      'gid://shopify/SubscriptionContract/1',
      'gid://shopify/SubscriptionContract/2',
      'gid://shopify/SubscriptionContract/3',
    ];

    mockPerformBulkMutation(
      contractIds.map((id) => ({
        data: {
          subscriptionContractActivate: {
            contract: {id, customer: {id: 'gid://shopify/Customer/1'}},
          },
        },
      })),
    );

    const formData = new FormData();
    formData.append('action', 'bulk-activate');
    formData.append('contracts', contractIds.join(','));

    const mockRequest = {
      request: new Request('https://shopify-subscriptions-app.com', {
        method: 'POST',
        body: formData,
      }),
      params: {},
      context: {},
    };

    const result = await action(mockRequest);

    contractIds.forEach((contractId) => {
      expect(enqueueSpy).toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          shop: 'shop1.myshopify.io',
          payload: {
            admin_graphql_api_id: contractId,
            admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
            emailTemplate: 'SUBSCRIPTION_RESUMED',
          },
        }),
      );
    });

    expect(result.status).toBe(200);
  });

  it('send customer emails for partial success', async () => {
    const enqueueSpy = vi.spyOn(jobs, 'enqueue');

    const contractIds = [
      'gid://shopify/SubscriptionContract/1',
      'gid://shopify/SubscriptionContract/2',
      'gid://shopify/SubscriptionContract/3',
    ];

    const formData = new FormData();
    formData.append('action', 'bulk-pause');
    formData.append('contracts', contractIds.join(','));

    const mockRequest = {
      request: new Request('https://shopify-subscriptions-app.com', {
        method: 'POST',
        body: formData,
      }),
      params: {},
      context: {},
    };

    mockPerformBulkMutation([
      {
        data: {
          subscriptionContractPause: {
            contract: {
              id: 'gid://shopify/SubscriptionContract/1',
              customer: {id: 'gid://shopify/Customer/1'},
            },
          },
        },
      },
      {
        data: {
          subscriptionContractPause: {
            contract: {
              id: 'gid://shopify/SubscriptionContract/2',
              customer: {id: 'gid://shopify/Customer/1'},
            },
          },
        },
      },
      {
        data: {
          subscriptionContractPause: {
            contract: null,
          },
        },
      },
    ]);

    const result = await action(mockRequest);

    expect(result.status).toBe(200);

    expect(enqueueSpy).toHaveBeenCalledTimes(2);
  });
});
