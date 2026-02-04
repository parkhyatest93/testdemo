import type {Address} from '@shopify/address';
import {nodesFromEdges} from '@shopify/admin-graphql-api-utilities';
import type {TFunction} from 'i18next';
import type {SubscriptionMailingAddress} from 'types/admin.types';
import type {PricingPolicy} from '~/routes/app.contracts.$id.edit/validator';
import type {SubscriptionContractStatusType} from '~/types';
import type {SubscriptionContractsQuery} from 'types/admin.generated';
import {SubscriptionBillingAttemptErrorCode} from '~/types/webhooks';
import type {
  BillingAttemptProcessingError,
  ContractDetailsCycleDiscount,
  CycleDiscount,
  SubscriptionContractListItem,
} from '~/types/contracts';
import {formatPrice} from './money';
import {SubscriptionContractStatus} from '~/types';

/**
 * Formats a customer's address into a format that can be used by the
 * address component
 * note: this address type is different from the type that graphql
 * mutations expect as input (MailingAddressInput)
 */
export function formatCustomerAddress(
  customerAddress: SubscriptionMailingAddress,
): Address | null {
  if (!customerAddress) {
    return null;
  }

  const {
    address1,
    address2,
    city,
    provinceCode,
    countryCode,
    zip,
    firstName,
    lastName,
    phone,
  } = customerAddress;

  // required fields in AddressType
  if (!address1 || !city || !zip || !countryCode) {
    return null;
  }

  return {
    address1,
    address2: address2 ?? '',
    zip,
    city,
    country: countryCode,
    // remove nulls from the Maybe<T> type
    province: provinceCode ?? undefined,
    firstName: firstName ?? undefined,
    lastName: lastName ?? undefined,
    phone: phone ?? undefined,
  };
}

export function discountTextFromCycleDiscount(
  cycleDiscount:
    | CycleDiscount
    | ContractDetailsCycleDiscount
    | PricingPolicy['cycleDiscounts'][0],
  t: TFunction,
  locale: string,
) {
  const {adjustmentType, adjustmentValue} = cycleDiscount;
  let value = '';

  if ('amount' in adjustmentValue) {
    value = formatPrice({
      currency: adjustmentValue.currencyCode,
      amount: adjustmentValue.amount,
      locale,
    });
  } else if ('percentage' in adjustmentValue) {
    value = String(adjustmentValue.percentage);
  }

  if (!value) {
    return '';
  }

  switch (adjustmentType) {
    case 'PERCENTAGE':
      return t('details.discountValue.percentageOff', {value});
    case 'FIXED_AMOUNT':
      return t('details.discountValue.amountOff', {value});
    case 'PRICE':
      return t('details.discountValue.fixedPrice', {value});
    default:
      return '';
  }
}

export function formatStatus(status: SubscriptionContractStatusType) {
  if (status == SubscriptionContractStatus.Failed)
    return SubscriptionContractStatus.Active;
  else return status;
}

export function hasInventoryError(
  contract: SubscriptionContractListItem,
): boolean {
  if (!contract.billingAttempts || contract.billingAttempts.length === 0) {
    return false;
  }

  const errorCode = contract.billingAttempts[0]?.errorCode;

  return (
    errorCode ===
      SubscriptionBillingAttemptErrorCode.InsufficientInventory.toUpperCase() ||
    errorCode ===
      SubscriptionBillingAttemptErrorCode.InventoryAllocationsNotFound.toUpperCase()
  );
}

type SubscriptionContractBillingAttempt =
  SubscriptionContractsQuery['subscriptionContracts']['edges'][number]['node']['billingAttempts']['edges'][number]['node'];

export function formatProcessingError(
  attempt: SubscriptionContractBillingAttempt,
): BillingAttemptProcessingError | null {
  return attempt.processingError
    ? {
        code: attempt.processingError.code,
        insufficientStockProductVariants:
          attempt.processingError?.code === 'INSUFFICIENT_INVENTORY' &&
          'insufficientStockProductVariants' in attempt.processingError
            ? nodesFromEdges(
                attempt.processingError.insufficientStockProductVariants
                  ?.edges || [],
              ).map((node) => ({
                variantId: node.id,
                variantTitle: node.title,
                image: node.image
                  ? {
                      url: node.image.url,
                      altText: node.image.altText ?? undefined,
                    }
                  : node.product.featuredMedia?.preview?.image
                    ? {
                        url: node.product.featuredMedia.preview.image.url,
                        altText:
                          node.product.featuredMedia.preview.image.altText ??
                          undefined,
                      }
                    : undefined,
                defaultId: node.product.id,
                defaultTitle: node.product.title,
              }))
            : [],
      }
    : null;
}
