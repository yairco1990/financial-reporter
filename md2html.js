#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node md2html.js <file.md>');
  process.exit(1);
}

const md = fs.readFileSync(file, 'utf-8');

// Strip the <div dir="rtl"> wrapper — we handle RTL in HTML
const content = md.replace(/<\/?div[^>]*>/g, '').trim();

// Simple markdown to HTML converter
function mdToHtml(text) {
  let html = text;

  // Escape HTML (but preserve our markdown)
  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Code blocks (``` ... ```)
  html = html.replace(/```([^`]*?)```/gs, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Tables
  html = html.replace(/^(\|.+\|)\n(\|[-| :]+\|)\n((?:\|.+\|\n?)*)/gm, (_, header, sep, body) => {
    const parseRow = (row, tag) =>
      '<tr>' + row.split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
        .map(cell => `<${tag}>${cell.trim()}</${tag}>`).join('') + '</tr>';
    const alignments = sep.split('|').filter((_, i, a) => i > 0 && i < a.length - 1)
      .map(c => c.trim());
    const headerRow = parseRow(header, 'th');
    const bodyRows = body.trim().split('\n').map(r => parseRow(r, 'td')).join('\n');
    return `<table>\n<thead>${headerRow}</thead>\n<tbody>\n${bodyRows}\n</tbody>\n</table>`;
  });

  // Headers
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rules
  html = html.replace(/^---$/gm, '<hr>');

  // Blockquotes
  html = html.replace(/^&gt; (.+)$/gm, '<blockquote>$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote>/g, '<br>');

  // Bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>');

  // Ordered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs — wrap remaining loose lines
  html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

const bodyHtml = mdToHtml(content);
const title = (content.match(/^#\s+(.+)$/m) || ['', path.basename(file, '.md')])[1]
  .replace(/\*\*/g, '');

const html = `<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Heebo:wght@300;400;500;700;900&display=swap');

  :root {
    --bg: #0f172a;
    --surface: #1e293b;
    --surface-hover: #334155;
    --border: #334155;
    --text: #e2e8f0;
    --text-muted: #94a3b8;
    --accent: #38bdf8;
    --accent-dim: #0ea5e9;
    --green: #4ade80;
    --red: #f87171;
    --yellow: #fbbf24;
    --purple: #a78bfa;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: 'Heebo', sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.7;
    padding: 2rem;
    max-width: 960px;
    margin: 0 auto;
  }

  h1 {
    font-size: 2rem;
    font-weight: 900;
    color: var(--accent);
    border-bottom: 3px solid var(--accent-dim);
    padding-bottom: 0.75rem;
    margin-bottom: 1.5rem;
    margin-top: 1rem;
  }

  h2 {
    font-size: 1.5rem;
    font-weight: 700;
    color: var(--yellow);
    margin-top: 2.5rem;
    margin-bottom: 1rem;
    padding-bottom: 0.4rem;
    border-bottom: 1px solid var(--border);
  }

  h3 {
    font-size: 1.15rem;
    font-weight: 500;
    color: var(--purple);
    margin-top: 1.5rem;
    margin-bottom: 0.75rem;
  }

  h4 {
    font-size: 1rem;
    font-weight: 500;
    color: var(--green);
    margin-top: 1.25rem;
    margin-bottom: 0.5rem;
  }

  p {
    margin-bottom: 0.75rem;
    color: var(--text);
  }

  strong {
    color: #f1f5f9;
    font-weight: 700;
  }

  hr {
    border: none;
    border-top: 1px solid var(--border);
    margin: 2rem 0;
  }

  blockquote {
    background: var(--surface);
    border-right: 4px solid var(--accent);
    padding: 1rem 1.25rem;
    margin: 1rem 0;
    border-radius: 0 8px 8px 0;
    color: var(--text-muted);
    font-size: 0.95rem;
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    margin: 1rem 0 1.5rem;
    background: var(--surface);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 4px 24px rgba(0,0,0,0.3);
  }

  thead {
    background: linear-gradient(135deg, var(--accent-dim), var(--purple));
  }

  th {
    padding: 0.75rem 1rem;
    text-align: right;
    font-weight: 700;
    color: #fff;
    font-size: 0.9rem;
    white-space: nowrap;
  }

  td {
    padding: 0.6rem 1rem;
    text-align: right;
    border-bottom: 1px solid var(--border);
    font-size: 0.9rem;
  }

  tbody tr:last-child td {
    border-bottom: none;
  }

  tbody tr:hover {
    background: var(--surface-hover);
  }

  /* Highlight total/summary rows */
  tbody tr:last-child {
    font-weight: 700;
  }

  ul, ol {
    padding-right: 1.5rem;
    margin: 0.5rem 0 1rem;
  }

  li {
    margin-bottom: 0.35rem;
    color: var(--text);
  }

  li::marker {
    color: var(--accent);
  }

  pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 10px;
    padding: 1.25rem;
    overflow-x: auto;
    margin: 1rem 0;
    direction: ltr;
    text-align: left;
  }

  code {
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 0.85rem;
    color: var(--green);
    line-height: 1.5;
  }

  /* Responsive */
  @media (max-width: 640px) {
    body { padding: 1rem; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.25rem; }
    table { font-size: 0.8rem; }
    th, td { padding: 0.4rem 0.6rem; }
  }

  /* Print */
  @media print {
    body { background: #fff; color: #000; max-width: 100%; }
    table { box-shadow: none; }
    thead { background: #ddd; }
    th { color: #000; }
    h1 { color: #0369a1; }
    h2 { color: #92400e; }
    h3 { color: #6b21a8; }
    pre { background: #f5f5f5; }
    code { color: #166534; }
  }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;

const outFile = file.replace(/\.md$/, '.html');
fs.writeFileSync(outFile, html);
console.log(`✓ ${outFile}`);
