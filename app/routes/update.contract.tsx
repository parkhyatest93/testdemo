import { json, LoaderFunctionArgs } from "@remix-run/node";
import { ApiVersion, shopifyApi } from "@shopify/shopify-api";
import { sessionStorage } from "~/shopify.server";

const hostName = process.env.SHOPIFY_SHOP ;

// Resolving Shopify API core to send requests
function resolveCoreApi() {
  const core = (shopifyApi as any)?.api;
  if (core?.clients?.Graphql) return core;


  if (!process.env.SHOPIFY_API_KEY || !process.env.SHOPIFY_API_SECRET) {
    throw new Error("Missing SHOPIFY_API_KEY or SHOPIFY_API_SECRET in .env");
  }

  return shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY,
    apiSecretKey: process.env.SHOPIFY_API_SECRET,
    apiVersion: ApiVersion.July24,
    hostName
  });
}

// Get Admin Client for Shop based on Shopify session
async function getAdminClientForShop(shop: string) {
  const offlineId = `offline_${shop}`;
  let session = await sessionStorage.loadSession(offlineId);

  if (!session) {
    const list = await sessionStorage.findSessionsByShop(shop);
    if (list && list.length > 0) {
      session = list.find((s: any) => !s.isOnline) ?? list[0];
    }
  }

  if (!session?.accessToken) {
    throw new Error(`No valid offline app session found for shop ${shop}`);
  }

  const core = resolveCoreApi();
  const admin = new core.clients.Graphql({ session });
  return admin;
}

// GraphQL Mutation for updating subscription contract
const UPDATE_CONTRACT_MUTATION = `
mutation subscriptionContractUpdate($id: ID!) {
  subscriptionContractUpdate(id: $id) {
    subscriptionContract {
      id
      status
    }
    userErrors {
      field
      message
    }
  }
}`;
async function updateSubscriptionContract(shop: string, contractId: string) {
  const admin = await getAdminClientForShop(shop);

  const formattedContractId = contractId.startsWith("gid://")
    ? contractId
    : `gid://shopify/SubscriptionContract/${contractId}`;

  if (!formattedContractId.match(/^gid:\/\/shopify\/SubscriptionContract\/\d+$/)) {
    throw new Error(`Invalid contractId format: ${formattedContractId}`);
  }

  console.log("Sending mutation with:", { id: formattedContractId });

  const response = await admin.query({
    data: {
      query: UPDATE_CONTRACT_MUTATION,
      variables: {
        id: formattedContractId,
      },
    },
  });

  if (response.body.errors) {
    console.error("GraphQL errors:", response.body.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(response.body.errors)}`);
  }

  const { subscriptionDraft, userErrors } = response.body.data?.subscriptionContractUpdate || {};
  if (userErrors?.length > 0) {
    console.error("User errors:", userErrors);
    throw new Error(`User errors: ${JSON.stringify(userErrors)}`);
  }

  if (!subscriptionDraft) {
    throw new Error("No subscription draft returned");
  }

  return subscriptionDraft;
}

export async function action({ request }: LoaderFunctionArgs) {
  console.log("Received request to update subscription contract");

  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, { status: 405 });
  }

  const shop = process.env.SHOPIFY_SHOP;
  if (!shop) {
    return json({ error: "No shop defined" }, { status: 500 });
  }

  // Extract and log contractId
  const { contractId } = await request.json();
  console.log("Received input:", { contractId });

  if (!contractId) {
    return json({ error: "Missing contractId" }, { status: 400 });
  }

  try {
    const result = await updateSubscriptionContract(shop, contractId);
    return json({ message: "Subscription draft created successfully", result });
  } catch (error) {
    console.error("Error updating subscription contract:", error);
    return json(
      { error: `090Failed to update contract: ${error.message}` + contractId  +
           process.env.SHOPIFY_API_KEY + "|"
           + process.env.SHOPIFY_API_SECRET + "|"
           + ApiVersion.July24 + "|"
          + hostName
         },
      { status: 500 }
    );
  }
}