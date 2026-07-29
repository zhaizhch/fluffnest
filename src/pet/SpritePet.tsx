import { PixiPet } from "./PixiPet";

type Props = {
  species: string;
  behavior: string;
  facing?: "left" | "right";
  size?: number;
};

export function SpritePet({
  species,
  behavior,
  facing = "right",
  size = 192,
}: Props) {
  return (
    <PixiPet
      species={species}
      behavior={behavior}
      facing={facing}
      size={size}
    />
  );
}
