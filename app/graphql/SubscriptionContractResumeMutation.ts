const SubscriptionContractResume = `#graphql
mutation SubscriptionContractResume($subscriptionContractId: ID!) {
  subscriptionContractActivate(subscriptionContractId: $subscriptionContractId) {
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

export default SubscriptionContractResume;
