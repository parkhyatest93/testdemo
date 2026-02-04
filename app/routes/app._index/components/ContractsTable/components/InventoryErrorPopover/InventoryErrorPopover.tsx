import {
  Popover,
  Box,
  InlineStack,
  Icon,
  Text,
  BlockStack,
  Thumbnail,
  Link,
  Badge,
  Button,
} from '@shopify/polaris';
import {AlertCircleIcon, ImageIcon} from '@shopify/polaris-icons';
import {useTranslation} from 'react-i18next';
import {useEffect, useState} from 'react';

import styles from './InventoryErrorPopover.module.css';
import type {InsufficientStockProductVariant} from '~/types/contracts';
import {parseGid} from '@shopify/admin-graphql-api-utilities';
import {useAppBridge} from '@shopify/app-bridge-react';

export function InventoryErrorPopover({
  insufficientStockProductVariants,
}: {
  insufficientStockProductVariants?: InsufficientStockProductVariant[];
}) {
  const shopify = useAppBridge();
  const {t} = useTranslation('app.contracts');
  const [popOverActive, setPopOverActive] = useState(false);
  const togglePopoverActive = () => setPopOverActive(!popOverActive);
  const setPopoverActive = () => setPopOverActive(true);
  const setPopoverInactive = () => setPopOverActive(false);
  const [domain, setDomain] = useState('');

  useEffect(() => {
    setDomain(shopify.config.shop || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const warningIconActivator = (
    <Box paddingInlineEnd="200">
      <BlockStack align="center">
        <Button
          variant="plain"
          icon={<Icon tone="warning" source={AlertCircleIcon} />}
          onClick={togglePopoverActive}
          accessibilityLabel={t(`table.resourceName.warningToolTipContent`)}
        >
          {/* Polaris resets the icon color when no child text is passed */}
          {''}
        </Button>
      </BlockStack>
    </Box>
  );

  // Prevents the navigating to the contract details page when clicking on the activator or popover
  function stopPropagationHandler(event: React.MouseEvent<HTMLDivElement>) {
    event.stopPropagation();
  }

  return (
    <div
      onMouseEnter={setPopoverActive}
      onMouseLeave={setPopoverInactive}
      aria-label="warning-icon"
      onClick={stopPropagationHandler}
    >
      <Popover
        active={popOverActive}
        activator={warningIconActivator}
        onClose={setPopoverInactive}
        preferredAlignment="left"
        preferredPosition="below"
        fullWidth={false}
      >
        <div onMouseEnter={setPopoverActive} onMouseLeave={setPopoverInactive}>
          <Box maxWidth="320px" padding="400">
            <BlockStack gap="300" inlineAlign="start">
              <InlineStack wrap={false} gap="100">
                <Icon tone="warning" source={AlertCircleIcon} />
                <Text as="span" fontWeight="medium" breakWord={false}>
                  <span className={styles.WarningHoverColor}>
                    {t(`table.resourceName.warningToolTipContent`)}
                  </span>
                </Text>
              </InlineStack>
              {(insufficientStockProductVariants ?? []).map((product) => {
                return (
                  <InlineStack key={product.variantId} gap="300" wrap={false}>
                    <Thumbnail
                      source={product.image?.url ?? ImageIcon}
                      alt={product.image?.altText ?? ''}
                      size="small"
                    />
                    <BlockStack gap="050" inlineAlign="start" align="center">
                      <Link
                        removeUnderline
                        target="_blank"
                        url={`https://${domain}/admin/products/${parseGid(
                          product.defaultId,
                        )}`}
                      >
                        {product.defaultTitle}
                      </Link>
                      {product.variantTitle?.trim() &&
                        product.variantTitle !== 'Default Title' && (
                          <Badge size="small">{product.variantTitle}</Badge>
                        )}
                    </BlockStack>
                  </InlineStack>
                );
              })}
            </BlockStack>
          </Box>
        </div>
      </Popover>
    </div>
  );
}
