---
name: Netflix email extraction quirks
description: Critical gotchas when parsing Netflix temporary access code emails from IMAP
---

## 1. QP + UTF-8 double-encoding bug

`decodeQuotedPrintable` maps `=XX` hex to `String.fromCharCode(0xXX)`, producing Latin-1 codepoints.
When the MIME charset is UTF-8, those codepoints are actually UTF-8 byte values — they must be re-assembled:

```typescript
body = decodeQuotedPrintable(body);
if (!isLatin1) {
  body = Buffer.from(body, "latin1").toString("utf-8"); // fix multi-byte chars
}
```

**Why:** Netflix emails use `Content-Type: text/plain; charset=UTF-8` + `Content-Transfer-Encoding: quoted-printable`. Without this fix, "código" appears as "cÃ³digo".

**How to apply:** In `extractEmailParts`, detect `charset` from Content-Type header before decoding. Same logic applies to base64: use `buf.toString('latin1')` vs `'utf-8'` based on charset.

---

## 2. Multi-line date in "a las" pattern

Netflix plain-text emails sometimes line-wrap right after the day number:
```
Solicitud de Admin desde: *Apple - iPad* a las 1\r\nde junio, 7:55 p. m.
```
Regex `[^\n\r]+` stops at `\r\n`, capturing only "1" as the time.

**Fix:** Normalize before matching:
```typescript
const normalized = body.replace(/(\d)\r?\n([a-záéíóú\w])/gi, "$1 $2");
```

**Why:** The line-wrap happens when "a las " + day number hits the ~76-char plain-text line limit.

---

## 3. False device name "el dispositivo que aparece a continuación"

Newer Netflix email format does NOT include the device name in plain text:
> "Recibimos una solicitud de código de acceso temporal desde\nel dispositivo que aparece a continuación."

The old regex matched "el dispositivo que aparece a continuación" as the device name.

**Fix:** After extracting the device string, check with `isFalseDevice()`:
```typescript
function isFalseDevice(s: string): boolean {
  return /dispositivo que aparece/i.test(s) || s.length < 2;
}
```
Return "Información del dispositivo no disponible" when this triggers.

---

## 4. Time string includes "Obtener código" (same line in some emails)

Some forwarded Gmail emails have "Obtener código" on the same line as the time:
> "2 de junio, 11:19 a. m. GMT+10 Obtener código"

**Fix:** Post-process the captured time string:
```typescript
function cleanTime(s: string): string {
  return s
    .replace(/\s+Obtener\b.*/i, "")
    .replace(/\s+Si\s+no\b.*/i, "")
    .replace(/[,\s]+$/, "")
    .trim();
}
```

---

## 5. Multi-language IMAP search

Do two separate IMAP `search()` calls and combine results:
- Spanish: `{ subject: "código de acceso temporal" }`
- English: `{ subject: "Netflix temporary access code" }`

Then union the results with `new Set([...foundEs, ...foundEn])`.
