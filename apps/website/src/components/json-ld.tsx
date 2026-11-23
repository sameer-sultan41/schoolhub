import { type JsonLdObject, serializeJsonLd } from "@/lib/json-ld";

/** Structured data for search engines (website-builder §4): one schema.org object. */
export function JsonLd({ data }: { data: JsonLdObject }) {
  return (
    <script
      type="application/ld+json"
      // The renderer's only dangerouslySetInnerHTML: serializeJsonLd escapes every character
      // that could close this element, so content cannot break out (json-ld.test.tsx).
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
