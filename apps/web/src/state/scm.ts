import { createScmEnvironmentAtoms } from "@t3tools/client-runtime/state/scm";

import { connectionAtomRuntime } from "../connection/runtime";

export const scmEnvironment = createScmEnvironmentAtoms(connectionAtomRuntime);
