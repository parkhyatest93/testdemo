import {mockShopifyServer} from '#/test-utils';
import * as factories from '#/factories';
import {afterEach, describe, expect, it, afterAll, vi} from 'vitest';
import SubscriptionBillingCycleScheduleEdit from '~/graphql/SubscriptionBillingCycleScheduleEditMutation';
import {CustomerSendEmailService} from '../CustomerSendEmailService';
import {FinalAttemptDunningService} from '../FinalAttemptDunningService';
import {MerchantSendEmailService} from '../MerchantSendEmailService';
import {TEST_SHOP} from '#/constants';
import {CustomerSendEmailJob, jobs} from '~/jobs';

vi.mock('~/services/CustomerSendEmailService', async (importOriginal) => {
  const original: any = await importOriginal();
  const CustomerSendEmailService = vi.fn();
  CustomerSendEmailService.prototype.run = vi.fn().mockResolvedValue(undefined);

  return {...original, CustomerSendEmailService};
});

vi.spyOn(
  FinalAttemptDunningService.prototype as any,
  'cancelSubscriptionContract',
).mockResolvedValue(undefined);

vi.mock('~/services/MerchantSendEmailService', async (importOriginal) => {
  const original: any = await importOriginal();
  const MerchantSendEmailService = vi.fn();
  MerchantSendEmailService.prototype.run = vi.fn().mockResolvedValue(undefined);

  return {...original, MerchantSendEmailService};
});

const subscriptionContract = factories.contract.build();

function defaultGraphQLResponses() {
  return {
    SubscriptionContractCustomerQuery: {
      data: {
        subscriptionContract: {
          customer: {id: subscriptionContract.customer.id},
        },
      },
    },
    SubscriptionContractPause: {
      data: {
        subscriptionContractPause: {
          contract: {customer: {id: subscriptionContract.customer.id}},
        },
      },
    },
  };
}

function onFailureSkipGraphQLResponse() {
  return {
    SubscriptionContractCustomerQuery: {
      data: {
        subscriptionContract: {
          customer: {id: subscriptionContract.customer.id},
        },
      },
    },
    SubscriptionBillingCycleScheduleEdit: {
      data: {
        subscriptionBillingCycleScheduleEdit: {
          userErrors: [],
        },
      },
    },
  };
}

const {graphQL, mockGraphQL} = mockShopifyServer();

describe('FinalAttemptDunningService', () => {
  afterEach(() => {
    graphQL.mockRestore();
    vi.clearAllMocks();
  });

  describe('run', () => {
    afterAll(() => {
      vi.restoreAllMocks();
    });

    it('calls CustomerSendEmail and MerchantSendEmail mutation', async () => {
      mockGraphQL(defaultGraphQLResponses());

      const cancelSubscriptionContractMock = vi
        .spyOn(
          FinalAttemptDunningService.prototype as any,
          'cancelSubscriptionContract',
        )
        .mockResolvedValue(undefined);

      const finalAttemptDunningService = new FinalAttemptDunningService({
        shop: TEST_SHOP,
        subscriptionContract: subscriptionContract,
        billingCycleIndex: 1,
        onFailure: 'cancel',
        merchantEmailTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE__MERCHANT_',
        sendCustomerEmail: true,
      });

      await finalAttemptDunningService.run();

      expect(CustomerSendEmailService.prototype.run).toHaveBeenCalledWith(
        TEST_SHOP,
        subscriptionContract.customer.id,
        {
          subscriptionContractId: subscriptionContract.id,
          billingCycleIndex: 1,
          dunningStatus: 'CANCELED',
          subscriptionTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE',
        },
      );

      expect(MerchantSendEmailService.prototype.run).toHaveBeenCalledWith(
        TEST_SHOP,
        {
          subscriptionContractId: subscriptionContract.id,
          dunningStatus: 'CANCELED',
          subscriptionTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE__MERCHANT_',
        },
      );

      expect(cancelSubscriptionContractMock).toHaveBeenCalledOnce();
    });

    describe('with merchantEmailTemplateName set to SUBSCRIPTION_INVENTORY_FAILURE__MERCHANT_', () => {
      it('calls MerchantSendEmail with merchant inventory failure email template', async () => {
        mockGraphQL(defaultGraphQLResponses());

        const finalAttemptDunningService = new FinalAttemptDunningService({
          shop: TEST_SHOP,
          subscriptionContract: subscriptionContract,
          billingCycleIndex: 1,
          onFailure: 'cancel',
          merchantEmailTemplateName:
            'SUBSCRIPTION_INVENTORY_FAILURE__MERCHANT_',
          sendCustomerEmail: true,
        });

        await finalAttemptDunningService.run();

        expect(MerchantSendEmailService.prototype.run).not.toHaveBeenCalled();
      });
    });

    it('sends the payment failure email but not the regular customer pause email', async () => {
      mockShopifyServer();
      mockGraphQL(defaultGraphQLResponses());
      const enqueueSpy = vi.spyOn(jobs, 'enqueue');

      const pauseSubscriptionContractMock = vi.spyOn(
        FinalAttemptDunningService.prototype as any,
        'pauseSubscriptionContract',
      );

      const finalAttemptDunningService = new FinalAttemptDunningService({
        shop: TEST_SHOP,
        subscriptionContract: subscriptionContract,
        billingCycleIndex: 1,
        onFailure: 'pause',
        sendCustomerEmail: true,
        merchantEmailTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE__MERCHANT_',
      });

      await finalAttemptDunningService.run();

      expect(enqueueSpy).not.toHaveBeenCalledWith(
        new CustomerSendEmailJob({
          payload: {
            admin_graphql_api_id: subscriptionContract.id,
            admin_graphql_api_customer_id: subscriptionContract.customer.id,
            emailTemplate: 'SUBSCRIPTION_PAUSED',
          },
          shop: 'shop1.myshopify.io',
        }),
      );

      expect(CustomerSendEmailService.prototype.run).toHaveBeenCalledWith(
        TEST_SHOP,
        subscriptionContract.customer.id,
        {
          subscriptionContractId: subscriptionContract.id,
          billingCycleIndex: 1,
          dunningStatus: 'PAUSED',
          subscriptionTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE',
        },
      );

      expect(pauseSubscriptionContractMock).toHaveBeenCalledOnce();
    });

    it('calls SubscriptionBillingCycleScheduleEdit mutation if onFailure is skip', async () => {
      mockGraphQL(onFailureSkipGraphQLResponse());

      const billingCycleIndex = 1;
      const onFailure = 'skip';

      const finalAttemptDunningService = new FinalAttemptDunningService({
        shop: TEST_SHOP,
        subscriptionContract: subscriptionContract,
        billingCycleIndex: billingCycleIndex,
        onFailure: onFailure,
        merchantEmailTemplateName: 'SUBSCRIPTION_PAYMENT_FAILURE__MERCHANT_',
        sendCustomerEmail: true,
      });

      await finalAttemptDunningService.run();

      expect(graphQL).toHaveBeenNthCalledWith(
        2,
        SubscriptionBillingCycleScheduleEdit,
        {
          variables: {
            billingCycleInput: {
              contractId: 'gid://shopify/SubscriptionContract/1',
              selector: {
                index: billingCycleIndex,
              },
            },
            input: {
              reason: 'MERCHANT_INITIATED',
              skip: true,
            },
          },
        },
      );
    });
  });
});
