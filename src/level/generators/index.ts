import { registerGenerator } from "../generator";

import { FlatGenerator } from "./flat";
import { VoidGenerator } from "./void";

// Make the built in generators selectable from the server config
registerGenerator(FlatGenerator);
registerGenerator(VoidGenerator);

export { FlatGenerator, VoidGenerator };
