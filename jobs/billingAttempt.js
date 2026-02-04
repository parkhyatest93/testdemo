import dotenv from 'dotenv';
import axios from 'axios';
import cron from 'node-cron';

// بارگذاری اطلاعات از .env
dotenv.config();

const SHOPIFY_API_URL = 'https://devshop.minimeal.com/admin/api/2025-07/graphql.json';  // تغییر بده
// const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const SHOPIFY_ACCESS_TOKEN = "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";

// کران‌جاب هر 10 دقیقه اجرا می‌شود
cron.schedule('*/1 * * * *', async () => {
  console.log('Checking for due subscription contracts...');

  try {
    const contractsQuery = `
    query {
      subscriptionContracts(first: 100, query: "nextBillingDate<=now() AND status=ACTIVE") {
        edges {
          node {
            id
            status
            nextBillingDate
            customerPaymentMethodId
          }
        }
      }
    }
    `;

    const response = await axios.post(SHOPIFY_API_URL, { query: contractsQuery }, {
      headers: {
        'X-Shopify-Storefront-Access-Token': SHOPIFY_ACCESS_TOKEN,
        'Content-Type': 'application/json'
      }
    });

    const contracts = response.data.data.subscriptionContracts.edges;

    for (const contract of contracts) {
      const contractId = contract.node.id;
      const paymentMethodId = contract.node.customerPaymentMethodId;

      if (!paymentMethodId) {
        console.log(`Skipping contract ${contractId}, no payment method found.`);
        continue;
      }
      //mutation subscriptionBillingAttemptCreate($subscriptionContractId: ID!, $subscriptionBillingAttemptInput: SubscriptionBillingAttemptInput!) { subscriptionBillingAttemptCreate(subscriptionContractId: $subscriptionContractId, subscriptionBillingAttemptInput: $subscriptionBillingAttemptInput) { subscriptionBillingAttempt { id } userErrors { field message } } }
      const createBillingAttemptMutation = `
      mutation {
        subscriptionBillingAttemptCreate(
          subscriptionContractId: "${contractId}",
          subscriptionBillingAttemptInput: { idempotencyKey: "${contractId}:${contract.node.nextBillingDate}" }
        ) {
          subscriptionBillingAttempt {
            id
            order {
              id
              name
            }
            ready
            errorMessage
          }
          userErrors {
            field
            message
          }
        }
      }
      `;

      const billingAttemptResponse = await axios.post(SHOPIFY_API_URL, {
        query: createBillingAttemptMutation
      }, {
        headers: {
          'X-Shopify-Storefront-Access-Token': SHOPIFY_ACCESS_TOKEN,
          'Content-Type': 'application/json'
        }
      });

      const attemptData = billingAttemptResponse.data.data.subscriptionBillingAttemptCreate;

      if (attemptData.userErrors.length) {
        console.error(`Error creating billing attempt for ${contractId}: ${attemptData.userErrors[0].message}`);
        continue;
      }

      if (attemptData.subscriptionBillingAttempt.ready) {
        console.log(`Billing attempt successful for contract ${contractId}. Order created: ${attemptData.subscriptionBillingAttempt.order.name}`);
      } else {
        console.log(`Billing attempt for contract ${contractId} is pending.`);
      }
    }
  } catch (error) {
    console.error('Error in checking contracts or creating billing attempts:', error);
  }
});

console.log('Cron job started. Checking subscriptions every 1 minutes...');