/**
 * ColorGradingShader - Archviz photo-realistic post-processing
 * Vignette + warm highlights + cool shadows + contrast S-curve + saturation
 * + local contrast sharpening + chromatic aberration (screen-space RGB channel split, strongest at screen edges)
 * Compatible with Three.js EffectComposer ShaderPass
 */

const ColorGradingShader = {

    uniforms: {
        tDiffuse:             { value: null },
        vignetteOffset:       { value: 0.78 },   // vignette start radius (lower = bigger vignette)
        vignetteDarkness:     { value: 0.18 },   // nearly white studio background; avoids a gloomy edge falloff
        contrast:             { value: 1.04 },   // soft S-curve; keeps sunny warmth without clipping pale interiors
        saturation:           { value: 0.95 },   // warm but not candy-coloured
        temperature:          { value: 0.024 },  // warm shift on highlights
        shadowTint:           { value: 0.012 },  // cool-blue tint in shadows for split-tone look
        resolution:           { value: { x: 1, y: 1 } },
        clarity:              { value: 0.64 },   // local contrast strength: clear boundaries without outline strokes
        clarityFine:          { value: 0.56 },   // furniture/window frame scale
        clarityMid:           { value: 0.24 },   // wall/floor and room-volume scale
        clarityThreshold:     { value: 0.014 },  // catches white-on-light boundaries without noisy fabric halos
        clarityChroma:        { value: 0.04 },   // keep clarity luminance-based to avoid coloured halos
        clarityLimit:         { value: 0.038 },  // local clamp padding; avoids drawn edge halos
        sharpenRadius:        { value: 0.9 },
        whiteEdgeBoost:       { value: 0.12 },   // extra high-key relief for white furniture/fixtures
        whiteEdgeThreshold:   { value: 0.80 },
        highlightRolloff:     { value: 0.46 },
        // Chromatic aberration: subtle RGB channel split, strongest at screen edges.
        // 0 = off, 0.003 = subtle glass-edge look, 0.008 = heavy lens distortion.
        chromaticAberration:  { value: 0.0 }
    },

    vertexShader: /* glsl */`
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,

    fragmentShader: /* glsl */`
        uniform sampler2D tDiffuse;
        uniform float vignetteOffset;
        uniform float vignetteDarkness;
        uniform float contrast;
        uniform float saturation;
        uniform float temperature;
        uniform float shadowTint;
        uniform vec2 resolution;
        uniform float clarity;
        uniform float clarityFine;
        uniform float clarityMid;
        uniform float clarityThreshold;
        uniform float clarityChroma;
        uniform float clarityLimit;
        uniform float sharpenRadius;
        uniform float whiteEdgeBoost;
        uniform float whiteEdgeThreshold;
        uniform float highlightRolloff;
        uniform float chromaticAberration;

        varying vec2 vUv;

        float luma(vec3 c) {
            return dot(c, vec3(0.2126, 0.7152, 0.0722));
        }

        vec3 sceneSample(vec2 uv) {
            return texture2D(tDiffuse, clamp(uv, vec2(0.001), vec2(0.999))).rgb;
        }

        void main() {
            // --- Chromatic aberration (radial RGB split) ---
            // The offset vector points away from screen centre, so R shifts out
            // and B shifts in — matching how a real lens disperses colour.
            vec2 dir = vUv - 0.5;                        // vector from centre
            float edgeDist = dot(dir, dir) * 4.0;        // 0 at centre, ~1 at corners
            vec2 aberr = dir * chromaticAberration * edgeDist;

            float r = texture2D(tDiffuse, vUv + aberr      ).r;
            float g = texture2D(tDiffuse, vUv              ).g;
            float b = texture2D(tDiffuse, vUv - aberr      ).b;
            float a = texture2D(tDiffuse, vUv              ).a;
            vec3 color = vec3(r, g, b);
            vec3 centerColor = texture2D(tDiffuse, vUv).rgb;

            // --- Local clarity, not outlines ---
            // Multi-scale unsharp mask:
            // - fine band separates furniture, frames, fixtures and panel seams;
            // - mid band separates wall/floor/ceiling and room-volume boundaries.
            // Tonal gates and neighbourhood clamps prevent white halos and
            // shadow crunching, so the image reads sharper without drawn lines.
            vec2 texel = sharpenRadius / max(resolution, vec2(1.0));

            vec3 n = sceneSample(vUv + vec2(0.0, -texel.y));
            vec3 s = sceneSample(vUv + vec2(0.0,  texel.y));
            vec3 e = sceneSample(vUv + vec2( texel.x, 0.0));
            vec3 w = sceneSample(vUv + vec2(-texel.x, 0.0));
            vec3 ne = sceneSample(vUv + texel * vec2( 0.72, -0.72));
            vec3 nw = sceneSample(vUv + texel * vec2(-0.72, -0.72));
            vec3 se = sceneSample(vUv + texel * vec2( 0.72,  0.72));
            vec3 sw = sceneSample(vUv + texel * vec2(-0.72,  0.72));

            vec3 fineBlur = (n + s + e + w + ne + nw + se + sw) * 0.125;

            vec2 mid = texel * 2.35;
            vec3 mn = sceneSample(vUv + vec2(0.0, -mid.y));
            vec3 ms = sceneSample(vUv + vec2(0.0,  mid.y));
            vec3 me = sceneSample(vUv + vec2( mid.x, 0.0));
            vec3 mw = sceneSample(vUv + vec2(-mid.x, 0.0));
            vec3 midBlur = (fineBlur * 2.0 + mn + ms + me + mw) / 6.0;

            vec3 fineDetail = centerColor - fineBlur;
            vec3 midDetail = fineBlur - midBlur;
            float centerLuma = luma(centerColor);
            float fineLumDetail = luma(fineDetail);
            float midLumDetail = luma(midDetail);
            float fineEdge = abs(centerLuma - luma(fineBlur));
            float midEdge = abs(luma(fineBlur) - luma(midBlur));
            float edgeSignal = max(fineEdge, midEdge * 0.75);
            float axisEdge = max(abs(luma(e) - luma(w)), abs(luma(s) - luma(n)));
            float diagEdge = max(abs(luma(ne) - luma(sw)), abs(luma(nw) - luma(se)));
            float structureMask = smoothstep(clarityThreshold * 1.15, clarityThreshold * 6.2, max(axisEdge, diagEdge));

            float edgeMask = smoothstep(clarityThreshold, clarityThreshold * 4.8, edgeSignal);
            float textureReject = smoothstep(
                clarityThreshold * 0.55,
                clarityThreshold * 2.4,
                abs(fineLumDetail) + abs(midLumDetail) * 0.45
            );
            float shadowGuard = smoothstep(0.035, 0.15, centerLuma);
            float highlightGuard = 1.0 - smoothstep(0.92, 1.0, centerLuma);
            float tonalGuard = 0.70 + 0.30 * shadowGuard * highlightGuard;
            float clarityMask = edgeMask * textureReject * tonalGuard * (0.55 + 0.45 * structureMask);
            vec3 fineNeutral = vec3(fineLumDetail) + (fineDetail - vec3(fineLumDetail)) * clarityChroma;
            vec3 midNeutral = vec3(midLumDetail) + (midDetail - vec3(midLumDetail)) * clarityChroma;

            // High-key edge relief: white furniture on pale floors/walls needs
            // more local separation, but still not a drawn outline. This only
            // rebalances the existing signed luminance detail near real edges.
            float highKey = smoothstep(whiteEdgeThreshold, 0.96, centerLuma);
            float boundarySignal = max(edgeSignal, max(axisEdge, diagEdge) * 0.65);
            float whiteBoundary = smoothstep(clarityThreshold * 0.45, clarityThreshold * 3.2, boundarySignal);
            float whiteEdgeMask = highKey * whiteBoundary * (0.45 + 0.55 * structureMask);
            float whiteDetail = fineLumDetail * 0.82 + midLumDetail * 0.56;

            vec3 enhanced = color
                + fineNeutral * clarity * clarityFine * clarityMask
                + midNeutral * clarity * clarityMid * clarityMask
                + vec3(whiteDetail) * clarity * whiteEdgeBoost * whiteEdgeMask;

            vec3 localMin = min(centerColor, min(min(n, s), min(e, w)));
            vec3 localMax = max(centerColor, max(max(n, s), max(e, w)));
            color = clamp(enhanced, localMin - vec3(clarityLimit), localMax + vec3(clarityLimit));
            color = clamp(color, 0.0, 1.0);

            // --- Vignette (smooth radial darkening) ---
            vec2 center = vUv - 0.5;
            float dist = length(center) * 1.8;
            float vignette = smoothstep(vignetteOffset + 0.4, vignetteOffset - 0.35, dist);
            color *= mix(1.0, vignette, vignetteDarkness);

            // --- Contrast S-curve ---
            color = (color - 0.5) * contrast + 0.5;
            color = clamp(color, 0.0, 1.0);
            color = mix(color, smoothstep(0.0, 1.0, color), 0.10);

            // Preserve high-key separation instead of letting warm whites clip
            // into a single flat patch.
            vec3 rolled = color / (color + vec3(highlightRolloff));
            rolled *= (1.0 + highlightRolloff);
            color = mix(color, rolled, smoothstep(0.58, 0.98, max(max(color.r, color.g), color.b)) * 0.9);

            // --- Saturation ---
            float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
            color = mix(vec3(luminance), color, saturation);

            // --- Split-tone: warm highlights + cool shadows ---
            // Highlights (bright areas): shift toward warm amber
            float hiWeight = smoothstep(0.42, 0.88, luminance);
            color.r += temperature * hiWeight;
            color.g += temperature * 0.35 * hiWeight;
            color.b -= temperature * 0.5 * hiWeight;
            // Shadows (dark areas): faint cool-blue to prevent muddy blacks
            float loWeight = 1.0 - smoothstep(0.0, 0.45, luminance);
            color.b += shadowTint * loWeight;
            color.g += shadowTint * 0.3 * loWeight;

            color = clamp(color, 0.0, 1.0);

            gl_FragColor = vec4(color, a);
        }
    `
};

export { ColorGradingShader };
export default ColorGradingShader;
