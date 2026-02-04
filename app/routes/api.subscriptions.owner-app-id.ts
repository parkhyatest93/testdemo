import { json, type LoaderFunctionArgs } from "@remix-run/node";
import * as shopModule from "~/shopify.server";

/** Helpers */
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
  return m.sessionStorage ?? m.shopify?.sessionStorage ?? m.api?.sessionStorage;
}
async function getOfflineAccessToken(shop: string) {
  const s = resolveSessionStorage();
  const sessions =
    typeof s.findSessionsByShop === "function"
      ? await s.findSessionsByShop(shop)
      : await s.findSessionsByShopId(shop);
  const offline = sessions.find((x: any) => !x.isOnline) ?? sessions[0];
  if (!offline?.accessToken) throw new Error("No offline access token");
  return offline.accessToken as string;
}
async function gql(shop: string, token: string, query: string) {
  const res = await fetch(`https://${shop}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

export async function loader({ request }: LoaderFunctionArgs) {
  const auth = request.headers.get("authorization") || "";
  const shop = extractShopFromBearer(auth);
  if (!shop) return json({ error: "Missing/invalid bearer" }, { status: 401 });

  const token = await getOfflineAccessToken(shop);
  const q = `query { currentAppInstallation { app { id title } } }`;
  const data = await gql(shop, token, q);
  const gid = data?.data?.currentAppInstallation?.app?.id as string | undefined; // e.g. gid://shopify/App/262104088577
  const title = data?.data?.currentAppInstallation?.app?.title;
  const numericId = gid ? Number(gid.split("/").pop()) : null;

  return json({ ok: true, shop, app: { id: gid, numericId, title } });
}