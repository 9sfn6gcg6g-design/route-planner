/**
 * Pillar 3 — quality score. Public seam: the single calibrated 0–1 segment
 * quality the finder ranks by and the UI shows as "Quality 87%" (decision 16).
 * To retune the blend or add a signal (decision 7), edit the weights and
 * `segmentQuality` in `evaluate.ts` — a new signal slots in as another weighted
 * dimension without reshaping this interface.
 */
export { segmentQuality } from './evaluate'
