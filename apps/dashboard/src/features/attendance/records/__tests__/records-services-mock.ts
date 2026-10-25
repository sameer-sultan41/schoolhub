/**
 * The `@/services` mock the Records tests share. A `jest.mock` factory can't reference an
 * import, so each test file calls this through `jest.requireActual`; it must not import
 * `@/services` itself (that would re-enter the mock).
 */
export function recordsServicesMock() {
  return {
    ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
    Services: {
      auth: { fetchCurrentUser: jest.fn() },
      schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
      studentAttendance: { fetchAttendancePage: jest.fn() },
      attendanceCorrections: { requestCorrection: jest.fn() },
    },
  };
}
