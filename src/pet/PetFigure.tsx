import { usesCustomFigure } from "../lib/petCatalog";
import { RisingKakaPet } from "./RisingKakaPet";
import { SpritePet } from "./SpritePet";

type Props = {
  species: string;
  behavior: string;
  facing?: "left" | "right";
  size?: number;
  /** Rising KaKa explicit action override (Dragging / RbtnClk / …) */
  risingAction?: string | null;
  /** Mute Rising KaKa SFX */
  muted?: boolean;
};

export function PetFigure({
  species,
  behavior,
  facing = "right",
  size = 192,
  risingAction = null,
  muted = false,
}: Props) {
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
