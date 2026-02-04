import {useFetcher, useRevalidator} from '@remix-run/react';
import {useCallback, useEffect, useState} from 'react';
import type {WithToast} from '~/types';
import {usePollBillingAttemptAction} from '~/routes/app.contracts.$id._index/hooks/usePollBillingAttemptAction';
import {useAppBridge} from '@shopify/app-bridge-react';

export function useBillContractAction() {
  const shopify = useAppBridge();
  const fetcher = useFetcher<WithToast<{id?: string}>>();
  const [isAttemptInProgress, setIsAttemptInProgress] = useState(false);
  const revalidator = useRevalidator();

  const onDonePollingAttempt = useCallback(() => {
    revalidator.revalidate();
    setIsAttemptInProgress(false);
  }, [revalidator]);

  const startPolling = usePollBillingAttemptAction({
    onDoneCallback: onDonePollingAttempt,
  });

  const billContractLoading =
    fetcher.state === 'submitting' || fetcher.state === 'loading';

  useEffect(() => {
    if (!billContractLoading) {
      if (fetcher.data?.id) {
        startPolling(fetcher.data?.id);
      } else {
        setIsAttemptInProgress(false);
      }
    }
  }, [fetcher.data, billContractLoading, startPolling]);

  useEffect(() => {
    if (fetcher.data?.toast) {
      const {message, ...opts} = fetcher.data?.toast;
      shopify.toast.show(message, {
        ...opts,
        duration: 2000,
      });
    }
  }, [fetcher.data?.toast, shopify]);

  const billContract = useCallback(
    (cycleIndex: number, allowOverselling: boolean = false) => {
      setIsAttemptInProgress(true);
      const inventoryPolicy = allowOverselling
        ? 'ALLOW_OVERSELLING'
        : 'PRODUCT_VARIANT_INVENTORY_POLICY';
      const formData = new FormData();
      formData.append('inventoryPolicy', inventoryPolicy);
      formData.append('cycleIndex', cycleIndex.toString());
      fetcher.submit(formData, {method: 'post', action: `./bill-contract`});
    },
    [fetcher],
  );

  return {
    billContract,
    billContractLoading,
    isAttemptInProgress,
  };
}
