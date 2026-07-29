import type { CSSProperties } from "react";
import { stageMeta } from "../lib/evolution";
import {
  getSkinStyle,
  resolveSkinFilter,
  stageVisual,
  type SkinAccessory,
} from "../lib/skinLines";
import type { SkinPalette } from "../lib/types";

type Props = {
  species: string;
  stage: string;
  skinId?: string;
  palette?: SkinPalette;
  behavior?: string;
  facing?: "left" | "right";
  size?: number;
};

const PALETTE: Record<string, SkinPalette> = {
  mochi: {
    body: "#F3E6D8",
    blush: "#E8A090",
    ear: "#E8D5C4",
    accent: "#C4A484",
    ink: "#3D3229",
  },
  cloud: {
    body: "#E8F0F8",
    blush: "#F0B8C8",
    ear: "#D0E4F4",
    accent: "#A8C8E0",
    ink: "#3A4858",
  },
  bean: {
    body: "#E8C090",
    blush: "#E8A090",
    ear: "#D4A878",
    accent: "#C48858",
    ink: "#4A3020",
  },
  ink: {
    body: "#C8CCD8",
    blush: "#A8B0C0",
    ear: "#B0B4C4",
    accent: "#687088",
    ink: "#1E2430",
  },
};

function Accessories({
  list,
  pal,
  cx,
  topY,
}: {
  list: SkinAccessory[];
  pal: SkinPalette;
  cx: number;
  topY: number;
}) {
  return (
    <g className="soft-accessories">
      {list.map((a) => {
        switch (a) {
          case "beret":
            return (
              <g key={a}>
                <ellipse cx={cx - 4} cy={topY - 2} rx="22" ry="10" fill="#5C4033" />
                <ellipse cx={cx + 10} cy={topY} rx="8" ry="5" fill="#4A3228" />
              </g>
            );
          case "strawberry_clip":
            return (
              <g key={a} transform={`translate(${cx + 18} ${topY + 8})`}>
                <ellipse cx="0" cy="2" rx="7" ry="8" fill="#E06070" />
                <path d="M-4 -4 Q0 -8 4 -4" fill="#6AAA5A" />
                <circle cx="-2" cy="2" r="1.2" fill="#fff8" />
                <circle cx="2" cy="4" r="1" fill="#fff8" />
              </g>
            );
          case "hoodie":
            return (
              <g key={a}>
                <path
                  d={`M${cx - 28} ${topY + 36} Q${cx} ${topY + 22} ${cx + 28} ${topY + 36}
                      L${cx + 24} ${topY + 58} Q${cx} ${topY + 48} ${cx - 24} ${topY + 58} Z`}
                  fill="#6B8FA8"
                  opacity="0.92"
                />
                <path
                  d={`M${cx - 16} ${topY + 8} Q${cx} ${topY - 6} ${cx + 16} ${topY + 8}`}
                  fill="none"
                  stroke="#5A7A92"
                  strokeWidth="6"
                  strokeLinecap="round"
                />
              </g>
            );
          case "sunny_doll":
            return (
              <g key={a} transform={`translate(${cx - 30} ${topY + 20})`}>
                <circle cx="0" cy="0" r="8" fill="#F5E6A8" stroke={pal.ink} strokeWidth="1" />
                <line x1="0" y1="8" x2="0" y2="22" stroke="#C8A878" strokeWidth="1.5" />
                <circle cx="-2.5" cy="-1" r="1" fill={pal.ink} />
                <circle cx="2.5" cy="-1" r="1" fill={pal.ink} />
              </g>
            );
          case "dusk_feather":
            return (
              <g key={a}>
                <ellipse
                  cx={cx + 26}
                  cy={topY + 28}
                  rx="14"
                  ry="22"
                  fill="#E8A070"
                  opacity="0.75"
                  transform={`rotate(18 ${cx + 26} ${topY + 28})`}
                />
                <ellipse
                  cx={cx - 26}
                  cy={topY + 28}
                  rx="12"
                  ry="18"
                  fill="#D88860"
                  opacity="0.65"
                  transform={`rotate(-18 ${cx - 26} ${topY + 28})`}
                />
              </g>
            );
          case "rain_umbrella":
            return (
              <g key={a} transform={`translate(${cx + 34} ${topY + 4})`}>
                <path
                  d="M-18 8 Q0 -10 18 8 Z"
                  fill="#E8F4F8"
                  stroke="#A8C0D0"
                  strokeWidth="1.5"
                  opacity="0.85"
                />
                <line x1="0" y1="8" x2="0" y2="36" stroke="#A8C0D0" strokeWidth="2" />
              </g>
            );
          case "overalls":
            return (
              <g key={a}>
                <path
                  d={`M${cx - 22} ${topY + 40} L${cx - 18} ${topY + 22} L${cx - 10} ${topY + 22}
                      L${cx - 12} ${topY + 40} Z`}
                  fill="#6A9E6A"
                />
                <path
                  d={`M${cx + 22} ${topY + 40} L${cx + 18} ${topY + 22} L${cx + 10} ${topY + 22}
                      L${cx + 12} ${topY + 40} Z`}
                  fill="#6A9E6A"
                />
                <rect
                  x={cx - 22}
                  y={topY + 40}
                  width="44"
                  height="22"
                  rx="6"
                  fill="#5A8E5A"
                />
                <circle cx={cx + 20} cy={topY + 18} r="5" fill="#7ABA5A" />
              </g>
            );
          case "sport_band":
            return (
              <g key={a}>
                <rect
                  x={cx - 20}
                  y={topY + 10}
                  width="40"
                  height="8"
                  rx="3"
                  fill="#3A9E4A"
                />
                <rect
                  x={cx - 6}
                  y={topY + 10}
                  width="12"
                  height="8"
                  fill="#F5F0E8"
                />
              </g>
            );
          case "apron":
            return (
              <g key={a}>
                <path
                  d={`M${cx - 24} ${topY + 36} L${cx + 24} ${topY + 36}
                      L${cx + 20} ${topY + 62} L${cx - 20} ${topY + 62} Z`}
                  fill="#F5F0E8"
                  stroke="#C8B8A0"
                  strokeWidth="1"
                />
                <rect x={cx - 8} y={topY + 42} width="16" height="12" rx="2" fill="#D4C4A8" />
              </g>
            );
          case "paintbrush":
            return (
              <g key={a} transform={`translate(${cx + 32} ${topY + 40}) rotate(25)`}>
                <rect x="-2" y="0" width="4" height="28" rx="1" fill="#8B6914" />
                <path d="M-4 0 L4 0 L2 -10 L-2 -10 Z" fill="#E8E0D0" />
                <circle cx="0" cy="-12" r="4" fill="#6870A8" />
                <circle cx={-14} cy={8} r="3" fill="#E06070" opacity="0.8" />
                <circle cx={-10} cy={14} r="2.5" fill="#F0C040" opacity="0.8" />
              </g>
            );
          case "thick_glasses":
            return (
              <g key={a}>
                <circle cx={cx - 10} cy={topY + 28} r="9" fill="none" stroke={pal.ink} strokeWidth="2.5" />
                <circle cx={cx + 10} cy={topY + 28} r="9" fill="none" stroke={pal.ink} strokeWidth="2.5" />
                <line x1={cx - 1} y1={topY + 28} x2={cx + 1} y2={topY + 28} stroke={pal.ink} strokeWidth="2" />
              </g>
            );
          case "book":
            return (
              <g key={a} transform={`translate(${cx - 36} ${topY + 44})`}>
                <rect x="0" y="0" width="16" height="20" rx="1" fill="#E8DCC8" stroke={pal.ink} strokeWidth="1" />
                <line x1="8" y1="0" x2="8" y2="20" stroke="#C8B8A0" strokeWidth="1" />
              </g>
            );
          case "sleep_cap":
            return (
              <g key={a}>
                <path
                  d={`M${cx - 18} ${topY + 12} Q${cx} ${topY - 16} ${cx + 22} ${topY + 6}
                      L${cx + 18} ${topY + 14} Q${cx} ${topY + 4} ${cx - 16} ${topY + 14} Z`}
                  fill="#B8C0D8"
                />
                <circle cx={cx + 22} cy={topY + 4} r="5" fill="#E8E4F0" />
              </g>
            );
          default:
            return null;
        }
      })}
    </g>
  );
}

