import {parseGid} from '@shopify/admin-graphql-api-utilities';
import {
  Badge,
  BlockStack,
  Box,
  Icon,
  InlineStack,
  Link,
  Text,
  Thumbnail,
  useBreakpoints,
} from '@shopify/polaris';
import {AlertCircleIcon, ImageIcon} from '@shopify/polaris-icons';
import {useTranslation} from 'react-i18next';
import type {SubscriptionContractDetailsLine} from '~/types/contracts';
import {formatPrice} from '~/utils/helpers/money';
import styles from './SubscriptionLineItem.module.css';

export interface SubscriptionLineItemProps {
  line: SubscriptionContractDetailsLine;
  isOutOfStock?: boolean;
}

export function SubscriptionLineItem({
  line,
  isOutOfStock = false,
}: SubscriptionLineItemProps) {
  const {t, i18n} = useTranslation('app.contracts');
  const locale = i18n.language;
  const {smDown} = useBreakpoints();
  const isMobile = smDown;

  const {
    title,
    variantTitle,
    variantImage,
    currentPrice,
    pricingPolicy,
    lineDiscountedPrice,
    quantity,
    productId,
  } = line;

  const oneTimePurchasePrice = pricingPolicy?.basePrice;

  return (
    <InlineStack
      gap={{xs: '800', sm: '200', md: '200', lg: '200', xl: '200'}}
      align="space-between"
      blockAlign="start"
      wrap={false}
    >
      <div style={{flexGrow: 1}}>
        <InlineStack gap="300" wrap={false} align="space-between">
          <Box padding="0">
            <Thumbnail
              source={variantImage?.url ?? ImageIcon}
              alt={variantImage?.altText ?? ''}
              size={isMobile ? 'medium' : 'small'}
            />
          </Box>
          <div style={{flexGrow: 1}}>
            <BlockStack gap="050" inlineAlign="stretch">
              <Link
                removeUnderline
                url={
                  productId
                    ? `shopify://admin/products/${parseGid(productId)}`
                    : ''
                }
              >
                <Text as="p" variant="bodyMd" fontWeight="medium">
                  {title}
                </Text>
              </Link>
              {variantTitle ? (
                <Box>
                  <Text as="span" variant="bodySm">
                    <Badge size="small">{variantTitle}</Badge>
                  </Text>
                </Box>
              ) : null}
              {oneTimePurchasePrice ? (
                <Text as="p" variant="bodySm" tone="subdued">
                  {t('edit.details.oneTimePurchasePrice', {
                    price: formatPrice({
                      currency: oneTimePurchasePrice.currencyCode,
                      amount: oneTimePurchasePrice.amount,
                      locale,
                    }),
                  })}
                </Text>
              ) : null}
              {isOutOfStock ? (
                <Box color="text-warning" padding="0">
                  <InlineStack align="start" wrap={false}>
                    <Box
                      paddingInlineEnd="100"
                      paddingBlock="0"
                      paddingBlockStart="0"
                    >
                      {/* The svg source itself has some inline padding, so we need to offset it */}
                      <div style={{marginInlineStart: '-0.125rem'}}>
                        <Icon source={AlertCircleIcon} tone="warning" />
                      </div>
                    </Box>
                    <span className={styles.WarningTextColor}>
                      {t('edit.details.outOfStock')}
                    </span>
                  </InlineStack>
                </Box>
              ) : null}
              {isMobile ? (
                <TotalCostBreakdown
                  currentPrice={currentPrice}
                  quantity={quantity}
                  lineDiscountedPrice={lineDiscountedPrice}
                  isMobile={isMobile}
                  locale={locale}
                />
              ) : null}
            </BlockStack>
          </div>
        </InlineStack>
      </div>
      {isMobile ? null : (
        <TotalCostBreakdown
          currentPrice={currentPrice}
          quantity={quantity}
          lineDiscountedPrice={lineDiscountedPrice}
          isMobile={isMobile}
          locale={locale}
        />
      )}
    </InlineStack>
  );
}

const TotalCostBreakdown = ({
  currentPrice,
  quantity,
  lineDiscountedPrice,
  isMobile,
  locale,
}) => (
  <Box paddingBlockStart={isMobile ? '200' : '0'}>
    <InlineStack wrap={false} align="space-between" gap="1200">
      <InlineStack gap="200" wrap={false}>
        <Text as="span" tone="subdued">
          {formatPrice({
            currency: currentPrice.currencyCode,
            amount: currentPrice.amount,
            locale,
          })}
        </Text>
        <Text as="span">x</Text>
        <Text as="span">{quantity}</Text>
      </InlineStack>
      <Text as="span">
        {formatPrice({
          currency: lineDiscountedPrice.currencyCode,
          amount: lineDiscountedPrice.amount,
          locale,
        })}
      </Text>
    </InlineStack>
  </Box>
);
