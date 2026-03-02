import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  BlockStack,
  Button,
  Divider,
  InlineStack,
  Text,
  View,
  useEmail,
  useSessionToken,
  useCustomer,
  useShippingAddress,
  useCurrency,
  useTotalAmount,
  useApplyGiftCardChange, useCartLines,
} from '@shopify/ui-extensions-react/checkout';

async function getSessionTokenCompat(st: ReturnType<typeof useSessionToken>): Promise<string> {
  try {
    if (typeof st === 'function') return await st();
    if (st && typeof (st as any).get === 'function') return await (st as any).get();
  } catch {}
  return '';
}

const BASE_URL = process.env.BACKEND_URL_BASE+'api/checkout';
const GET_URL = BASE_URL+ '/getAllHolding';
const TRANSFER_URL = BASE_URL+ '/transferCreditToGiftCard';
const TRANSFER_SOIL_URL = BASE_URL+ '/transferSoilPointToCoupon';
const CHECK_STAND_ALONE_URL = (process.env.APP_URL ?? '')+'/api/checkout/check-stand-alone';

const DEBOUNCE_MS = 400;

type HoldingResponse = {
  creditBalance: number;
  creditBalanceCurrency: string;
  soilPoint: number;
};

type StandAloneResponse = {
  status: boolean;
  hasStandAlone: boolean;
  standAloneVariantIds: string[];
  message?: string;
  error?: string;
};


