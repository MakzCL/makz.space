import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./nucleus.css";
import { mountBetaMark } from "../../../packages/sk-channel/channel";
mountBetaMark();
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
