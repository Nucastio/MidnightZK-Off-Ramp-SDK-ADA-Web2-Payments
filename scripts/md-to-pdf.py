#!/usr/bin/env python3
"""Render a Markdown document to PDF (GitHub-flavored subset) via weasyprint."""
import sys, pathlib, markdown
from weasyprint import HTML

src, out = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
html_body = markdown.markdown(
    src.read_text(encoding="utf-8"),
    extensions=["tables", "fenced_code", "toc", "sane_lists", "admonition"],
)
css = """
@page { size: A4; margin: 20mm 18mm; }
body { font-family: 'DejaVu Sans', Arial, sans-serif; font-size: 10.5pt; line-height: 1.45; color: #1a1a1a; }
h1 { font-size: 20pt; border-bottom: 2px solid #444; padding-bottom: 4px; }
h2 { font-size: 15pt; margin-top: 1.2em; border-bottom: 1px solid #ccc; padding-bottom: 2px; }
h3 { font-size: 12pt; margin-top: 1em; }
code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-size: 9pt; font-family: 'DejaVu Sans Mono', monospace; word-break: break-word; }
pre { background: #f4f4f4; padding: 8px; border-radius: 4px; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 8.5pt; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; font-size: 9pt; }
th, td { border: 1px solid #bbb; padding: 4px 7px; text-align: left; vertical-align: top; word-break: break-word; }
th { background: #eee; }
a { color: #1a56db; text-decoration: none; word-break: break-all; }
blockquote { border-left: 3px solid #888; margin: 0.8em 0; padding: 2px 12px; background: #fafafa; color: #333; }
"""
HTML(string=f"<style>{css}</style>{html_body}").write_pdf(str(out))
print(f"wrote {out} ({out.stat().st_size} bytes)")
