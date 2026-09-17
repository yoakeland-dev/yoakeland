#version 300 es
precision highp float;

uniform sampler2D u_tex;
uniform vec2 u_canvasSize;
uniform vec2 u_imgSize;
uniform float u_levels;
uniform float u_style; // 0=dither, 1=scanlines, 2=ascii, 3=dotmatrix, 4=gameboy
uniform vec3 u_accent;
uniform vec3 u_panelBg;

out vec4 outColor;

const float bayer8x8[64] = float[64](
  0.0,32.0, 8.0,40.0, 2.0,34.0,10.0,42.0,
  48.0,16.0,56.0,24.0,50.0,18.0,58.0,26.0,
  12.0,44.0, 4.0,36.0,14.0,46.0, 6.0,38.0,
  60.0,28.0,52.0,20.0,62.0,30.0,54.0,22.0,
   3.0,35.0,11.0,43.0, 1.0,33.0, 9.0,41.0,
  51.0,19.0,59.0,27.0,49.0,17.0,57.0,25.0,
  15.0,47.0, 7.0,39.0,13.0,45.0, 5.0,37.0,
  63.0,31.0,55.0,23.0,61.0,29.0,53.0,21.0
);

vec3 gbColor(int idx) {
  float shade = mix(0.18, 1.0, float(idx) / 3.0);
  return u_accent * shade;
}

float hash21(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float getLuma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}

float sdfBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sampleVectorAscii(int charIdx, vec2 uv) {
  vec2 p = uv - 0.5;
  float stroke = 0.06;
  float d = 1.0;

  if (charIdx == 0) return 0.0; // Space

  if (charIdx == 1) {
    d = length(p - vec2(0.0, -0.32)) - 0.08;
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 2) {
    float topDot = length(p - vec2(0.0, 0.18)) - 0.07;
    float botDot = length(p - vec2(0.0, -0.18)) - 0.07;
    d = min(topDot, botDot);
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 3) {
    d = sdfBox(p, vec2(0.26, stroke));
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 4) {
    float h = sdfBox(p, vec2(0.26, stroke));
    float v = sdfBox(p, vec2(stroke, 0.26));
    d = min(h, v);
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 5) {
    float topBar = sdfBox(p - vec2(0.0, 0.12), vec2(0.26, stroke));
    float botBar = sdfBox(p + vec2(0.0, 0.12), vec2(0.26, stroke));
    d = min(topBar, botBar);
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 6) {
    float v1 = sdfBox(p - vec2(0.12, 0.0), vec2(0.04, 0.32));
    float v2 = sdfBox(p + vec2(0.12, 0.0), vec2(0.04, 0.32));
    float h1 = sdfBox(p - vec2(0.0, 0.12), vec2(0.32, 0.04));
    float h2 = sdfBox(p + vec2(0.0, 0.12), vec2(0.32, 0.04));
    d = min(min(v1, v2), min(h1, h2));
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 7) {
    float slash = sdfBox(p, vec2(0.35, 0.04));
    float c1 = abs(length(p - vec2(-0.16, 0.18)) - 0.08) - 0.03;
    float c2 = abs(length(p - vec2(0.16, -0.18)) - 0.08) - 0.03;
    d = min(slash, min(c1, c2));
    return smoothstep(0.03, 0.0, d);
  }

  if (charIdx == 8) {
    float outerRing = abs(length(p) - 0.28) - 0.04;
    float innerCore = length(p - vec2(-0.04, 0.0)) - 0.12;
    d = min(outerRing, innerCore);
    return smoothstep(0.03, 0.0, d);
  }

  return 0.0;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_canvasSize;
  uv.y = 1.0 - uv.y;

  float canvasAspect = u_canvasSize.x / u_canvasSize.y;
  float imgAspect = u_imgSize.x / u_imgSize.y;
  vec2 scale = canvasAspect > imgAspect
    ? vec2(1.0, imgAspect / canvasAspect)
    : vec2(canvasAspect / imgAspect, 1.0);

  vec2 st = (uv - 0.5) * scale + 0.5;
  vec3 color = vec3(0.0);
  int mode = int(u_style + 0.5);

  if (mode == 0) {
    float ditherScale = 2.0;
    vec2 gridResolution = u_canvasSize / ditherScale;
    vec2 pixelatedSt = floor(st * gridResolution) / gridResolution;
    color = texture(u_tex, pixelatedSt).rgb;

    vec2 pixelPos = floor(gl_FragCoord.xy / ditherScale);
    int bx = int(mod(pixelPos.x, 8.0));
    int by = int(mod(pixelPos.y, 8.0));
    float bayerBase = (bayer8x8[by * 8 + bx] + 0.5) / 64.0 - 0.5;

    int bxShift = int(mod(pixelPos.x + 4.0, 8.0));
    int byShift = int(mod(pixelPos.y + 4.0, 8.0));
    float bayerShifted = (bayer8x8[byShift * 8 + bxShift] + 0.5) / 64.0 - 0.5;

    float grain = hash21(pixelPos);
    float luma = getLuma(color);
    float rangeMask = smoothstep(0.02, 0.18, luma) * smoothstep(0.98, 0.82, luma);

    float noiseBlend = (grain - 0.5) * 0.35 * rangeMask;
    float finalThreshold = mix(bayerBase, bayerShifted, clamp(grain + noiseBlend, 0.0, 1.0)) + noiseBlend * 0.1;
    color = floor(color * (u_levels - 1.0) + finalThreshold + 0.5) / (u_levels - 1.0);
    color = mix(u_panelBg, color, luma);

  } else if (mode == 1) {
    float ditherScale = 2.0;
    vec2 gridResolution = u_canvasSize / ditherScale;
    vec2 pixelatedSt = floor(st * gridResolution) / gridResolution;
    color = texture(u_tex, pixelatedSt).rgb;

    vec2 pixelPos = floor(gl_FragCoord.xy / ditherScale);
    float scanline = mod(pixelPos.y, 2.0) < 1.0 ? 1.0 : 0.72;
    float grain = (hash21(pixelPos) - 0.5) * 0.06;
    color = clamp(color * scanline + grain, 0.0, 1.0);

  } else if (mode == 2) {
    vec2 cellSize = vec2(8.0, 16.0);
    vec2 cellCoord = floor(gl_FragCoord.xy / cellSize);
    vec2 cellCenterPx = (cellCoord + 0.5) * cellSize;

    vec2 cellUV = cellCenterPx / u_canvasSize;
    cellUV.y = 1.0 - cellUV.y;
    vec2 sampleSt = (cellUV - 0.5) * scale + 0.5;

    vec3 sampleCol = texture(u_tex, sampleSt).rgb;
    float luma = getLuma(sampleCol);

    int charIndex = int(clamp(floor(luma * 9.0), 0.0, 8.0));
    vec2 localUV = mod(gl_FragCoord.xy, cellSize) / cellSize;

    float mask = sampleVectorAscii(charIndex, localUV);
    color = mix(u_panelBg, sampleCol, mask);

  } else if (mode == 3) {
    float dotSpacing = 8.0;
    vec2 cellCoord = floor(gl_FragCoord.xy / dotSpacing);
    vec2 cellCenterPx = (cellCoord + 0.5) * dotSpacing;

    vec2 cellUV = cellCenterPx / u_canvasSize;
    cellUV.y = 1.0 - cellUV.y;
    vec2 sampleSt = (cellUV - 0.5) * scale + 0.5;

    vec3 sampleCol = texture(u_tex, sampleSt).rgb;
    float luma = getLuma(sampleCol);

    vec2 cellLocal = mod(gl_FragCoord.xy, dotSpacing) / dotSpacing - 0.5;
    float dist = length(cellLocal);

    float maxRadius = 0.42;
    float radius = clamp(luma * maxRadius, 0.05, maxRadius);
    float dotMask = smoothstep(radius, radius - 0.08, dist);

    color = mix(u_panelBg, sampleCol * 1.1, dotMask);

    float fade = smoothstep(0.0, 1.0, 1.0 - uv.y);
    color = mix(u_panelBg, color, fade);
    outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
    return;

  } else if (mode == 4) {
    float gbPixelSize = 8.0;

    vec2 pixelCoord = floor(gl_FragCoord.xy / gbPixelSize);
    vec2 pixelCenter = (pixelCoord + 0.5) * gbPixelSize;
    vec2 sampleUV = pixelCenter / u_canvasSize;
    sampleUV.y = 1.0 - sampleUV.y;
    vec2 sampleSt = (sampleUV - 0.5) * scale + 0.5;

    vec3 srcCol = texture(u_tex, sampleSt).rgb;

    int bx = int(mod(pixelCoord.x, 8.0));
    int by = int(mod(pixelCoord.y, 8.0));
    float bayer = (bayer8x8[by * 8 + bx] + 0.5) / 64.0 - 0.5;

    float luma = getLuma(srcCol);
    luma = clamp(luma + bayer * 0.15, 0.0, 1.0);

    int paletteIdx = int(clamp(floor(luma * 4.0), 0.0, 3.0));
    vec3 baseGbColor = gbColor(paletteIdx);

    vec2 pixelLocal = mod(gl_FragCoord.xy, gbPixelSize) / gbPixelSize; // [0.0, 1.0]
    vec2 pNorm = (pixelLocal - 0.5) * 2.0;                             // [-1.0, 1.0]

    float innerVignette = smoothstep(1.3, 0.2, length(pNorm));
    vec2 borderD = abs(pNorm);
    float edgeGap = smoothstep(1.0, 0.72, max(borderD.x, borderD.y));

    color = baseGbColor * (innerVignette * 0.35 + 0.65) * edgeGap;
  }

  float fade = smoothstep(0.0, 1.0, 1.0 - uv.y);
  color = mix(u_panelBg, color, fade);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
