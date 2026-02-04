// /api/subscriptions/update-qty.ts (Remix route)
import type {ActionFunctionArgs, LoaderFunctionArgs} from '@remix-run/node';
import {json} from '@remix-run/node';
import '@shopify/shopify-api/adapters/node';
import shopify, {sessionStorage} from '~/shopify.server';
import {shopifyApi, ApiVersion} from '@shopify/shopify-api';


function buildCorsHeaders(request: Request): Headers {
  const origin = request.headers.get('Origin') || '';
  const headers = new Headers();

  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Vary', 'Origin');
  headers.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  headers.set(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With',
  );
  headers.set('Access-Control-Max-Age', '86400');

  return headers;
}

function withCors<T>(
  request: Request,
  res: Response,
): Response {
  const cors = buildCorsHeaders(request);
  cors.forEach((v, k) => res.headers.set(k, v));
  return res;
}

function corsJson(request: Request, data: any, init?: number | ResponseInit) {
  const res = json(data, typeof init === 'number' ? {status: init} : init);
  return withCors(request, res);
}

/* ====== GraphQL ====== */
const Q_CONTRACT_LINES = /* GraphQL */ `
  query ($id: ID!) {
    subscriptionContract(id: $id) {
      id
      app { id title handle }
      lines(first: 50) {
        nodes { id title quantity productId variantId }
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

const MUT_LINE_UPDATE = /* GraphQL */ `
  mutation ($draftId: ID!, $lineId: ID!, $qty: Int!) {
    subscriptionDraftLineUpdate(
      draftId: $draftId,
      lineId: $lineId,
      input: { quantity: $qty }
    ) {
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

/* ===== Types ===== */
type Payload = {
  contractId: string;
  lineId?: string;
  quantity: number;
};

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

function isOwnedByThisApp(appGid?: string | null) {
  if (!appGid) return false;
  const owner = process.env.OWNER_APP_ID;
  if (!owner) return true;
  const numeric = appGid.replace('gid://shopify/App/', '');
  return numeric === owner;
}

/* ===== Loader (GET/OPTIONS) ===== */
export async function loader({request}: LoaderFunctionArgs) {
  if (request.method === 'OPTIONS') {
    return withCors(request, new Response(null, {status: 204}));
  }
  if (request.method === 'GET') {
    return corsJson(request, {ok: true, route: '/api/subscriptions/update-qty'});
  }
  return withCors(request, new Response('Method Not Allowed', {status: 405}));
}

/* ===== Action (POST) ===== */
export async function action({request}: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return withCors(request, new Response('Method Not Allowed', {status: 405}));
  }

  try {
    const auth = request.headers.get('authorization') || '';
    const shop = shopFromBearer(auth);
    if (!shop) {
      return corsJson(request, {ok: false, error: {message: 'Invalid or missing bearer (dest)'}}, 401);
    }

    const body = (await request.json()) as Payload;
    const {contractId, lineId, quantity} = body || {};
    if (!contractId || typeof quantity !== 'number') {
      return corsJson(
        request,
        {ok: false, error: {message: 'Invalid payload (need contractId, quantity[, lineId])'}},
        400,
      );
    }

    const admin = await getAdminClientForShop(shop);

    const contractRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );
    const contract = contractRes?.data?.subscriptionContract;
    if (!contract) {
      return corsJson(request, {ok: false, error: {message: 'Contract not found'}, raw: contractRes}, 404);
    }

    const lines: any[] = contract?.lines?.nodes ?? [];
    const ownerAppGID: string | undefined = contract?.app?.id;
    const ownership = {
      ownerAppGID,
      ownerAppNumeric: ownerAppGID?.replace('gid://shopify/App/', '') ?? null,
      expectedOwnerAppId: process.env.OWNER_APP_ID ?? null,
      ownedByMe: isOwnedByThisApp(ownerAppGID),
    };

    const selectedLineId = lineId || (lines.length > 0 ? lines[0].id : null);
    if (!selectedLineId) {
      return corsJson(
        request,
        {ok: false, shop, contractId, ownership, error: {message: 'No lines found on this contract'}},
        400,
      );
    }

    const draftRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_CREATE_DRAFT, variables: {contractId}}}),
    );
    const draft = draftRes?.data?.subscriptionContractUpdate?.draft;
    const draftErrs = draftRes?.data?.subscriptionContractUpdate?.userErrors ?? [];
    if (draftErrs.length || !draft?.id) {
      return corsJson(request, {ok: false, step: 'createDraft', request: {contractId}, response: draftRes}, 400);
    }
    const draftId = String(draft.id);

    const updRes = await unwrapGraphQL<any>(
      admin.query({
        data: {query: MUT_LINE_UPDATE, variables: {draftId, lineId: selectedLineId, qty: Number(quantity)}},
      }),
    );
    const updErrs = updRes?.data?.subscriptionDraftLineUpdate?.userErrors ?? [];
    if (updErrs.length) {
      return corsJson(
        request,
        {ok: false, step: 'updateLine', request: {draftId, lineId: selectedLineId, quantity}, response: updRes},
        400,
      );
    }

    const comRes = await unwrapGraphQL<any>(
      admin.query({data: {query: MUT_COMMIT, variables: {draftId}}}),
    );
    const comErrs = comRes?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (comErrs.length) {
      return corsJson(request, {ok: false, step: 'commit', request: {draftId}, response: comRes}, 400);
    }

    const afterRes = await unwrapGraphQL<any>(
      admin.query({data: {query: Q_CONTRACT_LINES, variables: {id: contractId}}}),
    );

    const afterLines: any[] = afterRes?.data?.subscriptionContract?.lines?.nodes ?? [];
    const beforeLine = lines.find((l) => l.id === selectedLineId);
    const afterLine = afterLines.find((l) => l.id === selectedLineId);
    const changed = Number(afterLine?.quantity) === Number(quantity);

    return corsJson(request, {
      ok: true,
      shopFromToken: shop,
      contractId,
      requested: {lineId: selectedLineId, quantity},
      ownership,
      before: beforeLine ? [{...beforeLine}] : lines,
      draft: {id: draftId},
      commit: {userErrors: comErrs},
      after: afterLine ? [{...afterLine}] : afterLines,
      result: changed
        ? {status: 'changed', message: 'Quantity updated successfully.'}
        : {
          status: 'unchanged',
          message: ownership.ownedByMe
            ? 'Commit succeeded but quantity did not change (unexpected).'
            : 'Commit succeeded but quantity did not change. Likely NOT owned by this app.',
        },
    });
  } catch (e: any) {
    return corsJson(request, {ok: false, error: {message: e?.message ?? 'Unknown error'}, stack: e?.stack}, 500);
  }
}