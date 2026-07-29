import { SpritePet } from "./SpritePet";

type Props = {
  species: string;
  behavior: string;
  facing?: "left" | "right";
  size?: number;
};

export function PetFigure({
  species,
  behavior,
  facing = "right",
  size = 192,
}: Props) {
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
