import type {LoaderFunctionArgs, ActionFunctionArgs} from "@remix-run/node";
import {json} from "@remix-run/node";

import "@shopify/shopify-api/adapters/node";
import shopify, {sessionStorage} from "~/shopify.server";
import {shopifyApi, ApiVersion} from "@shopify/shopify-api";

/* ===================== CORS helpers ===================== */

function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get("Origin") || "";
  const headers = new Headers();
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Vary", "Origin");
  headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With",
  );
  headers.set("Access-Control-Max-Age", "86400");
  return headers;
}

function withCors(request: Request, res: Response): Response {
  const cors = buildCorsHeaders(request);
  cors.forEach((v, k) => res.headers.set(k, v));
  return res;
}

function corsJson(request: Request, data: any, init?: number | ResponseInit) {
  const res = json(
    data,
    typeof init === "number" ? {status: init} : init,
  );
  return withCors(request, res);
}

/* ===================== Shopify helpers ===================== */

function safeBase64UrlDecode(input: string) {
  const b64 =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
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
  const admin = new core.clients.Graphql({session});
  return admin;
}

/* ========== GraphQL: load all variants with is_subscription metafield ========== */

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

/**
 * Load all product variants that have metafield custom.is_subscription = true/1.
 */
async function fetchSubscriptionVariants(admin: any) {
  const variants: {id: string; title: string; productTitle: string}[] = [];
  let after: string | null = null;
  let hasNextPage = true;

  while (hasNextPage) {
    const res = await unwrapGraphQL<any>(
      admin.query({
        data: {
          query: Q_SUBSCRIPTION_PRODUCTS,
          variables: {after},
        },
      }),
    );

    const productsConnection = res?.data?.products;
    const productNodes = productsConnection?.nodes ?? [];

    for (const p of productNodes) {
      const productTitle = p?.title ?? "Unknown product";
      const variantNodes = p?.variants?.nodes ?? [];

      for (const v of variantNodes) {
        const metafield = v?.metafield;
        const rawValue = metafield?.value;

        let isSubscription = false;
        if (typeof rawValue === "string") {
          const trimmed = rawValue.trim().toLowerCase();

          // direct string flags
          if (trimmed === "true" || trimmed === "1") {
            isSubscription = true;
          } else {
            // try to parse JSON-encoded boolean
            try {
              const parsed = JSON.parse(trimmed);
              if (parsed === true) {
                isSubscription = true;
              }
            } catch {
              // ignore parse errors
            }
          }
        }

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

/* ===================== Shared handler ===================== */

async function handleEligibleVariants(request: Request) {
  const url = new URL(request.url);

  // contractId can come from query (?contractId=...) or from JSON body (POST)
  let contractId = url.searchParams.get("contractId") || "";

  if (!contractId && request.method !== "GET") {
    try {
      const body = await request.json();
      if (body && typeof body.contractId === "string") {
        contractId = body.contractId;
      }
    } catch {
      // ignore body parse errors, contractId just stays ""
    }
  }

  const auth = request.headers.get("authorization") || "";
  const shop = shopFromBearer(auth);
  if (!shop) {
    return corsJson(
      request,
      {ok: false, error: {message: "Invalid or missing bearer (dest)"}},
      401,
    );
  }

  const admin = await getAdminClientForShop(shop);

  // Load all product variants that are marked as subscription via metafield
  const subscriptionVariants = await fetchSubscriptionVariants(admin);

  const options: Array<{label: string; value: string; sellingPlanId?: string}> =
    subscriptionVariants.map((v) => ({
      label: `${v.productTitle ?? "Unknown product"} — ${v.title}`,
      value: v.id,
    }));

  // Response shape kept identical to previous implementation
  return corsJson(request, {ok: true, contractId, items : options});
}

/* ===================== Loader / Action ===================== */

export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, {status: 204}));
  }
  // Treat GET/HEAD via shared handler
  return handleEligibleVariants(request);
}

export async function action({request}: ActionFunctionArgs) {
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, {status: 204}));
  }
  // Handle POST (and other non-GET methods) the same way
  return handleEligibleVariants(request);
}