function Egg({
  species,
  pal,
}: {
  species: string;
  pal: SkinPalette;
}) {
  const pattern =
    species === "mochi"
      ? "#F8F0E8"
      : species === "cloud"
        ? "#D8E8F4"
        : species === "bean"
          ? "#D4A878"
          : "#A8B0C0";
  return (
    <g className="soft-egg">
      <ellipse cx="80" cy="88" rx="36" ry="44" fill={pal.body} stroke={pal.ink} strokeWidth="2.2" />
      <ellipse cx="68" cy="72" rx="10" ry="6" fill="#fff" opacity="0.45" />
      {species === "mochi" && (
        <>
          <ellipse cx="70" cy="96" rx="6" ry="4" fill={pattern} opacity="0.7" />
          <ellipse cx="92" cy="100" rx="5" ry="3.5" fill={pattern} opacity="0.7" />
        </>
      )}
      {species === "cloud" && (
        <>
          <ellipse cx="62" cy="88" rx="10" ry="8" fill={pattern} opacity="0.55" />
          <ellipse cx="95" cy="92" rx="12" ry="9" fill={pattern} opacity="0.45" />
        </>
      )}
      {species === "bean" && (
        <path
          d="M80 52 Q88 88 80 124 Q72 88 80 52"
          fill="none"
          stroke={pal.accent}
          strokeWidth="3"
          opacity="0.5"
        />
      )}
      {species === "ink" && (
        <>
          <ellipse cx="80" cy="100" rx="22" ry="8" fill={pal.accent} opacity="0.25" />
          <rect x="74" y="48" width="12" height="10" rx="2" fill={pal.accent} opacity="0.5" />
        </>
      )}
      <ellipse cx="80" cy="138" rx="22" ry="5" fill={pal.ink} opacity="0.12" />
    </g>
  );
}

