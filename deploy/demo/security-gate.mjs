import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function verifyReport(report) {
  if (report?.bomFormat !== 'CycloneDX' || !Array.isArray(report.components) || !report.components.length) throw new Error('Missing or invalid SBOM inventory');
  if (report.vulnerabilities !== undefined && !Array.isArray(report.vulnerabilities)) throw new Error('Malformed vulnerability report');
  for (const finding of report.vulnerabilities ?? []) {
    if (!Array.isArray(finding.ratings) || !finding.ratings.length) throw new Error('Unrated vulnerability blocks deployment');
    if (finding.ratings.some(r => typeof r.severity !== 'string' || !['none', 'low', 'medium'].includes(r.severity.toLowerCase()))) {
      throw new Error('High, critical, unknown or unrecognized vulnerability severity blocks deployment');
    }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const file of process.argv.slice(2)) verifyReport(JSON.parse(await readFile(file, 'utf8')));
  if (process.argv.length < 3) throw new Error('At least one security report is required');
  console.log('Security policy passed');
}
