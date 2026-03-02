// EditProductCard.tsx
import {
  Card,
  BlockStack,
  InlineStack,
  Heading,
  Button,
  Select,
  useApi,
} from '@shopify/ui-extensions-react/customer-account';
import {useEffect, useMemo, useState} from 'react';
import {QuantityInput} from '../QuantityInput';

interface EligibleItem {
  // matches API response shape: { label, value, sellingPlanId? }
  label: string;
  value: string; // gid://shopify/ProductVariant/...
  sellingPlanId?: string | null;
}

interface EditProductCardProps {
  defaultQty: number;
  lineId: string;
  contractId: string;
  onUpdated?: () => void;
}

export function EditProductCard({
                                  defaultQty,
                                  lineId,
                                  contractId,
                                  onUpdated,
                                }: EditProductCardProps) {
  const appUrl = process.env.SHOPIFY_APP_URL || ''
  const api = useApi<'customer-account.page.render'>();
  const [qty, setQty] = useState(String(defaultQty));
  const [loading, setLoading] = useState(false);

  const [options, setOptions] = useState<EligibleItem[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState<string>('');

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        setLoadingOptions(true);
        const token = await api.sessionToken.get();

        const res = await fetch(`${appUrl}/api/subscriptions/eligible-variants`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            contractId,
            lineId,
          }),
        });

        const data = await res.json();
        if (!alive) return;

        // Be defensive: accept either `items` or `options`
        const rawItems: unknown =
          (Array.isArray(data.items) && data.items) ||
          (Array.isArray(data.options) && data.options) ||
          [];

        if (res.ok && data?.ok && Array.isArray(rawItems)) {
          const casted = rawItems as EligibleItem[];
          setOptions(casted);

          // Auto-select first variant if present
          if (casted[0]?.value) {
            setSelectedVariantId(casted[0].value);
          } else {
            setSelectedVariantId('');
          }
        } else {
          console.error('eligible-variants error:', data);
          setOptions([]);
          setSelectedVariantId('');
        }
      } catch (e) {
        console.error(e);
        setOptions([]);
        setSelectedVariantId('');
      } finally {
        if (alive) setLoadingOptions(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [api.sessionToken, appUrl, contractId, lineId]);

  const selectOptions = useMemo(
    () =>
      options.map((it) => ({
        label: it.label,
        value: it.value,
      })),
    [options],
  );

  const hasSelection = Boolean(selectedVariantId);

  async function handleReplace() {
    if (!hasSelection) return;
    setLoading(true);
    try {
      const token = await api.sessionToken.get();

      const picked = options.find((o) => o.value === selectedVariantId);

      const res = await fetch(`${appUrl}/api/subscriptions/update-product`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contractId,
          lineId,
          variantId: selectedVariantId,
          // if you need sellingPlanId for the backend:
          sellingPlanId: picked?.sellingPlanId ?? undefined,
          quantity: Number(qty) || 1,
        }),
      });

      const data = await res.json();
      if (!res.ok || data?.error) {
        console.error('update-product failed:', data);
        return;
      }
      onUpdated?.();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card padding>
      <BlockStack spacing="base">
        <Heading level={2}>hinzufügen</Heading>

        <Select
          label="Produkt / Variante"
          options={selectOptions}
          value={selectedVariantId}
          onChange={setSelectedVariantId}
          disabled={loadingOptions || loading}
          placeholder={loadingOptions ? 'Lade…' : 'Wähle ein Produkt'}
        />

        <InlineStack spacing="base" blockAlignment="end">
          <QuantityInput
            value={qty}
            setValue={setQty}
            disabled={loading || loadingOptions}
          />

          <Button
            kind="primary"
            onPress={handleReplace}
            disabled={loading || loadingOptions || !hasSelection}
          >
            {loading ? 'Speichern…' : 'Hinzufügen'}
          </Button>
        </InlineStack>
      </BlockStack>
    </Card>
  );
}