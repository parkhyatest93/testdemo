import {
  Text,
  BlockStack,
  InlineLayout,
  ProductThumbnail,
  Button,
  useApi,
  InlineStack,
  Divider,
} from '@shopify/ui-extensions-react/customer-account';
import {useExtensionApi} from 'foundation/Api';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {SubscriptionContractDetails, SubscriptionLine} from 'types';
import {QuantityInput} from '../QuantityInput';

type Props = {
  line: SubscriptionLine;
  contract: SubscriptionContractDetails;
  onUpdated?: () => void;
};

export function SubscriptionLineItem({line, contract, onUpdated}: Props) {
  const {i18n} = useExtensionApi();
  const api = useApi<'customer-account.page.render'>();
  const app_url = process.env.SHOPIFY_APP_URL || ''

  // --- state
  const [loading, setLoading] = useState(false);
  const [value, setValue] = useState(String(line.quantity ?? 1));

  // keep state in sync if parent re-renders with a different quantity
  useEffect(() => {
    setValue(String(line.quantity ?? 1));
  }, [line.quantity]);

  const toInt = (s: string) => {
    const n = Number(String(s).replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? Math.max(1, n) : 1;
  };
  const qty = useMemo(() => toInt(value), [value]);
  const hasChanged = qty !== Number(line.quantity ?? 1);

  // mounted guard to avoid setState on unmounted component
  const isMounted = useRef(true);
  useEffect(() => () => { isMounted.current = false; }, []);

  async function handleUpdate() {
    if (!hasChanged || loading) return;
    setLoading(true);
    try {
      const token = await api.sessionToken.get();
      const res = await fetch(`${app_url}/api/subscriptions/update-qty`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          contractId: contract.id,
          lineId: line.id,
          quantity: qty,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        console.error('Update qty failed:', data);
        return;
      }
      await onUpdated?.();
    } catch (e) {
      console.error(e);
    } finally {
      if (isMounted.current) setLoading(false);
    }
  }

  async function removeItem() {
    if (loading) return;
    setLoading(true);
    let ok = false;

    try {
      const token = await api.sessionToken.get();
      const res = await fetch(`${app_url}/api/subscriptions/remove-product`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({ contractId: contract.id, lineId: line.id }),
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        console.error('remove-line failed:', data);
        return;
      }

      if (data?.result?.status === 'removed' || data?.removed === true) {
        ok = true;
        await onUpdated?.();
      } else {
        console.warn('remove-line not removed after commit', data);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  console.log(line);
  const currentPrice = Number(line.currentPrice.amount);
  const discountedPrice = Number(line.lineDiscountedPrice.amount);
  const currency = line.currentPrice.currencyCode;
  const isDiscounted = discountedPrice < currentPrice * line.quantity;

  return (
    <BlockStack spacing="base">
      {/* top row: thumbnail | texts | price */}
      <InlineLayout
        columns={['auto', 'fill', 'auto']}
        spacing="base"
        blockAlignment="center"
        inlineAlignment="start"
      >
        <ProductThumbnail source={line.image?.url} badge={line.quantity} />

        <BlockStack spacing="extraTight">
          <Text>{line.title}</Text>
          {line.variantTitle && <Text appearance="subdued">{line.variantTitle}</Text>}
          {line.quantity > 1 ? (
            <Text size="small" appearance="subdued">
              {i18n.translate('priceSummary.quantity', {
                quantity: i18n.formatCurrency(currentPrice, {
                  currency,
                  compactDisplay: 'short',
                  currencyDisplay: 'narrowSymbol',
                }),
              })}
            </Text>
          ) : null}
        </BlockStack>

        <BlockStack spacing="none" inlineAlignment="end">
          <Text
            size={isDiscounted ? 'small' : 'base'}
            appearance={isDiscounted ? 'subdued' : 'base'}
            accessibilityRole={isDiscounted ? 'deletion' : undefined}
          >
            {i18n.formatCurrency(currentPrice * line.quantity, {
              currency,
              compactDisplay: 'short',
              currencyDisplay: 'narrowSymbol',
            })}
          </Text>
          {isDiscounted && (
            <Text>
              {i18n.formatCurrency(discountedPrice, {
                currency,
                compactDisplay: 'short',
                currencyDisplay: 'narrowSymbol',
              })}
            </Text>
          )}
        </BlockStack>
      </InlineLayout>

      {/* bottom row: quantity stepper + save + remove (one horizontal row) */}
      <InlineStack spacing="base" blockAlignment="center" inlineAlignment="start">
        <QuantityInput
          label="Anzahl"
          value={value}
          setValue={setValue}
          min={1}
          disabled={loading}
        />
        <Button
          kind="primary"
          disabled={!hasChanged || loading}
          onPress={handleUpdate}
        >
          {loading ? 'Speichern…' : 'Speichern'}
        </Button>
        <Button
          kind="plain"
          tone="critical"
          onPress={removeItem}
          disabled={loading}
          accessibilityLabel="Remove item"
        >
          {loading ? 'löschen…' : 'löschen'}
        </Button>
      </InlineStack>

      {/* separator */}
      <Divider />
    </BlockStack>
  );
}