function MochiBody({
  pal,
  feature,
  upright,
}: {
  pal: SkinPalette;
  feature: number;
  upright: number;
}) {
  const sit = 1 - upright;
  const bodyCy = 78 + sit * 8;
  const bodyRy = 38 - sit * 4;
  const earH = 8 + feature * 14;
  const tail = feature > 0.2;
  return (
    <g>
      {tail && (
        <ellipse
          cx="118"
          cy={bodyCy + 20}
          rx={6 + feature * 8}
          ry={10 + feature * 10}
          fill={pal.ear}
          opacity="0.9"
        />
      )}
      <ellipse cx="80" cy={bodyCy} rx="42" ry={bodyRy} fill={pal.body} stroke={pal.ink} strokeWidth="2.2" />
      {/* ears */}
      <ellipse cx="52" cy={bodyCy - 28} rx="12" ry={earH} fill={pal.ear} stroke={pal.ink} strokeWidth="1.5" />
      <ellipse cx="108" cy={bodyCy - 28} rx="12" ry={earH} fill={pal.ear} stroke={pal.ink} strokeWidth="1.5" />
      {/* face */}
      <ellipse cx="68" cy={bodyCy - 4} rx="4.5" ry="5.5" fill={pal.ink} />
      <ellipse cx="92" cy={bodyCy - 4} rx="4.5" ry="5.5" fill={pal.ink} />
      <circle cx="69.5" cy={bodyCy - 5.5} r="1.4" fill="#fff" />
      <circle cx="93.5" cy={bodyCy - 5.5} r="1.4" fill="#fff" />
      <ellipse cx="62" cy={bodyCy + 8} rx="7" ry="4" fill={pal.blush} opacity="0.55" />
      <ellipse cx="98" cy={bodyCy + 8} rx="7" ry="4" fill={pal.blush} opacity="0.55" />
      <path
        d={`M74 ${bodyCy + 10} Q80 ${bodyCy + 14 + feature * 2} 86 ${bodyCy + 10}`}
        fill="none"
        stroke={pal.ink}
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </g>
  );
}

