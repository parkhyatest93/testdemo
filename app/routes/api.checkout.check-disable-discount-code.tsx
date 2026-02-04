// app/routes/api.checkout.check-disable-discount-code.tsx
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
  const res = json(data, typeof init === "number" ? {status: init} : init);
  return withCors(request, res);
}

/* ===================== Shopify helpers ===================== */

function safeBase64UrlDecode(input: string) {
  const b64 =
    input.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((input.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}

/**
 * Extract shop (e.g. "my-shop.myshopify.com") from a Shopify session token
 * provided as Authorization: Bearer <token>.
 */
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

/**
 * Normalize Shopify GraphQL client responses.
 */
async function unwrapGraphQL<T = any>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  const maybe = typeof res?.json === "function" ? await res.json() : res;
  return (maybe?.body ?? maybe) as T;
}

/**
 * Load an offline admin GraphQL client for a given shop.
 */
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

/* ========== GraphQL: variant metafield custom.disable_discount_code ========== */

const Q_CHECK_DISABLE_DISCOUNT_CODE = /* GraphQL */ `
  query CheckDisableDiscountCode($variantIds: [ID!]!) {
    nodes(ids: $variantIds) {
      __typename
      ... on ProductVariant {
        id
        metafield(namespace: "custom", key: "disable_discount_code") {
          value
        }
      }
    }
  }
`;

type CheckRequestBody = {
  variantIds?: string[];
};

export type DisableDiscountResponse = {
  status: boolean;
  disableDiscounts: boolean;
  blockedVariants: string[];
  message?: string;
  error?: string;
};

/* ===================== Core handler ===================== */

function parseBool(raw: unknown): boolean {
  if (raw == null) return false;
  const s = String(raw).trim().toLowerCase();
  if (s === "true" || s === "1" || s === "yes") return true;
  try {
    const parsed = JSON.parse(s);
    if (parsed === true) return true;
  } catch {
    // ignore
  }
  return false;
}

async function handleCheckDisableDiscountCode(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return withCors(request, new Response(null, {status: 204}));
  }

  if (request.method !== "POST") {
    return corsJson(
      request,
      {
        status: false,
        error: "Only POST is allowed",
        disableDiscounts: false,
        blockedVariants: [],
      } as DisableDiscountResponse,
      405,
    );
  }

  let body: CheckRequestBody;
  try {
    body = await request.json();
  } catch {
    return corsJson(
      request,
      {
        status: false,
        error: "Invalid JSON body",
        disableDiscounts: false,
        blockedVariants: [],
      } as DisableDiscountResponse,
      400,
    );
  }

  const variantIds = body.variantIds || [];
  if (variantIds.length === 0) {
    return corsJson(
      request,
      {
        status: true,
        disableDiscounts: false,
        blockedVariants: [],
        message: "No variants to check.",
      } as DisableDiscountResponse,
      200,
    );
  }

  const auth = request.headers.get("authorization") || "";
  let shop = shopFromBearer(auth);

  // Optional fallback for single-shop apps
  if (!shop) {
    const fallbackShop = process.env.SHOPIFY_SINGLE_SHOP;
    if (fallbackShop && fallbackShop.endsWith(".myshopify.com")) {
      shop = fallbackShop;
    }
  }

  if (!shop) {
    return corsJson(
      request,
      {
        status: false,
        error: "Invalid or missing bearer (dest) and no fallback shop configured",
        disableDiscounts: false,
        blockedVariants: [],
      } as DisableDiscountResponse,
      401,
    );
  }

  try {
    const admin = await getAdminClientForShop(shop);

    const result = await unwrapGraphQL<any>(
      admin.query({
        data: {
          query: Q_CHECK_DISABLE_DISCOUNT_CODE,
          variables: {variantIds},
        },
      }),
    );

    const nodes = result?.data?.nodes ?? [];
    const blockedVariants: string[] = [];

    for (const node of nodes) {
      if (!node || node.__typename !== "ProductVariant") continue;

      const vid = node.id as string;
      const rawVal = node.metafield?.value;
      const disabled = parseBool(rawVal);

      console.log("Variant", vid, "disable_discount_code raw =", rawVal, "parsed =", disabled);

      if (disabled) blockedVariants.push(vid);
    }

    const disableDiscounts = blockedVariants.length > 0;

    const response: DisableDiscountResponse = {
      status: true,
      disableDiscounts,
      blockedVariants,
      message: disableDiscounts
        ? "Discount codes and gift cards must be disabled for this cart."
        : "No disable-discount variants found in cart.",
    };

    return corsJson(request, response, 200);
  } catch (err: any) {
    console.error("check-disable-discount-code error:", err);
    return corsJson(
      request,
      {
        status: false,
        error: err?.message || "Internal server error",
        disableDiscounts: false,
        blockedVariants: [],
      } as DisableDiscountResponse,
      500,
    );
  }
}

/* ===================== Loader / Action ===================== */

export async function loader({request}: LoaderFunctionArgs) {
  return handleCheckDisableDiscountCode(request);
}

export async function action({request}: ActionFunctionArgs) {
  return handleCheckDisableDiscountCode(request);
}