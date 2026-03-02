import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  BlockStack,
  Text,
  useCustomer,
  useEmail,
  useSessionToken,
  useCartLines,
  useBuyerJourneyIntercept,
} from '@shopify/ui-extensions-react/checkout';

// --- Helper for session token ---
async function getSessionTokenCompat(st: ReturnType<typeof useSessionToken>): Promise<string> {
  try {
    if (typeof st === 'function') return await st();
    if (st && typeof (st as any).get === 'function') return await (st as any).get();
  } catch {}
  return '';
}

// --- API config ---
const ENDPOINT = process.env.BACKEND_URL_BASE +'api/checkout/check-product-buy';
const DEBOUNCE_MS = 400;

type ApiResponse = {
  purchased: boolean;
  orderIds: string[];
  message?: string;
};

function App() {
  const customer = useCustomer();
  const emailField = useEmail();
  const session = useSessionToken();
  const cartLines = useCartLines();

  // 📨 Collect email + cart info
  const email = useMemo(() => (customer?.email || emailField || '').trim(), [customer?.email, emailField]);
  const variantIds = useMemo(
    () =>
      cartLines
        ?.map((l) => l.merchandise?.id)
        .filter((v): v is string => Boolean(v)) || [],
    [cartLines]
  );
  const productIds = useMemo(
    () =>
      cartLines
        ?.map((l) => l.merchandise?.product?.id)
        .filter((v): v is string => Boolean(v)) || [],
    [cartLines]
  );

  const [loading, setLoading] = useState(false);
  const [purchased, setPurchased] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPayloadRef = useRef<string>('');

  // 🚫 Prevent checkout if product already purchased
  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (canBlockProgress && purchased) {
      return {
        behavior: 'block',
        reason: 'already_purchased',
        perform: () => ({
          behavior: 'block',
          reason: 'already_purchased',
          errors: [
            {
              message:
                'Sie haben dieses Produkt bereits einmal gekauft. Dieser Artikel kann nur einmal pro Kunde gekauft werden.',
            },
          ],
        }),
      };
    }
    return { behavior: 'allow' };
  });

  // 🔁 Fetch check result whenever email or cart changes
  useEffect(() => {
    if (!email || !variantIds.length) {
      setPurchased(false);
      setError(null);
      return;
    }

    const payloadKey = JSON.stringify({ email, variantIds, productIds });
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (lastPayloadRef.current === payloadKey) return;
      lastPayloadRef.current = payloadKey;

      (async () => {
        setLoading(true);
        setError(null);
        try {
          const token = await getSessionTokenCompat(session);
          const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              email,
              variantIds,
              productIds,
            }),
          });

          const json = (await res.json().catch(() => ({}))) as Partial<ApiResponse>;
          if (!res.ok) throw new Error((json as any)?.message || `HTTP ${res.status}`);

          setPurchased(Boolean(json?.purchased));
        } catch (e: any) {
          setError(e?.message || 'Netzwerkfehler');
          setPurchased(false);
        } finally {
          setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [email, JSON.stringify(variantIds), JSON.stringify(productIds), session]);

  return (
    <BlockStack spacing="tight">
      {loading && (
        <Banner status="info" title="Überprüfung läuft">
          <Text>Wir prüfen, ob Sie dieses Produkt bereits gekauft haben…</Text>
        </Banner>
      )}
      {error && !loading && (
        <Banner status="critical" title="Fehler">
          <Text>{error}</Text>
        </Banner>
      )}
      {purchased && !loading && !error && (
        <Banner status="warning" title="Bereits gekauft">
          <Text>
            Sie haben dieses Produkt bereits einmal gekauft. Dieser Artikel kann nur einmal pro Kunde gekauft werden.
          </Text>
        </Banner>
      )}
    </BlockStack>
  );
}

export { App };
export default App;