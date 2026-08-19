// Scene-wide fog (uFogDensity/uFogColor + the FogFragCoord = gl_Position.w varying) is the GL_EXP2
// port of QSS-M's Fog_EnableGFog. Every program drawing solid scene geometry repeats fshBrush's three
// fog lines verbatim, or models stop matching the world they stand on: Brush, Alias, Player, Sprite,
// Particle, Turbulent. Deliberately absent from Sky/SkyChain/SkyCube (r_skyfog blends those
// separately), PScript (QSS-M disables fog for additive script particles), Warp (post-process of an
// already-fogged scene) and every 2D/HUD program.

export const vshAlias =
`uniform vec3 uOrigin;
uniform mat3 uAngles;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform vec3 uLightVec;
uniform float uBlend;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aPosition2;
attribute vec3 aNormal2;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
varying float vLightDot;
varying float FogFragCoord;
void main(void)
{
  vec3 lerpedPos = mix(aPosition, aPosition2, uBlend);
  vec3 position = uViewAngles * (uAngles * lerpedPos + uOrigin - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vTexCoord = aTexCoord;
  vLightDot = mix(dot(aNormal, uLightVec), dot(aNormal2, uLightVec), uBlend);
  FogFragCoord = gl_Position.w;
}`

export const fshAlias =
`precision mediump float;
uniform float uGamma;
uniform float uAlpha;
uniform vec3 uAmbientLight;
uniform vec3 uShadeLight;
uniform bool uUseOverbright;
uniform bool uUseFullbrights;
uniform sampler2D tTexture;
uniform float uFogDensity;
uniform vec4 uFogColor;
varying vec2 vTexCoord;
varying float vLightDot;
varying float FogFragCoord;

void main(void)
{
  vec4 texture = texture2D(tTexture, vTexCoord);
  // Overbright: clamp the lit value to 1.0 then double (r_alias.c / Ironwail ldexp),
  // matching the world's 2.0 ceiling so models aren't dimmer than the level. The
  // texture.a mix keeps fullbright texels (a=0, palette 224-255) at full intensity,
  // undoubled; gl_fullbrights 0 forces them lit like everything else.
  vec3 light = vLightDot * uShadeLight + uAmbientLight;
  if (uUseOverbright)
    light = clamp(light, 0.0, 1.0) * 2.0;
  float fb = uUseFullbrights ? texture.a : 1.0;
  gl_FragColor = vec4(texture.rgb * mix(vec3(1.0,1.0,1.0), light, fb), uAlpha);
  float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
  fog = clamp(fog, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFogColor.rgb, gl_FragColor.rgb, fog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshCharacter =
`uniform vec2 uCharacter;
uniform vec2 uDest;
uniform mat4 uOrtho;
attribute vec2 aPosition;
varying vec2 vTexCoord;
void main(void)
{
  gl_Position = uOrtho * vec4(aPosition * 8.0 + uDest, 0.0, 1.0);
  vTexCoord = (aPosition + uCharacter) * 0.0625;
}`

export const fshCharacter = 
`precision mediump float;
uniform sampler2D tTexture;
varying vec2 vTexCoord;
void main(void)
{
  gl_FragColor = texture2D(tTexture, vTexCoord);
}`

export const vshDlight =
`uniform vec3 uOrigin;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform float uRadius;
attribute vec3 aPosition;
varying float vAlpha;
void main(void)
{
  vec3 position = aPosition * 0.35 * uRadius + uViewAngles * (uOrigin - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vAlpha = aPosition.y * -0.2;
}`

export const fshDlight =
`precision mediump float;
uniform float uGamma;
varying float vAlpha;
void main(void)
{
  gl_FragColor = vec4(1.0, pow(0.5, uGamma), 0.0, vAlpha);
}`

export const vshFill =
`uniform mat4 uOrtho;
attribute vec2 aPosition;
attribute vec4 aColor;
varying vec4 vColor;
void main(void)
{
  gl_Position = uOrtho * vec4(aPosition, 0.0, 1.0);
  vColor = aColor;
}`

export const fshFill =
`precision mediump float;
varying vec4 vColor;
void main(void)
{
  gl_FragColor = vColor;
}`

export const vshParticle =
`uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform vec3 uVpn;
attribute vec2 aCorner;
attribute vec3 aOrigin;
attribute vec4 aColor;
varying vec2 vCoord;
varying vec3 vColor;
varying float FogFragCoord;
void main(void)
{
  vec3 offset = aOrigin - uViewOrigin;
  float d = dot(offset, uVpn);
  float scale = d < 20.0 ? 0.375 : 0.375 + d * 0.0015;
  vec2 point = aCorner * scale;
  vec3 position = vec3(point.x, 0.0, point.y) + uViewAngles * offset;
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vCoord = aCorner;
  vColor = aColor.rgb;
  FogFragCoord = gl_Position.w;
}`

export const fshParticle =
`precision mediump float;
uniform float uGamma;
uniform float uFogDensity;
uniform vec4 uFogColor;
varying vec2 vCoord;
varying vec3 vColor;
varying float FogFragCoord;
void main(void)
{
  gl_FragColor = vec4(vColor, 1.0 - smoothstep(0.75, 1.0, length(vCoord)));
  float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
  fog = clamp(fog, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFogColor.rgb, gl_FragColor.rgb, fog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

// effectinfo scripted particles (pscript.ts): instanced, atlas-textured quads.
// aOrientation selects the quad basis: 0 = camera-facing billboard via uVright/uVup,
// 1 = spark/beam stretched along aVelocity (pre-scaled CPU-side to dir*length) and
// oriented by the per-particle camera direction crossed with that stretch vector
// (r_part_fte.c R_AddTSparkParticle), 2 = flat quad perpendicular to aVelocity
// (pre-normalized CPU-side; PT_UDECAL / `orientation oriented`). Billboard and
// oriented quads share the optional 2D corner rotation; sparks ignore it like QSS-M.
export const vshPScript =
`uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform vec3 uVright;
uniform vec3 uVup;
uniform float uPixelWidth;
attribute vec2 aCorner;
attribute vec3 aOrigin;
attribute vec3 aVelocity;
attribute float aSize;
attribute float aRotation;
attribute vec4 aUV;
attribute float aOrientation;
attribute vec4 aColor;
varying vec2 vTexCoord;
varying vec4 vColor;
void main(void)
{
  float halfSize = aSize * 0.5;
  vec2 corner = aCorner;
  if (aRotation != 0.0)
  {
    float sr = sin(aRotation);
    float cr = cos(aRotation);
    corner = vec2(aCorner.x * cr - aCorner.y * sr, aCorner.x * sr + aCorner.y * cr);
  }
  vec3 offset;
  if (aOrientation > 1.5)
  {
    vec3 n = aVelocity;
    vec3 h = abs(n.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    vec3 s = normalize(cross(n, h));
    vec3 t = cross(n, s);
    offset = s * (corner.x * halfSize) + t * (corner.y * halfSize);
  }
  else if (aOrientation > 0.5)
  {
    vec3 toCamera = uViewOrigin - aOrigin;
    float dist = length(toCamera);
    vec3 across = normalize(cross(toCamera, aVelocity));
    // never rasterize thinner than ~1 pixel: 1-unit-wide rain streaks at 500+ units
    // produce zero fragments without MSAA (QSS-M gets partial coverage from fsaa)
    float hw = max(halfSize, dist * uPixelWidth);
    offset = across * (aCorner.x * hw) + aVelocity * aCorner.y;
  }
  else
  {
    offset = uVright * (corner.x * halfSize) + uVup * (corner.y * halfSize);
  }
  vec3 worldPos = aOrigin + offset;
  vec3 eyePos = uViewAngles * (worldPos - uViewOrigin);
  gl_Position = uPerspective * vec4(eyePos.xz, -eyePos.y, 1.0);
  vTexCoord = vec2(mix(aUV.x, aUV.z, (aCorner.x + 1.0) * 0.5), mix(aUV.y, aUV.w, (aCorner.y + 1.0) * 0.5));
  vColor = aColor;
}`

export const fshPScript =
`precision mediump float;
uniform float uGamma;
uniform sampler2D tTexture;
varying vec2 vTexCoord;
varying vec4 vColor;
void main(void)
{
  gl_FragColor = texture2D(tTexture, vTexCoord) * vColor;
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshPic =
`uniform mat4 uOrtho;
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main(void)
{
  gl_Position = uOrtho * vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}`

export const fshPic =
`precision mediump float;
uniform sampler2D tTexture;
varying vec2 vTexCoord;
void main(void)
{
  gl_FragColor = texture2D(tTexture, vTexCoord);
}`

export const vshPicTranslate =
`uniform mat4 uOrtho;
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main(void)
{
  gl_Position = uOrtho * vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}`

export const fshPicTranslate =
`precision mediump float;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform sampler2D tTexture;
uniform sampler2D tTrans;
varying vec2 vTexCoord;
void main(void)
{
  vec4 texture = texture2D(tTexture, vTexCoord);
  vec4 trans = texture2D(tTrans, vTexCoord);
  gl_FragColor = vec4(mix(mix(texture.rgb, uTop * trans.x, trans.y), uBottom * trans.z, trans.w), texture.a);
}`

export const vshPlayer =
`uniform vec3 uOrigin;
uniform mat3 uAngles;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform vec3 uLightVec;
uniform float uBlend;
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec3 aPosition2;
attribute vec3 aNormal2;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
varying float vLightDot;
varying float FogFragCoord;
void main(void)
{
  vec3 lerpedPos = mix(aPosition, aPosition2, uBlend);
  vec3 position = uViewAngles * (uAngles * lerpedPos + uOrigin - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vTexCoord = aTexCoord;
  vLightDot = mix(dot(aNormal, uLightVec), dot(aNormal2, uLightVec), uBlend);
  FogFragCoord = gl_Position.w;
}`

export const fshPlayer =
`precision mediump float;
uniform float uGamma;
uniform float uAlpha;
uniform vec3 uAmbientLight;
uniform vec3 uShadeLight;
uniform bool uUseOverbright;
uniform bool uUseFullbrights;
uniform vec3 uTop;
uniform vec3 uBottom;
uniform sampler2D tTexture;
uniform sampler2D tPlayer;
uniform float uFogDensity;
uniform vec4 uFogColor;
varying vec2 vTexCoord;
varying float vLightDot;
varying float FogFragCoord;
void main(void)
{
  vec4 texture = texture2D(tTexture, vTexCoord);
  vec4 player = texture2D(tPlayer, vTexCoord);
  vec3 light = vLightDot * uShadeLight + uAmbientLight;
  if (uUseOverbright)
    light = clamp(light, 0.0, 1.0) * 2.0;
  float fb = uUseFullbrights ? texture.a : 1.0;
  gl_FragColor = vec4(
    mix(mix(texture.rgb, uTop * (1.0 / 191.25) * player.x, player.y), uBottom * (1.0 / 191.25) * player.z, player.w)
    * mix(vec3(1.0, 1.0, 1.0), light, fb), uAlpha);
  float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
  fog = clamp(fog, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFogColor.rgb, gl_FragColor.rgb, fog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshSky =
`uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform vec3 uScale;
attribute vec3 aPosition;
varying vec2 vTexCoord;
void main(void)
{
  vec3 position = uViewAngles * (aPosition * uScale * 18918.0);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vTexCoord = aPosition.xy * uScale.xy * 1.5;
}`

export const fshSky =
`precision mediump float;
uniform float uGamma;
uniform vec2 uTime;
uniform sampler2D tSolid;
uniform sampler2D tAlpha;
varying vec2 vTexCoord;
void main(void)
{
  vec4 alpha = texture2D(tAlpha, vTexCoord + uTime.x);
  gl_FragColor = vec4(mix(texture2D(tSolid, vTexCoord + uTime.y).rgb, alpha.rgb, alpha.a), 1.0);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshSkyChain =
`uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
attribute vec3 aPosition;
void main(void)
{
  vec3 position = uViewAngles * (aPosition - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
}`

export const fshSkyChain =
`precision mediump float;
void main(void)
{
}`

export const vshSkyCube =
`uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
attribute vec3 aPosition;
varying vec3 vDir;
void main(void)
{
  vec3 position = uViewAngles * (aPosition - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vDir = vec3(-(aPosition.y - uViewOrigin.y),
                aPosition.z - uViewOrigin.z,
                aPosition.x - uViewOrigin.x);
}`

export const fshSkyCube =
`precision mediump float;
uniform float uGamma;
uniform float uSkyFog;
uniform vec3 uFogColor;
uniform samplerCube tSky;
varying vec3 vDir;
void main(void)
{
  gl_FragColor = textureCube(tSky, vDir);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, uFogColor, uSkyFog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshSprite =
`uniform vec4 uRect;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
varying float FogFragCoord;
void main(void)
{
  vec3 position = uViewAngles * (aPosition - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vTexCoord = aTexCoord;
  FogFragCoord = gl_Position.w;
}`

export const fshSprite =
`precision mediump float;
uniform float uGamma;
uniform sampler2D tTexture;
uniform float uFogDensity;
uniform vec4 uFogColor;
varying vec2 vTexCoord;
varying float FogFragCoord;
void main(void)
{
  gl_FragColor = texture2D(tTexture, vTexCoord);
  float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
  fog = clamp(fog, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFogColor.rgb, gl_FragColor.rgb, fog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));
}`

export const vshTurbulent =
`uniform vec3 uOrigin;
uniform mat3 uAngles;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
attribute vec3 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
varying float FogFragCoord;
void main(void)
{
  vec3 position = uViewAngles * (uAngles * aPosition + uOrigin - uViewOrigin);
  gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);
  vTexCoord = aTexCoord;
  FogFragCoord = gl_Position.w;
}`

export const fshTurbulent =
`precision mediump float;
uniform float uGamma;
uniform float uTime;
uniform sampler2D tTexture;
uniform float uAlpha;
uniform float uFogDensity;
uniform vec4 uFogColor;

varying vec2 vTexCoord;
varying float FogFragCoord;

void main(void)
{
  gl_FragColor = vec4(texture2D(tTexture, vTexCoord + vec2(sin(vTexCoord.t * 3.141593 + uTime), sin(vTexCoord.s * 3.141593 + uTime)) * 0.125).rgb, 1.0);
  float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
  fog = clamp(fog, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFogColor.rgb, gl_FragColor.rgb, fog);
  gl_FragColor.rgb = pow(gl_FragColor.rgb, vec3(uGamma));

  gl_FragColor.a = uAlpha;
}`

export const vshWarp =
`uniform mat4 uOrtho;
attribute vec2 aPosition;
attribute vec2 aTexCoord;
varying vec2 vTexCoord;
void main(void)
{
  gl_Position = uOrtho * vec4(aPosition, 0.0, 1.0);
  vTexCoord = aTexCoord;
}`

export const fshWarp =
`precision mediump float;
uniform float uTime;
uniform sampler2D tTexture;
varying vec2 vTexCoord;
void main(void)
{
  gl_FragColor = texture2D(tTexture, vTexCoord + vec2(sin(vTexCoord.t * 15.70796 + uTime) * 0.003125, sin(vTexCoord.s * 9.817477 + uTime) * 0.005));
}`

export const vshBrush =
`#version 100

uniform vec3 uOrigin;
uniform mat3 uAngles;
uniform vec3 uViewOrigin;
uniform mat3 uViewAngles;
uniform mat4 uPerspective;
uniform float uLightStyles[65];

attribute vec3 Vert;
attribute vec2 TexCoords;
attribute vec2 LMCoords;
attribute vec4 LMStyles;

varying float FogFragCoord;
varying vec2 vTexCoords;
varying vec2 vLMCoords;
varying vec4 vLMWeights;
varying vec3 vWorldPos;

void main()
{
	vec3 worldPos = uAngles * Vert + uOrigin;
	vec3 position = uViewAngles * (worldPos - uViewOrigin);
	gl_Position = uPerspective * vec4(position.xz, -position.y, 1.0);

	vTexCoords = TexCoords;
	vLMCoords = LMCoords;
	vWorldPos = worldPos;
	FogFragCoord = gl_Position.w;

	vLMWeights = vec4(
		uLightStyles[int(LMStyles.x + 0.5)],
		uLightStyles[int(LMStyles.y + 0.5)],
		uLightStyles[int(LMStyles.z + 0.5)],
		uLightStyles[int(LMStyles.w + 0.5)]
	);
}`

export const fshBrush =
`#version 100
precision mediump float;

uniform sampler2D Tex;
uniform sampler2D LMTex0;
uniform sampler2D FullbrightTex;
uniform sampler2D LMTex1;
uniform sampler2D LMTex2;
uniform sampler2D LMTex3;
uniform bool uUseFullbrightTex;
uniform bool uUseOverbright;
uniform bool uUseAlphaTest;
uniform float uAlpha;
uniform float uFogDensity;
uniform vec4 uFogColor;
uniform float uGamma;
// Lit water (r_litwater): classic turbulent UV warp applied to the diffuse
// sample only — lightmap UVs (vLMCoords) stay unwarped, matching fshTurbulent.
uniform bool uWarp;
uniform float uTime;

// GPU dlights: analytic replacement for the old CPU dlight-overlay lightmap.
// Each light contributes (radius - dist3d) in brightness units when above its
// minlight threshold, summed across lights, then scaled by 2/255 and clamped
// 0..1 — reproducing the old overlay's fixed-point encoding
// (brightness*256 >> 7, clamped 0..255, sampled back as a 0..1 byte).
uniform int uNumDlights;
uniform vec4 uDlightPosRadius[32]; // xyz = origin, w = radius
uniform vec4 uDlightColor[32]; // rgb = color (0..1), w = minlight

varying float FogFragCoord;
varying vec2 vTexCoords;
varying vec2 vLMCoords;
varying vec4 vLMWeights;
varying vec3 vWorldPos;

void main()
{
	vec2 diffuseCoords = uWarp
		? vTexCoords + vec2(sin(vTexCoords.t * 3.141593 + uTime), sin(vTexCoords.s * 3.141593 + uTime)) * 0.125
		: vTexCoords;
	vec4 result = texture2D(Tex, diffuseCoords);
	if (uUseAlphaTest && (result.a < 0.666))
		discard;

	vec3 dlight = vec3(0.0);
	for (int i = 0; i < 32; i++) {
		if (i >= uNumDlights)
			break;
		vec4 posRadius = uDlightPosRadius[i];
		vec4 colorMin = uDlightColor[i];
		float add = posRadius.w - distance(vWorldPos, posRadius.xyz);
		if (add > colorMin.w)
			dlight += colorMin.rgb * add;
	}
	dlight = clamp(dlight * (2.0 / 255.0), 0.0, 1.0);

	vec3 lm = texture2D(LMTex0, vLMCoords).rgb * vLMWeights.x
	        + texture2D(LMTex1, vLMCoords).rgb * vLMWeights.y
	        + texture2D(LMTex2, vLMCoords).rgb * vLMWeights.z
	        + texture2D(LMTex3, vLMCoords).rgb * vLMWeights.w
	        + dlight;
	// Overbright: raise the lightmap ceiling to 2.0 instead of 1.0. The per-style
	// weight (lightstylevalue/128) already bakes in the 2x, so this is a clamp
	// change, not an extra multiply — fullbright texels (added below) stay 1x.
	result.rgb *= clamp(lm, 0.0, uUseOverbright ? 2.0 : 1.0);
	if (uUseFullbrightTex)
		result += texture2D(FullbrightTex, vTexCoords);
	result = clamp(result, 0.0, 1.0);
	float fog = exp(-uFogDensity * uFogDensity * FogFragCoord * FogFragCoord);
	fog = clamp(fog, 0.0, 1.0);
	result = mix(uFogColor, result, fog);
	result.a = uAlpha; // FIXME: This will make almost transparent things cut holes though heavy fog

	result.rgb = pow(result.rgb, vec3(uGamma));

	gl_FragColor = result;
}`