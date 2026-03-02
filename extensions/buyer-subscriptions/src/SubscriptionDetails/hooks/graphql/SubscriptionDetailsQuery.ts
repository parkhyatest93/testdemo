// SubscriptionDetailsQuery.ts

const SubscriptionDetailsQuery = `#graphql
query SubscriptionContract($id: ID!) {
  customer {
    subscriptionContract(id: $id) {
      id
      status
      lastBillingAttemptErrorType
      deliveryPolicy {
        interval
        intervalCount {
          count
          precision
        }
      }
      currencyCode
      deliveryPrice {
        amount
        currencyCode
      }
      upcomingBillingCycles(first: 6) {
        edges {
          node {
            billingAttemptExpectedDate
            skipped
            cycleIndex
          }
        }
      }
      deliveryMethod {
        ... on SubscriptionDeliveryMethodShipping {
          address {
            address1
            address2
            city
            countryCode
            firstName
            lastName
            phone
            provinceCode
            zip
          }
          shippingOption {
            presentmentTitle
          }
        }
        ... on SubscriptionDeliveryMethodLocalDelivery {
          address {
            address1
            address2
            city
            countryCode
            firstName
            lastName
            phone
            provinceCode
            zip
          }
          localDeliveryOption {
            presentmentTitle
          }
        }
        ... on SubscriptionDeliveryMethodPickup {
          pickupOption {
            pickupAddress {
              address1
              address2
              city
              countryCode
              phone
              zip
              zoneCode
            }
          }
        }
      }
      lines(first: 50) {
        edges {
          node {
            id
            name
            title
            variantTitle
            quantity

            # subscription unit price in contract currency
            currentPrice {
              amount
              currencyCode
            }

            # total line price including discounts (per contract)
            lineDiscountedPrice {
              amount
              currencyCode
            }

            # custom attributes coming from subscriptionDraftLineAdd
            customAttributes {
              key
              value
            }

            image {
              id
              altText
              url
            }
          }
        }
      }
      orders(first: 5, reverse: true) {
        edges {
          node {
            id
            createdAt
            totalPrice {
              amount
              currencyCode
            }
          }
        }
      }
    }
  }
}
`;

export default SubscriptionDetailsQuery;