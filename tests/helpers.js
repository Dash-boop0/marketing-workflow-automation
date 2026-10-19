import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
export const loadRules = () => JSON.parse(read('config/rules.json'));
export const sampleCsv = () => read('sample-data/leads.csv');
export const FIXED_NOW = () => '2026-10-20T09:00:00.000Z';
export const HEADER = 'first_name,last_name,email,phone,company,job_title,company_size,country,source,created_at,opt_in,notes';
