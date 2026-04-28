// Set required env vars before any module imports them.
process.env.APP_SECRET = 'test-secret-do-not-use-in-prod';
// Make sure COOKIE_SECURE doesn't leak in from the operator's shell — tests
// need to control it explicitly.
delete process.env.COOKIE_SECURE;
