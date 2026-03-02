import {
  Banner, BlockStack, Button, Spinner, Text,
  useBuyerJourneyIntercept, useEmail, useSessionToken, useCustomer
} from '@shopify/ui-extensions-react/checkout';
import * as React from 'react';
import {useAppMetafields, useCartLines} from '@shopify/ui-extensions-react/checkout';

const BASE_URL = process.env.BACKEND_URL_BASE+"api/";
type CheckResponse = { status?: boolean | number | string; message?: string };
const PROXY_CHECK  = BASE_URL + 'customer/check-active-subscription-by-email';
const PROXY_CANCEL = BASE_URL + 'checkout/cancel-subscription';

function isActiveStatus(v: unknown) {
  return v === true || v === 1 || v === "1" || v === "true";
}

 async function getSessionTokenCompat(st: ReturnType<typeof useSessionToken>): Promise<string> {
  try {
    if (typeof st === 'function') return await st();
    if (st && typeof (st as any).get === 'function') return await (st as any).get();
  } catch {}
  return '';
}



export function App() {

  const lines = useCartLines();

  const { hasSubscription, subscriptionLines } = React.useMemo(() => {
    const subs = lines.filter((l: any) =>
      !!l?.sellingPlanAllocation ||
      !!l?.merchandise?.sellingPlan ||
      l?.merchandise?.requiresSellingPlan === true ||
      ((l?.merchandise?.sellingPlanGroups?.length ?? 0) > 0)
    );
    return { hasSubscription: subs.length > 0, subscriptionLines: subs };
  }, [lines]);
  // console.log('subscriptionLines:', subscriptionLines,hasSubscription);
  const session = useSessionToken();
  const customer = useCustomer();
  const isLoggedIn = !!customer?.id;

  const emailValue = useEmail();
  const email = typeof emailValue === 'string' ? emailValue : '';

  const [state, setState] = React.useState<'checking' | 'active' | 'clear' | 'error'>('checking');
  const [msg, setMsg] = React.useState('');


  const [backendToken] = useAppMetafields({
    type: "customer",
    namespace: "custom",
    key: "backend_token",
  })
  console.log('wateringMetafield:', backendToken);


  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (!canBlockProgress) return {type: 'allow' as const};
    if (state === 'checking') return {type: 'block' as const, reason: 'Checking subscription…'};
    if (state === 'active') return {
      type: 'block' as const,
      reason: isLoggedIn ? 'Active subscription' : 'Login required'
    };
    return {type: 'allow' as const};
  });

  React.useEffect(() => {

    if (!hasSubscription) {
      setState('clear');
      setMsg('');
      return;
    }

    (async () => {
      try {
        const res = await fetch(PROXY_CHECK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email , backend_token: backendToken}),
        });
        const data: CheckResponse = await res.json().catch(() => ({} as CheckResponse));
        const active = isActiveStatus(data?.status);
        setMsg(data?.message || '');
        setState(active ? 'active' : 'clear');
      } catch (e: any) {
        setState('error');
        setMsg(e?.message || 'Failed to check subscription');
      }
    })();
  }, [email]);

  if (state === 'checking') {
    return (
      <BlockStack spacing="tight">
        <Spinner />
        <Text>Checking your subscription…</Text>
      </BlockStack>
    );
  }

  if (state === 'active') {
    if (!isLoggedIn) {
      return (
        <Banner status="critical" title="Login required">
          <BlockStack spacing="loose">
            {msg ? <Text>{msg}</Text> : null}
            <Text>You have an active subscription. Please log in to cancel it.</Text>
            <BlockStack spacing="tight">
              <Button kind="primary" to="/account/login?return_to=/checkout">Log in to continue</Button>
              <Button onPress={() => setState('checking')}>I have logged in — recheck</Button>
            </BlockStack>
          </BlockStack>
        </Banner>
      );
    }

    return (
      <Banner status="critical" title="Active subscription detected">
        <BlockStack spacing="loose">
          {msg ? <Text>{msg}</Text> : null}
          <Text>You already have an active subscription. Cancel it to proceed.</Text>
          <Button
            kind="primary"
            onPress={async () => {
              try {
                const token = await getSessionTokenCompat(session);
                const r = await fetch(PROXY_CANCEL, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`,
                  },
                  body: JSON.stringify({ email, backend_token: backendToken, source: 'checkout_block' }),
                });
                if (r.ok) {
                  setState('clear');
                } else {
                  const d = await r.json().catch(() => ({}));
                  setMsg(d?.message || 'Cancel failed');
                }
              } catch (e: any) {
                setMsg(e?.message || 'Cancel failed');
              }
            }}
          >
            Cancel subscription &amp; continue
          </Button>
        </BlockStack>
      </Banner>
    );
  }

  if (isLoggedIn && email.length && state === 'error') {
    return (
      <Banner status="warning" title="We could not verify your subscription">
        <Text>{msg}</Text>
      </Banner>
    );
  }

  return null;
}