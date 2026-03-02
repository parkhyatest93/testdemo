import {
  BlockStack,
  Grid,
  GridItem,
  Button,
  Card,
  SkeletonTextBlock,
  View,
  Text,
  Style,
  Page,
} from '@shopify/ui-extensions-react/customer-account';
import {getBillingCycleInfo} from 'utilities';

import {useSubscriptionContract} from './hooks/useSubscriptionContract';
import {
  UpcomingOrderCard,
  OverviewCard,
  PastOrdersCard,
  PriceSummaryCard,
  EditQtyCard,
  EditProductCard,
  NotFound,
} from './components';
import {useExtensionApi} from 'foundation/Api';
import {BillingAttemptErrorType} from 'types';
import {useToast, SuccessToastType} from 'utilities/hooks/useToast';
import {DetailsActions} from './DetailsActions';
import {de} from '@faker-js/faker';

interface SubscriptionDetailsProps {
  id: string;
}

export function SubscriptionDetails({id}: SubscriptionDetailsProps) {
  const {data, loading, error, refetchSubscriptionContract, refetchLoading} =
    useSubscriptionContract({id});
  const {i18n} = useExtensionApi();
  const {showSuccessToast} = useToast();

  if (!data?.subscriptionContract && loading) {
    return <SubscriptionDetailsSkeleton />;
  }

  if (error) {
    throw error;
  }

  if (data?.subscriptionContract === null || !data) {
    return <NotFound />;
  }

  const {
    id: contractId,
    deliveryPolicy,
    lines,
    orders,
    shippingAddress,
    shippingMethodTitle,
    pickupAddress,
    priceBreakdownEstimate,
    status,
    upcomingBillingCycles,
    lastOrderPrice,
    lastBillingAttemptErrorType,
  } = data.subscriptionContract;

  const defaultQty = lines[0]?.quantity ?? 1;


  const {nextBillingDate} = getBillingCycleInfo(upcomingBillingCycles);

  const hasInventoryError =
    (lastBillingAttemptErrorType as BillingAttemptErrorType | null) ===
    BillingAttemptErrorType.InventoryError;

  function onSkipOrder() {
    showSuccessToast(SuccessToastType.Skipped);
    refetchSubscriptionContract();
  }

  const pageTitle =
    status === 'CANCELLED'
      ? i18n.translate('subscriptionDetails')
      : i18n.translate('manageSubscription');

  const overviewCard = (
    <OverviewCard
      contractId={contractId}
      deliveryPolicy={deliveryPolicy}
      shippingAddress={shippingAddress}
      shippingMethodTitle={shippingMethodTitle}
      pickupAddress={pickupAddress}
      status={status}
      refetchSubscriptionContract={refetchSubscriptionContract}
    />
  );

  return (
    <Page
      title={pageTitle}
      secondaryAction={
        <Button
          to="extension:/"
          accessibilityLabel="Go back to subscription list"
        />
      }
      primaryAction={
        <DetailsActions
          contractId={contractId}
          status={status}
          refetchSubscriptionContract={refetchSubscriptionContract}
          lastOrderPrice={lastOrderPrice}
          nextOrderPrice={priceBreakdownEstimate?.totalPrice}
          nextBillingDate={nextBillingDate}
        />
      }
    >
      <Grid
        columns={Style.default(['fill'])
          .when({viewportInlineSize: {min: 'medium'}}, ['fill', 'fill'])
          .when({viewportInlineSize: {min: 'large'}}, [
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
          ])}
        rows="auto"
        spacing={['loose', 'loose']}
      >
        <GridItem
          columnSpan={Style.default(1).when(
            {viewportInlineSize: {min: 'large'}},
            7,
          )}
        >
          <BlockStack spacing="loose">
            <View>
              <Text variant="bodyLg" fontWeight="medium">
                next Billing Date {' '}
                {nextBillingDate
                  ? i18n.formatDate(new Date(nextBillingDate))
                  : '—'}
              </Text>
            </View>
            {status === 'ACTIVE' || hasInventoryError ? (
              <UpcomingOrderCard
                onSkipOrder={onSkipOrder}
                refetchSubscriptionContract={refetchSubscriptionContract}
                refetchLoading={refetchLoading}
                contractId={contractId}
                upcomingBillingCycles={upcomingBillingCycles}
                hasInventoryError={hasInventoryError}
              />
            ) : null}
            <View
              display={Style.default('none').when(
                {viewportInlineSize: {min: 'medium'}},
                'auto',
              )}
            >
              {overviewCard}
            </View>
          </BlockStack>
        </GridItem>
        <GridItem
          columnSpan={Style.default(1).when(
            {viewportInlineSize: {min: 'large'}},
            5,
          )}
        >
          <BlockStack spacing="loose">
            {priceBreakdownEstimate ? (
              <PriceSummaryCard price={priceBreakdownEstimate}
                                lines={lines}
                                onUpdated={refetchSubscriptionContract}
                                contract = {data.subscriptionContract} />
            ) : null}
            <View
              display={Style.default('auto').when(
                {viewportInlineSize: {min: 'medium'}},
                'none',
              )}
            >
              {overviewCard}
            </View>

            <EditProductCard
              defaultQty={1}
              lineId={lines[0]?.id}
              contractId={contractId}
              onUpdated={refetchSubscriptionContract}
            />

            <PastOrdersCard orders={orders} />

          </BlockStack>
        </GridItem>
      </Grid>
    </Page>
  );
}

function SubscriptionDetailsSkeleton() {
  return (
    <Page title="" loading secondaryAction={<Button to="loading" />}>
      <Grid
        columns={Style.default(['fill'])
          .when({viewportInlineSize: {min: 'medium'}}, ['fill', 'fill'])
          .when({viewportInlineSize: {min: 'large'}}, [
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
            'fill',
          ])}
        spacing={['loose', 'loose']}
      >
        <GridItem
          columnSpan={Style.default(1).when(
            {viewportInlineSize: {min: 'large'}},
            7,
          )}
        >
          <BlockStack spacing="loose">
            <Card padding>
              <View>
                <SkeletonTextBlock />
              </View>
            </Card>
            <Card padding>
              <View>
                <SkeletonTextBlock />
                <SkeletonTextBlock />
                <SkeletonTextBlock />
              </View>
            </Card>
          </BlockStack>
        </GridItem>
        <GridItem
          columnSpan={Style.default(1).when(
            {viewportInlineSize: {min: 'large'}},
            5,
          )}
        >
          <BlockStack spacing="loose">
            <Card padding>
              <View>
                <SkeletonTextBlock />
                <SkeletonTextBlock />
              </View>
            </Card>
            <Card padding>
              <View>
                <SkeletonTextBlock />
                <SkeletonTextBlock />
              </View>
            </Card>
          </BlockStack>
        </GridItem>
      </Grid>
    </Page>
  );
}
