export function resolveColor(theme, token) {
  const initial = theme.colors[token] ?? theme.export[token] ?? token;
  let value = initial;
  const seen = new Set();
  while (typeof value === "string" && !value.startsWith("#")) {
    if (seen.has(value) || !(value in theme.vars)) throw new Error(`Unresolved color: ${token} (${value})`);
    seen.add(value);
    value = theme.vars[value];
  }
  if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`Expected a six-digit hex color: ${token}`);
  return value.toUpperCase();
}

export function contrast(first, second) {
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/../g).map((pair) => parseInt(pair, 16) / 255);
    const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
