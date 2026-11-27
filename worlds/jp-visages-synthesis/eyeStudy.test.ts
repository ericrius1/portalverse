import { describe, expect, it } from 'vitest';
import { EYE_STUDY_HEADS, EYE_STUDY_KEY, EYE_STUDY_LABELS, eyeStudyCollider } from './eyeStudy';
import { buildVisageSynthesisPlan, createVisageCollider } from './layout';

describe('blind eye study', () => {
  it('uses every eye treatment once with anonymous labels and identical face treatments', () => {
    expect(new Set(EYE_STUDY_KEY).size).toBe(4);
    expect(EYE_STUDY_LABELS).toEqual(['A', 'B', 'C', 'D']);
    const treatments = EYE_STUDY_HEADS.map(h => [h.y, h.z, h.yaw, h.scale, h.seed, h.weeping, h.crackAngle, h.crackDensity]);
    for (const treatment of treatments) expect(treatment).toEqual(treatments[0]);
    for (let i = 1; i < EYE_STUDY_HEADS.length; i++) {
      expect(EYE_STUDY_HEADS[i].x - EYE_STUDY_HEADS[i - 1].x).toBe(8);
    }
  });

  it('keeps the route between the portals open while protecting comparison heads and plinths', () => {
    const plan = buildVisageSynthesisPlan();
    const collider = eyeStudyCollider(createVisageCollider(plan.heads, plan.pillars));
    for (let z = -36.25; z <= 36.25; z += 0.5) {
      expect(collider.move([0, 0, z + 0.5], [0, 0, z], 0.45, 1.7)).toEqual([0, z]);
    }
    for (const h of EYE_STUDY_HEADS) {
      const [x, z] = collider.move([h.x, 0, h.z + 5], [h.x, 0, h.z], 0.45, 1.7);
      expect(Math.max(Math.abs(x - h.x), Math.abs(z - h.z))).toBeGreaterThanOrEqual(h.colliderRadius + 0.44);
    }
  });
});
