/**
 * Shared resource limits for processing untrusted document bytes.
 *
 * Attachment / linked-document bytes are attacker-influenced (anyone who can
 * email the user, or a compromised vendor portal). Feeding arbitrarily large
 * input into a PDF parser (unpdf), an OCR engine (tesseract), or a vision API is
 * a denial-of-service surface — a decompression "bomb" or a pathological page
 * count can pin CPU/memory. We cap the bytes we are willing to PARSE here, in
 * one place, so every consumer agrees on the ceiling.
 *
 * ⚠️ Keep this file free of Node / Electron / Vue imports — it must run anywhere.
 */

/**
 * Largest document we will hand to a local parser/OCR/vision call. 20 MiB
 * comfortably covers real invoices (and sits under Gmail's 25 MB attachment
 * cap) while refusing genuinely abusive payloads. Oversized input is SKIPPED,
 * not rejected: the file is still downloaded/kept; we just don't parse it, so a
 * legitimate-but-huge document is never lost — only its auto-extraction.
 */
export const MAX_PARSE_BYTES = 20 * 1024 * 1024
