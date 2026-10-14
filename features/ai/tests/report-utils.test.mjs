import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { summarizeReport, retainRuns } from '../eval/report-utils.mjs';

describe('evaluation acceptance',()=>{
  it('reproduces the frozen failures and refuses subsets, duplicate coverage and incomplete retention',async()=>{
    const {reports}=JSON.parse(await readFile(new URL('../eval/fixtures/baseline.json',import.meta.url),'utf8'));
    expect(reports.map(r=>summarizeReport(r).summary.plansPassed)).toEqual([28,35,46,44]);
    expect(reports.map(r=>summarizeReport(r).summary.executableNegativeDrafts)).toEqual([0,0,1,3]);
    expect(reports.every(r=>!summarizeReport(r).acceptance.passed)).toBe(true);
    const partial=structuredClone(reports[0]);partial.runs=partial.runs.slice(0,1);partial.runs[0].results=partial.runs[0].results.slice(0,1);
    Object.assign(partial.runs[0].results[0],{passed:true,planPassed:true,ledgerPassed:true});
    expect(summarizeReport(partial).acceptance.passed).toBe(false);
    const wrongDraft=structuredClone(reports[0]);Object.assign(wrongDraft.runs[0].results[0],{planPassed:false,ledgerPassed:true});
    expect(summarizeReport(wrongDraft).summary.plansPassed).toBe(27);
    expect(summarizeReport(wrongDraft).summary.ledgersPassed).toBe(28);
    const duplicate=structuredClone(reports[0]);duplicate.runs[0].results[1]=duplicate.runs[0].results[0];
    expect(summarizeReport(duplicate).acceptance.coverageComplete).toBe(false);
    const mixedModel=structuredClone(reports[0]);mixedModel.runs[1].model.modelId='other-model';
    expect(summarizeReport(mixedModel).acceptance.configurationConsistent).toBe(false);
    const interrupted=structuredClone(reports[0]);interrupted.runs[1].done=false;interrupted.fatal='Detached frame';
    expect(()=>retainRuns(interrupted,[1])).toThrow('incomplete');
    const retained=retainRuns(interrupted,[0,2]);
    expect(retained.runs).toHaveLength(2);expect(retained.provenance.originalFatal).toBe('Detached frame');
    expect(retained.acceptance.repetitionRequirementMet).toBe(false);
  });
});
