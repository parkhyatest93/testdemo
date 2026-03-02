
import {
  useBuyerJourneyIntercept,
  useEmail,
  useDiscountCodes,
  useApplyDiscountCodeChange,
  useAppliedGiftCards,
} from '@shopify/ui-extensions-react/checkout';

const VERIFY_URL =
  (process.env.BACKEND_URL_BASE ?? '') + 'api/checkout/getUserGiftAndCoupon';


export function App() {
  const email = useEmail();
  const discountCodes = useDiscountCodes();
  const appliedGiftCards = useAppliedGiftCards();
  const applyDiscountCodeChange = useApplyDiscountCodeChange();
  console.log(VERIFY_URL);
  // Intercept when the buyer tries to continue to the next step / pay
  useBuyerJourneyIntercept(() => {
    return {
      shouldBlockProgress: async () => {
        // Build payload with all discount codes and gift cards + email
        const codes =
          (discountCodes ?? []).map((d: any) =>
            typeof d === 'string' ? d : d?.code,
          ) || [];

        const gifts =
          (appliedGiftCards ?? []).map((g: any) => ({
            lastCharacters: g?.lastCharacters,
            balance: g?.balance?.amount,
            currency: g?.balance?.currencyCode,
          })) || [];
        console.log(gifts);
        const payload = {
          email: email ?? null,
          discountCodes: codes.filter(Boolean),
          giftCards: gifts,
        };
        console.log('Verifying discount codes/gift cards with payload:', payload);
        try {
          const res = await fetch(VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });

          // If the backend is unreachable or doesn't return JSON, block
          const data = await res.json().catch(() => ({ status: false }));
          console.log('Verification response:', data);
          if (data?.status === true) {
            return { behavior: 'allow' as const };
          }

          // Otherwise: remove ALL discount codes and block progress
          for (const code of payload.discountCodes) {
            await applyDiscountCodeChange({
              type: 'removeDiscountCode',
              code,
            });
          }

          return {
            behavior: 'block' as const,
            reason: 'invalid-discount-or-giftcard',
            errors: [
              {
                message:
                  data?.message ??
                  'your discount code or gift card has some problem',
              },
            ],
          };
        } catch (err) {
          // Network/other error → block
          for (const code of payload.discountCodes) {
            await applyDiscountCodeChange({
              type: 'removeDiscountCode',
              code,
            });
          }

          return {
            behavior: 'block' as const,
            reason: 'verification-error',
            errors: [
              {
                message:
                  'there is a problem. please try again',
              },
            ],
          };
        }
      },
    };
  });

  // No visible UI needed for this guard
  return null;
}