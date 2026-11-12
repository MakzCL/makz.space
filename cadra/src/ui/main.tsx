import { createRoot } from "react-dom/client";
import App from "./App";
import "./cadra.css";
import { mountBetaMark } from "../../../packages/sk-channel/channel";
mountBetaMark();
createRoot(document.getElementById("root")!).render(<App />);
