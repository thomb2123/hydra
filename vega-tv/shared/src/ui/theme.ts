// 10-foot UI tokens. The Vega TV surface is 1920x1080 logical pixels.
// Matches the streaming-service look: near-black canvas, white focus, purple accent.
export const colors = {
  background: '#000000',
  surface: '#16161a',
  surfaceRaised: '#232329',
  focus: '#ffffff',
  focusText: '#000000',
  text: '#ffffff',
  textMuted: '#9a9aa3',
  accent: '#7b5cff',
  danger: '#ff6b6b',
  ok: '#46d369',
};

export const spacing = {xs: 6, s: 12, m: 20, l: 32, xl: 56};

export const fonts = {
  title: 44,
  heading: 32,
  body: 26,
  small: 21,
};

// Keep content away from the edges of TVs that overscan.
export const safeArea = {horizontal: 80, vertical: 48};
