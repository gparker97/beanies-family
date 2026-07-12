import type { CalendarClient, CalendarInstance } from '../CalendarClient';

/**
 * Full `CalendarClient` stub with harmless no-op defaults; override any method per
 * test. Keeps the interface in ONE place so adding a client method doesn't re-break
 * every inline `const x: CalendarClient = {…}` literal across the test suite.
 */
export function makeCalendarClientStub(overrides: Partial<CalendarClient> = {}): CalendarClient {
  return {
    invalidateConnection() {},
    async insertEvent() {},
    async patchEvent() {},
    async patchEventFields() {},
    async listInstances(): Promise<CalendarInstance[]> {
      return [];
    },
    async deleteEvent() {},
    async eventExists() {
      return true;
    },
    async listCalendars() {
      return [{ id: 'primary', summary: 'Primary', primary: true }];
    },
    async listEventTimes() {
      return [];
    },
    ...overrides,
  };
}
