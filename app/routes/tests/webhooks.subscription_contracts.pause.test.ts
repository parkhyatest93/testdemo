import {mockShopifyServer} from '#/test-utils';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {TEST_SHOP} from '#/constants';
import {action} from '../webhooks.subscription_contracts.pause';

const ACTION_REQUEST = {
  request: new Request('https://app.com'),
  params: {},
  context: {},
};

const {mockWebhook} = mockShopifyServer();

const subscriptionContractPayload = {
  admin_graphql_api_id: 'gid://shopify/SubscriptionContract/1',
  admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
  admin_graphql_api_origin_order_id: 'gid://shopify/Order/1',
};

describe('when webhook action is triggered', () => {
  afterEach(async () => {
    vi.resetAllMocks();
  });

  it('returns a 200 response', async () => {
    mockWebhook({
      shop: TEST_SHOP,
      topic: 'SUBSCRIPTION_CONTRACTS_PAUSE',
      payload: subscriptionContractPayload,
    });
    const response = await action(ACTION_REQUEST);

    expect(response.status).toBe(200);
  });
});
