import {useState} from 'react';
import {
  Checkbox,
  BlockStack,
  InlineStack,
  Link,
  Text,
  useBuyerJourneyIntercept,
} from '@shopify/ui-extensions-react/checkout';

export function App() {
  const [accepted, setAccepted] = useState(false);
  const [accepted2, setAccepted2] = useState(false);

  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (canBlockProgress && !accepted || !accepted2) {
      return {
        behavior: 'block',
        reason: 'policies_not_accepted',
        errors: [
          {
            message:
              'Bitte bestätigen Sie die AGB und die Widerrufs-/Rückerstattungsrichtlinie, um fortzufahren.',
          },
        ],
      };
    }
    return {behavior: 'allow'};
  });

  return (
    <BlockStack spacing="tight">
      <Checkbox id="policies-accept" checked={accepted} onChange={setAccepted}>
        <InlineStack spacing="tight" wrap>
          <Text>Ich stimme den</Text>
          <Link to="https://minimeal.com/pages/unsere-agb-1">Allgemeinen Geschäftsbedingungen (AGB)</Link>
          <Text>der SUN AG zu.</Text>
        </InlineStack>
      </Checkbox>
      <Checkbox id="policies-accept2" checked={accepted2} onChange={setAccepted2}>
        <InlineStack spacing="tight" wrap>
          <Text>Ich bestätige, dass mir bekannt ist, dass</Text>
          <Link to="https://minimeal.com/pages/widerrufsrecht">für gelieferte Lebensmittel kein Widerrufsrecht besteht.</Link>
        </InlineStack>
      </Checkbox>
    </BlockStack>
  );
}