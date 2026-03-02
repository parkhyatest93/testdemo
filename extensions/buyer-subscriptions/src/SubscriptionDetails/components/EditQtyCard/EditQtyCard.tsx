import {
  Card, BlockStack, InlineStack, TextField, Heading, Button,
} from '@shopify/ui-extensions-react/customer-account';
import {useApi} from '@shopify/ui-extensions-react/customer-account';
import {useState} from 'react';
import { QuantityInput } from '../QuantityInput';

interface EditQtyCardProps {
  defaultQty: number;
  lineId: string;      // gid://shopify/SubscriptionLine/...
  contractId: string;  // gid://shopify/SubscriptionContract/...
  onUpdated?: () => void;
  appUrl: string;      //: https://subscription-app.pfand-boxen.de
}

export function EditQtyCard({
                              defaultQty, lineId, contractId, onUpdated, appUrl,
                            }: EditQtyCardProps) {
  const api = useApi<'customer-account.order-status.block.render'>();
  const [value, setValue] = useState(String(defaultQty));
  const [loading, setLoading] = useState(false);

  const hasChanged = value.trim() !== '' && value !== String(defaultQty);

  async function handleUpdate() {
    setLoading(true);
    try {
      const token = await api.sessionToken.get();

      const res = await fetch(`${appUrl}/api/subscriptions/update-qty`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          contractId,
          lineId,
          quantity: Number(value),
        }),
      });

      const data = await res.json();

      if (!res.ok || data?.error) {
        console.error('Update qty failed:', data);
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
        <Heading level={2}>Menge aktualisieren</Heading>
        <InlineStack spacing="base" blockAlignment="end">


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
        </InlineStack>
      </BlockStack>
    </Card>
  );
}