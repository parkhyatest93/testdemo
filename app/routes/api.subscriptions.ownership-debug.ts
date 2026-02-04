import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import * as shopModule from "~/shopify.server";

/** ===== GraphQL ===== */
const Q_CONTRACT_LINES = `
query ($id: ID!) {
  subscriptionContract(id: $id) {
    id
    lines(first: 50) {
      edges { node { id sellingPlanId variantId productId title quantity } }
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

/** ===== helpers ===== */
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

/** ===== handlers ===== */
export async function loader({ request }: LoaderFunctionArgs) {
  return new Response("Method Not Allowed", { status: 405 });
}

type Body = {
  contractId?: string;
  sellingPlanId?: string;
  variantId?: string;
  lineIndex?: number;
};

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  try {
    const authHeader = request.headers.get("authorization") || "";
    const shop = extractShopFromBearer(authHeader);
    if (!shop) return json({ error: "Missing/invalid bearer" }, { status: 401 });

    const token = await getOfflineAccessToken(shop);
    const { contractId, sellingPlanId: spIn, variantId: varIn, lineIndex = 0 } = (await request.json()) as Body;

    let sellingPlanId = spIn ?? null;
    let variantId = varIn ?? null;
    let pickedLine: any = null;

    if (contractId && (!sellingPlanId || !variantId)) {
      const cRes = await adminGraphqlFetch(shop, token, Q_CONTRACT_LINES, { id: contractId });
      const lines = (cRes.body?.data?.subscriptionContract?.lines?.edges ?? []).map((e: any) => e.node);
      pickedLine = lines[Math.max(0, Math.min(lineIndex, Math.max(0, lines.length - 1)))] ?? null;
      if (pickedLine) {
        if (!sellingPlanId) sellingPlanId = pickedLine.sellingPlanId ?? null;
        if (!variantId) variantId = pickedLine.variantId ?? null;
      }
    }

    let spRes: any = null;
    if (sellingPlanId) {
      spRes = await adminGraphqlFetch(shop, token, Q_SP_GROUP_APP, { id: sellingPlanId });
    }

    let varRes: any = null;
    if (variantId) {
      varRes = await adminGraphqlFetch(shop, token, Q_VARIANT_ALLOCATIONS, { id: variantId });
    }

    return json({
      ok: true,
      shop,
      input: { contractId, sellingPlanId, variantId, lineIndex },
      pickedLine,
      raw: {
        sellingPlanGroup: spRes,
        variantAllocations: varRes,
      },
    });
  } catch (e: any) {
    return json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}