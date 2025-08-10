// theme.js
export const THEMES = [
  { id:'neon', name:'Neon Night', bg:'#0b0f15', baseHue:200, sat:0.9, light:0.6 },
  { id:'sunset', name:'Electric Sunset', bg:'#0e0a12', baseHue:320, sat:0.85, light:0.65 },
  { id:'aurora', name:'Aurora', bg:'#041011', baseHue:160, sat:0.7, light:0.7 },
  { id:'mono', name:'Mono Studio', bg:'#0a0a0a', baseHue:220, sat:0.05, light:0.8 }
];

export function colorForNote(velocity, note, bpm, theme){
  const base = theme.baseHue;
  const hue = (base + (note % 12) * 30 + (bpm%120)) % 360;
  const sat = Math.min(100, (theme.sat*100) * (0.6 + velocity*0.4));
  const light = Math.min(90, (theme.light*100) * (0.4 + velocity*0.6));
  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

export function paletteForBPM(bpm, theme){
  // morph saturation and lightness by tempo
  const t = Math.min(1, bpm/180);
  const sat = theme.sat*0.5 + t*theme.sat*0.8;
  const light = theme.light*0.5 + t*theme.light*0.6;
  return { baseHue: theme.baseHue + t*40, sat, light };
}