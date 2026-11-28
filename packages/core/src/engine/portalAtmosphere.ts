import * as THREE from 'three/webgpu';
import { abs, cameraPosition, dot, mix, modelPosition, modelWorldMatrix, normalize, smoothstep, vec4 } from 'three/tsl';

/**
 * Use the scene currently drawing the aperture, never the destination's fog.
 * Three supplies its Fog, FogExp2, or fogNode dynamically for each render pass,
 * including nested portals and slots reused after a room change.
 */
export function createPortalWindowMaterial(): THREE.MeshBasicNodeMaterial {
  const material = new THREE.MeshBasicNodeMaterial();
  material.fog = true;
  material.setupFog = function (builder, outputNode) {
    // NodeManager supplies fogNode at runtime; the installed NodeBuilder types
    // do not declare it yet.
    if (!('fogNode' in builder) || !builder.fogNode) return outputNode;

    // Keep the original colour before Three's fog shader writes to `output`.
    const clear = vec4(outputNode as THREE.Node<'vec4'>).toVar();
    const fogged = vec4(THREE.MeshBasicNodeMaterial.prototype.setupFog.call(this, builder, clear) as THREE.Node<'vec4'>);
    const planeNormal = normalize(modelWorldMatrix.mul(vec4(0, 0, 1, 0)).xyz);
    const planeDistance = abs(dot(cameraPosition.sub(modelPosition), planeNormal));
    // Negative fog.near (Reef) can leave haze even at zero distance. Clear the
    // opening before fillsView's 0.55 m direct-render handoff to avoid a pop.
    const atmosphere = smoothstep(0.6, 2, planeDistance);
    return vec4(mix(clear.rgb, fogged.rgb, atmosphere), clear.a);
  };
  return material;
}
