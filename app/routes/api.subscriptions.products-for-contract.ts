import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import "@shopify/shopify-api/adapters/node";
import shopify, { sessionStorage } from "~/shopify.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

function safeBase64UrlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}
function shopFromBearer(header: string): string | null {
  const token = header.replace(/^Bearer\s+/i, "");
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const body = JSON.parse(safeBase64UrlDecode(payload));
    const dest: string | undefined = body?.dest;
    if (!dest) return null;
    const host = dest.replace(/^https?:\/\//, "");
    return host.endsWith(".myshopify.com") ? host : null;
  } catch {
    return null;
  }
}
function resolveCoreApi() {
  const core = (shopify as any)?.api;
  if (core?.clients?.Graphql) return core;
  const hostName = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || "example.com")
    .replace(/^https?:\/\//, "");
  return shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY || "",
    apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
    apiVersion: ApiVersion.Unstable,
    hostName,
  });
}

async function unwrapGraphQL<T = any>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  const maybe = typeof res?.json === "function" ? await res.json() : res;
  return (maybe?.body ?? maybe) as T;
}
async function getAdminClientForShop(shop: string) {
  const offlineId = `offline_${shop}`;
  // @ts-ignore
  let session = await sessionStorage.loadSession?.(offlineId);
  if (!session) {
    // @ts-ignore
    const list = await sessionStorage.findSessionsByShop?.(shop);
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

const Q_SUBSCRIPTION_PRODUCTS = /* GraphQL */ `
  query SubscriptionProducts($after: String) {
    products(first: 50, after: $after) {
      pageInfo {
        hasNextPage
        endCursor
      }
      nodes {
        id
        title
        variants(first: 100) {
          nodes {
            id
            title
            metafield(namespace: "custom", key: "is_subscription") {
              value
            }
          }
        }
      }
    }
  }
`;

async function fetchSubscriptionVariants(admin: any) {
  const variants: { id: string; title: string; productTitle: string }[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const res = await unwrapGraphQL<any>(
      admin.query({
        data: {
          query: Q_SUBSCRIPTION_PRODUCTS,
          variables: { after },
        },
      }),
    );

    const productsConnection = res?.data?.products;
    console.log(productsConnection);
    const productNodes = productsConnection?.nodes ?? [];

    for (const p of productNodes) {
      const productTitle = p?.title ?? "Unknown product";
      const variantNodes = p?.variants?.nodes ?? [];

      for (const v of variantNodes) {
        const metafield = v?.metafield;
        const value = metafield?.value;

        const isSubscription = value === "true" || value === "1";

        if (isSubscription) {
          variants.push({
            id: v.id,
            title: v.title,
            productTitle,
          });
        }
      }
    }

    hasNextPage = Boolean(productsConnection?.pageInfo?.hasNextPage);
    after = productsConnection?.pageInfo?.endCursor ?? null;
  }

  return variants;
}

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const contractId = url.searchParams.get("contractId") || "";

    const auth = request.headers.get("authorization") || "";
    const shop = shopFromBearer(auth);
    if (!shop) {
      return json(
        { ok: false, error: { message: "Invalid or missing bearer (dest)" } },
        { status: 401 },
      );
    }

    const admin = await getAdminClientForShop(shop);

    // Load all product variants and filter those that are marked as subscription via metafield
    const subscriptionVariants = await fetchSubscriptionVariants(admin);

    const options: Array<{ label: string; value: string; sellingPlanId?: string }> =
      subscriptionVariants.map((v) => ({
        label: `${v.productTitle ?? "Unknown product"} — ${v.title}`,
        value: v.id,
      }));

    return json({ ok: true, contractId, options });
  } catch (e: any) {
    return json({ ok: false, error: { message: e?.message ?? "Unknown error" } }, { status: 500 });
  }
}