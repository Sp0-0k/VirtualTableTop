export const COOKIE_DM = 'vtt_dm';
export const COOKIE_PLAYER = 'vtt_player_id';

// 30 days in seconds — used for Max-Age. Per spec §7: "30-day sliding expiry".
// We don't actively slide; re-issuing on /api/me and /api/dm/bootstrap is enough.
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;
