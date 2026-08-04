import React from "react";
import ReactDOM from "react-dom/client";
import { WebPetApp } from "./WebPetApp";
import "./demo.css";

document.documentElement.classList.add("demo-window");
document.body.classList.add("demo-window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <WebPetApp />
  </React.StrictMode>,
);
