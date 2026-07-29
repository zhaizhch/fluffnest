import type { SkinPalette } from "../lib/types";

/**
 * Digimon-inspired evolution pet (original designs).
 * baby → 球兽感 · rookie → 小恐龙 · champion → 盔冠恐龙 · ultimate → 铠甲龙战士
 */
export function DigiFigure({
  palette,
  stage,
}: {
  palette: SkinPalette;
  stage: string;
}) {
  const ink = palette.ink;
  if (stage === "baby") return <BabyBit ink={ink} />;
  if (stage === "champion") return <ChampionBit ink={ink} />;
  if (stage === "ultimate") return <UltimateBit ink={ink} />;
  return <RookieBit ink={ink} />; // rookie / adult default
}

function BabyBit({ ink }: { ink: string }) {
  return (
    <svg className="char-figure digi baby" viewBox="0 0 140 160" width="120" height="140">
      <ellipse cx="70" cy="148" rx="28" ry="5" fill={ink} opacity="0.12" />
      <g className="part torso">
        <circle cx="70" cy="100" r="38" fill="#f4a0b8" />
        <circle cx="70" cy="100" r="28" fill="#ffc0d0" />
        <circle cx="58" cy="88" r="4" fill={ink} />
        <circle cx="82" cy="88" r="4" fill={ink} />
        <ellipse cx="70" cy="108" rx="8" ry="6" fill="#e07090" />
      </g>
      <g className="part arm left"><circle cx="38" cy="110" r="10" fill="#f4a0b8" /></g>
      <g className="part arm right"><circle cx="102" cy="110" r="10" fill="#f4a0b8" /></g>
    </svg>
  );
}

function RookieBit({ ink }: { ink: string }) {
  const yellow = "#f5d03a";
  const green = "#3a9e4a";
  return (
    <svg className="char-figure digi rookie" viewBox="0 0 160 210" width="150" height="200">
      <ellipse cx="80" cy="198" rx="32" ry="5" fill={ink} opacity="0.12" />
      <g className="part leg left"><path d="M58 155 L52 190 L68 190 L70 155Z" fill={yellow} /><path d="M50 188 h20 l-2 8 h-18z" fill="#e05040" /></g>
      <g className="part leg right"><path d="M90 155 L92 190 L108 190 L102 155Z" fill={yellow} /><path d="M90 188 h20 l2 8 h-20z" fill="#e05040" /></g>
      <g className="part torso">
        <path d="M55 100 C48 140 58 160 80 162 C102 160 112 140 105 100 C98 88 62 88 55 100Z" fill={yellow} />
        <path d="M68 105 L72 150 L88 150 L92 105 Z" fill={green} opacity="0.9" />
        <path d="M74 108 L78 145 M82 108 L86 145" stroke="#2d7a38" strokeWidth="2" />
      </g>
      <g className="part arm left"><path d="M55 115 C40 125 36 145 48 155 L56 148 C52 138 54 124 60 118Z" fill={yellow} /><path d="M42 152 l-8 6 6 4 8-4z" fill="#e05040" /></g>
      <g className="part arm right"><path d="M105 115 C120 125 124 145 112 155 L104 148 C108 138 106 124 100 118Z" fill={yellow} /><path d="M118 152 l8 6 -6 4 -8-4z" fill="#e05040" /></g>
      <g className="part head">
        <ellipse cx="80" cy="78" rx="36" ry="34" fill={yellow} />
        <g className="part eye left"><ellipse cx="64" cy="78" rx="9" ry="11" fill="#fff" /><circle className="iris" cx="66" cy="80" r="5" fill="#2a2018" /><circle cx="68" cy="76" r="1.8" fill="#fff" /></g>
        <g className="part eye right"><ellipse cx="96" cy="78" rx="9" ry="11" fill="#fff" /><circle className="iris" cx="94" cy="80" r="5" fill="#2a2018" /><circle cx="92" cy="76" r="1.8" fill="#fff" /></g>
        {/* smile teeth */}
        <path className="mouth-line" d="M62 95 Q80 112 98 95" stroke={ink} strokeWidth="2" fill="#fff" />
        <path d="M70 98 L70 106 M80 100 L80 108 M90 98 L90 106" stroke={ink} strokeWidth="1.2" />
        <ellipse className="mouth-open" cx="80" cy="102" rx="10" ry="8" fill="#c05040" opacity="0" />
      </g>
      <g className="props">
        <g className="prop-ball"><circle cx="128" cy="175" r="9" fill="#fff" stroke={ink} /></g>
        <g className="prop-flame"><path d="M30 120 Q20 100 28 90 Q35 105 30 120Z" fill="#ff7030" opacity="0.9" /></g>
      </g>
    </svg>
  );
}

