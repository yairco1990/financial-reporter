/**
 * Shared helpers for report generators (daily / monthly / annual).
 */

/**
 * Turn raw model output into a clean HTML fragment:
 *  - unwrap a ```html … ``` code block if present,
 *  - reduce a full HTML document (<!DOCTYPE>/<html>/<head>/<style>/<body>) to
 *    just its body content, so the model's own document/width styles don't
 *    fight our responsive full-width email wrapper.
 */
export function extractFragment(report: string): string {
  let html = report;
  const fenced = report.match(/```html\n?([\s\S]*?)```/);
  if (fenced) html = fenced[1];

  const body = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (body) html = body[1];

  return html
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '') // drop model <style> blocks; we use inline styles + our own
    .trim();
}
