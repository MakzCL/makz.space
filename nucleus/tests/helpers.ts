import { B, chain } from "../src/examples/build";
export { B, chain };
/** 5 V → R1 10k → mid → R2 10k → GND */
export const divider = () => chain(["VSOURCE", { value: "5" }], ["RES", { value: "10k" }], ["RES", { value: "10k" }]);
