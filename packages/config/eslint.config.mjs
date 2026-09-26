import base from "./eslint.base.mjs";
import warningsAsErrors from "./eslint.warnings-as-errors.mjs";

export default warningsAsErrors(base);
