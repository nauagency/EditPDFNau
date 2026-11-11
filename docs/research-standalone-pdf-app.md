# BÁO CÁO NGHIÊN CỨU & THIẾT KẾ KIẾN TRÚC:
# BÓC TÁCH `apps/pdf` TỪ GENOFFICE THÀNH ỨNG DỤNG SỬA PDF ĐỘC LẬP (STANDALONE AI PDF EDITOR)

> **Mã công việc (Job ID)**: `job-20261110210724-fe05a6`  
> **Không gian làm việc (Space ID)**: `sp8bf203fcfed8684ca8d72fbacdde3bfa`  
> **Worktree độc lập**: `C:\Users\damna\genoffice-wt-pdf` (nhánh `research-standalone-pdf`)  
> **Chế độ**: Nghiên cứu mã nguồn cục bộ (LEAN local-only context), loại bỏ hoàn toàn Word/Excel  

---

## 1. TỔNG QUAN KIẾN TRÚC HIỆN TẠI CỦA GENOFFICE & `apps/pdf`

### 1.1 Cấu trúc Monorepo GenOffice
GenOffice là một bộ ứng dụng văn phòng nguồn mở tích hợp AI, được thiết kế theo cấu trúc monorepo bao gồm:
- **`apps/`**:
  - `apps/docs`: Trình soạn thảo văn bản Word (.docx, .doc, .odt, .hwp) dựa trên Tiptap / Prosemirror.
  - `apps/sheets`: Trình xử lý bảng tính Excel (.xlsx, .xls, .csv, .ods) dựa trên Univer.
  - `apps/slides`: Trình biên tập trình chiếu PowerPoint (.pptx, .ppt, .odp) dựa trên Konva và custom render tree.
  - `apps/pdf`: Trình đọc và chỉnh sửa tệp PDF chuyên sâu.
  - `apps/markdown`: Trình soạn thảo Markdown trực quan.
  - `apps/html`: Trình chỉnh sửa tài liệu HTML.
  - `apps/shell`: Vỏ bọc ứng dụng Electron đa tài liệu (Multi-tab host), quản lý định tuyến tệp và cửa sổ trung tâm.
- **`packages/`**: 24 gói thư viện nội bộ phục vụ từ parse OLE2/CFB, docx-engine, xlsx-gateway, pptx-engine, pdf2docx, font-metrics, zip-gate, cho đến agent-core, ai-provider, ai-search, ui, i18n.

### 1.2 Bản chất cốt lõi của `apps/pdf`
Qua khảo sát chi tiết mã nguồn, `apps/pdf` không phải là một trình xem PDF (PDF viewer) đơn thuần, mà đã được kiến trúc thành một **Full-Featured WYSIWYG Desktop PDF Editor** chuyên sâu, kết hợp React 19 + Electron 43 + Vite.

Ứng dụng sở hữu **Kiến trúc 5 tầng lõi (Core Multi-Engine)**:

