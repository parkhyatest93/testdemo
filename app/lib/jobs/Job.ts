import type {Logger} from 'pino';
import {HttpResponseError} from '@shopify/shopify-api';
import {SessionNotFoundError} from '@shopify/shopify-app-remix/server';
import {logger} from '~/utils/logger.server';

const SHOP_FROZEN_402_ERROR_RESPONSE = 402;
const SHOP_NO_ACCESS_403_ERROR_RESPONSE = 403;
const SHOP_NOT_FOUND_404_ERROR_RESPONSE = 404;
const SHOP_LOCKED_423_ERROR_RESPONSE = 423;

/**
 * Checks against a list of response codes from the Shopify GraphQL API.
 * @see https://shopify.dev/docs/api/admin-graphql#status_and_error_codes
 */
function isNonRetryable(error: HttpResponseError): boolean {
  return [
    SHOP_FROZEN_402_ERROR_RESPONSE,
    SHOP_NO_ACCESS_403_ERROR_RESPONSE,
    SHOP_NOT_FOUND_404_ERROR_RESPONSE,
    SHOP_LOCKED_423_ERROR_RESPONSE,
  ].includes(error.response.code);
}

/**
 * Determines if the error should be considered terminal (ie. not to be retried).
 * Terminal = request failed but we can't do anything about it
 * Ex: shop expired
 */
export function isTerminal(error: Error): boolean {
  return (
    error instanceof SessionNotFoundError ||
    (error instanceof HttpResponseError && isNonRetryable(error))
  );
}

export type JobContext = {
  traceId: string;
};

export abstract class Job<T = unknown> {
  parameters: T;

  public jobName: string;
  public queue: string = 'default';

  constructor(parameters: T) {
    this.jobName = this.constructor.name;
    this.parameters = parameters;
  }

  async run(): Promise<void> {
    this.logger.info(`Starting ${this.jobName}`);

    try {
      await this.perform();
      this.logger.info(`Completed ${this.jobName}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (isTerminal(error)) {
        this.logger.warn({error}, `Terminated ${this.jobName}`);

        // return early = do not retry the job
        return;
      }

      this.logger.error({error}, `Failed ${this.jobName}`);

      // throw error = job runner will retry
      throw error;
    }
  }

  get logger(): Logger {
    return logger.child({
      job: this.jobName,
      parameters: this.parameters,
    });
  }

  toJSON() {
    return {
      jobName: this.jobName,
      parameters: this.parameters,
    };
  }

  abstract perform(): Promise<void>;
}
