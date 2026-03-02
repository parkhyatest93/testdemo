import {useExtensionApi} from './useExtensionApi';

interface SendRequestParams {
  contractId?: string;
  operationName: 'PAUSE' | 'RESUME';
}

/**
 * Send a request back to the remix app
 */
export function useAppRequest(): ({
  contractId,
  operationName,
}: SendRequestParams) => Promise<Response> {
  const {sessionToken} = useExtensionApi();

  let url: string;

  try {
    url = process.env.APP_URL || '';
  } catch (e) {
    console.error('Missing app url in useAppRequest');
    console.error(e);
    return () => Promise.resolve(new Response());
  }

  const fullUrl = `${url}/customerAccount/emails/`;

  async function sendAppRequest({
    contractId,
    operationName,
  }: SendRequestParams) {
    // Request a new (or cached) session token from Shopify
    const token = await sessionToken.get();

    const result = fetch(fullUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      method: 'POST',
      body: JSON.stringify({
        operationName,
        admin_graphql_api_id: contractId,
      }),
    });

    return result;
  }

  return sendAppRequest;
}
