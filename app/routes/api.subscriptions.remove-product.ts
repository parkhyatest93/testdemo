// app/routes/api.subscriptions.remove-product.ts
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node';
import {json} from '@remix-run/node';
import '@shopify/shopify-api/adapters/node';
import shopify, {sessionStorage} from '~/shopify.server';
import {shopifyApi, ApiVersion} from '@shopify/shopify-api';

/* ========= CORS ========= */
function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin') || '';
  const h = new Headers();
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Access-Control-Allow-Credentials', 'true');
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  h.set('Access-Control-Max-Age', '86400');
  return h;
}
function withCors(request: Request, res: Response) {
  const cors = buildCorsHeaders(request);
  cors.forEach((v, k) => res.headers.set(k, v));
  return res;
}
function corsJson(request: Request, data: any, init?: number | ResponseInit) {
  const res = json(data, typeof init === 'number' ? {status: init} : init);
  return withCors(request, res);
}

/* ========= GraphQL ========= */
const Q_CONTRACT_LINES = /* GraphQL */ `
  query ($id: ID!) {
    subscriptionContract(id: $id) {
      id
      app { id title }
      lines(first: 100) {
        nodes { id title quantity variantId productId }
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

const MUT_LINE_REMOVE = /* GraphQL */ `
  mutation ($draftId: ID!, $lineId: ID!) {
    subscriptionDraftLineRemove(draftId: $draftId, lineId: $lineId) {
      draft { id }
      userErrors { field message }
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

/* ========= Types & utils ========= */
type Payload = {
  contractId: string;                   // required
  lineId?: string;                      // optional (gid://shopify/SubscriptionLine/…)
  variantId?: string | number;          // optional (gid or numeric) – used if lineId not provided
};

function toVariantGid(id?: string | number) {
  if (!id) return undefined;
  const s = String(id);
  return s.startsWith('gid://') ? s : `gid://shopify/ProductVariant/${s}`;
}

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
  } catch { return null; }
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
  if (!session?.accessToken) throw new Error(`No valid offline app session found for shop ${shop}`);
  const core = resolveCoreApi();
  return new core.clients.Graphql({session});
}

function isOwnedByThisApp(appGid?: string | null) {
  if (!appGid) return false;
  const owner = process.env.OWNER_APP_ID;
  if (!owner) return true;
  const numeric = appGid.replace('gid://shopify/App/', '');
  return numeric === owner;
}

/* ========= Loader ========= */
export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') return withCors(request, new Response(null, {status: 204}));
  if (request.method === 'GET') return corsJson(request, {ok: true, route: '/api/subscriptions/remove-product'});
  return withCors(request, new Response('Method Not Allowed', {status: 405}));
}

/* ========= Action ========= */
export async function action({request}: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return withCors(request, new Response('Method Not Allowed', {status: 405}));
  }

  try {
    // 0) auth → shop
    const auth = request.headers.get('authorization') || '';
    const shop = shopFromBearer(auth);
    if (!shop) return corsJson(request, {ok: false, error: {message: 'Invalid or missing bearer (dest)'}}, 401);

    // 1) payload
    const body = (await request.json()) as Payload;
    const {contractId} = body || {};
    const variantGid = toVariantGid(body?.variantId);
    const providedLineId = body?.lineId;

    if (!contractId || (!providedLineId && !variantGid)) {
      return corsJson(request, {
        ok: false,
        error: {message: 'Invalid payload (need contractId AND one of lineId or variantId)'},
      }, 400);
    }

    // 2) admin client
    const admin = await getAdminClientForShop(shop);

    // 3) read contract lines
    const contractRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );
    const contract = contractRes?.data?.subscriptionContract;
    if (!contract) {
      return corsJson(request, {ok: false, error: {message: 'Contract not found'}, raw: contractRes}, 404);
    }

    const lines: Array<{id: string; variantId: string}> = contract?.lines?.nodes ?? [];
    const ownership = {
      ownerAppGID: contract?.app?.id ?? null,
      expectedOwnerAppId: process.env.OWNER_APP_ID ?? null,
      ownedByMe: isOwnedByThisApp(contract?.app?.id),
    };

    // 4) resolve lineId
    let lineId = providedLineId || null;
    if (!lineId && variantGid) {
      const found = lines.find(l => String(l.variantId) === variantGid);
      lineId = found?.id ?? null;
    }
    if (!lineId) {
      return corsJson(request, {
        ok: false,
        error: {message: 'Line not found for given variantId'},
        hint: {variantId: variantGid},
        linesCount: lines.length,
      }, 404);
    }

    // 5) create draft
    const draftRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_CREATE_DRAFT, variables: {contractId}}}),
    );
    const draft = draftRes?.data?.subscriptionContractUpdate?.draft;
    const draftErrs = draftRes?.data?.subscriptionContractUpdate?.userErrors ?? [];
    if (draftErrs.length || !draft?.id) {
      return corsJson(request, {ok: false, step: 'createDraft', request: {contractId}, response: draftRes}, 400);
    }
    const draftId = String(draft.id);

    // 6) remove line
    const remRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_LINE_REMOVE, variables: {draftId, lineId}}}),
    );
    const remErrs = remRes?.data?.subscriptionDraftLineRemove?.userErrors ?? [];
    if (remErrs.length) {
      return corsJson(request, {
        ok: false,
        step: 'removeLine',
        request: {draftId, lineId},
        response: remRes,
      }, 400);
    }

    // 7) commit
    const comRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_COMMIT, variables: {draftId}}}),
    );
    const comErrs = comRes?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (comErrs.length) {
      return corsJson(request, {ok: false, step: 'commit', request: {draftId}, response: comRes}, 400);
    }

    // 8) verify after
    const afterRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );
    const afterLines: any[] = afterRes?.data?.subscriptionContract?.lines?.nodes ?? [];
    const stillExists = afterLines.some(l => String(l.id) === String(lineId));

    return corsJson(request, {
      ok: true,
      action: 'remove-line',
      shopFromToken: shop,
      contractId,
      ownership,
      draft: { id: draftId },
      commit: { userErrors: comErrs },
      // New standardized result shape (aligns with add-variant)
      result: {
        status: (!stillExists ? 'removed' : 'not_removed'),
        message: (!stillExists
          ? 'Line removed.'
          : 'Commit succeeded but the line still exists after re-read.')
      },
      // Backward compatibility fields
      removed: !stillExists,
      removedLineId: lineId,
      beforeCount: lines.length,
      afterCount: afterLines.length,
      afterSample: afterLines.slice(0, 5),
    });
  } catch (e: any) {
    return corsJson(request, {ok: false, error: {message: e?.message ?? 'Unknown error'}, stack: e?.stack}, 500);
  }
}