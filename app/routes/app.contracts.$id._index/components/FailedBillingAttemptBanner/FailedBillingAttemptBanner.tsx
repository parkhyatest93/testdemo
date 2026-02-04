import {Banner, Box, Button, InlineStack, Text} from '@shopify/polaris';
import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {formatDate} from '~/utils/helpers/date';

interface FailedBillingAttemptBannerProps {
  onOpen: () => void;
  billingCycleDate: string;
  productCount: number;
}

export function FailedBillingAttemptBanner({
  onOpen,
  billingCycleDate,
  productCount,
}: FailedBillingAttemptBannerProps) {
  const {t, i18n} = useTranslation('app.contracts');
  const [showInventoryWarningBanner, setShowInventoryWarningBanner] =
    useState(true);

  return showInventoryWarningBanner ? (
    <Box paddingBlockEnd="400">
      <Banner
        tone="warning"
        title={t('failedOrder.banner.title', {
          date: formatDate(billingCycleDate, i18n.language),
        })}
        onDismiss={() => {
          setShowInventoryWarningBanner(false);
        }}
      >
        <InlineStack gap="200">
          <Text as="p">
            {t('failedOrder.banner.description', {count: productCount})}
          </Text>
          <Button onClick={onOpen}>{t('failedOrder.banner.button')}</Button>
        </InlineStack>
      </Banner>
    </Box>
  ) : null;
}
