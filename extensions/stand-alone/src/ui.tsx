import {
  Banner,
  BlockStack,
  Button,
  Text,
  useBuyerJourneyIntercept,
  useCartLines,
  useApplyCartLinesChange,
  useSessionToken,
} from '@shopify/ui-extensions-react/checkout';
import {useEffect, useMemo, useRef, useState} from 'react';

type StandAloneResponse = {
  status: boolean;
  hasStandAlone: boolean;
  standAloneVariantIds: string[];
  message?: string;
  error?: string;
};

const CHECK_URL = (process.env.APP_URL ?? '')+'/api/checkout/check-stand-alone';

function App() {
  const cartLines = useCartLines();
  const applyCartLinesChange = useApplyCartLinesChange();
  const sessionToken = useSessionToken();

  const variantIds = useMemo(() => cartLines.map(l => l.merchandise.id), [cartLines]);

  const [standAloneVariantIds, setStandAloneVariantIds] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [removedOnce, setRemovedOnce] = useState(false);

  const lastPayload = useRef('');

  // 1) Ask server which variants are stand-alone
  useEffect(() => {
    if (!variantIds.length) {
      setStandAloneVariantIds([]);
      setRemovedOnce(false);
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
            Authorization: `Bearer ${token}`,
          },
          body: payload,
        });

        const data: StandAloneResponse = await r.json();
        if (!r.ok || !data?.status) throw new Error(data?.error || `HTTP ${r.status}`);

        if (!cancelled) {
          setStandAloneVariantIds(data.standAloneVariantIds || []);
          if (!(data.standAloneVariantIds || []).length) setRemovedOnce(false);
        }
      } catch {
        if (!cancelled) setStandAloneVariantIds([]);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();

    return () => { cancelled = true; };
  }, [variantIds.join(',')]);

  // 2) Compute violation: stand-alone exists + other items exist
  const standAloneLines = useMemo(
    () => cartLines.filter(l => standAloneVariantIds.includes(l.merchandise.id)),
    [cartLines, standAloneVariantIds.join(',')]
  );

  const otherLines = useMemo(
    () => cartLines.filter(l => !standAloneVariantIds.includes(l.merchandise.id)),
    [cartLines, standAloneVariantIds.join(',')]
  );

  const hasViolation = standAloneLines.length > 0 && otherLines.length > 0;

  // 3) Optional: block progress until resolved
  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (hasViolation && canBlockProgress) {
      return {
        behavior: 'block',
        reason: 'stand_alone_conflict',
        errors: [{message: 'Dieser Artikel muss alleine gekauft werden. Bitte entfernen Sie die anderen Produkte.'}],
      };
    }
    return {behavior: 'allow'};
  });

  // 4) Button action: remove all non-stand-alone items
  const onRemoveOthers = async () => {
    if (!hasViolation || removing) return;
    setRemoving(true);
    try {
      for (const line of otherLines) {
        await applyCartLinesChange({
          type: 'removeCartLine',
          id: line.id,
          quantity: line.quantity, // remove entire line
        });
      }
      setRemovedOnce(true);
    } finally {
      setRemoving(false);
    }
  };

  // UI: only show when violation exists (or while checking/removing)
  if (!hasViolation && !checking && !removing) return null;

  return (
    <BlockStack spacing="tight">
      {checking && (
        <Banner status="info" title="Regel wird geprüft...">
          <Text>Bitte einen Moment warten.</Text>
        </Banner>
      )}

      {hasViolation && (
        <Banner status="critical" title="Dieser Artikel muss alleine gekauft werden">
          <Text>
            In Ihrem Warenkorb befindet sich ein Produkt, das nur einzeln bestellt werden kann.
            Bitte entfernen Sie die anderen Produkte.
          </Text>
          <Button onPress={onRemoveOthers} disabled={removing}>
            {removing ? 'Produkte werden entfernt…' : 'Andere Produkte entfernen'}
          </Button>
        </Banner>
      )}

      {!hasViolation && removedOnce && (
        <Banner status="success" title="Warenkorb angepasst">
          <Text>Die anderen Produkte wurden entfernt. Sie können jetzt fortfahren.</Text>
        </Banner>
      )}
    </BlockStack>
  );
}

export default App;
export {App};