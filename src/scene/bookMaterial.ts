import * as THREE from 'three';
import { starFx } from './starLight.ts';

/**
 * One material per atlas sheet. Books are a unit rounded box, scaled per instance; the vertex
 * shader re-applies the rounding in millimetres so corners stay round at any size, and the
 * fragment shader picks spine (atlas), boards (palette colour) or paper edges by normal.
 */
/**
 * Shelf lighting, as (y of the lowest shelf surface, shelf pitch, compartment height, strength):
 * an LED strip under each shelf's front edge, fading down the compartment. Strength 0 turns it off.
 */
export type ShelfLight = [number, number, number, number];

export function createBookMaterial(
  atlas: THREE.Texture,
  mode: 'spine' | 'cover' = 'spine',
  shelfLight: ShelfLight = [0, 1, 1, 0],
): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.74, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAtlas = { value: atlas };
    shader.uniforms.uShelf = { value: new THREE.Vector4(...shelfLight) };
    shader.uniforms.uStarOn = starFx.uniform;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute vec3 aDims;
        attribute vec4 aRect;
        attribute vec3 aColor;
        attribute float aRadius;
        attribute float aBoardMm;
        attribute float aHighlight;
        attribute float aStar;
        varying float vStar;
        varying float vWorldY;
        varying vec3 vPosMm;
        varying vec3 vObjN;
        varying vec4 vRect;
        varying vec3 vBoard;
        varying vec3 vDims;
        varying float vBoardMm;
        varying float vHighlight;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        // The instance matrix carries the scale; pre-multiplying keeps the rounded normals true.
        `vec3 objectNormal = normal * aDims;`,
      )
      .replace(
        '#include <begin_vertex>',
        `vec3 posMm = sign(position) * (aDims * 0.5 - aRadius) + normal * aRadius;
        vec3 transformed = posMm / aDims;
        vPosMm = posMm;
        vObjN = normal;
        vRect = aRect;
        vBoard = aColor;
        vDims = aDims;
        vBoardMm = aBoardMm;
        vHighlight = aHighlight;
        vStar = aStar;
        vWorldY = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform sampler2D uAtlas;
        uniform vec4 uShelf;
        uniform float uStarOn;
        varying float vStar;
        varying float vWorldY;
        varying vec3 vPosMm;
        varying vec3 vObjN;
        varying vec4 vRect;
        varying vec3 vBoard;
        varying vec3 vDims;
        varying float vBoardMm;
        varying float vHighlight;`,
      )
      .replace(
        '#include <map_fragment>',
        `vec2 suv = clamp(vec2(vPosMm.x / vDims.x + 0.5, 0.5 - vPosMm.y / vDims.y), 0.003, 0.997);
        vec3 spineCol = texture2D(uAtlas, vRect.xy + suv * vRect.zw).rgb;
        // Paper block: fine page striping, a soft shadow where it meets the boards.
        float edgeX = vDims.x * 0.5 - abs(vPosMm.x);
        float lines = 0.5 + 0.5 * sin(vPosMm.x * 19.0 + sin(vPosMm.y * 0.05 + vPosMm.z * 0.05) * 2.0);
        vec3 paper = vec3(0.86, 0.82, 0.73) * (0.95 + 0.05 * lines);
        paper *= 0.82 + 0.18 * smoothstep(0.0, 2.2, edgeX - vBoardMm);
        float rim = 1.0 - smoothstep(vBoardMm - 0.15, vBoardMm + 0.15, edgeX);
        vec3 board = vBoard * 0.92;
        vec3 edges = mix(paper, board, rim);
        float fSpine = smoothstep(0.5, 0.92, vObjN.z);
        float fBoard = smoothstep(0.5, 0.92, abs(vObjN.x));
        vec3 col = mix(edges, board, fBoard);
        ${
          mode === 'cover'
            ? `// Face-out: the atlas holds the front cover. Spine on the left as you look at it.
        vec2 cuv = clamp(vec2(0.5 - vPosMm.z / vDims.z, 0.5 - vPosMm.y / vDims.y), 0.002, 0.998);
        vec3 coverCol = texture2D(uAtlas, vRect.xy + cuv * vRect.zw).rgb;
        // The hinge groove a few millimetres in from the spine on hardcovers.
        float hinge = 1.0 - 0.22 * step(1.5, vBoardMm) * exp(-pow((vDims.z * 0.5 - vPosMm.z - 8.0) / 1.2, 2.0));
        float fFront = smoothstep(0.5, 0.92, vObjN.x);
        col = mix(col, coverCol * hinge, fFront);
        col = mix(col, board * 0.85, fSpine);`
            : `col = mix(col, spineCol, fSpine);`
        }
        diffuseColor.rgb *= col;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * 0.16 * vHighlight;
        // Warm light from the strip under the shelf above, strongest near the top of the compartment.
        float inComp = mod(vWorldY - uShelf.x, uShelf.y);
        float dTop = max(0.0, uShelf.z - inComp);
        // The five-star switch turns the strips off and the spots on.
        float shelfLight = uShelf.w * (1.0 - uStarOn) * (0.05 + 0.26 * exp(-dTop / 120.0));
        ${
          mode === 'cover'
            ? `// A spot from above on a five-star cover: an oval pool, brightest just above the middle.
        vec2 sp = vec2(vPosMm.z / (vDims.z * 0.62), (vPosMm.y - vDims.y * 0.12) / (vDims.y * 0.62));
        float spot = vStar * uStarOn * (0.78 + 0.45 * (1.0 - smoothstep(0.35, 1.15, length(sp))));
        float facing = max(smoothstep(0.5, 0.92, vObjN.x), 0.35);`
            : `// A five-star spine lit from above, brightest towards the head.
        float spot = vStar * uStarOn * (0.9 + 0.3 * smoothstep(-0.5, 0.5, vPosMm.y / vDims.y));
        float facing = max(smoothstep(0.5, 0.92, vObjN.z), 0.4);`
        }
        totalEmissiveRadiance += diffuseColor.rgb * vec3(1.0, 0.92, 0.8) * (shelfLight + spot) * facing;`,
      );
  };
  mat.customProgramCacheKey = () => `book-v6-${mode}`;
  return mat;
}
