# EditPDFNau

EditPDFNau is a standalone Windows PDF editor by Nauagency. It opens, edits,
organizes, annotates, signs, and saves PDF documents locally. Its optional AI
assistant can use Codex CLI, local OpenAI-compatible endpoints, or user-supplied
provider credentials.

## Current features

- View, search, print, and reorganize PDF pages.
- Edit existing PDF text without adding a persistent background.
- Insert text separately from editing existing text.
- Add annotations, drawings, signatures, forms, watermarks, headers, and footers.
- Edit and replace embedded images.
- Use EditPDFNau AI for document-aware assistance.

## Development

```powershell
npm install
npm run dev
npm test
npm run typecheck
npm run dist:win
```

The Windows installer is generated under `dist/pdf/`.

## Independence and attribution

EditPDFNau is distributed as its own application and does not require the
GenOffice or Stirling-PDF applications or services at runtime. Earlier open
source work used during development remains credited under the applicable
licenses in `LICENSE` and `NOTICE`.

## License

Apache License 2.0. See `LICENSE` and `NOTICE`.
