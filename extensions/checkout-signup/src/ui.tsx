import {useEffect, useMemo, useRef, useState} from 'react';
import {
  BlockStack,
  InlineStack,
  Text,
  TextField,
  Button,
  Checkbox,
  useBuyerJourneyIntercept,
  useEmail,
  useAttributeValues,
  useCartLines,
  useBillingAddress,
  useSessionToken,
} from '@shopify/ui-extensions-react/checkout';

// Customer-related backend API
const CUSTOMER_BASE_URL = `${process.env.BACKEND_URL_BASE}api/customer/`;
const CHECK_USER_ENDPOINT = `${CUSTOMER_BASE_URL}check-user-register`;
const SIGNUP_ENDPOINT = `${CUSTOMER_BASE_URL}signup`;

// Register-required check endpoint (Remix route)
const CHECK_REGISTER_REQUIRED_URL =
  `${process.env.APP_URL}/api/checkout/check-register-required`;

type CheckRegisterRequiredResponse = {
  status: boolean;
  requireLogin: boolean;
  variantsRequiringLogin: string[];
  message?: string;
  error?: string;
};

export function App() {
  // --- Local state for signup box ---
  const [password, setPassword] = useState<string>('');
  const [registerLoading, setRegisterLoading] = useState<boolean>(false);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [registerSuccess, setRegisterSuccess] = useState<boolean>(false);

  // Registration status from backend:
  // null  -> no email yet / not checked
  // false -> not registered
  // true  -> already registered
  const [isRegistered, setIsRegistered] = useState<boolean | null>(null);
  const [checkLoading, setCheckLoading] = useState<boolean>(false);

  // Checkbox that controls whether the account-creation form is open
  const [createAccountChecked, setCreateAccountChecked] =
    useState<boolean>(false);

  // Buyer email from checkout
  const email = useEmail() || '';

  // Share ID from checkout/cart attributes
  const [shareIdValue] = useAttributeValues(['share_id']);
  const share_id = shareIdValue || '';

  // Billing address from checkout (for first and last name)
  const billingAddress = useBillingAddress();
  const firstName = billingAddress?.firstName || '';
  const lastName = billingAddress?.lastName || '';

  // Cart lines – for subscription + variant IDs
  const cartLines = useCartLines();

  // Session token for authenticated backend calls
  const sessionToken = useSessionToken();

  // Determine if at least one line has a selling plan (subscription)
  const hasSubscriptionProduct = cartLines.some((line) =>
    Boolean(line.merchandise?.sellingPlan),
  );

  // Derived variantIds & productIds
  const variantIds = useMemo(
    () => cartLines.map((l) => l.merchandise.id),
    [cartLines],
  );
  const productIds = useMemo(
    () =>
      cartLines
        .map((l) => (l as any).merchandise?.product?.id)
        .filter((id): id is string => Boolean(id)),
    [cartLines],
  );

  // --- Result of /api/checkout/check-register-required ---
  const [requiresRegisterByProducts, setRequiresRegisterByProducts] =
    useState<boolean>(false);
  const [registerRequiredLoading, setRegisterRequiredLoading] =
    useState<boolean>(false);
  const [registerRequiredError, setRegisterRequiredError] =
    useState<string | null>(null);
  const lastRegisterPayload = useRef<string>('');

  // ===========================================================
  // 1) Check if email already has an account
  // ===========================================================
  useEffect(() => {
    if (!email) {
      setIsRegistered(null);
      return;
    }

    let cancelled = false;

    async function checkUser() {
      setCheckLoading(true);
      setRegisterError(null);

      try {
        const token = await sessionToken.get();
        console.log(
          'session token length for CHECK_USER_ENDPOINT:',
          token?.length,
        );

        const res = await fetch(CHECK_USER_ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            // Only needed if your backend validates the session token
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({email}),
        });

        const data = await res.json();
        console.log('check-user-register response:', data);

        if (cancelled) return;

        if (typeof data?.status !== 'undefined') {
          // Normalize backend status to boolean
          const registered =
            data.status === 1 ||
            data.status === '1' ||
            data.status === true;
          setIsRegistered(registered);
        } else {
          // Unexpected shape → treat as "no account"
          setIsRegistered(false);
        }
      } catch (error) {
        console.error('check-user-register error', error);
        if (!cancelled) {
          // On error we treat as "no account"
          setIsRegistered(false);
        }
      } finally {
        if (!cancelled) {
          setCheckLoading(false);
        }
      }
    }

    checkUser();

    return () => {
      cancelled = true;
    };
  }, [email, sessionToken]);

  // ===========================================================
  // 2) If user has NO account → check register-required products
  // ===========================================================
  useEffect(() => {
    // If already registered, no need to check products at all
    if (isRegistered === true) {
      setRequiresRegisterByProducts(false);
      return;
    }

    if (!email || variantIds.length === 0) {
      setRequiresRegisterByProducts(false);
      return;
    }

    const payload = JSON.stringify({email, variantIds, productIds});

    if (payload === lastRegisterPayload.current) {
      return;
    }
    lastRegisterPayload.current = payload;

    setRegisterRequiredLoading(true);
    setRegisterRequiredError(null);

    (async () => {
      try {
        const token = await sessionToken.get();
        console.log(
          'session token length for check-register-required:',
          token?.length,
        );

        const res = await fetch(CHECK_REGISTER_REQUIRED_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: payload,
        });

        const data: CheckRegisterRequiredResponse = await res.json();
        console.log('check-register-required response:', data);

        if (!res.ok || !data.status) {
          throw new Error(data.error || `HTTP ${res.status}`);
        }

        setRequiresRegisterByProducts(Boolean(data.requireLogin));
      } catch (err: any) {
        console.error('check-register-required error', err);
        setRequiresRegisterByProducts(false);
        setRegisterRequiredError(
          err?.message || 'Error while checking register requirement.',
        );
      } finally {
        setRegisterRequiredLoading(false);
      }
    })();
  }, [
    email,
    variantIds.join(','),
    productIds.join(','),
    isRegistered,
    sessionToken,
  ]);

  // ===========================================================
  // 3) Derived flags from your scenario
  // ===========================================================

  // hasAccount = true only when backend clearly says user is registered
  const hasAccount = isRegistered === true;
  const noAccount = isRegistered === false;

  // "is subscription? or is register required"
  const hasSubscriptionOrRegisterRequired =
    hasSubscriptionProduct || requiresRegisterByProducts;

  // Signup is mandatory only if:
  // - we definitely know there is no account
  // - AND there is a subscription or a register-required product
  const signupRequired = noAccount && hasSubscriptionOrRegisterRequired;

  // IMPORTANT CHANGE:
  // Show signup form whenever user does NOT have an account OR we are not sure yet.
  // Only hide the form when isRegistered === true.
  const shouldShowSignupForm = !hasAccount;

  // ===========================================================
  // 4) Manage checkbox state based on flags
  // ===========================================================
  useEffect(() => {
    if (!shouldShowSignupForm) {
      // User has an account → hide / reset checkbox
      setCreateAccountChecked(false);
      return;
    }

    if (signupRequired) {
      // Required → force checkbox ON and locked
      setCreateAccountChecked(true);
    } else {
      // Optional → default unchecked
      setCreateAccountChecked(false);
    }
  }, [shouldShowSignupForm, signupRequired]);

  // ===========================================================
  // 5) Intercept buyer journey: block only when signupRequired
  // ===========================================================
  useBuyerJourneyIntercept(({canBlockProgress}) => {
    if (!canBlockProgress) {
      return {behavior: 'allow'};
    }

    // If we know user has an account → never block
    if (hasAccount) {
      return {behavior: 'allow'};
    }

    // If signup is required (noAccount && has subscription/register_required),
    // block until password is provided.
    console.log("gh ",signupRequired,password,signupRequired && !password);


    // Otherwise allow checkout
    return {behavior: 'allow'};
  });

  // ===========================================================
  // 6) Handle registration submit
  // ===========================================================
  async function handleRegister() {
    setRegisterError(null);
    setRegisterSuccess(false);

    if (!email) {
      setRegisterError(
        'Bitte geben Sie im Bestellvorgang zuerst Ihre E-Mail-Adresse ein.',
      );
      return;
    }
    if (!firstName || !lastName) {
      setRegisterError(
        'Bitte geben Sie im Feld „Rechnungsadresse“ Ihren Vor- und Nachnamen ein.',
      );
      return;
    }
    if (!password) {
      setRegisterError('Bitte geben Sie ein Passwort ein.');
      return;
    }

    setRegisterLoading(true);

    try {
      const res = await fetch(SIGNUP_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          password,
          share_id: share_id || 1,
          first_name: firstName,
          last_name: lastName,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        const message =
          data?.message ||
          'Die Registrierung ist fehlgeschlagen. Bitte versuchen Sie es später erneut.';
        throw new Error(message);
      }

      setRegisterSuccess(true);
      // After successful register, treat customer as registered → form disappears, no blocking
      setIsRegistered(true);
    } catch (error: any) {
      console.error('register error', error);
      setRegisterError(
        error?.message || 'Registration failed. Please try again later.',
      );
    } finally {
      setRegisterLoading(false);
    }
  }

  // ===========================================================
  // 7) Render UI according to scenario
  // ===========================================================
  if (!shouldShowSignupForm) {
    // User has an account → do not render the signup form at all
    return null;
  }

  return (
    <BlockStack spacing="loose">
      <BlockStack spacing="tight">
        <Text size="medium" emphasis="bold">
          Konto erstellen
        </Text>

        {/* Checkbox: locked when signup is required, optional otherwise */}
        <Checkbox
          id="create-account"
          checked={createAccountChecked}
          onChange={(value: boolean) => {
            if (!signupRequired) {
              // Only allow user to toggle when signup is optional
              setCreateAccountChecked(value);
            }
          }}
          disabled={signupRequired}
        >
          <Text>
            {signupRequired
              ? 'Für ABO’s bzw. bestimmte Produkte ist ein Kundenkonto erforderlich.'
              : 'Erstelle ein Konto exklusive Angebote und einen schnelleren Checkout (optional).'}
          </Text>
        </Checkbox>

        {/* Form is visible only when checkbox is ON */}
        {createAccountChecked && (
          <BlockStack spacing="tight">
            <Text size="small">
              Um ein Konto für die oben angegebene E-Mail-Adresse zu erstellen,
              lege einfach ein Passwort fest.
            </Text>

            <Text size="small">
              E-Mail:{' '}
              <Text emphasis="bold">
                {email || 'Noch nicht eingetragen'}
              </Text>
            </Text>

            {firstName || lastName ? (
              <Text size="small">
                Name:{' '}
                <Text emphasis="bold">
                  {[firstName, lastName].filter(Boolean).join(' ')}
                </Text>
              </Text>
            ) : (
              <Text size="small">
                Der Kontoname wird von Ihrer Rechnungsadresse übernommen.
              </Text>
            )}

            <TextField
              type="password"
              label="Passwort"
              value={password}
              onChange={setPassword}
              disabled={checkLoading || registerRequiredLoading}
            />

            <InlineStack spacing="tight">
              <Button
                kind="primary"
                loading={
                  registerLoading ||
                  checkLoading ||
                  registerRequiredLoading
                }
                onPress={handleRegister}
              >
                Konto erstellen
              </Button>
            </InlineStack>

            {registerError && (
              <Text size="small" appearance="critical">
                {registerError}
              </Text>
            )}

            {registerRequiredError && (
              <Text size="small" appearance="critical">
                {registerRequiredError}
              </Text>
            )}

            {registerSuccess && (
              <Text size="small" appearance="success">
                Konto erfolgreich erstellt.
              </Text>
            )}
          </BlockStack>
        )}
      </BlockStack>
    </BlockStack>
  );
}