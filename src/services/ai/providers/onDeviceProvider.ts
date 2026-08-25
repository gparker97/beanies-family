// On-device provider — the future in-browser tier (WebLLM/WebGPU). Per the research
// (ADR-030), on-device is first-class for TEXT today but in-browser multimodal/vision
// for structured document extraction is not yet reliable, so this is a SEAM, not an
// implementation: it throws a typed `not_available` the UI shows as a friendly *info*
// toast (not an error). Keeping the seam here means adding the real on-device tier later
// requires no change to the service, the tier dispatch, or the wedge.

import {
  ExtractionProviderError,
  type ExtractionProvider,
  type ExtractionRequest,
  type ExtractionResultByTask,
  type ExtractionTask,
} from '../types';

const notAvailable = () =>
  Promise.reject(
    new ExtractionProviderError(
      'not_available',
      'On-device document extraction is not available yet'
    )
  );

export const onDeviceProvider: ExtractionProvider = {
  id: 'on-device',
  run<T extends ExtractionTask>(
    _task: T,
    _request: ExtractionRequest
  ): Promise<ExtractionResultByTask[T]> {
    return notAvailable();
  },
};
