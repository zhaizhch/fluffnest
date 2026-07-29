/** Digimon egg (bit egg stage only). No wardrobe overlays. */

export function DigiEgg({ flame = false }: { flame?: boolean }) {
  return (
    <div className={`digiegg ${flame ? "flame" : ""}`} aria-label="数码蛋" title="数码蛋">
      <div className="digiegg-shell">
        <span className="digiegg-shine" />
        <span className="digiegg-band" />
        <span className="digiegg-sigil">D</span>
      </div>
      <div className="digiegg-shadow" />
    </div>
  );
}
