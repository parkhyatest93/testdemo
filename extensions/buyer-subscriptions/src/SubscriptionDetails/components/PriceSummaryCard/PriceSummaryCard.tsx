import {
  Card,
  Grid,
  Text,
  BlockStack,
  InlineStack,
} from '@shopify/ui-extensions-react/customer-account';
import {useExtensionApi} from 'foundation/Api';
import type {Money, SubscriptionContractDetails, SubscriptionLine} from 'types';
import {SubscriptionLineItem} from '../SubscriptionLineItem';

export interface PriceSummaryCardProps {
  lines: SubscriptionLine[];
  onUpdated?: () => Promise<void> | void;
  price: {
    subtotalPrice: Money;
    totalTax?: Money;
    totalShippingPrice: Money;
    totalPrice: Money;
  };
  contract : SubscriptionContractDetails
}

export function PriceSummaryCard({price, lines , contract , onUpdated }: PriceSummaryCardProps) {
  const {i18n} = useExtensionApi();

  const discountTotal = lines.reduce((sum, line) => {
    const qty = line.quantity ?? 1;

    // original total = product unit price * quantity
    const baseTotal = Number(line.currentPrice.amount) * qty;

    // discounted total from subscription
    const discountedTotal = Number(line.lineDiscountedPrice.amount);

    const diff = baseTotal - discountedTotal;

    // only count positive discounts
    return diff > 0 ? sum + diff : sum;
  }, 0);

  const hasDiscount = discountTotal > 0.0001;

  console.log("discount",hasDiscount,discountTotal);
   return (
    <Card padding>
      <BlockStack spacing="loose">
        <BlockStack spacing="tight">
          {lines.map((line) => (
            <SubscriptionLineItem key={line.id} line={line}  contract ={contract} onUpdated={onUpdated} />
          ))}
        </BlockStack>
        <BlockStack spacing="tight">
          <Grid columns={['fill', 'auto']}>
            <Text>{i18n.translate('priceSummary.subtotal')}</Text>
            <Text>
              {i18n.formatCurrency(Number(price.subtotalPrice.amount), {
                currency: price.subtotalPrice.currencyCode,
                currencyDisplay: 'narrowSymbol',
              })}
            </Text>
          </Grid>
          {hasDiscount && (
            <Grid columns={['fill', 'auto']}>
              <Text appearance="subdued">Rabatt gesamt</Text>
              <Text appearance="critical">
                -
                {i18n.formatCurrency(discountTotal, {
                  currency: price.subtotalPrice.currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
            </Grid>
          )}
          <Grid columns={['fill', 'auto']}>
            <Text>{i18n.translate('priceSummary.shipping')}</Text>
            <Text>
              {i18n.formatCurrency(Number(price.totalShippingPrice.amount), {
                currency: price.totalShippingPrice.currencyCode,
                currencyDisplay: 'narrowSymbol',
              })}
            </Text>
          </Grid>
          {price.totalTax ? (
            <Grid columns={['fill', 'auto']}>
              <Text>{i18n.translate('priceSummary.taxes')}</Text>
              <Text>
                {i18n.formatCurrency(Number(price.totalTax.amount), {
                  currency: price.totalTax.currencyCode,
                  currencyDisplay: 'narrowSymbol',
                })}
              </Text>
            </Grid>
          ) : null}
        </BlockStack>
        <Grid columns={['fill', 'auto']}>
          <Text emphasis="bold" size="large">
            {i18n.translate('priceSummary.total')}
          </Text>
          <InlineStack blockAlignment="baseline" spacing="tight">
            <Text size="small" appearance="subdued">
              {price.totalPrice.currencyCode}
            </Text>
            <Text emphasis="bold" size="large">
              {i18n.formatCurrency(Number(price.totalPrice.amount), {
                currency: price.totalPrice.currencyCode,
                compactDisplay: 'short',
                currencyDisplay: 'narrowSymbol',
              })}
            </Text>
          </InlineStack>
        </Grid>
      </BlockStack>
    </Card>
  );
}
