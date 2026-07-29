/** Cute egg shell per species — egg growth stage only. */

const EGG_COLORS: Record<string, { shell: string; spot: string; glow: string }> = {
  mochi: { shell: "#F6E8DC", spot: "#E8C8B0", glow: "#FFE8D8" },
  cloud: { shell: "#E4F0FA", spot: "#B8D4EC", glow: "#F0F8FF" },
  bean: { shell: "#E8C898", spot: "#C89058", glow: "#FFE8C0" },
  ink: { shell: "#C8CCD8", spot: "#687088", glow: "#E0E4F0" },
};

export function CuteEgg({ species = "mochi" }: { species?: string }) {
  const c = EGG_COLORS[species] ?? EGG_COLORS.mochi!;
  return (
    <div className="cute-egg" aria-label="宠物蛋" title="宠物蛋">
      <div
        className="cute-egg-shell"
        style={{
          background: `radial-gradient(circle at 35% 28%, ${c.glow}, ${c.shell} 55%, ${c.spot})`,
          borderColor: c.spot,
        }}
      >
        <span className="cute-egg-shine" />
        <span className="cute-egg-spot" style={{ background: c.spot }} />
        <span className="cute-egg-spot s2" style={{ background: c.spot }} />
        <span className="cute-egg-face">· ·</span>
      </div>
      <div className="cute-egg-shadow" />
    </div>
  );
}
