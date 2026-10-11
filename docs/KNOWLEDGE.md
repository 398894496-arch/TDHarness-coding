# Knowledge base

What the company's AI knows beyond one conversation: the distilled record of everyone's work, the company's documents, and what people chose to remember. It is a work memory and handbook search for the agents on the desks, not a document Q&A portal; for Q&A over thousands of files, put [Dify](https://github.com/langgenius/dify), [RAGFlow](https://github.com/infiniflow/ragflow) or [MaxKB](https://github.com/1Panel-dev/MaxKB) next to it.

中文：公司的 AI 在一次对话之外还知道什么——每个人每天工作的整理记录、公司资料、大家让它记住的事。它是给工作台 AI 用的工作记忆加手册检索，不是文档问答门户。

## What goes in

| Source | How | Where |
| --- | --- | --- |
| Everyone's conversations with the agent | Task `TDH-Brain-Daily` (00:15) reads the day's sessions where the desk keeps them, writes an evidence layer and one distilled page per person per day through the gateway, collects corrections | `D:\dsh\brain` |
| Company documents | Dropped in a folder; read on the next search, no rebuild | `company\_handbook\_company` (everyone), `company\_handbook\<dept>` (that department) |
| Company memory | Admins and directors ask their agent to remember (`company_memory_write`) | `company\_shared\_memory` |
| Personal memory | Anyone asks their agent to remember | their own `_memory` |

File types: `.md .txt .csv`, `.docx .xlsx .pptx` (read with Node's zlib, no extra package), `.pdf` (vendored Mozilla pdf.js, in a child process), old binary `.doc .xls .ppt` and WPS `.wps .et .dps` (olefile and xlrd; what a file is comes from its first bytes, so a `.wps` saved as zip or a renamed `.docx` is read correctly), scanned PDF pages and pictures `.png .jpg .jpeg .bmp .tif .webp` (OCR: RapidOCR, PaddleOCR's Chinese models on ONNX Runtime). PDFs, old Office files and OCR run in the background, one file at a time, so a search never waits; their text is cached in `D:\dsh\runtime\kb-cache` (safe to delete). The Python side is installed by `server\install-ocr.ps1` into its own venv and switched on only after it reads a test image correctly. Not read: password-protected files, pre-2005 WPS formats, RTF; handwriting reads poorly and scanned tables lose their grid.

## How search works

`server/kb-index.js`, served on `127.0.0.1:4182` and reached from the desks at `/company/knowledge`:

- Files are cut into passages and ranked with BM25. Latin words and numbers are terms; Chinese is cut into overlapping two-character terms, so 退货运费谁承担 finds 运费由公司承担 without a dictionary. Question words (怎么, 是谁) do not count; coverage is weighted by how rare each word is, and words that occur nowhere do not count against an answer.
- The snippet is the text around the hit, with its line; a hit in a PDF, deck or workbook names its page or sheet (〔第 3 页〕, 〔Sheet1〕).
- Files are cached in memory by modification time and size; a changed file is read again on the next search.
- **Refuses instead of guessing** (after [DSH-KRouter](https://github.com/398894496-arch/DSH-KRouter)): the question is cut into two-character words with a general word list (jieba's, MIT) plus the files' own words; when its specific words that occur nowhere outnumber the ones the first hit covers, or the first hit covers under half of three or more, the answer is nothing. On the desk, nothing lets the agent fall back to web search; a weak hit would stop it at the wrong page.
- **The company's own synonyms**: `company\_handbook\_company\同义词.txt` (or `synonyms.txt`, also in a department's handbook), one group per line, `报销 = 核销, 报账`. A question is also asked with each synonym; when its own word occurs nowhere and a synonym does, only the synonym is used. The file is not searched itself.
- Keyword search with synonyms, no embeddings, no vector store: a wording that is neither in the files nor in the synonym list is not found.

How well: `node scripts/prove-kb-recall.js` (12 handbook pages, 26 questions with an answer, 12 without, one that needs a synonym): the right page first 26/26, off-topic refused 12/12, the synonym found. Run on a real office library before and after, the refusal changed none of 13 everyday questions and refused two off-topic ones that had been answered with unrelated pages. Still answered weakly: a question whose words all occur somewhere but never together (客户要退款怎么处理 matched a page about customers handling orders).

## Who finds what

Every search needs the login token a person got at sign-in: no token, a revoked token or a deactivated person gets nothing, and a name typed into a header is ignored. Each search is logged (who, how many hits, not the question).

| | Finds |
| --- | --- |
| Everyone | company handbook, company memory, corrections, their own memory and daily pages |
| A department | its handbook and its adopted lessons |
| A director | plus the daily pages of their department |
| An admin | all of it |

Raw conversations never come up in a search. They are opened one file at a time by path, by their owner, that department's director or an admin. A note's `visibility` (`self`, `dept`, `boss`) can only narrow what its folder allows, never widen it.

The files themselves agree with the search: `server\secure-folders.ps1` sets the company share's NTFS rights from the roster (a person's folder opens for them, their director and admins; the handbook and company memory are changed only by admins and directors), so nobody reads around the search or writes into the handbook every agent trusts. See [SERVER.md](SERVER.md#who-opens-which-folder).

Every desk's account page tells the person what is kept and who can see it (知识库会记下什么).

## Proofs

- `node scripts/prove-knowledge.js`: five people (employee, colleague in the same department, director, someone from another department, admin) against one brain and company folder: who finds what, raw conversations by path only, ranking and snippets, Office / PDF / OCR / old Office files, the background queue not blocking a search, no server paths in answers. Runs in CI on Windows and Linux.
- `server\prove-secure-folders.ps1` (on the server): asks Windows, account by account, what each person can actually open and change.
