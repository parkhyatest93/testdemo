import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import * as shopModule from "~/shopify.server";

/* ====================== helpers ====================== */
function safeBase64UrlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}
function extractShopFromBearer(auth: string) {
  const bearer = (auth || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const [, payload] = bearer.split(".");
  if (!payload) return null;
  const body = JSON.parse(safeBase64UrlDecode(payload));
  const dest = (body?.dest || "").replace(/^https?:\/\//, "");
  return dest.endsWith(".myshopify.com") ? dest : null;
}
function resolveSessionStorage() {
  const m: any = shopModule;
  const s = m.sessionStorage ?? m.shopify?.sessionStorage ?? m.api?.sessionStorage;
  if (!s) throw new Error("Cannot resolve sessionStorage from ~/shopify.server");
  return s;
}
async function getOfflineAccessToken(shop: string): Promise<string> {
  const s = resolveSessionStorage();
  const sessions =
    typeof s.findSessionsByShop === "function"
      ? await s.findSessionsByShop(shop)
      : await s.findSessionsByShopId(shop);
  if (!sessions?.length) throw new Error(`No app session for ${shop}`);
  const offline = sessions.find((x: any) => !x.isOnline) ?? sessions[0];
  if (!offline?.accessToken) throw new Error("No offline access token");
  return offline.accessToken as string;
}
async function adminGraphqlFetch(
  shop: string,
  token: string,
  query: string,
  variables?: any
) {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

/* ====================== GraphQL ====================== */
const MUT_GROUP_CREATE = `
mutation ($input: SellingPlanGroupInput!) {
  sellingPlanGroupCreate(input: $input) {
    sellingPlanGroup {
      id
      name
      appId
      sellingPlans(first: 10) {
        edges {
          node {
            id
            name
            billingPolicy {
              __typename
              ... on SellingPlanRecurringBillingPolicy {
                interval
                intervalCount
              }
            }
            deliveryPolicy {
              __typename
              ... on SellingPlanRecurringDeliveryPolicy {
                interval
                intervalCount
              }
            }
            pricingPolicies { __typename }
          }
        }
      }
    }
    userErrors { field message }
  }
}
`;

const MUT_GROUP_ADD_VARIANTS = `
mutation ($id: ID!, $variantIds: [ID!]!) {
  sellingPlanGroupAddProductVariants(id: $id, productVariantIds: $variantIds) {
    sellingPlanGroup { id }
    userErrors { field message }
  }
}
`;

const Q_GROUP_APP = `
query ($id: ID!) {
  sellingPlanGroup(id: $id) {
    id
    name
    appId
    sellingPlans(first: 10) { edges { node { id name } } }
  }
}
`;

/* ====================== types ====================== */
type Body = {
  groupName?: string;        // internal group name
  variantIds: string[];      // ["gid://shopify/ProductVariant/..."]
  everyDays?: number;        // default 28
  discountPercent?: number;  // default 20
  purchaseOptionTitle?: string; // optional override for options.option1
};

/* ====================== handlers ====================== */
export async function loader() {
  return new Response("Method Not Allowed", { status: 405 });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const auth = request.headers.get("authorization") || "";
    const shop = extractShopFromBearer(auth);
    if (!shop) return json({ error: "Missing/invalid bearer" }, { status: 401 });

    const {
      groupName,
      variantIds,
      everyDays = 28,
      discountPercent = 20,
      purchaseOptionTitle,
    } = (await request.json()) as Body;

    if (!variantIds?.length) {
      return json({ error: "variantIds is required (array of GIDs)" }, { status: 400 });
    }

    const token = await getOfflineAccessToken(shop);

    const option1 =
      purchaseOptionTitle ??
      `Every ${everyDays} days • ${discountPercent}% off`;

    const input = {
      name: groupName || "MINIMEAL 28d 20% (by app)", // internal
      merchantCode: "minimeal-28d",
      options: ["Delivery"], //  (string[])
      position: 1,
      sellingPlansToCreate: [
        {
          name: `Every ${everyDays} days, ${discountPercent}% off`, // internal plan name
          category: "SUBSCRIPTION",
          options: [option1],
          billingPolicy: {
            recurring: { interval: "DAY", intervalCount: everyDays },
          },
          deliveryPolicy: {
            recurring: { interval: "DAY", intervalCount: everyDays },
          },
          pricingPolicies: [
            {
              fixed: {
                adjustmentType: "PERCENTAGE",
                adjustmentValue: { percentage: discountPercent },
              },
            },
          ],
        },
      ],
    };

    const createRes = await adminGraphqlFetch(shop, token, MUT_GROUP_CREATE, { input });
    const createErr = createRes.body?.data?.sellingPlanGroupCreate?.userErrors ?? [];
    const group = createRes.body?.data?.sellingPlanGroupCreate?.sellingPlanGroup ?? null;
    if (createErr.length || !group?.id) {
      return json({ step: "groupCreate", response: createRes }, { status: 400 });
    }

    const attachRes = await adminGraphqlFetch(shop, token, MUT_GROUP_ADD_VARIANTS, {
      id: group.id,
      variantIds,
    });
    const attachErr = attachRes.body?.data?.sellingPlanGroupAddProductVariants?.userErrors ?? [];
    if (attachErr.length) {
      return json({ step: "groupAttachVariants", response: attachRes }, { status: 400 });
    }

    const verifyRes = await adminGraphqlFetch(shop, token, Q_GROUP_APP, { id: group.id });

    return json({
      ok: true,
      shop,
      createdGroup: group,
      attach: attachRes.body?.data?.sellingPlanGroupAddProductVariants,
      verify: verifyRes.body?.data?.sellingPlanGroup,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}