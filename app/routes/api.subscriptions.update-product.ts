// /api/subscriptions/update-qty.ts  → add-variant with price resolved from selling plan of the variant
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node';
import {json} from '@remix-run/node';
import '@shopify/shopify-api/adapters/node';
import shopify, {sessionStorage} from '~/shopify.server';
import {shopifyApi, ApiVersion} from '@shopify/shopify-api';

/* ===== CORS helpers ===== */
function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin') || '';
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}
function withCors(request: Request, res: Response): Response {
  const cors = buildCorsHeaders(request);
  cors.forEach((v, k) => res.headers.set(k, v));
  return res;
}
function corsJson(request: Request, data: any, init?: number | ResponseInit) {
  const res = json(data, typeof init === 'number' ? {status: init} : init);
  return withCors(request, res);
}

/* ===== GraphQL ===== */
const Q_CONTRACT_LINES = /* GraphQL */ `
  query ($id: ID!) {
    subscriptionContract(id: $id) {
      id
      app { id title handle }
      lines(first: 100) {
        nodes { id title quantity productId variantId }
      }
    }
  }
`;

/** Base variant price (Decimal as string from Admin API) */
const Q_VARIANT_PRICE = /* GraphQL */ `
  query ($id: ID!) {
    productVariant(id: $id) {
      id
      price
    }
  }
`;

/**
 * Variant → selling plan groups → selling plans → pricing policies
 * We use this to resolve the subscription price from the selling plan that
 * the variant actually belongs to.
 *
 * Assumption: each variant can be in multiple plans in theory, but in this
 * project only ONE relevant plan exists, so we simply take the first one.
 */
const Q_VARIANT_PLANS = /* GraphQL */ `
  query ($id: ID!) {
    productVariant(id: $id) {
      id
      sellingPlanGroups(first: 10) {
        nodes {
          id
          name
          sellingPlans(first: 10) {
            nodes {
              id
              pricingPolicies {
                __typename
                ... on SellingPlanFixedPricingPolicy {
                  adjustmentType
                  adjustmentValue {
                    __typename
                    ... on MoneyV2 {
                      amount
                      currencyCode
                    }
                    ... on SellingPlanPricingPolicyPercentageValue {
                      percentage
                    }
                  }
                }
                # Additional policy types (e.g. recurring) are ignored for now
              }
            }
          }
        }
      }
    }
  }
`;

const MUT_CREATE_DRAFT = /* GraphQL */ `
  mutation ($contractId: ID!) {
    subscriptionContractUpdate(contractId: $contractId) {
      draft { id }
      userErrors { field message }
    }
  }
`;

/** Add a new line to the draft, using the resolved subscription price
 *  and store the original product price in a custom attribute.
 */
const MUT_LINE_ADD = /* GraphQL */ `
  mutation (
    $draftId: ID!
    $variantId: ID!
    $qty: Int!
    $price: Decimal!
    $basePrice: String!  
  ) {
    subscriptionDraftLineAdd(
      draftId: $draftId,
      input: {
        productVariantId: $variantId
        quantity: $qty
        currentPrice: $price
        customAttributes: [
          { key: "productBasePrice", value: $basePrice }
        ]
      }
    ) {
      draft {
        id
      }
      userErrors {
        field
        message
      }
    }
  }
`;

const MUT_COMMIT = /* GraphQL */ `
  mutation ($draftId: ID!) {
    subscriptionDraftCommit(draftId: $draftId) {
      contract { id status }
      userErrors { field message }
    }
  }
`;

/* ===== Types ===== */
type Payload = {
  contractId: string;
  quantity?: number; // optional; defaults to 1
  variantId?: string | number;
};

