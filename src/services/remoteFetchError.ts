/**
 * The one error class every device-side remote fetch throws (weather, live flight checks), so
 * the classification fields and the message shape are written once. Each service keeps its own
 * subclass (`WeatherFetchError`, `FlightStatusApiError`) so its store's `instanceof` check only
 * ever matches its own service's failures.
 *
 * `devHint` is the developer's next step, printed on the console by the store and NEVER sent
 * to the firehose (it can name an endpoint).
 */
export class RemoteFetchError<C extends string = string> extends Error {
  /** Which service failed ("weather", "flight-status"); the message prefix. */
  readonly service: string;
  readonly code: C;
  readonly httpStatus?: number;
  readonly devHint: string;

  constructor(service: string, code: C, devHint: string, httpStatus?: number) {
    super(`${service} request failed: ${code}${httpStatus ? ` (HTTP ${httpStatus})` : ''}`);
    // Literal string, never a class name: the prod build minifies class names. Subclasses
    // overwrite it with their own literal.
    this.name = 'RemoteFetchError';
    this.service = service;
    this.code = code;
    this.httpStatus = httpStatus;
    this.devHint = devHint;
  }
}
