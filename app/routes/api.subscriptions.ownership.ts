import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import * as shopModule from "~/shopify.server";

/** ===================== GraphQL ===================== */
const Q_LIST_CONTRACTS = `
query ($first: Int!, $after: String) {
  subscriptionContracts(first: $first, after: $after, sortKey: CREATED_AT, reverse: false) {
    edges {
      cursor
      node {
        id
        status
        lines(first: 3) {
          edges {
            node {
              id
              quantity
              title
              sellingPlanId
              productId
              variantId
            }
          }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}
`;

const Q_CONTRACT_LINES = `
query ($id: ID!) {
  subscriptionContract(id: $id) {
    id
    status
    lines(first: 50) {
      edges {
        node {
          id
          quantity
          title
          productId
          variantId
          sellingPlanId
        }
      }
    }
  }
}
`;

const Q_SP_GROUP_APP = `
query ($id: ID!) {
  sellingPlan(id: $id) {
    id
    sellingPlanGroup {
      id
      appId
      app { id title }
      name
    }
  }
}
`;

const Q_VARIANT_ALLOCATIONS = `
query ($id: ID!) {
  productVariant(id: $id) {
    id
    sellingPlanAllocations(first: 50) {
      edges {
        node {
          sellingPlan {
            id
            sellingPlanGroup {
              id
              appId
              app { id title }
            }
          }
        }
      }
    }
  }
}
`;

/** ===================== Types ===================== */
type OwnershipRow = {
  contractId: string;
  status?: string;
  lineId?: string | null;
  sellingPlanId?: string | null;
  variantId?: string | null;
  sellingPlanGroupAppId?: number | null;
  ownerAppId?: number | null;
  ownedByMe: boolean | "unknown";
  note?: string;
};

type PostBody = { contractId: string; lineIndex?: number };