export function App() {

  const cartLines = useCartLines();

  const variantIds = useMemo(() => cartLines.map(l => l.merchandise.id), [cartLines]);

  const  hideSoilPoint = true ;
  const [hideBackendBox, setHideBackendBox] = useState(false);
  const session = useSessionToken();
  const emailField = useEmail();
  const customer = useCustomer();
  const shippingAddress = useShippingAddress();
  const currencyCode = useCurrency().isoCode;
  const totalAmount = useTotalAmount();

  const applyGiftCardChange = useApplyGiftCardChange();
  const applyDiscountCodeChange = useApplyGiftCardChange(); // 👈

  const email = useMemo(() => customer?.email ?? emailField ?? '', [customer, emailField]);
  const isLoggedIn = Boolean(customer?.id);

  const addressKey = useMemo(() => {
    const a = shippingAddress;
    return JSON.stringify({
      country: a?.countryCode,
      province: a?.provinceCode || a?.province,
      zip: a?.zip,
      city: a?.city,
      a1: a?.address1,
      a2: a?.address2,
    });
  }, [shippingAddress]);

  const requestKey = useMemo(
    () => `${email}|${currencyCode}|${addressKey}`,
    [email, currencyCode, addressKey]
  );

  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [data, setData] = useState<HoldingResponse | null>(null);

  const lastExecutedKeyRef = useRef<string>('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🎁 Gift card
  const [giftCardCode, setGiftCardCode] = useState<string | null>(null);
  const [transferringCredit, setTransferringCredit] = useState(false);
  const [transferMsg, setTransferMsg] = useState<string | null>(null);

  // 🟤 SOIL -> Coupon
  const [soilCouponCode, setSoilCouponCode] = useState<string | null>(null);
  const [transferringSoil, setTransferringSoil] = useState(false);
  const [soilMsg, setSoilMsg] = useState<string | null>(null);


  // Check for stand_alone items in cart
  useEffect(() => {
    if (!session) return;

    // If cart is empty, show the box again
    if (variantIds.length === 0) {
      setHideBackendBox(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const token = await getSessionTokenCompat(session);

        const payload = JSON.stringify({ variantIds });

        const r = await fetch(CHECK_STAND_ALONE_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: payload,
        });

        const resp: StandAloneResponse = await r.json();

        if (!r.ok || !resp?.status) {
          throw new Error(resp?.error || `HTTP ${r.status}`);
        }

        if (cancelled) return;

        // Option A: hide the backend box whenever ANY stand_alone item exists
        setHideBackendBox(Boolean(resp.hasStandAlone));

      } catch (e) {
        if (!cancelled) setHideBackendBox(false);
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [session, variantIds.join(','), cartLines.length]);

  // Fetch balances
  useEffect(() => {
    if (!session || !isLoggedIn) return;
    console.log("login and seesion", session, isLoggedIn);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (lastExecutedKeyRef.current === requestKey) return;
      lastExecutedKeyRef.current = requestKey;

      (async () => {
        try {
          setLoading(true);
          setErr(null);
          const token = await getSessionTokenCompat(session);

          const res = await fetch(GET_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              email,
              currencyCode,
              source: 'checkout_block',
            }),
          });

          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json?.message || `HTTP ${res.status}`);

          const d: HoldingResponse = {
            creditBalance: parseFloat(json?.data?.creditBalance || '0'),
            creditBalanceCurrency: json?.data?.creditBalanceCurrency || currencyCode,
            soilPoint: parseFloat(json?.data?.soilPoint || '0'),
          };
          setData(d);
        } catch (e: any) {
          setErr(e?.message || 'Network error');
        } finally {
          setLoading(false);
        }

      })();
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [session, isLoggedIn, requestKey, email, currencyCode]);

  function calcCredit(current , percent = 25){
    let total = typeof totalAmount?.amount === 'string'
        ? parseFloat(totalAmount.amount)
        : (totalAmount?.amount as number) || 0;

   // console.log(total,current,(total/2),current > (total/100 * percent));
     if(current < (total/percent * 100)){
      return current;
     }
     return total/percent * 100;
  }

  function calcResetCredit(current , percent){
    return current - calcCredit(current , percent);
  }
  // Credits -> Gift card
  const transferCredits = async () => {
    if (transferringCredit) return;

    try {
      setTransferringCredit(true);
      setTransferMsg(null);

      const token = await getSessionTokenCompat(session);
      const orderTotal =
        typeof totalAmount?.amount === 'string'
          ? parseFloat(totalAmount.amount)
          : (totalAmount?.amount as number) || 0;

      const credit= calcCredit(data?.creditBalance , 100);

      const r = await fetch(TRANSFER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          currencyCode,
          orderTotal: credit,
          source: 'checkout_block',
        }),
      });

      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp?.message || `HTTP ${r.status}`);

      if (resp?.data?.giftCardCode) setGiftCardCode(resp.data.giftCardCode);
      setTransferMsg(resp?.message || 'Transfer complete.');
    } catch (e: any) {
      setTransferMsg(e?.message || 'Transfer failed.');
    } finally {
      setTransferringCredit(false);
    }
  };
  const ZERO_WIDTH_REGEX = /[\u200B-\u200D\uFEFF]/g; // zero-width chars
  function sanitizeReductionCode(raw?: string | null) {
    return (raw ?? '')
      .replace(ZERO_WIDTH_REGEX, '')
      .replace(/\s+/g, ' ')        // collapse internal spaces
      .trim()                      // remove leading/trailing
      .normalize('NFKC');          // canonical unicode
  }
  // SOIL -> Coupon/Discount
  const transferSoilCredits = async () => {
    try {
      setTransferringSoil(true);
      setSoilMsg(null);

      const token = await getSessionTokenCompat(session);
      const orderTotal =
        typeof totalAmount?.amount === 'string'
          ? parseFloat(totalAmount.amount)
          : (totalAmount?.amount as number) || 0;

      const credit= calcCredit(data?.soilPoint , 50);

      const r = await fetch(TRANSFER_SOIL_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          currencyCode,
          orderTotal: credit,
          source: 'checkout_block',
        }),
      });

      const resp = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(resp?.message || `HTTP ${r.status}`);

      const code =
        resp?.data?.couponCode ||
        resp?.data?.discountCode ||
        resp?.data?.code ||
        null;

        setSoilCouponCode(code);


      setSoilMsg(resp?.message || 'SOIL transfer complete.');
    } catch (e: any) {
      setSoilMsg(e?.message || 'SOIL transfer failed.');
    } finally {
      setTransferringSoil(false);
    }
  };

  // Apply gift card
  const applyGiftCard = async () => {
    if (!giftCardCode) return;
    await applyGiftCardChange({ type: 'addGiftCard', code: giftCardCode });
  };

  // Apply discount/coupon
  const applySoilCoupon = async () => {
     if (!soilCouponCode) return;
    await applyDiscountCodeChange({ type: 'addGiftCard', code: soilCouponCode });
  };

  const fmt = (v: number, curr = data?.creditBalanceCurrency || currencyCode) =>
    new Intl.NumberFormat('de-AT', { style: 'currency', currency: curr }).format(v ?? 0);

  const calcMaxCredit= (current,total)=>{
    return total/2;
  }

  return (
    <BlockStack spacing="tight">
      {!isLoggedIn && !hideBackendBox && (
        <Banner status="warning" title="Sign in required">
          <Text>Sign in to view balances.</Text>
        </Banner>
      )}

      {isLoggedIn && !hideBackendBox && loading && (
        <Banner status="info" title="Loading">
          <Text>Fetching your balances…</Text>
        </Banner>
      )}

      {isLoggedIn && !hideBackendBox && err && (
        <Banner status="critical" title="Error">
          <Text>{err}</Text>
        </Banner>
      )}

      {isLoggedIn && !hideBackendBox && !loading && !err && data && (
        <View border="base" borderRadius="large" padding="base" background="subdued">
          <BlockStack spacing="tight">

            {/* SOIL */}

            { !hideSoilPoint && ( <Row label="SOIL Points €:" value={fmt(data.soilPoint)} strongLabel />)}

            { !hideSoilPoint && ( <Inset><Row label="> Einlösen?" value={fmt(calcCredit(data.soilPoint , 50))} strongValue /></Inset>)}
            { !hideSoilPoint && ( <Row label="SOIL Points Rest:" value={fmt(calcResetCredit(data.soilPoint, 50 ))} accent />)}

            {!hideSoilPoint && data.soilPoint > 0 && (
              <Button kind="primary" onPress={transferSoilCredits} loading={transferringSoil}>
                Transfer SOIL to Coupon
              </Button>
            )}
            {!hideSoilPoint && soilMsg && <Text appearance="subdued">{soilMsg}</Text>}

            {!hideSoilPoint && soilCouponCode && (
              <Button kind="secondary" onPress={applySoilCoupon}>
                Apply Coupon {soilCouponCode}
              </Button>
            )}


            <Divider />

            {/* Credits */}
            <Row label="Credits:" value={fmt(data.creditBalance)} strongLabel />
            <Inset><Row label="> Einlösen?" value={fmt(calcCredit(data.creditBalance, 100))} strongValue /></Inset>
            <Row label="Credits Rest:" value={fmt(calcResetCredit(data.creditBalance , 100))} accent />

            {data.creditBalance > 0 && (
              <Button kind="primary" onPress={transferCredits} loading={transferringCredit}>
                Credits in Gutschein umwandeln
              </Button>
            )}
            {transferMsg && <Text appearance="subdued">{transferMsg}</Text>}

            {giftCardCode && (
              <Button kind="secondary"  onPress={applyGiftCard}>
                Gutschein einlösen: {giftCardCode}
              </Button>
            )}

          </BlockStack>
        </View>
      )}
    </BlockStack>
  );
}

function Row({ label, value, strongLabel, strongValue, accent }:{
  label:string; value:string;
  strongLabel?:boolean; strongValue?:boolean; accent?:boolean;
}) {
  return (
    <InlineStack align="space-between" wrap={false}>
      <Text emphasis={strongLabel ? 'bold' : 'none'}>{label}</Text>
      <Text emphasis={strongValue ? 'bold' : 'none'} appearance={accent ? 'accent' : 'default'}>
        {value}
      </Text>
    </InlineStack>
  );
}
function Inset({ children }: { children: React.ReactNode }) {
  return <View border="base" borderRadius="large" padding="tight">{children}</View>;
}