function ChampionBit({ ink }: { ink: string }) {
  const orange = "#e89030";
  const cream = "#f5d9a0";
  return (
    <svg className="char-figure digi champion" viewBox="0 0 180 230" width="168" height="215">
      <ellipse cx="90" cy="218" rx="40" ry="6" fill={ink} opacity="0.14" />
      <g className="part leg left"><path d="M60 165 L50 210 L72 210 L74 165Z" fill={orange} /><path d="M48 208 h28 l-4 8 h-24z" fill="#3a3028" /></g>
      <g className="part leg right"><path d="M106 165 L108 210 L130 210 L120 165Z" fill={orange} /><path d="M106 208 h28 l4 8 h-28z" fill="#3a3028" /></g>
      <g className="part torso">
        <path d="M55 110 C45 155 58 175 90 178 C122 175 135 155 125 110 C115 95 65 95 55 110Z" fill={orange} />
        <ellipse cx="90" cy="145" rx="28" ry="22" fill={cream} />
        <path d="M70 125 h40 v8 h-40z" fill="#3a3028" opacity="0.35" />
      </g>
      <g className="part arm left"><path d="M55 120 C35 135 30 165 48 175 L58 165 C50 155 52 135 62 125Z" fill={orange} /></g>
      <g className="part arm right"><path d="M125 120 C145 135 150 165 132 175 L122 165 C130 155 128 135 118 125Z" fill={orange} /></g>
      <g className="part head">
        {/* helmet crest horns */}
        <path d="M50 70 L35 35 L60 68Z" fill={cream} stroke={ink} strokeWidth="1" />
        <path d="M130 70 L145 35 L120 68Z" fill={cream} stroke={ink} strokeWidth="1" />
        <path d="M90 28 L82 70 L98 70Z" fill={cream} stroke={ink} strokeWidth="1" />
        <ellipse cx="90" cy="88" rx="40" ry="36" fill={orange} />
        <path d="M55 75 Q90 55 125 75" fill={cream} />
        <g className="part eye left"><ellipse cx="72" cy="90" rx="8" ry="9" fill="#fff" /><circle className="iris" cx="73" cy="91" r="4.5" fill="#2a1810" /></g>
        <g className="part eye right"><ellipse cx="108" cy="90" rx="8" ry="9" fill="#fff" /><circle className="iris" cx="107" cy="91" r="4.5" fill="#2a1810" /></g>
        <path className="mouth-line" d="M75 108 Q90 118 105 108" stroke={ink} strokeWidth="2" fill="none" />
        <ellipse className="mouth-open" cx="90" cy="112" rx="8" ry="6" fill="#a04030" opacity="0" />
      </g>
      <g className="props">
        <g className="prop-flame"><path d="M25 130 Q10 100 22 85 Q32 110 25 130Z" fill="#ff6020" /></g>
      </g>
    </svg>
  );
}

function UltimateBit({ ink }: { ink: string }) {
  const gold = "#d4a84a";
  const armor = "#3a4558";
  const teal = "#4ec4b8";
  return (
    <svg className="char-figure digi ultimate" viewBox="0 0 180 240" width="170" height="225">
      <ellipse cx="90" cy="228" rx="38" ry="6" fill={ink} opacity="0.14" />
      <g className="part leg left"><path d="M62 170 L55 215 L75 215 L78 170Z" fill={armor} /><path d="M54 212 h24 v8 h-26z" fill={gold} /></g>
      <g className="part leg right"><path d="M102 170 L105 215 L125 215 L118 170Z" fill={armor} /><path d="M102 212 h26 v8 h-24z" fill={gold} /></g>
      <g className="part torso">
        <path d="M58 115 C52 155 62 175 90 178 C118 175 128 155 122 115 C112 100 68 100 58 115Z" fill={armor} />
        <path d="M70 120 L90 155 L110 120 Z" fill={teal} opacity="0.85" />
        <circle cx="90" cy="130" r="6" fill={gold} />
        {/* back shields hint */}
        <path d="M48 125 L35 150 L50 155Z" fill={gold} opacity="0.8" />
        <path d="M132 125 L145 150 L130 155Z" fill={gold} opacity="0.8" />
      </g>
      <g className="part arm left"><path d="M58 120 C40 135 35 165 52 172 L60 160 C52 150 54 132 64 124Z" fill={armor} /><path d="M40 168 h16 v6 h-18z" fill={gold} /></g>
      <g className="part arm right"><path d="M122 120 C140 135 145 165 128 172 L120 160 C128 150 126 132 116 124Z" fill={armor} /><path d="M124 168 h18 v6 h-16z" fill={gold} /></g>
      <g className="part head">
        <path d="M55 75 L45 40 L70 72Z" fill={gold} />
        <path d="M125 75 L135 40 L110 72Z" fill={gold} />
        <ellipse cx="90" cy="85" rx="34" ry="32" fill={armor} />
        <path d="M60 70 Q90 50 120 70" fill={gold} />
        <g className="part eye left"><ellipse cx="74" cy="88" rx="7" ry="6" fill={teal} /><circle cx="75" cy="88" r="2" fill="#fff" /></g>
        <g className="part eye right"><ellipse cx="106" cy="88" rx="7" ry="6" fill={teal} /><circle cx="105" cy="88" r="2" fill="#fff" /></g>
        <path className="mouth-line" d="M78 102 Q90 108 102 102" stroke={teal} strokeWidth="2" fill="none" />
        <ellipse className="mouth-open" cx="90" cy="106" rx="6" ry="4" fill="#203040" opacity="0" />
      </g>
      <g className="props">
        <g className="prop-wand"><path d="M130 160 L155 120" stroke={gold} strokeWidth="3" /><circle cx="156" cy="116" r="5" fill={teal} /></g>
        <g className="prop-flame"><path d="M28 140 Q14 110 26 95 Q36 120 28 140Z" fill="#4ec4b8" /></g>
      </g>
    </svg>
  );
}
