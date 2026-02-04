import type { ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

import "@shopify/shopify-api/adapters/node";
import shopify, { sessionStorage } from "~/shopify.server";
import { shopifyApi, ApiVersion } from "@shopify/shopify-api";

/* ---------------- GraphQL ---------------- */
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

const MUT_LINE_REMOVE = /* GraphQL */ `
  mutation ($draftId: ID!, $lineId: ID!) {
    subscriptionDraftLineRemove(draftId: $draftId, lineId: $lineId) {
      draft { id }
      userErrors { field message }
    }
  }
`;

/**
 * subscriptionDraftLineAdd -> input: SubscriptionLineInput
 */
const MUT_LINE_ADD = /* GraphQL */ `
  mutation (
    $draftId: ID!,
    $productVariantId: ID!,
    $quantity: Int!,
    $sellingPlanId: ID
  ) {
    subscriptionDraftLineAdd(
      draftId: $draftId,
      input: {
        productVariantId: $productVariantId
        quantity: $quantity
        sellingPlanId: $sellingPlanId
      }
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

/* ---------------- Types ---------------- */
type ReplacePayload = {
  contractId: string;          // gid://shopify/SubscriptionContract/...
  lineId: string;              // gid://shopify/SubscriptionLine/...
  productVariantId: string;    // gid://shopify/ProductVariant/...
  sellingPlanId?: string | null;
  quantity?: number;
};

/* ---------------- helpers ---------------- */
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
  const maybe = typeof (res as any)?.json === "function" ? await (res as any).json() : res;
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
function isOwnedByThisApp(appGid?: string | null) {
  if (!appGid) return false;
  const owner = process.env.OWNER_APP_ID;
  if (!owner) return true;
  const numeric = appGid.replace("gid://shopify/App/", "");
  return numeric === owner;
}

/* ---------------- Loader ---------------- */
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method === "GET") return json({ ok: true, route: "/api/subscriptions/replace-line" });
  return new Response("Method Not Allowed", { status: 405 });
}

/* ---------------- Action ---------------- */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  try {
    const auth = request.headers.get("authorization") || "";
    const shop = shopFromBearer(auth);
    if (!shop) {
      return json({ ok: false, error: { message: "Invalid or missing bearer (dest)" } }, { status: 401 });
    }

    const body = (await request.json()) as ReplacePayload;
    const { contractId, lineId, productVariantId } = body || {};
    let { sellingPlanId, quantity } = body || {};
    if (!contractId || !lineId || !productVariantId) {
      return json(
        { ok: false, error: { message: "Invalid payload (need contractId, lineId, productVariantId[, sellingPlanId, quantity])" } },
        { status: 400 },
      );
    }

    const admin = await getAdminClientForShop(shop);

    const contractRes = await unwrapGraphQL(
      admin.query({ data: { query: Q_CONTRACT_LINES, variables: { id: contractId } } }),
    );
    const contract = contractRes?.data?.subscriptionContract;
    if (!contract) {
      return json({ ok: false, error: { message: "Contract not found" }, raw: contractRes }, { status: 404 });
    }
    const ownerAppGID: string | undefined = contract?.app?.id;
    const ownership = {
      ownerAppGID,
      ownerAppNumeric: ownerAppGID?.replace("gid://shopify/App/", "") ?? null,
      expectedOwnerAppId: process.env.OWNER_APP_ID ?? null,
      ownedByMe: isOwnedByThisApp(ownerAppGID),
    };
    const lines: any[] = contract?.lines?.nodes ?? [];
    const currentLine = lines.find(l => l.id === lineId);
    if (!currentLine) {
      return json({ ok: false, error: { message: "Line not found on this contract" } }, { status: 400 });
    }
    if (typeof quantity !== "number") {
      quantity = Number(currentLine.quantity) || 1;
    }

    const draftRes = await unwrapGraphQL(
      admin.query({ data: { query: MUT_CREATE_DRAFT, variables: { contractId } } }),
    );
    const draft = draftRes?.data?.subscriptionContractUpdate?.draft;
    const draftErrs = draftRes?.data?.subscriptionContractUpdate?.userErrors ?? [];
    if (draftErrs.length || !draft?.id) {
      return json(
        { ok: false, step: "createDraft", request: { contractId }, response: draftRes },
        { status: 400 },
      );
    }
    const draftId = draft.id as string;

    const rmRes = await unwrapGraphQL(
      admin.query({ data: { query: MUT_LINE_REMOVE, variables: { draftId, lineId } } }),
    );
    const rmErrs = rmRes?.data?.subscriptionDraftLineRemove?.userErrors ?? [];
    if (rmErrs.length) {
      return json(
        { ok: false, step: "removeLine", request: { draftId, lineId }, response: rmRes },
        { status: 400 },
      );
    }

    const addRes = await unwrapGraphQL(
      admin.query({
        data: {
          query: MUT_LINE_ADD,
          variables: {
            draftId,
            productVariantId,
            quantity: Number(quantity),
            sellingPlanId: sellingPlanId ?? null,
          },
        },
      }),
    );
    const addErrs = addRes?.data?.subscriptionDraftLineAdd?.userErrors ?? [];
    if (addErrs.length) {
      return json(
        { ok: false, step: "addLine", request: { draftId, productVariantId, quantity, sellingPlanId }, response: addRes },
        { status: 400 },
      );
    }

    // 5) Commit
    const comRes = await unwrapGraphQL(
      admin.query({ data: { query: MUT_COMMIT, variables: { draftId } } }),
    );
    const comErrs = comRes?.data?.subscriptionDraftCommit?.userErrors ?? [];
    if (comErrs.length) {
      return json(
        { ok: false, step: "commit", request: { draftId }, response: comRes },
        { status: 400 },
      );
    }

    const afterRes = await unwrapGraphQL(
      admin.query({ data: { query: Q_CONTRACT_LINES, variables: { id: contractId } } }),
    );

    return json({
      ok: true,
      shopFromToken: shop,
      contractId,
      request: { lineId, productVariantId, sellingPlanId, quantity },
      ownership,
      commit: { userErrors: comErrs },
      after: afterRes?.data?.subscriptionContract?.lines?.nodes ?? [],
      result: { status: "changed", message: "Product replaced successfully (remove + add)." },
    });
  } catch (e: any) {
    return json(
      { ok: false, error: { message: e?.message ?? "Unknown error" }, stack: e?.stack },
      { status: 500 },
    );
  }
}