/** ===================== Helpers ===================== */
function safeBase64UrlDecode(input: string) {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  return Buffer.from(b64, "base64").toString("utf8");
}
function extractShopFromBearer(bearerAuth: string): string | null {
  const bearer = (bearerAuth || "").replace(/^Bearer\s+/i, "");
  if (!bearer) return null;
  const [, payload] = bearer.split(".");
  if (!payload) return null;
  const body = JSON.parse(safeBase64UrlDecode(payload));
  const dest = (body?.dest || "").replace(/^https?:\/\//, "");
  return dest.endsWith(".myshopify.com") ? dest : null;
}

function resolveSessionStorage() {
  const m: any = shopModule;
  const sessionStorage = m.sessionStorage ?? m.shopify?.sessionStorage ?? m.api?.sessionStorage;
  if (!sessionStorage) throw new Error("Cannot resolve sessionStorage from ~/shopify.server");
  return sessionStorage;
}

async function getOfflineAccessToken(shop: string): Promise<string> {
  const s = resolveSessionStorage();
  const sessions =
    typeof s.findSessionsByShop === "function"
      ? await s.findSessionsByShop(shop)
      : await s.findSessionsByShopId(shop);
  if (!sessions || sessions.length === 0) throw new Error(`No app session for ${shop}`);
  const offline = sessions.find((x: any) => !x.isOnline) ?? sessions[0];
  if (!offline?.accessToken) throw new Error("No offline access token");
  return offline.accessToken as string;
}

async function adminGraphqlFetch(shop: string, accessToken: string, query: string, variables?: any) {
  const url = `https://${shop}/admin/api/2025-01/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": accessToken },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function ownerAppIdFromEnv(): number | null {
  const raw = process.env.OWNER_APP_ID;
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function numericFromGid(gid?: string | null): number | null {
  if (!gid) return null;
  const parts = gid.split("/");
  const last = parts[parts.length - 1];
  const n = Number(last);
  return Number.isFinite(n) ? n : null;
}

async function resolvePlanOwnerAppId(
  shop: string,
  token: string,
  sellingPlanId?: string | null,
  variantId?: string | null
): Promise<number | null> {
  if (sellingPlanId) {
    const spRes = await adminGraphqlFetch(shop, token, Q_SP_GROUP_APP, { id: sellingPlanId });
    const group = spRes.body?.data?.sellingPlan?.sellingPlanGroup ?? null;
    if (group) {
      if (group.appId != null) return Number(group.appId);
      const fromAppGid = numericFromGid(group.app?.id ?? null);
      if (fromAppGid != null) return fromAppGid;
    }
  }

  if (variantId) {
    const varRes = await adminGraphqlFetch(shop, token, Q_VARIANT_ALLOCATIONS, { id: variantId });
    const edges = varRes.body?.data?.productVariant?.sellingPlanAllocations?.edges ?? [];
    let appIdNum: number | null = null;
    for (const e of edges) {
      const plan = e?.node?.sellingPlan;
      if (!plan) continue;
      if (sellingPlanId && plan.id !== sellingPlanId) continue;
      const g = plan.sellingPlanGroup;
      if (g?.appId != null) {
        appIdNum = Number(g.appId);
        break;
      }
      const fromAppGid = numericFromGid(g?.app?.id ?? null);
      if (fromAppGid != null) {
        appIdNum = fromAppGid;
        break;
      }
    }
    if (appIdNum != null) return appIdNum;
  }

  return null;
}

/** ===================== Remix Handlers ===================== */
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });

  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 250);
  const cursor = url.searchParams.get("cursor") || undefined;

  try {
    const authHeader = request.headers.get("authorization") || "";
    const shop = extractShopFromBearer(authHeader);
    if (!shop) return json({ error: "Missing/invalid bearer" }, { status: 401 });

    const token = await getOfflineAccessToken(shop);
    const ownerAppId = ownerAppIdFromEnv();

    const listRes = await adminGraphqlFetch(shop, token, Q_LIST_CONTRACTS, { first: limit, after: cursor });
    const edges = listRes.body?.data?.subscriptionContracts?.edges ?? [];
    const pageInfo = listRes.body?.data?.subscriptionContracts?.pageInfo ?? { hasNextPage: false, endCursor: null };

    const rows: OwnershipRow[] = [];
    for (const edge of edges) {
      const node = edge?.node;
      if (!node) continue;

      const contractId = node.id as string;
      const status = node.status as string | undefined;

      const firstLine = node.lines?.edges?.[0]?.node ?? null;
      const lineId = firstLine?.id ?? null;
      const sellingPlanId = firstLine?.sellingPlanId ?? null;
      const variantId = firstLine?.variantId ?? null;

      const appIdNum = await resolvePlanOwnerAppId(shop, token, sellingPlanId, variantId);

      let owned: boolean | "unknown" = "unknown";
      if (ownerAppId !== null && appIdNum !== null) owned = Number(appIdNum) === Number(ownerAppId);

      rows.push({
        contractId,
        status,
        lineId,
        sellingPlanId,
        variantId,
        sellingPlanGroupAppId: appIdNum,
        ownerAppId,
        ownedByMe: owned,
        note: !sellingPlanId ? "sellingPlanId missing on line; resolved via variant allocations (if any)." : undefined,
      });
    }

    return json({ ok: true, shop, ownerAppId, pageInfo, results: rows });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const authHeader = request.headers.get("authorization") || "";
    const shop = extractShopFromBearer(authHeader);
    if (!shop) return json({ error: "Missing/invalid bearer" }, { status: 401 });

    const token = await getOfflineAccessToken(shop);
    const ownerAppId = ownerAppIdFromEnv();

    const { contractId, lineIndex = 0 } = (await request.json()) as PostBody;

    const cRes = await adminGraphqlFetch(shop, token, Q_CONTRACT_LINES, { id: contractId });
    const contract = cRes.body?.data?.subscriptionContract ?? null;
    if (!contract) {
      return json({ ok: false, shop, contractId, error: "Contract not found on this shop" }, { status: 404 });
    }

    const lines = (contract.lines?.edges ?? []).map((e: any) => e.node);
    if (!lines.length) {
      return json({ ok: false, shop, contractId, error: "No lines in contract" }, { status: 400 });
    }

    const idx = Math.max(0, Math.min(lineIndex, lines.length - 1));
    const line = lines[idx];

    const sellingPlanId = line?.sellingPlanId ?? null;
    const variantId = line?.variantId ?? null;

    const appIdNum = await resolvePlanOwnerAppId(shop, token, sellingPlanId, variantId);

    let owned: boolean | "unknown" = "unknown";
    if (ownerAppId !== null && appIdNum !== null) owned = Number(appIdNum) === Number(ownerAppId);

    return json({
      ok: true,
      shop,
      contractId,
      lineId: line.id,
      sellingPlanId,
      variantId,
      sellingPlanGroupAppId: appIdNum,
      ownerAppId,
      ownedByMe: owned,
      note: !sellingPlanId ? "sellingPlanId missing on line; resolved via variant allocations (if any)." : undefined,
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}