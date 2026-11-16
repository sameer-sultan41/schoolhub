/** A schema.org object: plain JSON, so it serialises predictably. */
export type JsonLdValue = string | number | boolean | null | JsonLdValue[] | JsonLdObject;
export interface JsonLdObject {
  [key: string]: JsonLdValue | undefined;
}

// Each character that could end the <script> element or the HTML parser's view of it.
const UNSAFE_IN_SCRIPT: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};
const UNSAFE_IN_SCRIPT_PATTERN = /[<>&\u2028\u2029]/g;

/**
 * JSON for a `<script type="application/ld+json">` body. `JSON.stringify` alone is not safe there:
 * a title containing `</script>` would close the element. Escaping `<`, `>`, `&` and the two line
 * separators as `\uXXXX` keeps the JSON identical to a JSON parser and inert to the HTML parser
 * (the escape the Next.js JSON-LD guide recommends, widened).
 */
export function serializeJsonLd(data: JsonLdObject): string {
  return JSON.stringify(data).replace(
    UNSAFE_IN_SCRIPT_PATTERN,
    (character) => UNSAFE_IN_SCRIPT[character] ?? character,
  );
}