```
+---------------------------------------------------------------------------------------+
|                                    RENDERER LAYER                                     |
|  - React 19 UI + Ribbon Tabs (Home, Annotate, Edit, Page, View, FillForm, FormDesign)  |
|  - PDF.js v6.2.108: Canvas Rendering + Text Selection Layer + Thumbnail Probes        |
|  - AI Assistant Dock (AiPanel + ReAct AgentLoop + 45 AI Tools + Floating Selection)   |
|  - Interactive Layers: DrawLayer, FormLayer, FormDesignLayer, ImageEditLayer, Redact  |
+---------------------------------------------------------------------------------------+
                                           |  IPC Channels (PDF_CHANNELS, AI_CHANNELS)
+---------------------------------------------------------------------------------------+
|                                  MAIN PROCESS ENGINES                                 |
|  1. PDFium WebAssembly Engine (@embedpdf/pdfium):                                     |
|     - Soạn thảo trực tiếp in-place văn bản trên content stream (FPDFPageObj_Text)    |
|     - Trích xuất ma trận chữ (Matrix), kích thước phông, màu sắc fill/stroke          |
|  2. Font Subsetting Engine (harfbuzzjs hb-subset.wasm + font-metrics):                |
|     - Thu nhỏ tập phông TrueType/OpenType nhúng trực tiếp vào PDF sau chỉnh sửa      |
|     - Lưu ý: Chỉ sử dụng hb_subset_* APIs cho subsetting; KHÔNG có text shaping API  |
|  3. Document-Level & Security Engine (pdf-lib v1.17.1):                               |
|     - Thao tác trang: Ghép, tách, chèn trang trắng, chèn file PDF, crop, xoay, xoá    |
|     - AcroForms (Dropdown, Radio, Checkbox, Text), Điền biểu mẫu scan (Static Fills)  |
|     - Mã hoá/Giải mã PDF (Standard Security Handler, AES-128, AES-256, Passwords)   |
|     - Redaction thực thụ (xoá vĩnh viễn text/ảnh ngầm, không phải vẽ đè hộp đen)      |
|  4. Digital Signature & Verification Engine (node-forge + Native OS Certificate Stores)|
|     - Ký số chuẩn PKCS#7 / CMS Detached (adbe.pkcs7.detached, ETSI.CAdES.detached)    |
|     - Tương thích kho chứng chỉ Windows CryptoAPI/CNG in-place và Linux NSS.          |
|     - macOS Keychain native chưa được hỗ trợ trong system-certificates (ký qua .p12) |
|     - Hiển thị chữ ký trực quan (Visual appearance, vẽ tay, ảnh, thông tin chứng chỉ) |
|  5. AI Intelligence Engine (@genoffice/agent-core + ai-provider + ai-search):         |
|     - Multi-model streaming LLM (Gemini, Claude, GPT, DeepSeek, Genspark, Ollama)    |
|     - 45 công cụ AI tương tác tài liệu trực tiếp từ đọc hiểu đến chỉnh sửa layout     |
+---------------------------------------------------------------------------------------+
```

---

## 2. PHÂN TÍCH CHI TIẾT KHẢ NĂNG BÓC TÁCH RIÊNG `apps/pdf` (LOẠI BỎ HOÀN TOÀN WORD/EXCEL)

### 2.1 Hiện trạng đồ thị phụ thuộc và Chiến lược bóc tách đạt 0% Word/Excel

Để phân tích khả năng bóc tách độc lập, cần phân định rạch ròi giữa **thực trạng đồ thị monorepo hiện hữu** và **mục tiêu kiến trúc độc lập (target extraction)**:

#### A. Thực trạng đồ thị phụ thuộc trong Monorepo hiện tại (Current Graph)
Mặc dù mục tiêu thiết kế của `apps/pdf` là chuyên trách định dạng PDF, mã nguồn hiện tại trong monorepo vẫn còn vướng **2 chuỗi phụ thuộc gián tiếp** kéo các engine Word và PowerPoint vào:

