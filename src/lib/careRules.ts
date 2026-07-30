/** Care economy — keep in sync with src-tauri/src/state.rs */

export const DAILY_BOND_CAP = 30;
export const CHECKIN_ENERGY_COST = 12;

export const INTERACT_ENERGY_COST: Record<string, number> = {
  pat: 4,
  poke: 3,
  hug: 6,
  tickle: 5,
  play: 8,
  feed: 0,
};
