# Growmark — Project Constraints

## PROTECTED FILES — NEVER MODIFY

The watermark removal algorithm is the core product. It is correct, validated,
and must never be edited, refactored, reformatted, "improved", or optimised.

Never modify, move, rename, or reformat:
- src/core/watermarkEngine.js
- src/core/alphaMap.js
- src/core/blendModes.js
- src/utils.js
- src/assets/bg_48.png
- src/assets/bg_96.png

bg_48.png and bg_96.png are alpha-map calibration captures. Re-encoding,
resizing, or "optimising" them silently corrupts removal accuracy with no
visible error. Treat them as binary constants.

New code may IMPORT from these files. New code may never CHANGE them.

If a task appears to require changing a protected file, stop and explain why
instead of doing it.

## Deployment
GitHub Pages serves from /docs on the main branch. CNAME:
geminiaiwatermarkremover.com. Anything not in /docs is not live.