function CloudBody({
  pal,
  feature,
  upright,
}: {
  pal: SkinPalette;
  feature: number;
  upright: number;
}) {
  const cy = 76 + (1 - upright) * 6;
  const wing = feature * 22;
  return (
    <g>
      {feature > 0.3 && (
        <>
          <ellipse cx={48 - wing * 0.2} cy={cy + 4} rx={14 + wing * 0.4} ry={10 + wing * 0.3} fill={pal.ear} opacity="0.85" />
          <ellipse cx={112 + wing * 0.2} cy={cy + 4} rx={14 + wing * 0.4} ry={10 + wing * 0.3} fill={pal.ear} opacity="0.85" />
        </>
      )}
      <ellipse cx="80" cy={cy} rx="40" ry="34" fill={pal.body} stroke={pal.ink} strokeWidth="2" />
      <ellipse cx="58" cy={cy - 8} rx="16" ry="14" fill={pal.body} />
      <ellipse cx="102" cy={cy - 6} rx="14" ry="12" fill={pal.body} />
      <ellipse cx="80" cy={cy - 18} rx="18" ry="14" fill={pal.body} stroke={pal.ink} strokeWidth="1.5" />
      {/* bird face peek */}
      <ellipse cx="74" cy={cy - 16} rx="3.5" ry="4" fill={pal.ink} />
      <ellipse cx="88" cy={cy - 16} rx="3.5" ry="4" fill={pal.ink} />
      <path d={`M78 ${cy - 8} L82 ${cy - 5} L86 ${cy - 8}`} fill={pal.accent} />
      {feature > 0.5 && (
        <ellipse cx="80" cy={cy + 28} rx={8 + feature * 10} ry={6 + feature * 6} fill={pal.ear} opacity="0.7" />
      )}
      <ellipse cx="64" cy={cy - 2} rx="5" ry="3" fill={pal.blush} opacity="0.45" />
      <ellipse cx="96" cy={cy - 2} rx="5" ry="3" fill={pal.blush} opacity="0.45" />
    </g>
  );
}

function BeanBody({
  pal,
  feature,
  upright,
}: {
  pal: SkinPalette;
  feature: number;
  upright: number;
}) {
  const cy = 74 + (1 - upright) * 10;
  const standing = upright > 0.5;
  return (
    <g>
      {/* tail */}
      {feature > 0.2 && (
        <ellipse
          cx="118"
          cy={cy + 16}
          rx="7"
          ry={8 + feature * 8}
          fill={pal.accent}
          transform={`rotate(${standing ? -20 : 10} 118 ${cy + 16})`}
        />
      )}
      <ellipse cx="80" cy={cy} rx="36" ry={standing ? 40 : 34} fill={pal.body} stroke={pal.ink} strokeWidth="2.2" />
      <ellipse cx="56" cy={cy - 26} rx="11" ry={10 + feature * 4} fill={pal.ear} stroke={pal.ink} strokeWidth="1.5" />
      <ellipse cx="104" cy={cy - 26} rx="11" ry={10 + feature * 4} fill={pal.ear} stroke={pal.ink} strokeWidth="1.5" />
      <ellipse cx="80" cy={cy + 2} rx="7" ry="5" fill={pal.accent} />
      <ellipse cx="68" cy={cy - 6} rx="4.5" ry="5" fill={pal.ink} />
      <ellipse cx="92" cy={cy - 6} rx="4.5" ry="5" fill={pal.ink} />
      <circle cx="69.2" cy={cy - 7.2} r="1.3" fill="#fff" />
      <circle cx="93.2" cy={cy - 7.2} r="1.3" fill="#fff" />
      <ellipse cx="60" cy={cy + 6} rx="6" ry="3.5" fill={pal.blush} opacity="0.5" />
      <ellipse cx="100" cy={cy + 6} rx="6" ry="3.5" fill={pal.blush} opacity="0.5" />
      {standing && feature > 0.6 && (
        <>
          <ellipse cx="58" cy={cy + 36} rx="8" ry="10" fill={pal.body} stroke={pal.ink} strokeWidth="1.5" />
          <ellipse cx="102" cy={cy + 36} rx="8" ry="10" fill={pal.body} stroke={pal.ink} strokeWidth="1.5" />
        </>
      )}
      {!standing && (
        <>
          <ellipse cx="52" cy={cy + 24} rx="10" ry="7" fill={pal.ear} />
          <ellipse cx="108" cy={cy + 24} rx="10" ry="7" fill={pal.ear} />
        </>
      )}
    </g>
  );
}

