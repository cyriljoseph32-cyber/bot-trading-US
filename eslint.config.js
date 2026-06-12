import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import TradingApp from "./TradingApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TradingApp />
  </StrictMode>
);
