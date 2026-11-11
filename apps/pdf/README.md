# EditPDFNau

Standalone Electron PDF editor. This app launches `apps/pdf` directly and does
not require the GenOffice shell, Docs, or Sheets applications at runtime.

## Run locally

From the repository root:

```bash
npm install
npm run dev
```

To build and launch the production bundle:

```bash
npm run start
```

To create a Windows installer:

```bash
npm run dist:win -w @genoffice/pdf
```

## MVP scope

- Open, render, edit, organize, sign, and save PDF documents.
- Direct PDF text editing through PDFium, including validation and local reflow.
- PDF annotations, forms, images, redaction, OCR, and page operations.
- Standalone AI assistant with PDF tools, model streaming, image search, and AI
  image generation.

AI settings are stored in Electron's user-data directory as `ai-settings.json`.
The model picker's **Manage models** action reveals this file for BYOK setup in
standalone mode. Existing Genspark login state is also supported.
