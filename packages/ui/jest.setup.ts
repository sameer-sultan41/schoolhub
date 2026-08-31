import "@testing-library/jest-dom";
import { toHaveNoViolations } from "jest-axe";

// Unlike jest-dom, jest-axe doesn't self-register on import — it exports a matcher
// object that has to be handed to expect.extend explicitly.
expect.extend(toHaveNoViolations);
