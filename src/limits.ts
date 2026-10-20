// Per-person limits for requests that change something (book, move, cancel, chat, edit).
// They sit on top of the general limit set in buildApp, and only apply when rate limiting
// is switched on, which the real server does and the tests normally do not.
export const writeLimit = { max: 20, timeWindow: '1 minute' };
