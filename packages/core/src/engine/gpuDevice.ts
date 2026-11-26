/**
 * Portalverse asks for the WebGPU device itself and gives the same device to Three.js
 * and to every room that brings its own renderer (`ctx.gpu`, `ctx.addGpuLayer`).
 * One device lets textures pass between engines without copies.
 *
 * The device gets every optional feature the adapter has, as Three.js would ask for,
 * and the larger limits other WebGPU engines tend to need (more storage buffers and
 * bigger buffers), capped to what the adapter offers.
 */
const RAISED_LIMITS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxStorageBuffersPerShaderStage',
  'maxSampledTexturesPerShaderStage',
  'maxStorageTexturesPerShaderStage',
  'maxColorAttachmentBytesPerSample',
  'maxComputeWorkgroupStorageSize',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupSizeX',
  'maxComputeWorkgroupSizeY',
  'maxInterStageShaderVariables',
] as const;

/** Resolves to null where WebGPU isn't available (Three.js then falls back to WebGL). */
export async function requestSharedDevice(): Promise<GPUDevice | null> {
  if (typeof navigator === 'undefined' || !navigator.gpu) return null;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    const requiredFeatures = [...adapter.features] as GPUFeatureName[];
    const requiredLimits: Record<string, number> = {};
    const limits = adapter.limits as unknown as Record<string, number>;
    for (const name of RAISED_LIMITS) {
      if (typeof limits[name] === 'number') requiredLimits[name] = limits[name];
    }
    return await adapter.requestDevice({ requiredFeatures, requiredLimits });
  } catch (error) {
    console.warn('Shared WebGPU device unavailable; Three.js will pick its own', error);
    return null;
  }
}
