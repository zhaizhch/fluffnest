import type { SkinPalette } from "../lib/types";

/** Rising-Antivirus-lion inspired golden mascot (original · round, yellow, big eyes). */
export function LionFigure({
  palette,
  stage,
}: {
  palette: SkinPalette;
  stage: string;
}) {
  const fur = stage === "ultimate" ? "#f0b84a" : "#f2c14b";
  const mane = "#e0922e";
  const ink = palette.ink;
  const belly = "#ffe9b0";
  const size = stage === "baby" ? 0.85 : stage === "champion" || stage === "ultimate" ? 1.08 : 1;

  return (
    <svg className="char-figure lion" viewBox="0 0 160 200" width={150 * size} height={188 * size}>
      <ellipse cx="80" cy="188" rx="36" ry="6" fill={ink} opacity="0.12" />
      {/* tail */}
      <g className="part tail">
        <path d="M118 130 Q145 120 138 95" stroke={fur} strokeWidth="10" fill="none" strokeLinecap="round" />
        <circle cx="138" cy="92" r="8" fill={mane} />
      </g>
      <g className="part leg left"><ellipse cx="58" cy="168" rx="12" ry="16" fill={fur} /><ellipse cx="56" cy="180" rx="10" ry="6" fill={mane} /></g>
      <g className="part leg right"><ellipse cx="100" cy="168" rx="12" ry="16" fill={fur} /><ellipse cx="102" cy="180" rx="10" ry="6" fill={mane} /></g>
      <g className="part torso">
        <ellipse cx="80" cy="140" rx="40" ry="36" fill={fur} />
        <ellipse cx="80" cy="148" rx="24" ry="20" fill={belly} />
        {stage !== "baby" && (
          <path d="M55 120 Q80 108 105 120" fill={mane} opacity="0.85" />
        )}
      </g>
      <g className="part arm left"><ellipse cx="42" cy="138" rx="12" ry="16" fill={fur} transform="rotate(-20 42 138)" /></g>
      <g className="part arm right"><ellipse cx="118" cy="138" rx="12" ry="16" fill={fur} transform="rotate(20 118 138)" /></g>
      <g className="part head">
        {/* ears */}
        <g className="part ears">
          <ellipse cx="48" cy="78" rx="14" ry="12" fill={fur} />
          <ellipse cx="48" cy="78" rx="7" ry="6" fill="#f5a0a8" />
          <ellipse cx="112" cy="78" rx="14" ry="12" fill={fur} />
          <ellipse cx="112" cy="78" rx="7" ry="6" fill="#f5a0a8" />
        </g>
        <circle cx="80" cy="100" r="42" fill={fur} />
        {stage === "champion" || stage === "ultimate" ? (
          <path d="M40 95 Q80 55 120 95 Q80 78 40 95Z" fill={mane} />
        ) : null}
        <ellipse className="cheek left" cx="52" cy="112" rx="9" ry="5" fill="#f5a0a8" opacity="0.5" />
        <ellipse className="cheek right" cx="108" cy="112" rx="9" ry="5" fill="#f5a0a8" opacity="0.5" />
        {/* classic big round eyes */}
        <g className="part eye left">
          <ellipse cx="64" cy="100" rx="11" ry="13" fill="#fff" />
          <ellipse className="iris" cx="66" cy="102" rx="6" ry="7" fill="#3a2a18" />
          <circle cx="68" cy="98" r="2.2" fill="#fff" />
        </g>
        <g className="part eye right">
          <ellipse cx="96" cy="100" rx="11" ry="13" fill="#fff" />
          <ellipse className="iris" cx="94" cy="102" rx="6" ry="7" fill="#3a2a18" />
          <circle cx="92" cy="98" r="2.2" fill="#fff" />
        </g>
        <ellipse cx="80" cy="118" rx="8" ry="6" fill="#e87840" />
        <path className="mouth-line" d="M72 124 Q80 130 88 124" stroke={ink} strokeWidth="1.6" fill="none" />
        <ellipse className="mouth-open" cx="80" cy="126" rx="5" ry="4" fill="#c06050" opacity="0" />
        {/* brow tuft */}
        <ellipse cx="80" cy="72" rx="10" ry="6" fill={mane} />
      </g>
      <g className="props">
        {/* Rising-style green shield badge */}
        <g className="prop-shield" transform="translate(118 48)">
          <path
            d="M12 0 L24 4 L24 14 Q24 24 12 30 Q0 24 0 14 L0 4 Z"
            fill={palette.accent}
            opacity="0.95"
          />
          <path
            d="M7 14 L11 18 L18 9"
            fill="none"
            stroke="#fff"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      </g>
    </svg>
  );
}
