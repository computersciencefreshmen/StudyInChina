/** Keep source text inside the JSON-LD script without changing its JSON value. */
export function serializeJsonLd(value: unknown): string {
  // JSON escaping alone does not stop the HTML parser from reading </script>.
  return JSON.stringify(value).replace(/</g, '\\u003c')
}
