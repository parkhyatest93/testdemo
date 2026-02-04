import type {NodeOnDiskFile} from '@remix-run/node';
import {vi} from 'vitest';
import type {T} from 'vitest/dist/chunks/environment.LoooBwUu.js';
import type {GraphQLClient} from '~/types';
import type {BulkMutationResult} from '~/utils/bulkOperations';
import type {BulkOperationWithMetadata} from '~/utils/bulkOperations/bulkOperations';

export function mockBulkOperations() {
  const performBulkMutationMock = vi.hoisted(() => vi.fn());

  vi.mock(
    '~/utils/bulkOperations/performBulkMutation',
    async (importOriginal) => ({
      ...((await importOriginal()) as any),
      performBulkMutation: performBulkMutationMock,
    }),
  );

  function mockPerformBulkMutation(results: any[]) {
    performBulkMutationMock.mockImplementation(
      (
        graphql: GraphQLClient,
        mutationString: string,
        input: File | NodeOnDiskFile | ReadonlyArray<T>,
        onSuccess?: (results: ReadonlyArray<BulkMutationResult>) => void,
        onFailure?: (error: string) => void,
      ): Promise<BulkOperationWithMetadata> => {
        onSuccess?.(results as BulkMutationResult[]);

        return new Promise((resolve) => {
          resolve({
            bulkOperation: {
              id: '123',
              status: 'COMPLETED',
            },
            stagedUploadTargetUrl: 'https://example.com/staged-upload-target',
          });
        });
      },
    );
  }

  return {mockPerformBulkMutation};
}
