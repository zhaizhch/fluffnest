import { lazy, Suspense, useEffect } from "react";

function windowKind(): "pet" | "panel" {
  const q = new URLSearchParams(window.location.search).get("window");
  if (q === "panel") return "panel";
  return "pet";
}

const PetApp = lazy(() =>
  import("./pet/PetApp").then((m) => ({ default: m.PetApp })),
);
const PanelApp = lazy(() =>
  import("./panel/PanelApp").then((m) => ({ default: m.PanelApp })),
);

export default function App() {
  const kind = windowKind();

  useEffect(() => {
    document.documentElement.classList.add(`${kind}-window`);
    document.body.classList.add(`${kind}-window`);
    return () => {
      document.documentElement.classList.remove(`${kind}-window`);
      document.body.classList.remove(`${kind}-window`);
    };
  }, [kind]);

  return (
    <Suspense fallback={null}>
      {kind === "panel" ? <PanelApp /> : <PetApp />}
    </Suspense>
  );
}
