import {mockShopifyServer} from '#/test-utils';
import * as factories from '#/factories';
import type {DunningTracker} from '@prisma/client';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import prisma from '~/db.server';
import {RetryDunningService} from '~/services/RetryDunningService';
import {DunningService} from '../DunningService';
import {InventoryService} from '../InventoryService';
import {DateTime} from 'luxon';
import {jobs} from '~/jobs';
import {SendInventoryFailureEmailJob} from '~/jobs/email/SendInventoryFailureEmailJob';
import {setUpValidSession} from '#/utils/setup-valid-session';
import {sessionStorage} from '~/shopify.server';
import {TEST_SHOP} from '#/constants';
import {FinalAttemptDunningService} from '~/services/FinalAttemptDunningService';

vi.mock('~/services/RetryDunningService', async () => {
  const RetryDunningService = vi.fn();
  RetryDunningService.prototype.run = vi.fn().mockResolvedValue(undefined);

  return {RetryDunningService};
});

vi.mock('~/jobs', () => {
  const originalModule = vi.importActual('~/jobs');
  return {
    ...originalModule,
    jobs: {
      enqueue: vi.fn(),
    },
  };
});
const {mockGraphQL, graphQL} = mockShopifyServer();

describe('InventoryService', () => {
  beforeAll(async () => {
    await prisma.dunningTracker.deleteMany();
    await prisma.billingSchedule.deleteMany();
    await prisma.session.deleteMany();
    await setUpValidSession(sessionStorage);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await prisma.dunningTracker.deleteMany();
    await prisma.billingSchedule.deleteMany();
    await prisma.session.deleteMany();
    graphQL.mockRestore();
  });

  describe('run', () => {
    it('performs a final retry attempt on third of three attempts', async () => {
      mockGraphQL({
        SubscriptionContractCustomerQuery: {
          data: {
            subscriptionContract: {
              customer: {
                id: 'gid://shopify/Customer/1',
              },
            },
          },
        },
        MerchantSendEmail: {
          data: {
            merchantSendEmail: {
              success: true,
              userErrors: [],
            },
          },
        },
        SubscriptionBillingCycleScheduleEdit: {
          data: {
            subscriptionBillingCycleScheduleEdit: {
              billingCycle: {
                skipped: true,
              },
              userErrors: null,
            },
          },
        },
      });

      const contract = factories.contract.build();
      const billingCycle = factories.billingCycle.build(
        {},
        {transient: {billingAttemptsCount: 3}},
      );

      const settings = factories.settings.build({retryAttempts: 3});

      const inventoryService = new InventoryService({
        shopDomain: TEST_SHOP,
        contract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      const result = await inventoryService.run();

      expect(result).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
    });

    it('returns early if billing cycle already billed', async () => {
      const contract = factories.contract.build();
      const billingAttempt = factories.billingAttempt.build();

      const billingCycle = factories.billingCycle.build(
        {status: 'BILLED'},
        {transient: {billingAttempts: [billingAttempt]}},
      );

      const settings = factories.settings.build();

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract,
        billingCycle,
        settings,
        failureReason: 'CARD_EXPIRED',
      });

      const result = await inventoryService.run();

      expect(result).toEqual('BILLING_CYCLE_ALREADY_BILLED');
      expect(await prisma.dunningTracker.count()).toEqual(1);

      const tracker = await prisma.dunningTracker.findFirst();
      expect(tracker?.completedAt).not.toBeNull();
    });

    it('returns early if contract in terminal status', async () => {
      const contract = factories.contract.build({status: 'CANCELLED'});
      const billingAttempt = factories.billingAttempt.build();

      const billingCycle = factories.billingCycle.build(
        {},
        {transient: {billingAttempts: [billingAttempt]}},
      );

      const settings = factories.settings.build();

      const inventroyService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract,
        billingCycle,
        settings,
        failureReason: 'CARD_EXPIRED',
      });

      const result = await inventroyService.run();

      expect(result).toEqual('CONTRACT_IN_TERMINAL_STATUS');
      expect(await prisma.dunningTracker.count()).toEqual(1);

      const tracker = await prisma.dunningTracker.findFirst();
      expect(tracker?.completedAt).not.toBeNull();
    });

    it('returns early if billing attempt exepcted date is in future', async () => {
      const contract = factories.contract.build();
      const billingAttempt = factories.billingAttempt.build();

      const billingCycle = factories.billingCycle.build(
        {},
        {transient: {billingAttempts: [billingAttempt]}},
      );

      billingCycle['billingAttemptExpectedDate'] = DateTime.now()
        .plus({days: 5})
        .toISO();

      const settings = factories.settings.build();

      const inventroyService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract,
        billingCycle,
        settings,
        failureReason: 'CARD_EXPIRED',
      });

      const result = await inventroyService.run();

      expect(result).toEqual('EXPECTED_DATE_IN_FUTURE');
      expect(await prisma.dunningTracker.count()).toEqual(1);

      const tracker = await prisma.dunningTracker.findFirst();
      expect(tracker?.completedAt).not.toBeNull();
    });

    it('enqueues SendInventoryFailureEmailJob if inventory notification frequency is set to immediately', async () => {
      const enqueueSpy = vi.spyOn(jobs, 'enqueue');

      const subscriptionContract = factories.contract.build();
      const billingCycle = factories.billingCycle.build();
      const settings = factories.settings.build({
        inventoryNotificationFrequency: 'immediately',
      });

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract: subscriptionContract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      const result = await inventoryService.run();

      expect(enqueueSpy).toHaveBeenCalledWith(
        new SendInventoryFailureEmailJob({
          shop: 'example.myshopify.com',
          payload: {},
        }),
      );
      expect(result).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
    });

    it('performs a regular retry attempt on first of many retries', async () => {
      const subscriptionContract = factories.contract.build();
      const billingCycle = factories.billingCycle.build();
      // mock the return value of the RetryDunningService
      const settings = factories.settings.build();

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract: subscriptionContract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      const result = await inventoryService.run();

      expect(RetryDunningService.prototype.run).toHaveBeenCalledOnce();
      expect(result).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
    });

    it('performs a final attempt when inventory retry attempt is 0', async () => {
      const subscriptionContract = factories.contract.build();
      const billingCycle = factories.billingCycle.build();
      const settings = factories.settings.build({
        inventoryRetryAttempts: 0,
      });

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract: subscriptionContract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      const result = await inventoryService.run();

      expect(FinalAttemptDunningService.prototype.run).toHaveBeenCalledOnce();
      expect(result).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
    });

    it('performs retry attempt when inventory retry attempt is undefined', async () => {
      const subscriptionContract = factories.contract.build();
      const billingCycle = factories.billingCycle.build();
      const settings = factories.settings.build({
        inventoryRetryAttempts: undefined,
      });

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract: subscriptionContract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      const result = await inventoryService.run();

      expect(RetryDunningService.prototype.run).toHaveBeenCalledOnce();
      expect(result).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
    });

    it('creates a dunning tracker record on the first retry', async () => {
      const contract = factories.contract.build();
      const billingCycle = factories.billingCycle.build();
      const settings = factories.settings.build();

      const inventoryService = new InventoryService({
        shopDomain: 'example.myshopify.com',
        contract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      await inventoryService.run();

      expect(await prisma.dunningTracker.count()).toEqual(1);

      const tracker =
        (await prisma.dunningTracker.findFirst()) as DunningTracker;

      expect(tracker.shop).toEqual('example.myshopify.com');
      expect(tracker.contractId).toEqual(contract.id);
      expect(tracker.billingCycleIndex).toEqual(billingCycle.cycleIndex);
      expect(tracker.failureReason).toEqual('INVENTORY_ALLOCATIONS_NOT_FOUND');
      expect(tracker.completedAt).toBeNull();
    });

    it('updates the attempts count and marks tracker as completed', async () => {
      const contract = factories.contract.build();
      const billingCycle = factories.billingCycle.build(
        {},
        {transient: {billingAttemptsCount: 3}},
      );

      vi.mock('~/services/FinalAttemptDunningService', async () => {
        const actual = (await vi.importActual(
          '~/services/FinalAttemptDunningService',
        )) as any;

        const finalAttemptDunningService = vi.fn();
        finalAttemptDunningService.prototype.run = vi.fn();
        return {
          ...actual,
          FinalAttemptDunningService: finalAttemptDunningService,
        };
      });

      const settings = factories.settings.build({retryAttempts: 3});

      await factories.dunningTracker.create({
        shop: 'example.myshopify.com',
        contractId: contract.id,
        billingCycleIndex: billingCycle.cycleIndex,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      expect(await prisma.dunningTracker.count()).toEqual(1);

      const dunningService = new DunningService({
        shopDomain: 'example.myshopify.com',
        contract,
        billingCycle,
        settings,
        failureReason: 'INVENTORY_ALLOCATIONS_NOT_FOUND',
      });

      await dunningService.run();

      expect(await prisma.dunningTracker.count()).toEqual(1);
      const tracker =
        (await prisma.dunningTracker.findFirst()) as DunningTracker;

      expect(tracker.completedAt).not.toBeNull();
    });
  });
});