function InkBody({
  pal,
  feature,
  upright,
}: {
  pal: SkinPalette;
  feature: number;
  upright: number;
}) {
  const cy = 70 + (1 - upright) * 8;
  const tentacles = Math.round(2 + feature * 4);
  return (
    <g>
      {Array.from({ length: tentacles }).map((_, i) => {
        const a = -50 + (i / Math.max(1, tentacles - 1)) * 100;
        const len = 18 + feature * 16;
        return (
          <path
            key={i}
            d={`M${80 + a * 0.15} ${cy + 28} Q${80 + a * 0.45} ${cy + 28 + len * 0.5} ${80 + a * 0.55} ${cy + 28 + len}`}
            fill="none"
            stroke={pal.body}
            strokeWidth={5 - feature}
            strokeLinecap="round"
            opacity="0.85"
          />
        );
      })}
      <ellipse cx="80" cy={cy} rx="34" ry="32" fill={pal.body} stroke={pal.ink} strokeWidth="2" opacity="0.92" />
      {/* antennae */}
      <path d={`M68 ${cy - 28} Q62 ${cy - 40 - feature * 8} 58 ${cy - 36}`} fill="none" stroke={pal.accent} strokeWidth="2.5" strokeLinecap="round" />
      <path d={`M92 ${cy - 28} Q98 ${cy - 40 - feature * 8} 102 ${cy - 36}`} fill="none" stroke={pal.accent} strokeWidth="2.5" strokeLinecap="round" />
      <ellipse cx="70" cy={cy - 4} rx="5" ry="6" fill={pal.ink} />
      <ellipse cx="90" cy={cy - 4} rx="5" ry="6" fill={pal.ink} />
      <circle cx="71.5" cy={cy - 5.5} r="1.5" fill="#fff" />
      <circle cx="91.5" cy={cy - 5.5} r="1.5" fill="#fff" />
      {/* teen+ default thin glasses vibe only if no thick_glasses skin — drawn lightly */}
      {feature > 0.6 && (
        <g opacity="0.35">
          <circle cx="70" cy={cy - 4} r="8" fill="none" stroke={pal.ink} strokeWidth="1.2" />
          <circle cx="90" cy={cy - 4} r="8" fill="none" stroke={pal.ink} strokeWidth="1.2" />
          <line x1="78" y1={cy - 4} x2="82" y2={cy - 4} stroke={pal.ink} strokeWidth="1.2" />
        </g>
      )}
      {feature > 0.85 && (
        <path
          d={`M70 ${cy - 30} Q80 ${cy - 42} 90 ${cy - 30}`}
          fill={pal.accent}
          opacity="0.55"
        />
      )}
      <ellipse cx="80" cy={cy + 10} rx="6" ry="3" fill={pal.blush} opacity="0.35" />
    </g>
  );
}

export function SoftPet({
  species,
  stage,
  skinId,
  palette,
  behavior = "idle",
  facing = "right",
  size = 192,
}: Props) {
  const growth = stageMeta(species, stage);
  const vis = stageVisual(species, stage);
  const skin = getSkinStyle(skinId ?? `${species}-default`);
  const pal = palette ?? PALETTE[species] ?? PALETTE.mochi!;
  const filter = resolveSkinFilter(skinId);
  const accessories = (skin?.accessories ?? ["none"]).filter((a) => a !== "none");
  const isEgg = vis.id === "egg";
  const scale = growth.scale;
  const render = Math.round(size * scale);

  const style: CSSProperties = {
    width: render,
    height: Math.round(render * 1.05),
    filter: [
      "drop-shadow(0 10px 14px rgba(40, 28, 16, 0.16))",
      filter,
    ]
      .filter(Boolean)
      .join(" "),
    transform: facing === "left" ? "scaleX(-1)" : undefined,
  };

  const topY = isEgg ? 48 : 42;

  return (
    <div
      className={`soft-pet age-${vis.id} behavior-${behavior}`}
      data-species={species}
      data-stage={vis.id}
      data-skin={skin?.skinId}
      title={`${skin?.title ?? species} · ${growth.label}`}
      style={style}
    >
      <svg viewBox="0 0 160 150" width="100%" height="100%" aria-hidden>
        {isEgg ? (
          <Egg species={species} pal={pal} />
        ) : (
          <>
            {species === "mochi" && (
              <MochiBody pal={pal} feature={vis.feature} upright={vis.upright} />
            )}
            {species === "cloud" && (
              <CloudBody pal={pal} feature={vis.feature} upright={vis.upright} />
            )}
            {species === "bean" && (
              <BeanBody pal={pal} feature={vis.feature} upright={vis.upright} />
            )}
            {species === "ink" && (
              <InkBody pal={pal} feature={vis.feature} upright={vis.upright} />
            )}
            {!["mochi", "cloud", "bean", "ink"].includes(species) && (
              <MochiBody pal={pal} feature={vis.feature} upright={vis.upright} />
            )}
            <Accessories list={accessories} pal={pal} cx={80} topY={topY} />
          </>
        )}
        <ellipse cx="80" cy="142" rx="28" ry="5" fill="#000" opacity="0.08" />
      </svg>
    </div>
  );
}
