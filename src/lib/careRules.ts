/** Care economy — keep in sync with src-tauri/src/state.rs */

export const DAILY_BOND_CAP = 30;

/** @deprecated Energy system removed — kept as 0 for any leftover UI. */
export const CHECKIN_ENERGY_COST = 0;

/** @deprecated Energy system removed. */
export const INTERACT_ENERGY_COST: Record<string, number> = {
  pat: 0,
  poke: 0,
  hug: 0,
  tickle: 0,
  play: 0,
  feed: 0,
};
