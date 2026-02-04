import { json, type LoaderFunctionArgs } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  return json({
    ok: true,
    ownerAppId: process.env.OWNER_APP_ID ?? null,
    pid: process.pid,
    cwd: process.cwd(),
    nodeEnv: process.env.NODE_ENV ?? null,
  });
}