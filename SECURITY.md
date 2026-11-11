# EditPDFNau Security Policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting for the `nauagency/EditPDFNau`
repository. Do not publish exploit details in a public issue.

## Application boundary

- PDF windows use Electron context isolation with Node integration disabled.
- Renderer access to the operating system is limited to validated IPC handlers.
- PDF editing is local unless the user explicitly invokes a configured AI provider.
- No provider API keys are hard-coded into the application.
- External URLs are accepted only through protocol-checked application paths.

EditPDFNau does not require GenOffice or Stirling-PDF to be installed or running.
