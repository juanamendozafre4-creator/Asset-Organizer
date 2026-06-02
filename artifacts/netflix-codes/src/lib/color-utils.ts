export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return null;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

export function getLuminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

export function isDark(hex: string): boolean {
  return getLuminance(hex) < 0.35;
}

export function getTextColor(bg: string): string {
  return isDark(bg) ? "#ffffff" : "#0a0a0a";
}

export function getMutedTextColor(bg: string): string {
  return isDark(bg) ? "rgba(255,255,255,0.55)" : "rgba(0,0,0,0.45)";
}

export function getCardBg(bg: string): string {
  return isDark(bg) ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)";
}

export function getCardBorder(bg: string): string {
  return isDark(bg) ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.10)";
}

export function getLogoBg(bg: string): string {
  return isDark(bg) ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
}

export function getAccentColor(bg: string): string {
  return isDark(bg) ? "rgba(255,255,255,0.90)" : "rgba(0,0,0,0.85)";
}
