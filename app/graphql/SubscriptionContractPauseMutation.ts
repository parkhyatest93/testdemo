const SubscriptionContractPause = `#graphql
mutation SubscriptionContractPause($subscriptionContractId: ID!) {
  subscriptionContractPause(subscriptionContractId: $subscriptionContractId) {
    contract {
      id
      customer {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

export default SubscriptionContractPause;
