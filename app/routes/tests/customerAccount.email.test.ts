import {mockShopifyServer} from '#/test-utils';
import {vi} from 'vitest';
import {action} from '../customerAccount.emails';
import {CustomerSendEmailJob, jobs} from '~/jobs';

const {mockCustomerAccount} = mockShopifyServer();
const enqueueSpy = vi.spyOn(jobs, 'enqueue');

describe('customer account emails route', () => {
  it.each(['PAUSE', 'RESUME'])(
    'calls the customer send email job when receiving a %s request',
    async (operationName) => {
      mockCustomerAccount({
        sub: 'gid://shopify/Customer/2',
        dest: 'shop2.myshopify.io',
      });

      const mockRequest = {
        request: new Request('https://shopify-subscriptions-app.com', {
          method: 'POST',
          body: JSON.stringify({
            operationName,
            admin_graphql_api_id: 'gid://shopify/Customer/2',
          }),
        }),
        params: {},
        context: {},
      };
      const response = await action(mockRequest);

      expect(response.status).toBe(200);
      expect(enqueueSpy).toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          payload: {
            admin_graphql_api_customer_id: 'gid://shopify/Customer/2',
            admin_graphql_api_id: 'gid://shopify/Customer/2',
            emailTemplate:
              operationName === 'PAUSE'
                ? 'SUBSCRIPTION_PAUSED'
                : 'SUBSCRIPTION_RESUMED',
          },
          shop: 'shop2.myshopify.io',
        }),
      );
    },
  );

  it('throws an error when receiving an invalid operation name', async () => {
    mockCustomerAccount({
      sub: 'gid://shopify/Customer/2',
      dest: 'shop2.myshopify.io',
    });

    const mockRequest = {
      request: new Request('https://shopify-subscriptions-app.com', {
        method: 'POST',
        body: JSON.stringify({
          operationName: 'INVALID',
          admin_graphql_api_id: 'gid://shopify/Customer/2',
        }),
      }),
      params: {},
      context: {},
    };

    const response = await action(mockRequest);

    expect(response.status).toBe(500);
  });
});
