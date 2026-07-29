import type { SkinPalette } from "../lib/types";

type Props = {
  species: string;
  palette: SkinPalette;
  behavior: string;
};

/** Original anime-style layered 立绘 (not based on any copyrighted IP). */
export function AnimeFigure({ species, palette, behavior }: Props) {
  const skin = palette.body;
  const hair = hairColor(species, palette);
  const cloth = palette.accent;
  const ink = palette.ink;
  const blush = palette.blush;
  const eyeWhite = "#fffaf6";
  const iris = irisColor(species, palette);

  return (
    <svg
      className="anime-figure"
      viewBox="0 0 160 220"
      width="160"
      height="220"
      aria-hidden
    >
      <defs>
        <linearGradient id="hairShine" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.35" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="clothGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={cloth} stopOpacity="1" />
          <stop offset="100%" stopColor={ink} stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id="cheekGrad" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={blush} stopOpacity="0.85" />
          <stop offset="100%" stopColor={blush} stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* ground shadow */}
      <ellipse className="part shadow" cx="80" cy="208" rx="34" ry="6" fill={ink} opacity="0.12" />

      {/* hair back */}
      <g className="part hair-back">
        {species === "cloud" ? (
          <>
            <path d="M40 78 C28 120 30 170 48 188 L55 120 C50 100 52 82 60 72 Z" fill={hair} />
            <path d="M120 78 C132 120 130 170 112 188 L105 120 C110 100 108 82 100 72 Z" fill={hair} />
            <path d="M48 70 C40 110 55 165 70 175 L78 95 Z" fill={hair} opacity="0.9" />
            <path d="M112 70 C120 110 105 165 90 175 L82 95 Z" fill={hair} opacity="0.9" />
          </>
        ) : species === "ink" ? (
          <>
            <path d="M42 70 C25 100 35 160 55 185 L62 110 Z" fill={hair} />
            <path d="M118 70 C135 100 125 160 105 185 L98 110 Z" fill={hair} />
            <path d="M70 175 Q80 195 90 175" fill={hair} />
          </>
        ) : (
          <>
            <path d="M46 78 C38 115 42 150 55 168 L62 100 Z" fill={hair} />
            <path d="M114 78 C122 115 118 150 105 168 L98 100 Z" fill={hair} />
          </>
        )}
      </g>

      {/* legs */}
      <g className="part leg left" style={{ transformOrigin: "68px 168px" }}>
        <path d="M60 152 L54 188 L66 188 L70 152 Z" fill={skin} />
        <path d="M52 186 L68 186 L70 194 L50 194 Z" fill={ink} opacity="0.75" />
      </g>
      <g className="part leg right" style={{ transformOrigin: "92px 168px" }}>
        <path d="M90 152 L94 188 L106 188 L100 152 Z" fill={skin} />
        <path d="M92 186 L108 186 L110 194 L90 194 Z" fill={ink} opacity="0.75" />
      </g>

      {/* torso + outfit */}
      <g className="part torso" style={{ transformOrigin: "80px 130px" }}>
        <path
          d="M58 108 C55 140 58 155 68 162 L92 162 C102 155 105 140 102 108
             C95 100 85 96 80 96 C75 96 65 100 58 108 Z"
          fill={skin}
        />
        {/* outfit */}
        {species === "bean" ? (
          <>
            <path
              d="M57 112 C56 138 60 152 70 158 L90 158 C100 152 104 138 103 112
                 L95 118 L80 114 L65 118 Z"
              fill="url(#clothGrad)"
            />
            <rect x="74" y="118" width="12" height="36" rx="2" fill={ink} opacity="0.2" />
          </>
        ) : species === "ink" ? (
          <path
            d="M56 110 C54 145 60 165 80 168 C100 165 106 145 104 110
               L96 120 L80 116 L64 120 Z"
            fill="url(#clothGrad)"
          />
        ) : (
          <>
            {/* sailor / soft collar vibe */}
            <path
              d="M58 112 C57 140 62 155 80 158 C98 155 103 140 102 112
                 L92 122 L80 118 L68 122 Z"
              fill="url(#clothGrad)"
            />
            <path d="M68 112 L80 124 L92 112 L80 118 Z" fill={eyeWhite} opacity="0.9" />
            <path d="M74 122 L80 132 L86 122" fill={blush} opacity="0.8" />
          </>
        )}
      </g>

      {/* arms */}
      <g className="part arm left" style={{ transformOrigin: "56px 118px" }}>
        <path d="M58 112 C46 122 40 142 46 154 L56 152 C54 140 56 126 62 118 Z" fill={skin} />
        <circle cx="48" cy="156" r="6" fill={skin} />
      </g>
      <g className="part arm right" style={{ transformOrigin: "104px 118px" }}>
        <path d="M102 112 C114 122 120 142 114 154 L104 152 C106 140 104 126 98 118 Z" fill={skin} />
        <circle cx="112" cy="156" r="6" fill={skin} />
      </g>

      {/* head */}
      <g className="part head" style={{ transformOrigin: "80px 78px" }}>
        <ellipse cx="80" cy="78" rx="34" ry="36" fill={skin} />
        {/* soft jaw */}
        <ellipse cx="80" cy="92" rx="28" ry="20" fill={skin} />

        {/* animal / style ears */}
        {species === "mochi" && (
          <g className="part ears">
            <path d="M52 52 L46 28 L62 48 Z" fill={hair} />
            <path d="M52 48 L48 34 L58 46 Z" fill={blush} opacity="0.55" />
            <path d="M108 52 L114 28 L98 48 Z" fill={hair} />
            <path d="M108 48 L112 34 L102 46 Z" fill={blush} opacity="0.55" />
          </g>
        )}
        {species === "bean" && (
          <g className="part ears">
            <ellipse cx="52" cy="48" rx="9" ry="7" fill={hair} />
            <ellipse cx="108" cy="48" rx="9" ry="7" fill={hair} />
          </g>
        )}

        {/* face */}
        <g className="part face">
          <ellipse className="cheek left" cx="58" cy="88" rx="7" ry="4" fill="url(#cheekGrad)" />
          <ellipse className="cheek right" cx="102" cy="88" rx="7" ry="4" fill="url(#cheekGrad)" />

          <g className="part brow">
            <path d="M58 66 Q64 63 70 66" stroke={ink} strokeWidth="1.4" fill="none" opacity="0.45" />
            <path d="M90 66 Q96 63 102 66" stroke={ink} strokeWidth="1.4" fill="none" opacity="0.45" />
          </g>

          <g className="part eye left">
            <ellipse cx="64" cy="78" rx="7.5" ry="9" fill={eyeWhite} />
            <ellipse className="iris" cx="65" cy="79" rx="4.2" ry="5.2" fill={iris} />
            <circle cx="66.5" cy="76.5" r="1.6" fill="#fff" />
            <path className="lid" d="M56 78 Q64 68 72 78" fill={skin} opacity="0" />
          </g>
          <g className="part eye right">
            <ellipse cx="96" cy="78" rx="7.5" ry="9" fill={eyeWhite} />
            <ellipse className="iris" cx="95" cy="79" rx="4.2" ry="5.2" fill={iris} />
            <circle cx="93.5" cy="76.5" r="1.6" fill="#fff" />
            <path className="lid" d="M88 78 Q96 68 104 78" fill={skin} opacity="0" />
          </g>

          <g className="part mouth">
            <path
              className="mouth-line"
              d="M74 96 Q80 100 86 96"
              stroke={ink}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
            />
            <ellipse className="mouth-open" cx="80" cy="98" rx="4" ry="3" fill="#c07070" opacity="0" />
          </g>
        </g>

        {/* bangs / hair front */}
        <g className="part hair-front">
          {species === "cloud" ? (
            <>
              <path d="M46 70 C50 40 70 30 80 32 C90 30 110 40 114 70 C100 52 90 55 80 58 C70 55 60 52 46 70 Z" fill={hair} />
              <path d="M62 42 C70 55 74 70 72 82" stroke={hair} strokeWidth="7" fill="none" strokeLinecap="round" />
              <path d="M98 42 C90 55 86 70 88 82" stroke={hair} strokeWidth="7" fill="none" strokeLinecap="round" />
            </>
          ) : species === "ink" ? (
            <>
              <path d="M48 68 C52 38 78 28 80 30 C82 28 108 38 112 68 C98 48 88 54 80 56 C72 54 62 48 48 68 Z" fill={hair} />
              <path d="M80 30 L78 78" stroke={ink} strokeWidth="2" opacity="0.25" />
            </>
          ) : species === "bean" ? (
            <path d="M48 72 C52 42 70 34 80 36 C90 34 108 42 112 72 C100 55 90 58 80 60 C70 58 60 55 48 72 Z" fill={hair} />
          ) : (
            <>
              <path d="M48 70 C54 42 72 34 80 35 C88 34 106 42 112 70 C100 54 90 58 80 60 C70 58 60 54 48 70 Z" fill={hair} />
              <path d="M70 38 Q74 58 70 78" stroke={hair} strokeWidth="8" fill="none" strokeLinecap="round" />
              <circle cx="108" cy="58" r="5" fill={blush} opacity="0.7" />
            </>
          )}
          <path d="M55 48 L70 55" stroke="url(#hairShine)" strokeWidth="3" strokeLinecap="round" />
        </g>
      </g>

      {/* action props anchored on figure */}
      <g className={`props behavior-${behavior}`}>
        <g className="prop-ball">
          <circle cx="128" cy="190" r="9" fill="#f2f2f2" stroke={ink} strokeWidth="1" />
          <path d="M120 190 H136 M128 182 V198" stroke={ink} strokeWidth="1" opacity="0.5" />
        </g>
        <g className="prop-rope">
          <path d="M48 150 Q80 110 112 150" fill="none" stroke={cloth} strokeWidth="2.5" />
        </g>
        <g className="prop-cup">
          <rect x="118" y="130" width="14" height="12" rx="2" fill={cloth} />
          <path d="M132 132 Q140 136 132 140" fill="none" stroke={cloth} strokeWidth="2" />
        </g>
        <g className="prop-book">
          <rect x="112" y="128" width="20" height="14" rx="1.5" fill="#7a5c48" />
          <rect x="122" y="128" width="10" height="14" rx="1" fill="#d4b896" />
        </g>
        <g className="prop-brush">
          <rect x="122" y="118" width="3" height="28" rx="1" fill={ink} transform="rotate(20 124 132)" />
          <circle cx="130" cy="116" r="3" fill={blush} />
        </g>
        <g className="prop-phone">
          <rect x="116" y="132" width="12" height="20" rx="2" fill={ink} />
          <rect x="118" y="135" width="8" height="12" rx="1" fill="#9ad" />
        </g>
        <g className="prop-wand">
          <path d="M118 150 L138 112" stroke={cloth} strokeWidth="2.5" />
          <path d="M138 108 l3 7 7 1 -5 5 2 7 -7-4 -7 4 2-7 -5-5 7-1 z" fill="#f5e6a6" />
        </g>
        <g className="prop-note">
          <text x="118" y="100" fontSize="16" fill={cloth}>♪</text>
        </g>
        <g className="prop-snack">
          <ellipse cx="80" cy="120" rx="8" ry="5" fill="#d4a070" />
        </g>
      </g>
    </svg>
  );
}

function hairColor(species: string, p: SkinPalette): string {
  switch (species) {
    case "cloud":
      return shade(p.accent, 1.15);
    case "ink":
      return shade(p.ink, 1.35);
    case "bean":
      return shade(p.accent, 0.85);
    default:
      return shade(p.ear, 0.92);
  }
}

function irisColor(species: string, p: SkinPalette): string {
  switch (species) {
    case "cloud":
      return "#5a7fa8";
    case "ink":
      return "#3a4560";
    case "bean":
      return "#5f7a48";
    default:
      return shade(p.accent, 0.65);
  }
}

function shade(hex: string, factor: number): string {
  const n = hex.replace("#", "");
  const full = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  const num = parseInt(full, 16);
  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;
  r = Math.min(255, Math.max(0, Math.round(r * factor)));
  g = Math.min(255, Math.max(0, Math.round(g * factor)));
  b = Math.min(255, Math.max(0, Math.round(b * factor)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
