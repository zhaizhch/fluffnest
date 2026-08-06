import { lazy, Suspense } from "react";
import { petDef, usesCustomFigure } from "../lib/petCatalog";
import { RisingKakaPet } from "./RisingKakaPet";
import { SpritePet } from "./SpritePet";

const Live2DPet = lazy(() =>
  import("./Live2DPet").then((m) => ({ default: m.Live2DPet })),
);

type Props = {
  species: string;
  behavior: string;
  facing?: "left" | "right";
  size?: number;
  /** Rising KaKa explicit action override (Dragging / RbtnClk / …) */
  risingAction?: string | null;
  /** Mute Rising KaKa SFX */
  muted?: boolean;
  /** Short tap on Live2D figure. */
  onTap?: () => void;
};

export function PetFigure({
  species,
  behavior,
  facing = "right",
  size = 192,
  risingAction = null,
  muted = false,
  onTap,
}: Props) {
  const render = petDef(species)?.render;

  if (render === "live2d") {
    return (
      <div className={`pet-figure-host behavior-${behavior}`}>
        <Suspense
          fallback={
            <div
              style={{
                width: size,
                height: size,
                borderRadius: "50%",
                background:
                  "radial-gradient(circle at 45% 30%, #ffffff, #f3e8ef 55%, #c9a0b4 130%)",
              }}
            />
          }
        >
          <Live2DPet
            species={species}
            behavior={behavior}
            facing={facing}
            onTap={onTap}
          />
        </Suspense>
      </div>
    );
  }

  if (usesCustomFigure(species)) {
    return (
      <div className={`pet-figure-host behavior-${behavior}`}>
        {species === "rising" ? (
          <RisingKakaPet
            behavior={behavior}
            actionOverride={risingAction}
            facing={facing}
            size={size}
            muted={muted}
          />
        ) : null}
      </div>
    );
  }

  return (
    <div className={`pet-figure-host behavior-${behavior}`}>
      <SpritePet
        species={species}
        behavior={behavior}
        facing={facing}
        size={size}
      />
    </div>
  );
}