1. **`apps/pdf` import mã nguồn trực tiếp từ `packages/pdf2docx`**:
   - Trong [`apps/pdf/src/main/ocr.ts`](file:///C:/Users/damna/genoffice-wt-pdf/apps/pdf/src/main/ocr.ts#L8-L16): Sử dụng trực tiếp `ocr-vision` và kiểu `OcrEngine` từ `packages/pdf2docx/src/ocr-vision`, đồng thời định vị helper OCR nhị phân tại `packages/pdf2docx/ocr-helper`.
   - Trong [`apps/pdf/src/renderer/ocr-layer.tsx`](file:///C:/Users/damna/genoffice-wt-pdf/apps/pdf/src/renderer/ocr-layer.tsx#L14): Import các hàm phân loại chữ viết `isNoSpaceScript`, `scriptOf` từ `packages/pdf2docx/src/script`.
   - **Hệ lụy phụ thuộc**: Tệp `packages/pdf2docx/package.json` khai báo phụ thuộc trực tiếp vào **`@genoffice/docx-engine`** và **`@genoffice/pptx-engine`**. Do đó, việc liên kết với `packages/pdf2docx` khiến cây phụ thuộc của `apps/pdf` bị kéo dính gián tiếp vào engine Word (`docx-engine`).

2. **`@genoffice/ui` kéo theo `pptx-render` và `pptx-engine`**:
   - `apps/pdf` phụ thuộc gói giao diện dùng chung `@genoffice/ui` để tái sử dụng khung chat AI (`AiPanel`, `AiComposer`), hệ thống biểu tượng (`icons`) và nút thu gọn ribbon.
   - Tuy nhiên, trong `packages/ui/package.json`, gói này lại khai báo phụ thuộc vào **`@genoffice/pptx-render`** (phục vụ cho component trình chiếu slide và gallery hình dạng `shape-gallery.tsx`, `ai-attachments.tsx`), mà `pptx-render` lại kéo tiếp **`@genoffice/pptx-engine`**.

#### B. Chiến lược bóc tách mục tiêu (Target Extraction Strategy để đạt chuẩn 0% Word/Excel)
Để tạo ra một ứng dụng sửa PDF độc lập hoàn toàn, nhẹ tải và loại bỏ triệt để mọi dấu vết của Word/Excel/PowerPoint, kiến trúc đóng gói mục tiêu cần thực hiện 2 giải pháp bóc tách dứt điểm:

1. **Bóc tách module OCR & Script ra khỏi `pdf2docx`**:
   - Trích xuất logic OCR cục bộ (`ocr-vision.ts`, `ocr-helper`) và hàm nhận diện chữ viết (`script.ts`) thành một module nội bộ nằm ngay trong `apps/pdf/src/main/ocr/` (hoặc tạo gói dùng chung độc lập `@genoffice/ocr`).
   - Xóa bỏ hoàn toàn đường dẫn import trỏ tới `packages/pdf2docx`. Khi đó, liên kết tới `@genoffice/docx-engine` và `@genoffice/pptx-engine` từ phía `pdf2docx` sẽ bị triệt tiêu 100%.

2. **Tách mô-đun hóa (Modularize) `@genoffice/ui`**:
   - Tách `@genoffice/ui` thành 2 phần:
     - `@genoffice/ui-core`: Chỉ chứa các component giao diện thuần túy không phụ thuộc engine văn phòng nào (khung chat AI, các chip trạng thái token, Markdown renderer, composer, icons chung, ribbon controls).
     - `@genoffice/ui-slides`: Chứa riêng các thành phần thư viện hình dạng Konva/PPTX liên quan đến `pptx-render`.
   - `apps/pdf` sẽ chỉ phụ thuộc vào `@genoffice/ui-core`.
   
Khi thực hiện 2 điều chỉnh kiến trúc nêu trên, ứng dụng Standalone PDF Editor sẽ đạt được **chỉ số 0% phụ thuộc Word/Excel/PowerPoint tuyệt đối**.

### 2.2 Bóc tách khỏi `apps/shell` để chạy độc lập
Hiện tại trong monorepo, `apps/shell` đóng vai trò là trình điều phối mở tệp và chứa các tab tài liệu tổng hợp. Tuy nhiên:
- Trong mã nguồn `apps/pdf/src/main/pdf-main.ts` **đã tích hợp sẵn hàm `startPdfStandalone()`**:
  ```typescript
  export function startPdfStandalone(): void {
    registerRendererScheme()
    installNavigationGuard(app)
    installContextMenu(app, () => contextMenuLabels(getUiLang()))
    configurePdfRuntime({
      preloadPath: join(__dirname, '../preload/index.js'),
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
      rendererFile: join(__dirname, '../renderer/index.html'),
      createDocument: createStandaloneDocument,
    })
    void app.whenReady().then(() => {
      installRendererProtocol({ pdf: join(__dirname, '../renderer') })
      registerPdfIpc()
      const win = new BrowserWindow({
        width: 1200,
        height: 850,
        webPreferences: {
          preload: runtime.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      })
      const argPath = process.argv.slice(1).find((a) => /\.pdf$/i.test(a) && existsSync(a))
      grantAndTrack(win.webContents, argPath)
      void win.loadURL(rendererUrl(runtime.rendererUrl, 'pdf'))
    })
    app.on('window-all-closed', () => app.quit())
  }
  ```
- **Hạng mục cần bổ sung khi tách hoàn toàn**:
  Khi chạy dưới `apps/shell`, các kênh IPC của AI (`ai:stream`, `ai:get-settings`, `ai:set-settings`, `ai:web-search`) do `apps/shell` đăng ký tại tiến trình chính. Để `apps/pdf` tự chủ 100%:
  - Đưa module `ai-ipc.ts` (mô hình đã được triển khai hoàn chỉnh tại `apps/slides/src/main/ai-ipc.ts`) vào `apps/pdf/src/main/ai-ipc.ts`.
  - Gọi `registerAiIpc()` trong `startPdfStandalone()`.
  - Tích hợp thêm `@genoffice/project-store` để lưu lại các đoạn chat AI tương ứng với từng tệp PDF được mở.

---

## 3. KHẢO SÁT & ĐÁNH GIÁ CÁC TÍNH NĂNG AI PDF SẴN CÓ

`apps/pdf` được trang bị sẵn một hệ thống AI Assistant cực kỳ mạnh mẽ với **45 công cụ (AI Tools)** được định nghĩa trong `apps/pdf/src/renderer/ai/tools.ts`, cho phép AI không chỉ trả lời câu hỏi mà còn trực tiếp thao tác lên cấu trúc PDF:

### 3.1 Nhóm Đọc hiểu & Điều hướng (Context & Navigation)
- `read_pages`: Đọc nội dung văn bản chi tiết kèm số trang và tọa độ của trang đang mở hoặc trang được chỉ định.
- `search_text`: Tìm kiếm văn bản tốc độ cao trên toàn bộ tài liệu PDF.
- `goto_page`: Tự động cuộn trang hiển thị đến trang mục tiêu khi người dùng hỏi về một phần cụ thể.
- `get_outline`: Đọc cấu trúc mục lục (Bookmarks / Table of Contents) của tài liệu.
- **Smart Navigation Link**: Mọi câu trả lời của AI đều tự động tạo liên kết điều hướng dạng `[Page X]` hoặc nhấp vào đoạn trích dẫn để nhảy ngay đến vùng văn bản trên trang PDF và làm nổi bật (highlight visual indicator).

### 3.2 Nhóm Chỉnh sửa Văn bản Trực tiếp (Direct In-Place Text Editing)
- `edit_text`: Thay thế văn bản trực tiếp trong luồng nội dung PDFium mà không làm vỡ bố cục trang.
- `edit_block`: Viết lại cả đoạn văn (paragraph) và tự động tính toán ngắt dòng (reflow) trong giới hạn chiều rộng của đoạn cũ.
- `move_text_block`: Dịch chuyển đoạn văn bản lên/xuống (theo tọa độ dx/dy) để khép khoảng cách trống sau khi xóa một đoạn phía trên.
- `insert_text`, `list_inserted_text`, `edit_inserted_text`, `move_inserted_text`, `delete_inserted_text`: Chèn và hiệu chỉnh các khối văn bản mới trên trang.

### 3.3 Nhóm Chú thích & Đánh dấu (Markup & Annotations)
- `markup_text`: Tự động highlight, underline, strikethrough các đoạn trích dẫn chính xác trong văn bản theo yêu cầu của người dùng.
- `read_annotations`: Đọc toàn bộ các ghi chú, nhận xét và highlight hiện có trên tài liệu.
- `add_note`, `reply_note`, `edit_note`, `delete_note`: Thêm nhận xét mới, trả lời comment thread hoặc xóa ghi chú.
- `delete_markup`: Xóa bỏ các đánh dấu màu sắc không cần thiết.

### 3.4 Nhóm Xử lý Biểu mẫu Thông minh (Form Intelligence)
- `list_form_fields`: Quét và liệt kê danh sách các trường biểu mẫu tương tác (AcroForm fields).
- `add_form_mark`: Tự động điền dấu tích (check), dấu gạch chéo (cross) hoặc chữ vào các ô trống trên các mẫu đơn scan (Flat / Static forms).
- `apply_ops` (setFormValue): Tự động điền dữ liệu vào các trường form tương tác.

### 3.5 Nhóm Thao tác Hình ảnh bằng AI (Image Intelligence)
- `image_search`: Tìm kiếm hình ảnh trực tuyến thông qua công cụ tìm kiếm và chèn vào vị trí chỉ định.
- `generate_image`: Sinh hình ảnh AI mới dựa trên mô tả văn bản (Text-to-Image) và chèn ngay vào trang tài liệu.
- `list_page_images`: Liệt kê và trích xuất danh sách hình ảnh nhúng trong trang.
- `insert_image`, `replace_image`, `rotate_image`, `flip_image`, `crop_image`, `set_image_opacity`, `delete_image`: Điều khiển toàn diện các đối tượng ảnh.
- `remove_image_background`: **Tự động tách nền ảnh (AI Background Removal)** trực tiếp trên ảnh trong PDF.

### 3.6 Nhóm Quản lý & Tổ chức Trang (Page Operations)
- `insert_blank_page`: Chèn thêm trang trắng tại bất kỳ vị trí nào với kích thước tùy chỉnh.
- `set_page_size`: Đổi kích thước trang (A4, Letter, v.v.).
- `crop_pages`: Cắt xén lề trang PDF theo tọa độ.
- `extract_pages`: Trích xuất một hoặc nhiều trang thành file PDF riêng biệt.
- `split_pdf` / `split_pages`: Chia nhỏ tài liệu thành nhiều tệp.
- `merge_pages`: Gộp các trang từ tài liệu khác vào tài liệu hiện tại.
- `replace_pages`: Thay thế một hoặc nhiều trang bằng các trang từ tệp PDF khác.
- `set_watermark` / `set_header_footer`: Thêm hình mờ bảo vệ bản quyền, tiêu đề đầu trang và chân trang.
- `create_document`: Tạo tài liệu PDF mới toanh từ đầu bằng AI.

### 3.7 Nhóm Tính năng Nhanh trên Giao diện (Quick UI AI Features)
- **Selection Popover (`AiAskPopover.tsx`)**: Khi người dùng bôi đen văn bản trên tài liệu, một thanh công cụ nổi xuất hiện cung cấp các tác vụ tức thì:
  - *Giải thích đoạn văn (Explain)*
  - *Dịch thuật đa ngôn ngữ (Translate)*
  - *Tóm tắt nhanh (Summarize)*
  - *Trau chuốt văn phong (Polish / Rewrite)*
  - *Kiểm tra và sửa lỗi ngữ pháp (Grammar Check)*
- **Nút Ribbon AI một chạm**: Tóm tắt tổng thể tài liệu (`IconAiSummarize`), Rút trích các luận điểm chính (`IconAiKeyPoints`).

---

## 4. CÁC TÍNH NĂNG BỔ TRỢ ĐỂ TẠO THÀNH MỘT ỨNG DỤNG SỬA PDF ĐỘC LẬP HOÀN CHỈNH

Để ứng dụng sau khi bóc tách trở thành một phần mềm chỉnh sửa PDF độc lập ở phân khúc chuyên nghiệp (cạnh tranh trực tiếp với Foxit PDF Editor, Adobe Acrobat Pro, Nitro PDF):

| Phân hệ tính năng | Hiện trạng trong `apps/pdf` | Đề xuất bổ trợ / Nâng cấp cho Standalone App |
| :--- | :--- | :--- |
| **Giao diện đa tài liệu (Tabs)** | Phụ thuộc vào tab bar của `apps/shell`. | Tích hợp **Internal Multi-Document Tab Bar** trực tiếp trên đỉnh thanh Ribbon (hỗ trợ kéo thả tab, tách cửa sổ). |
| **Trung tâm xử lý hàng loạt (Batch Processing)** | Thao tác trên từng tệp đơn lẻ. | Bổ sung module **Batch Wizard**: Cho phép xử lý thư mục gồm nhiều file PDF: Batch OCR, Batch Compress, Batch Watermark, Batch Bates Numbering, Batch Protect/Decrypt. |
| **OCR tiếng Việt & Đa ngôn ngữ** | Hỗ trợ OCR trang đơn lẻ qua helper OS (`ocr.ts`). | Tích hợp engine OCR nâng cao (Tesseract WASM offline hoặc PaddleOCR/Cloud API) hỗ trợ chuẩn xác tiếng Việt có dấu, tự động dựng lại bảng biểu dạng lưới. |
| **Điền biểu mẫu AI (AI Form Auto-Fill)** | Hỗ trợ điền qua câu lệnh AI hoặc click thủ công. | Tính năng **1-Click AI Profile Auto-Fill**: Lưu trữ hồ sơ người dùng (họ tên, CCCD, địa chỉ, MST, chữ ký) và tự động nhận diện điền toàn bộ mẫu đơn hành chính chỉ với 1 cú nhấp chuột. |
| **Che thông tin nhạy cảm AI (Smart PII Redaction)** | Hỗ trợ chọn vùng redaction thủ công và xoá vĩnh viễn dữ liệu ngầm. | Tích hợp **AI PII Detector (Named Entity Recognition)**: Tự động phát hiện và đề xuất che hàng loạt các thông tin nhạy cảm: Số CCCD/Hộ chiếu, Số thẻ tín dụng/Ngân hàng, Số điện thoại, Email, Chữ ký. |
| **So sánh tài liệu ngữ nghĩa (Semantic PDF Diff)** | Đã có `ComparePanel.tsx` so sánh văn bản trực quan. | Bổ sung **AI Legal / Contract Diff**: So sánh 2 phiên bản hợp đồng và tóm tắt sự thay đổi điều khoản pháp lý bằng ngôn ngữ tự nhiên. |
| **Tiêu chuẩn lưu trữ PDF/A** | Chưa có kiểm tra tính tuân thủ PDF/A. | Bổ sung bộ xác thực và chuyển đổi **PDF/A-1b, PDF/A-2b, PDF/A-3b** phục vụ lưu trữ văn bản lưu trữ doanh nghiệp và cơ quan nhà nước. |
| **Xác thực chữ ký số nâng cao (LTV & Timestamping)** | Đã có ký PKCS#7 và xác thực chứng chỉ số. Hỗ trợ Windows personal store và Linux NSS. | Tích hợp **RFC 3161 Timestamping Authority (TSA)** và **LTV (Long-Term Validation)** nhúng thông tin thu hồi CRL/OCSP trực tiếp vào file PDF; phát triển native addon `SecItemExport` cho macOS Keychain. |
| **Trình thiết kế biểu mẫu trực quan (Visual Form Designer)** | Đã có `FormDesignLayer.tsx` cơ bản. | Nâng cấp lưới căn chỉnh (Grid, Smart Guides, Alignment Tools, Form Calculations với các phép tính toán tổng cộng số tiền tự động). |
| **Đo đạc bản vẽ kỹ thuật (CAD / Measurement)** | Đã có `measure.ts` và hộp thoại tỷ lệ cơ bản. | Bổ sung đo chu vi (Perimeter), đo diện tích đa giác (Polygon Area), góc (Angle) kèm định dạng đơn vị mét vuông, milimét. |

---

## 5. BẢN THIẾT KẾ KIẾN TRÚC ỨNG DỤNG STANDALONE (PDF-ONLY ARCHITECTURE)

```
genoffice-pdf-standalone/
├── apps/
│   └── pdf-desktop/                       # Ứng dụng Electron chính
│       ├── src/
│       │   ├── main/
│       │   │   ├── index.ts               # Entry point Electron app độc lập
│       │   │   ├── pdf-main.ts            # Quản lý window, grants, printing, save
│       │   │   ├── ai-ipc.ts              # Proxy AI streaming + settings độc lập
│       │   │   ├── app-menu.ts            # Menu hệ thống (File, Edit, View, Tools, Help)
│       │   │   ├── text-edit.ts           # PDFium WASM Direct Text Engine
│       │   │   ├── font-subset.ts         # HarfBuzz Font Subsetting Engine (hb-subset.wasm)
│       │   │   ├── save-pdf.ts            # pdf-lib save, forms, stamps, encryption
│       │   │   ├── pdf-sign.ts            # Digital signature CMS engine
│       │   │   ├── system-certificates.ts # OS Certificate Store Bridge (Windows/Linux)
│       │   │   ├── redaction.ts           # Destructive redaction engine
│       │   │   ├── pdf-shrink.ts          # PDF compression engine
│       │   │   └── ocr/                   # OCR module độc lập (đã tách rời khỏi pdf2docx)
│       │   │       ├── ocr.ts
│       │   │       └── script.ts
│       │   ├── preload/
│       │   │   └── index.ts               # ContextBridge expose pdfApi, aiApi
│       │   └── renderer/
│       │       ├── App.tsx                # React Root với Internal Tabs Bar
│       │       ├── TabBar.tsx             # Quản lý nhiều tab PDF cùng lúc
│       │       ├── ai/                    # AiPanel, Tools (45 tools), ReAct Loop
│       │       ├── edit-ops/              # Journaled Operation Layer
│       │       ├── DrawLayer.tsx          # Vector annotation & drawing
│       │       ├── FormLayer.tsx          # AcroForm Interactive Fill
│       │       ├── FormDesignLayer.tsx    # Form Field Builder
│       │       ├── ImageEditLayer.tsx     # Image manipulation & AI cutout
│       │       └── RedactionLayer.tsx     # Redaction selection & markups
├── packages/                              # 8 packages lõi được giữ lại (0% Word/Excel)
│   ├── agent-core/                        # ReAct AI Loop
│   ├── ai-provider/                       # LLM Connectors (Claude, GPT, Gemini, DeepSeek, Local)
│   ├── ai-search/                         # Web/Image Search & AI Image Generation
│   ├── electron-utils/                    # Native print, dialogs, atomic write
│   ├── font-metrics/                      # OS Font Table Reader
│   ├── i18n/                              # Typed Internationalization
│   ├── project-store/                     # Local chat history persistence
│   └── ui-core/                           # Shared UI components thuần túy (đã bỏ pptx-render)
└── packaging/
    └── electron-builder.json              # Đóng gói Windows (.exe/msi), Mac (.dmg), Linux (.AppImage)
```

### Ưu thế vượt trội khi bóc tách độc lập:
1. **Dung lượng đóng gói tối ưu (Ước tính mục tiêu: ~60-70MB)**:
   - Gói cài đặt đầy đủ của GenOffice hiện tại có dung lượng xấp xỉ 180MB do phải đóng gói kèm toàn bộ runtime của Univer (Sheets), Tiptap (Docs), docx-engine, xlsx-gateway, pptx-engine, v.v.
   - Con số 60-70MB là **ước tính mục tiêu (target estimate)** dựa trên việc loại bỏ hoàn toàn các engine nặng kể trên; số liệu đóng gói chính xác sẽ được đo đạc thực nghiệm khi hoàn thiện kịch bản build `electron-builder` riêng cho Standalone PDF Editor.
2. **Khởi động tức thì (Zero Bloat)**: Không tốn tài nguyên khởi tạo runtime của bảng tính Univer hay trình soạn thảo văn bản Tiptap.
3. **Độ ổn định & Bảo mật cao**: Cô lập hoàn toàn môi trường sandbox PDF, không bị ảnh hưởng bởi lỗ hổng bảo mật từ các bộ lọc file Office cũ (OLE2/CFB).
4. **Trải nghiệm người dùng tập trung**: Giao diện thuần tuý tối ưu hoá 100% cho các tác vụ xem, sửa, ký, điền form và xử lý tài liệu PDF bằng AI.

---

## 6. KẾT LUẬN & ĐỀ XUẤT HÀNH ĐỘNG

- **Tính khả thi kỹ thuật**: **Khả thi cao và có lộ trình bóc tách rõ ràng**. Bản thân phần lõi của `apps/pdf` đã được module hóa tốt, chỉ cần giải quyết 2 mắt xích phụ thuộc gián tiếp (`pdf2docx` trong OCR và `pptx-render` trong UI) để đạt chuẩn độc lập 0% Word/Excel.
- **Sức mạnh nội tại**: Sở hữu đầy đủ các công nghệ hàng đầu thế giới về PDF (PDFium C++ WASM, HarfBuzz font subsetter `hb-subset.wasm`, pdf-lib, node-forge PKCS#7) và 45 công cụ AI tích hợp sẵn.
- **Chiến lược triển khai**: Có thể bóc tách thành một repository độc lập mang tên `GenOffice PDF Editor` (hoặc sản phẩm thương mại độc lập) với chi phí tái cấu trúc tối thiểu, tạo ra một ứng dụng sửa PDF tích hợp AI hoàn chỉnh hàng đầu hiện nay.