/* ===== Defaults / helpers ===== */
const DEFAULT_VARIANT_NUMERIC = 15446629024122; // fallback if variantId not provided
function toVariantGid(id: string | number | undefined): string {
  if (!id) return `gid://shopify/ProductVariant/${DEFAULT_VARIANT_NUMERIC}`;
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/ProductVariant/${s}`;
}

/** Keep price as a Decimal string. Shopify Admin returns Decimal as string already. */
function toDecimalString(x: unknown): string | null {
  if (x === null || x === undefined) return null;
  const s = String(x).trim();
  // very light sanity check for a decimal-like value
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  return s;
}

/* ===== Utils ===== */
function safeBase64UrlDecode(input: string) {
  const b64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  return Buffer.from(b64, 'base64').toString('utf8');
}
function shopFromBearer(header: string): string | null {
  const token = header.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  try {
    const [, payload] = token.split('.');
    if (!payload) return null;
    const body = JSON.parse(safeBase64UrlDecode(payload));
    const dest: string | undefined = body?.dest;
    if (!dest) return null;
    const host = dest.replace(/^https?:\/\//, '');
    return host.endsWith('.myshopify.com') ? host : null;
  } catch {
    return null;
  }
}
function resolveCoreApi() {
  const core = (shopify as any)?.api;
  if (core?.clients?.Graphql) return core;
  const hostName = (process.env.SHOPIFY_APP_URL || process.env.APP_URL || 'example.com')
    .replace(/^https?:\/\//, '');
  return shopifyApi({
    apiKey: process.env.SHOPIFY_API_KEY || '',
    apiSecretKey: process.env.SHOPIFY_API_SECRET || '',
    apiVersion: ApiVersion.Unstable,
    hostName,
  });
}
async function unwrapGraphQL<T = any>(promise: Promise<any>): Promise<T> {
  const res = await promise;
  const maybe = typeof res?.json === 'function' ? await res.json() : res;
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


/**
 * Resolve the effective subscription price for a variant based on its selling plan(s).
 *
 * Logic:
 * - Read all sellingPlanGroups attached to this variant.
 * - Take the FIRST group and the FIRST selling plan from that group.
 *   (In this project only one plan is configured per variant.)
 * - Read pricingPolicies from that selling plan and derive the price from:
 *   - adjustmentType = PRICE       → use the MoneyV2 amount directly
 *   - adjustmentType = FIXED_AMOUNT→ basePrice - amount
 *   - adjustmentType = PERCENTAGE  → basePrice * (1 - percentage / 100)
 * - If anything is missing or unsupported → fall back to basePrice.
 */
async function resolvePriceFromVariantPlans(
  admin: any,
  variantGid: string,
  basePriceDecimal: string,
): Promise<{price: string; source: 'sellingPlan' | 'variant'}> {
  // Guard: base price must be a valid decimal
  const base = Number(basePriceDecimal);
  if (!Number.isFinite(base)) {
    throw new Error(`Invalid base price for variant ${variantGid}: ${basePriceDecimal}`);
  }

  const plansRes = await unwrapGraphQL<any>(
    admin.query({data: {query: Q_VARIANT_PLANS, variables: {id: variantGid}}}),
  );
  const variant = plansRes?.data?.productVariant;
  const groups: any[] = variant?.sellingPlanGroups?.nodes ?? [];

  // No selling plan groups → no subscription-specific pricing
  if (!groups.length) {
    return {price: basePriceDecimal, source: 'variant'};
  }

  const firstGroup = groups[0];
  const plans: any[] = firstGroup?.sellingPlans?.nodes ?? [];
  if (!plans.length) {
    return {price: basePriceDecimal, source: 'variant'};
  }

  // We assume exactly one plan per variant for this project
  const plan = plans[0];
  const policies: any[] = plan?.pricingPolicies ?? [];

  // We only care about fixed pricing policy for now
  const fixedPolicy = policies.find((p) => p.__typename === 'SellingPlanFixedPricingPolicy');
  if (!fixedPolicy) {
    return {price: basePriceDecimal, source: 'variant'};
  }

  const adjType: string = fixedPolicy.adjustmentType;
  const adjVal: any = fixedPolicy.adjustmentValue;

  // PRICE → the plan defines the final price as MoneyV2
  if (adjType === 'PRICE' && adjVal?.__typename === 'MoneyV2') {
    const amount = toDecimalString(adjVal.amount);
    if (amount) {
      return {price: amount, source: 'sellingPlan'};
    }
  }

  // FIXED_AMOUNT → subtract a fixed value from base price
  if (adjType === 'FIXED_AMOUNT' && adjVal?.__typename === 'MoneyV2') {
    const off = Number(adjVal.amount ?? 0);
    const result = (base - off).toFixed(2);
    const dec = toDecimalString(result);
    if (dec) {
      return {price: dec, source: 'sellingPlan'};
    }
  }

  // PERCENTAGE → apply percentage discount on base price
  if (adjType === 'PERCENTAGE' && typeof adjVal?.percentage === 'number') {
    const perc = adjVal.percentage;
    const result = (base * (1 - perc / 100)).toFixed(2);
    const dec = toDecimalString(result);
    if (dec) {
      return {price: dec, source: 'sellingPlan'};
    }
  }

  // Fallback if the policy is not usable
  return {price: basePriceDecimal, source: 'variant'};
}

/* ===== Loader (GET/OPTIONS) ===== */
export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS')
    return withCors(request, new Response(null, {status: 204}));
  if (request.method === 'GET')
    return corsJson(request, {
      ok: true,
      route: '/api/subscriptions/update-qty (add-variant-with-plan-price)',
    });
  return withCors(request, new Response('Method Not Allowed', {status: 405}));
}

/* ===== Action (POST) ===== */
export async function action({request}: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return withCors(request, new Response('Method Not Allowed', {status: 405}));
  }

  try {
    // 0) auth → shop
    const auth = request.headers.get('authorization') || '';
    const shop = shopFromBearer(auth);
    if (!shop) {
      return corsJson(
        request,
        {ok: false, error: {message: 'Invalid or missing bearer (dest)'}},
        401,
      );
    }

    // 1) payload
    const body = (await request.json()) as Payload;
    const {contractId} = body || {};
    const quantity = Number(body?.quantity ?? 1);
    const variantGid = toVariantGid(body?.variantId);

    if (!contractId || !Number.isFinite(quantity) || quantity <= 0) {
      return corsJson(
        request,
        {ok: false, error: {message: 'Invalid payload (need contractId, quantity>0)'}},
        400,
      );
    }

    // 2) admin client
    const admin = await getAdminClientForShop(shop);

    // 3) (optional) read contract lines, mainly for debug counts
    const contractRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );
    const contract = contractRes?.data?.subscriptionContract;
    if (!contract) {
      return corsJson(
        request,
        {ok: false, error: {message: 'Contract not found'}, raw: contractRes},
        404,
      );
    }
    const linesBefore: any[] = contract?.lines?.nodes ?? [];

    // 4) read base variant price (as before)
    const priceRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_VARIANT_PRICE, variables: {id: variantGid}}}),
    );
    const rawPrice = priceRes?.data?.productVariant?.price;
    const basePriceDecimal = toDecimalString(rawPrice);
    if (!basePriceDecimal) {
      return corsJson(
        request,
        {
          ok: false,
          step: 'variantPrice',
          error: {message: 'Variant price not found or invalid'},
          response: priceRes,
        },
        400,
      );
    }

    // 4b) resolve effective subscription price from selling plan(s) for this variant
    const {price: priceDecimal, source: priceSource} = await resolvePriceFromVariantPlans(
      admin,
      variantGid,
      basePriceDecimal,
    );

    // productUnitPrice = base product price (non-subscription)
    const productUnitPrice = basePriceDecimal;

    // subscriptionUnitPrice = unit price that will be stored on the subscription line
    const subscriptionUnitPrice = priceDecimal;

    // subscriptionLinePrice = total line price (unit * quantity)
    const subscriptionLinePrice = (
      Number(subscriptionUnitPrice) * quantity
    ).toFixed(2);


    // 5) create draft
    const draftRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_CREATE_DRAFT, variables: {contractId}}}),
    );
    const draft = draftRes?.data?.subscriptionContractUpdate?.draft;
    const draftErrs = draftRes?.data?.subscriptionContractUpdate?.userErrors ?? [];
    if (draftErrs.length || !draft?.id) {
      return corsJson(
        request,
        {ok: false, step: 'createDraft', request: {contractId}, response: draftRes},
        400,
      );
    }
    const draftId = String(draft.id);

    // 6) add line with subscription unit price and product base price as custom attribute
    const addRes = await unwrapGraphQL<any>(
      admin.query({
        data: {
          query: MUT_LINE_ADD,
          variables: {
            draftId,
            variantId: variantGid,
            qty: quantity,
            price: subscriptionUnitPrice,   // subscription unit price
            basePrice: productUnitPrice,    // original product unit price
          },
        },
      }),
    );
    const addErrs = addRes?.data?.subscriptionDraftLineAdd?.userErrors ?? [];
    if (addErrs.length) {
      return corsJson(
        request,
        {
          ok: false,
          step: 'addLine',
          request: {
            draftId,
            variantId: variantGid,
            quantity,
            currentPrice: subscriptionUnitPrice,
            productUnitPrice,
          },
          response: addRes,
        },
        400,
      );
    }


    // 7) commit
    const comRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_COMMIT, variables: {draftId}}}),
    );
    const comErrs = comRes?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (comErrs.length) {
      return corsJson(
        request,
        {ok: false, step: 'commit', request: {draftId}, response: comRes},
        400,
      );
    }

    // 8) read after
    const afterRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );
    const linesAfter: any[] = afterRes?.data?.subscriptionContract?.lines?.nodes ?? [];
    const added = linesAfter.some((l) => String(l.variantId) === variantGid);

    return corsJson(request, {
      ok: true,
      action: 'add-variant',
      shopFromToken: shop,
      contractId,
      requested: {
        variantId: variantGid,
        quantity,
        productUnitPrice,        // base product price (unit)
        subscriptionUnitPrice,   // subscription unit price
        subscriptionLinePrice,   // subscription total price (unit * qty)
        priceSource,
      },
      draft: {id: draftId},
      commit: {userErrors: comErrs},
      beforeCount: linesBefore.length,
      afterCount: linesAfter.length,
      result: added
        ? {status: 'added', message: 'Variant added to subscription.'}
        : {status: 'not_found_after_commit'},
      afterSample: linesAfter.slice(0, 5), // for quick debugging
    });

  } catch (e: any) {
    return corsJson(
      request,
      {ok: false, error: {message: e?.message ?? 'Unknown error'}, stack: e?.stack},
      500,
    );
  }
}