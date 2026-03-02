import {
  Banner,
  BlockStack,
  Text,
  useCartLines,
  useDiscountCodes,
  useApplyDiscountCodeChange,
  useAppliedGiftCards,
  useApplyGiftCardChange,
  useSessionToken,
} from '@shopify/ui-extensions-react/checkout';
import {useEffect, useMemo, useRef, useState} from 'react';

type DisableDiscountResponse = {
  status: boolean;
  disableDiscounts: boolean;
  blockedVariants: string[];
  message?: string;
  error?: string;
};

// Remix route URL (inside your app)
const CHECK_URL =
  (process.env.APP_URL ?? '') + '/api/checkout/check-disable-discount-code';

function App() {
  const cartLines = useCartLines();
  const discountCodes = useDiscountCodes();
  const appliedGiftCards = useAppliedGiftCards();

  const applyDiscountCodeChange = useApplyDiscountCodeChange();
  const applyGiftCardChange = useApplyGiftCardChange();

  const sessionToken = useSessionToken();

  const variantIds = useMemo(
    () => cartLines.map((l) => l.merchandise.id),
    [cartLines],
  );

  const [disableDiscounts, setDisableDiscounts] = useState(false);
  const [blockedVariants, setBlockedVariants] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [showRemovedBanner, setShowRemovedBanner] = useState(false);

  const lastPayload = useRef('');
  const removingRef = useRef(false);

  /* ---------------------------
   * 1) Ask server if any variant has custom.disable_discount_code = true
   * --------------------------- */
  useEffect(() => {
    if (variantIds.length === 0) {
      setDisableDiscounts(false);
      setBlockedVariants([]);
      setShowRemovedBanner(false);
      return;
    }

    const payload = JSON.stringify({variantIds});
    if (payload === lastPayload.current) return;
    lastPayload.current = payload;

    let cancelled = false;

    (async () => {
      setChecking(true);
      try {
        const token = await sessionToken.get();

        const r = await fetch(CHECK_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // IMPORTANT: needed for shopFromBearer() in your Remix route
            Authorization: `Bearer ${token}`,
          },
          body: payload,
        });

        const data: DisableDiscountResponse = await r.json();

        if (!r.ok || !data?.status) {
          throw new Error(data?.error || `HTTP ${r.status}`);
        }

        if (cancelled) return;

        setDisableDiscounts(Boolean(data.disableDiscounts));
        setBlockedVariants(data.blockedVariants || []);

        // Reset banner when cart becomes "allowed" again
        if (!data.disableDiscounts) {
          setShowRemovedBanner(false);
        }
      } catch (e) {
        if (!cancelled) {
          setDisableDiscounts(false);
          setBlockedVariants([]);
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [variantIds.join(',')]);

  /* ---------------------------
   * 2) If discounts are disabled, remove any applied discount codes / gift cards
   * --------------------------- */
  useEffect(() => {
    const hasDiscountCodes = (discountCodes?.length || 0) > 0;
    const hasGiftCards = (appliedGiftCards?.length || 0) > 0;

    if (!disableDiscounts) return;
    if (!hasDiscountCodes && !hasGiftCards) return;

    // Avoid infinite loops while we are removing
    if (removingRef.current) return;

    removingRef.current = true;

    (async () => {
      try {
        // Remove discount codes
        if (hasDiscountCodes) {
          for (const d of discountCodes) {
            await applyDiscountCodeChange({
              type: 'removeDiscountCode',
              code: d.code,
            });
          }
        }

        // Remove gift cards
        // NOTE: appliedGiftCards provides lastCharacters. Shopify allows removing
        // with full code OR last four characters.
        if (hasGiftCards) {
          for (const g of appliedGiftCards) {
            await applyGiftCardChange({
              type: 'removeGiftCard',
              code: g.lastCharacters,
            });
          }
        }

        setShowRemovedBanner(true);
      } finally {
        removingRef.current = false;
      }
    })();
  }, [
    disableDiscounts,
    discountCodes.map((d) => d.code).join(','),
    appliedGiftCards.map((g) => g.lastCharacters).join(','),
  ]);

  /* ---------------------------
   * UI (German messages)
   * --------------------------- */
  if (!disableDiscounts && !checking) return null;

  return (
    <BlockStack spacing="tight">
      {checking && (
        <Banner status="info" title="Prüfe Gutschein-Regeln...">
          <Text>Bitte einen Moment warten.</Text>
        </Banner>
      )}

      {disableDiscounts && (
        <Banner status="critical" title="Rabattcode / Geschenkgutschein nicht möglich">
          <Text>
            Aufgrund der Produkte in Ihrem Warenkorb können Sie keinen Rabattcode
            und keinen Geschenkgutschein verwenden. Auch die Credits ($C) werden ihnen daher nicht angezeigt.
          </Text>

          {showRemovedBanner && (
            <Text>
              Bereits eingegebene Codes wurden automatisch entfernt.
            </Text>
          )}
        </Banner>
      )}
    </BlockStack>
  );
}

export default App;
export {App};