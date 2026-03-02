import {
  Banner,
  BlockStack,
  Text,
  useBuyerJourneyIntercept,
  useEmail,
  useCartLines,
} from '@shopify/ui-extensions-react/checkout';
import { useEffect, useMemo, useRef, useState } from 'react';

type VerifyResponse = {
  status: boolean;
  alreadyPurchasedVariants: string[];
  message?: string;
  error?: string;
};

const VERIFY_URL =
  (process.env.BACKEND_URL_BASE ?? '') + 'api/checkout/check-max-purchase';

console.log('VERIFY_URL:', VERIFY_URL);

function App() {
  console.log("Check Max Purchase App loaded");

  const emailApi = useEmail();
  console.log('emailApi:', emailApi);
  const emailValue = emailApi?emailApi.trim() : '';
  console.log('emailValue:', emailValue);

  const cartLines = useCartLines();

  const variantIds = useMemo(
    () => cartLines.map(l => l.merchandise.id),
    [cartLines]
  );
  const productIds = useMemo(
    () =>
      cartLines
        ?.map((l) => l.merchandise?.product?.id)
        .filter((v): v is string => Boolean(v)) || [],
    [cartLines]
  );

  console.log('variantIds:', variantIds);
  console.log('productIds:', productIds);

  const [dups, setDups] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const lastPayload = useRef('');

  useEffect(() => {
    console.log("useEffect triggered");

    if (!emailValue || variantIds.length === 0) {
      console.log('Email or variantIds are missing');
      setDups([]);
      return;
    }

    const payload = JSON.stringify({ email: emailValue, variantIds, productIds });
    console.log('Payload:', payload);

    if (payload === lastPayload.current) {
      console.log('Payload is the same as the last one. Skipping request.');
      return;
    }

    lastPayload.current = payload;

    setChecking(true);
    fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
    })
      .then(async r => {
        const data: VerifyResponse = await r.json();
        console.log('Response received:', data);

        if (!r.status || !data?.status) {
          console.log('Error response:', data?.error || `HTTP ${r.status}`);
          throw new Error(data?.error || `HTTP ${r.status}`);
        }
        setDups(data.alreadyPurchasedVariants || []);
      })
      .catch(() => {
        console.log('Error occurred during fetch');
        setDups([]);
      })
      .finally(() => {
        setChecking(false);
        console.log('Fetch completed or failed');
      });
  }, [emailValue, variantIds.join(','), productIds.join(',')]);

  useBuyerJourneyIntercept(({ canBlockProgress }) => {
    if (dups.length > 0 && canBlockProgress) {
      console.log('Blocking progress due to duplicate purchase');
      return {
        behavior: 'block',
        reason: 'already_purchased',
        errors: [{ message: 'You already purchased one or more items in your cart.' }],
      };
    }
    return { behavior: 'allow' };
  });

  // UI
  if (!checking && dups.length === 0 && emailValue) return null;

  return (
    <BlockStack spacing="tight">
      {!emailValue && variantIds.length > 0 && (
        <Banner status="info" title="Enter your email to validate previous purchases." />
      )}
      {checking && (
        <Banner status="info" title="Checking previous purchases...">
          <Text>This takes a moment.</Text>
        </Banner>
      )}
      {dups.length > 0 && (
        <Banner status="critical" title="Duplicate purchase detected">
          <Text>Please remove the duplicated products to proceed.</Text>
        </Banner>
      )}
    </BlockStack>
  );
}
export  default App;
export {App};