import type { SkinPalette } from "../lib/types";

/** Vocaloid / Shimeji-inspired idol girl (original · twin-tails + headset). */
export function IdolFigure({
  palette,
  stage,
}: {
  palette: SkinPalette;
  stage: string;
}) {
  const hair = "#39c5bb";
  const hairDark = "#2a9e96";
  const skin = palette.body;
  const ink = palette.ink;
  const scale = stage === "baby" ? 0.82 : stage === "ultimate" ? 1.06 : 1;

  return (
    <svg className="char-figure idol" viewBox="0 0 160 220" width={160 * scale} height={220 * scale}>
      <ellipse cx="80" cy="208" rx="30" ry="5" fill={ink} opacity="0.12" />
      {/* twin tails back */}
      <g className="part hair-back">
        <path d="M48 70 C20 100 18 160 40 195 L58 100 Z" fill={hair} />
        <path d="M112 70 C140 100 142 160 120 195 L102 100 Z" fill={hair} />
        <path d="M42 120 C28 150 35 180 50 185" stroke={hairDark} strokeWidth="8" fill="none" opacity="0.5" />
        <path d="M118 120 C132 150 125 180 110 185" stroke={hairDark} strokeWidth="8" fill="none" opacity="0.5" />
      </g>
      <g className="part leg left"><path d="M66 155 L62 192 L72 192 L74 155Z" fill="#2a2a32" /><path d="M62 190 h12 v6 h-14z" fill="#1a1a22" /></g>
      <g className="part leg right"><path d="M86 155 L88 192 L98 192 L94 155Z" fill="#2a2a32" /><path d="M86 190 h14 v6 h-12z" fill="#1a1a22" /></g>
      <g className="part torso">
        <path d="M60 108 C58 145 65 158 80 160 C95 158 102 145 100 108 C92 100 68 100 60 108Z" fill={skin} />
        <path d="M62 112 C60 140 68 152 80 154 C92 152 100 140 98 112 L90 120 L80 116 L70 120Z" fill="#3a3a44" />
        <path d="M78 116 L80 148 L82 116" fill="#39c5bb" />
        <path d="M68 112 L80 126 L92 112 L80 118Z" fill="#f4f7fa" />
        <circle cx="80" cy="122" r="3" fill="#39c5bb" />
        {stage === "ultimate" && <path d="M55 100 H105" stroke="#39c5bb" strokeWidth="2" opacity="0.6" />}
      </g>
      <g className="part arm left"><path d="M60 114 C48 125 44 145 50 155 L58 152 C56 140 58 126 64 118Z" fill={skin} /><circle cx="51" cy="156" r="5.5" fill={skin} /></g>
      <g className="part arm right"><path d="M100 114 C112 125 116 145 110 155 L102 152 C104 140 102 126 96 118Z" fill={skin} /><circle cx="109" cy="156" r="5.5" fill={skin} /></g>
      <g className="part head">
        {/* headset */}
        <rect x="42" y="70" width="10" height="18" rx="3" fill="#2a2a32" />
        <rect x="108" y="70" width="10" height="18" rx="3" fill="#2a2a32" />
        <path d="M52 72 Q80 58 108 72" stroke="#2a2a32" strokeWidth="3" fill="none" />
        <circle cx="47" cy="79" r="3" fill="#39c5bb" />
        <circle cx="113" cy="79" r="3" fill="#39c5bb" />
        <ellipse cx="80" cy="78" rx="32" ry="34" fill={skin} />
        <ellipse className="cheek left" cx="58" cy="88" rx="6" ry="3.5" fill="#ff9eb5" opacity="0.45" />
        <ellipse className="cheek right" cx="102" cy="88" rx="6" ry="3.5" fill="#ff9eb5" opacity="0.45" />
        <g className="part eye left"><ellipse cx="66" cy="78" rx="7" ry="8.5" fill="#fff" /><ellipse className="iris" cx="67" cy="79" rx="4" ry="5" fill="#2ec4b6" /><circle cx="68.5" cy="76" r="1.5" fill="#fff" /></g>
        <g className="part eye right"><ellipse cx="94" cy="78" rx="7" ry="8.5" fill="#fff" /><ellipse className="iris" cx="93" cy="79" rx="4" ry="5" fill="#2ec4b6" /><circle cx="91.5" cy="76" r="1.5" fill="#fff" /></g>
        <path className="mouth-line" d="M74 96 Q80 101 86 96" stroke={ink} strokeWidth="1.4" fill="none" />
        <ellipse className="mouth-open" cx="80" cy="98" rx="3.5" ry="2.5" fill="#c07080" opacity="0" />
        {/* bangs + twin-tail roots */}
        <g className="part hair-front">
          <path d="M48 72 C52 40 72 30 80 32 C88 30 108 40 112 72 C98 50 88 56 80 58 C72 56 62 50 48 72Z" fill={hair} />
          <path d="M64 38 Q70 60 66 82" stroke={hairDark} strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M96 38 Q90 60 94 82" stroke={hairDark} strokeWidth="7" fill="none" strokeLinecap="round" />
          <path d="M48 70 Q40 95 48 130" stroke={hair} strokeWidth="14" fill="none" strokeLinecap="round" />
          <path d="M112 70 Q120 95 112 130" stroke={hair} strokeWidth="14" fill="none" strokeLinecap="round" />
          <rect x="44" y="58" width="8" height="5" rx="1" fill="#fff" opacity="0.7" />
          <rect x="108" y="58" width="8" height="5" rx="1" fill="#fff" opacity="0.7" />
        </g>
      </g>
      <g className={`props`}>
        <g className="prop-note"><text x="120" y="100" fontSize="14" fill="#39c5bb">♪</text></g>
        <g className="prop-mic"><rect x="118" y="140" width="6" height="22" rx="2" fill="#2a2a32" /><circle cx="121" cy="136" r="6" fill="#39c5bb" /></g>
      </g>
    </svg>
  );
}
