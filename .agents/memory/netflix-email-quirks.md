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

## 3. False device name: multiple Netflix variants

Netflix uses different placeholder phrases depending on email template version:
- OLD: "el dispositivo que aparece a continuación"
- NEW: "el dispositivo que ves más abajo"

Both must be rejected by `isFalseDevice`. The check `/el dispositivo/i` covers both variants.

**Fix:** `isFalseDevice` must include:
```typescript
function isFalseDevice(s: string): boolean {
  return (
    /dispositivo que aparece/i.test(s) ||
    /el dispositivo/i.test(s) ||       // covers "el dispositivo que ves más abajo"
    /dispositivo que ves/i.test(s) ||
    s.length < 2 ||
    s.length > 200                     // reject paragraph-length captures
  );
}
```

**Why:** The `s.length > 200` guard is critical — certain email formats (e.g. Roku Decodificador) caused the `dev` pattern to capture the entire collapsed body (no newlines → `[^\n<]+` matched everything).

---

## 4. Time string includes "Obtener código" / "Solicitar código" (same line in some emails)

Some forwarded or specific-device emails (e.g. Roku) have trailing noise on the same line as the time:
> "30 de mayo, 21:58 GMT-5 Solicitar código El enlace caduca..."

**Fix:** `stripTrailingNoise` (replaces the old `cleanTime`) removes all known noise suffixes:
```typescript
function stripTrailingNoise(s: string): string {
  return s
    .replace(/\s+Obtener\b.*/i, "")
    .replace(/\s+Solicitar\b.*/i, "")
    .replace(/\s+Si\s+no\b.*/i, "")
    .replace(/\s+If\s+you\b.*/i, "")
    .replace(/\s+Este\s+enlace\b.*/i, "")
    .replace(/\s+El\s+enlace\b.*/i, "")
    .replace(/\s+Protege\b.*/i, "")
    .replace(/\s+Cuida\b.*/i, "")
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

---

## 6. Roku / Decodificador email format — "ha enviado una solicitud desde"

Netflix emails for set-top boxes (Roku, Decodificador) use a different sentence structure:
> "4 ha enviado una solicitud desde Roku – Decodificador — 30 de mayo, 21:58 GMT-5 Solicitar código"

The standard patterns look for "Solicitud de [name] desde:" which does NOT match this format.

**Fix:** Add a dedicated pattern in `tryExtract` (before the broad fallbacks):
```typescript
const haEnviado = text.match(
  /ha\s+enviado\s+una\s+solicitud\s+desde\s+([^—–\n<]{3,80})(?:\s*[—–]\s*([^\n<]{3,60}))?/i
);
if (haEnviado) {
  const device = stripTrailingNoise(cleanText(haEnviado[1]).trim());
  const rawTime = haEnviado[2] ? cleanTime(cleanText(haEnviado[2])) : null;
  if (!isFalseDevice(device)) return rawTime ? `${device} — ${rawTime}` : device;
}
```

**Also:** The `dev` pattern `([^\n<]+)` had no length limit — in collapsed text (no newlines) it captured the entire remaining body. Fixed to `([^\n<]{1,150})`.
