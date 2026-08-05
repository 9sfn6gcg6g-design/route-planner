/**
 * Pillar 1 — user input. Public seam: the form/API boundary that turns raw form
 * strings into a validated `Session` before the compiler sees them (decision
 * 10). To change what the app accepts or how it is validated, edit `parse.ts`.
 */
export { parseSessionForm } from './parse'
export type { FieldErrors, ParseResult, SessionFormValues } from './parse'
