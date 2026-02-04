import {
  Badge,
  BlockStack,
  Box,
  Icon,
  InlineStack,
  Text,
  Thumbnail,
} from '@shopify/polaris';
import {Modal, TitleBar} from '@shopify/app-bridge-react';
import {useTranslation} from 'react-i18next';
import {AlertTriangleIcon, ImageIcon} from '@shopify/polaris-icons';
import type {InsufficientStockProductVariants} from '~/types';

interface CreateOrderModalProps {
  open: boolean;
  onClose: () => void;
  onCreateOrder: () => void;
  insufficientStockProductVariants: InsufficientStockProductVariants[];
}

export function CreateOrderModal({
  onCreateOrder,
  open,
  onClose,
  insufficientStockProductVariants,
}: CreateOrderModalProps) {
  const {t} = useTranslation('app.contracts');

  return (
    <Modal open={open} onHide={onClose}>
      <Box
        paddingInline="300"
        paddingBlockStart="300"
        paddingBlockEnd={insufficientStockProductVariants ? '100' : '300'}
      >
        <Box
          padding="200"
          background={'bg-surface-warning'}
          borderRadius="200"
          color="text-warning"
        >
          <InlineStack align="start" direction="row" wrap={false}>
            <Box paddingInlineEnd="200">
              <Icon source={AlertTriangleIcon} tone="textWarning" />
            </Box>
            <Text as="p">
              {t('failedOrder.modal.inventoryWarning', {
                count: insufficientStockProductVariants.length,
              })}
            </Text>
          </InlineStack>
        </Box>
      </Box>
      {insufficientStockProductVariants ? (
        <Box paddingInline="300" paddingBlock="200" paddingBlockEnd="300">
          <BlockStack gap="200">
            {insufficientStockProductVariants.map((variant) => (
              <Box
                key={variant.id}
                padding="200"
                borderStyle="solid"
                borderColor="border-secondary"
                borderWidth="025"
                borderRadius="200"
              >
                <InlineStack gap="200" blockAlign="start" wrap={false}>
                  <Thumbnail
                    source={variant.image?.originalSrc ?? ImageIcon}
                    alt={variant.image?.altText ?? ''}
                    size="small"
                  />
                  <BlockStack gap="050">
                    <InlineStack gap="200" blockAlign="start" wrap={false}>
                      <Text as="p" variant="bodyMd" fontWeight="semibold">
                        {variant.product.title}
                      </Text>
                      {variant.title &&
                        variant.title !== '' &&
                        variant.title !== 'Default Title' && (
                          <Box>
                            <Text as="span" variant="bodySm">
                              <Badge size="small">{variant.title}</Badge>
                            </Text>
                          </Box>
                        )}
                    </InlineStack>
                    <Text as="p" tone="subdued">
                      {t('failedOrder.modal.outOfStock')}
                    </Text>
                  </BlockStack>
                </InlineStack>
              </Box>
            ))}
          </BlockStack>
        </Box>
      ) : null}
      <TitleBar title={t('failedOrder.modal.title')}>
        <button
          variant="primary"
          onClick={() => {
            onCreateOrder();
            onClose();
          }}
        >
          {t('failedOrder.modal.actions.ignoreAndCreate')}
        </button>
        <button onClick={onClose}>
          {t('failedOrder.modal.actions.cancel')}
        </button>
      </TitleBar>
    </Modal>
  );
}
