import { describe, expect, it } from 'vitest';
// @ts-expect-error Deployment utilities are standalone JavaScript.
import { verifyReport } from '../deploy/demo/security-gate.mjs';

describe('demo supply-chain gate', () => {
  const inventory = { bomFormat: 'CycloneDX', components: [{ name: 'fixture' }] };
  it('accepts a populated inventory with no findings or low/medium findings', () => {
    expect(() => verifyReport(inventory)).not.toThrow();
    expect(() => verifyReport({ ...inventory, vulnerabilities: [{ ratings: [{ severity: 'medium' }] }] })).not.toThrow();
  });
  it('fails closed on absent inventory, malformed reports, unrated or blocked findings', () => {
    for (const report of [{}, { ...inventory, components: [] }, { ...inventory, vulnerabilities: {} }, ...['HIGH', 'critical', 'unknown', 'other'].map(severity => ({ ...inventory, vulnerabilities: [{ ratings: [{ severity }] }] })), { ...inventory, vulnerabilities: [{ ratings: [] }] }]) {
      expect(() => verifyReport(report)).toThrow();
    }
  });
});
