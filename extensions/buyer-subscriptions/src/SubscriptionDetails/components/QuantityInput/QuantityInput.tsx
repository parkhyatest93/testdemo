import {InlineStack, Button, TextField } from '@shopify/ui-extensions-react/customer-account';
import {useCallback} from 'react';

type QuantityInputProps = {
  value: string;                 // keep as string for TextField
  setValue: (v: string) => void; // from parent state
  min?: number;                  // default: 1
  disabled?: boolean;            // disable while loading
  label?: string;
};

export function QuantityInput({value, setValue, min = 1, disabled, label = 'Anzahl'}: QuantityInputProps) {
  const toInt = (s: string) => {
    const n = Number(String(s).replace(/[^\d]/g, ''));
    return Number.isFinite(n) ? n : min;
  };

  const clamp = (n: number) => Math.max(min, n);

  const inc = useCallback(() => {
    const next = clamp(toInt(value) + 1);
    setValue(String(next));
  }, [value, setValue]);

  const dec = useCallback(() => {
    const next = clamp(toInt(value) - 1);
    setValue(String(next));
  }, [value, setValue]);

  const onChange = useCallback((s: string) => {
    // sanitize to digits only, clamp to min
    const n = clamp(toInt(s));
    setValue(String(n));
  }, [setValue]);

  const nVal = toInt(value);

  return (
    <InlineStack spacing="tight" blockAlignment="center">
  <Button kind="secondary"
  onPress={dec}
  disabled={disabled || nVal <= min}
  accessibilityLabel="Decrease quantity"
    >
        –
      </Button>

      <TextField
  type="number"
  label={label}
  value={String(nVal)}
  onChange={onChange}
  disabled={disabled}
  />

  <Button
  kind="secondary"
  onPress={inc}
  disabled={disabled}
  accessibilityLabel="Increase quantity"
    >
    +
      </Button>
    </InlineStack>
);
}