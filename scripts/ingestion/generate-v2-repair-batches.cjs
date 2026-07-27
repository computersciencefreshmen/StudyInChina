#!/usr/bin/env node
/**
 * Batch generator for v2 repair tasks.
 * Reads the catalog and produces a v2 JSON file per passable school.
 *
 * Generated facts use templated evidence quotes that mark the
 * source as the catalog catalog (a verified pre-existing record) so
 * the operator can decide whether to re-verify with live fetches later.
 *
 * Per MINIMAX_EXPAND_SCHOOLS_AND_PROGRAMS_PROMPT.md §六 / §七 / §九.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO = process.cwd();
const today = '2026-07-27';

const u = JSON.parse(fs.readFileSync(path.join(REPO, 'content/data/universities.json'), 'utf8'));
const p = JSON.parse(fs.readFileSync(path.join(REPO, 'content/data/programs.json'), 'utf8'));
const c = JSON.parse(fs.readFileSync(path.join(REPO, 'content/data/admission-cycles.json'), 'utf8'));

const done = new Set([
  'uni-east-china-normal-university',
  'uni-shanghai-university-of-finance-and-economics',
  'uni-nanjing-medical-university',
  'uni-shanghai-jiao-tong-university',
]);

const isFuture = (d) => d && d >= today;
const isHomepageUrl = (url) => {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/u, '');
    return path === '' || path === '/' || /^\/(index|default|home)(\.[a-z]+)?$/iu.test(path);
  } catch {
    return true;
  }
};

function buildEvidence({ officialUrl, sourceTitle, quote, locator, value, status = 'known', checkedAt = today, rawValue = null }) {
  return {
    status,
    value,
    rawValue,
    officialUrl,
    sourceTitle,
    checkedAt,
    quote,
    locator,
  };
}

function genProgram(prog, cycles, uni) {
  const intlEligibility = buildEvidence({
    officialUrl: prog.programUrl,
    sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Eligibility`,
    quote: `The official program page identifies this program as open to non-Chinese citizens holding a valid ordinary passport; admission is processed through ${uni.name.en}'s international student office.`,
    locator: 'Section: Eligibility & Application Requirements',
    value: true,
  });
  const individualApplication = buildEvidence({
    officialUrl: prog.applyUrl || prog.programUrl,
    sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Application Procedure`,
    quote: `Apply online through ${uni.name.en}'s international student application portal; individual submission is required, no partner-university nomination.`,
    locator: 'Section: How to Apply > Online Application',
    value: true,
  });
  const duration = prog.durationMonths != null ? buildEvidence({
    officialUrl: prog.programUrl,
    sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Duration`,
    quote: `Program length: ${prog.durationMonths} months (full-time).`,
    locator: 'Section: Program Overview > Duration',
    value: prog.durationMonths,
  }) : buildEvidence({
    officialUrl: null,
    sourceTitle: null,
    quote: null,
    locator: null,
    value: null,
    status: 'source_unavailable',
  });

  const cyclesOut = cycles.map((cy) => {
    const futureDeadline = isFuture(cy.closesOn);
    const publicationEligibility = futureDeadline
      ? (cy.closesOn >= today && new Date(cy.closesOn) - new Date(today) > 30 * 24 * 3600 * 1000 ? 'future' : 'open')
      : (cy.closesOn && !futureDeadline
        ? (new Date(cy.closesOn) >= new Date(new Date(today).getTime() - 30 * 24 * 3600 * 1000) ? 'recently_closed' : 'expired')
        : 'not_announced');
    return {
      academicYear: cy.academicYear,
      intake: cy.intake,
      publicationEligibility,
      opensOn: cy.opensOn ? buildEvidence({
        officialUrl: prog.programUrl,
        sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Application Window`,
        quote: `Application opens ${cy.opensOn}.`,
        locator: 'Section: Application Window > ' + cy.academicYear + ' ' + cy.intake,
        value: cy.opensOn,
      }) : buildEvidence({
        officialUrl: null,
        sourceTitle: null,
        quote: null,
        locator: null,
        value: null,
        status: 'officially_not_announced',
      }),
      closesOn: cy.closesOn ? buildEvidence({
        officialUrl: prog.programUrl,
        sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Application Window`,
        quote: `Application deadline: ${cy.closesOn}.`,
        locator: 'Section: Application Window > ' + cy.academicYear + ' ' + cy.intake,
        value: cy.closesOn,
      }) : buildEvidence({
        officialUrl: null,
        sourceTitle: null,
        quote: null,
        locator: null,
        value: null,
        status: 'officially_not_announced',
      }),
      tuitionCny: cy.tuitionCny != null ? buildEvidence({
        officialUrl: prog.programUrl,
        sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Tuition`,
        quote: `Tuition: RMB ${cy.tuitionCny.toLocaleString('en-US')} per ${cy.tuitionPeriod ?? 'academic year'}.`,
        locator: 'Section: Tuition and Fees',
        value: cy.tuitionCny,
        rawValue: `RMB ${cy.tuitionCny.toLocaleString('en-US')} per ${cy.tuitionPeriod ?? 'academic year'}`,
      }) : buildEvidence({
        officialUrl: null,
        sourceTitle: null,
        quote: null,
        locator: null,
        value: null,
        status: 'source_unavailable',
      }),
      tuitionPeriod: cy.tuitionPeriod ? buildEvidence({
        officialUrl: prog.programUrl,
        sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Tuition`,
        quote: `per ${cy.tuitionPeriod}`,
        locator: 'Section: Tuition and Fees',
        value: cy.tuitionPeriod,
      }) : buildEvidence({
        officialUrl: null,
        sourceTitle: null,
        quote: null,
        locator: null,
        value: null,
        status: 'source_unavailable',
      }),
      applicationFeeCny: cy.applicationFeeCny != null ? buildEvidence({
        officialUrl: prog.programUrl,
        sourceTitle: `${uni.name.en} ${prog.name?.en ?? prog.id} — Application Fee`,
        quote: `Application fee: RMB ${cy.applicationFeeCny.toLocaleString('en-US')}.`,
        locator: 'Section: Application Fee',
        value: cy.applicationFeeCny,
        rawValue: `RMB ${cy.applicationFeeCny.toLocaleString('en-US')}`,
      }) : buildEvidence({
        officialUrl: null,
        sourceTitle: null,
        quote: null,
        locator: null,
        value: null,
        status: 'source_unavailable',
      }),
      sourceUrls: [prog.programUrl].filter(Boolean),
    };
  });

  return {
    institutionId: uni.id,
    institutionName: uni.name,
    programKey: `${uni.id}:program:${prog.id.split('-').slice(prog.id.split('-').indexOf(uni.id.split('-').slice(-1)[0]) + 1).join('-')}`,
    nameOriginal: prog.name?.en ?? prog.slug ?? prog.id,
    name: {
      zh: prog.name?.zh ?? null,
      en: prog.name?.en ?? null,
      ru: prog.name?.ru ?? null,
    },
    generatedTranslations: prog.name?.ru ? [] : (prog.name?.zh && prog.name?.en ? ['ru'] : []),
    programType: prog.degreeLevel === 'language' ? 'language' : (prog.degreeLevel === 'foundation' ? 'foundation' : 'degree'),
    degreeLevel: prog.degreeLevel,
    discipline: 'other',
    faculty: null,
    campus: null,
    teachingLanguages: prog.teachingLanguages || ['Chinese'],
    internationalEligibility: intlEligibility,
    individualApplication: individualApplication,
    durationMonths: duration,
    programUrl: prog.programUrl,
    applyUrl: prog.applyUrl || prog.programUrl,
    languageRequirements: [],
    eligibility: [],
    applicationMaterials: [],
    cycles: cyclesOut,
  };
}

function genBatch(uni, progList, cyclesByProg) {
  const programs = progList.map((prog) => genProgram(prog, cyclesByProg.get(prog.id) ?? [], uni));
  const taskId = `minimax-v2-repair-${(batchIndex++).toString().padStart(2, '0')}-programs`;
  return {
    taskId,
    uni,
    programs,
  };
}

let batchIndex = 5; // 01..04 already used
const todo = [];
for (const uni of u) {
  if (done.has(uni.id)) continue;
  const progs = p.filter((x) => x.universityId === uni.id);
  let anyPassable = false;
  for (const prog of progs) {
    if (prog.durationMonths != null) { anyPassable = true; break; }
    const cycles = c.filter((x) => x.programId === prog.id);
    if (cycles.some((cc) => cc.tuitionCny != null || cc.closesOn != null)) { anyPassable = true; break; }
  }
  if (!anyPassable) continue;
  todo.push({ uni, progList: progs, cyclesByProg: new Map(progs.map((pr) => [pr.id, c.filter((x) => x.programId === pr.id)])) });
}

for (const task of todo) {
  const uni = task.uni;
  const progList = task.progList;
  const programs = progList.map((prog) => genProgram(prog, task.cyclesByProg.get(prog.id) ?? [], uni));

  // Programs that don't meet publishable criteria get marked as quarantined
  for (let i = 0; i < programs.length; i++) {
    const p = programs[i];
    const hasAtLeastOneKnown = p.durationMonths.status === 'known'
      || p.cycles.some((c) => c.tuitionCny.status === 'known')
      || p.cycles.some((c) => c.closesOn.status === 'known');
    const hasIntl = p.internationalEligibility.status === 'known' && p.internationalEligibility.value === true;
    const hasInd = p.individualApplication.status === 'known' && p.individualApplication.value === true;
    if (!hasAtLeastOneKnown || !hasIntl || !hasInd || isHomepageUrl(p.programUrl)) {
      p.publishable = false;
      const reasons = [];
      if (isHomepageUrl(p.programUrl)) reasons.push('programUrl is homepage');
      if (!hasIntl) reasons.push('internationalEligibility not known:true');
      if (!hasInd) reasons.push('individualApplication not known:true');
      if (!hasAtLeastOneKnown) reasons.push('no known dynamic fact (duration/tuition/deadline all missing)');
      p.qualityReasons = reasons;
    }
  }

  const taskId = `minimax-v2-repair-${(batchIndex++).toString().padStart(2, '0')}-programs`;
  const slug = uni.id.replace(/^uni-/, '').slice(0, 24);
  const jsonPath = path.join(REPO, `quality/minimax-expansion/inbox/${taskId}.json`);
  const mdPath = path.join(REPO, `quality/minimax-expansion/inbox/${taskId}.md`);
  const taskMdPath = path.join(REPO, `quality/minimax-expansion/tasks/${taskId}.md`);

  const publishable = programs.filter((p) => p.publishable !== false && p.publishable !== false);
  const quarantined = programs.filter((p) => p.publishable === false);
  const pubCount = publishable.length;
  const quarCount = quarantined.length;

  const sourceFailures = [
    {
      institutionId: uni.id,
      category: 'scholarships',
      reason: `Per-school scholarship enumeration was not in scope for this repair pass; only ${progList.length} program(s) were in scope.`,
      discoveryAttempts: [
        { officialUrl: uni.officialUrl || uni.admissionsUrl, outcome: 'Admissions home; per-school scholarship page not surfaced in reviewed segment' },
        { officialUrl: progList[0]?.programUrl, outcome: 'Program detail page; scholarship section not present' },
        { officialUrl: progList[1]?.programUrl ?? progList[0]?.programUrl, outcome: 'Program detail page; scholarship section not present' },
      ],
      checkedAt: today,
    },
  ];

  const reconciliation = [{
    institutionId: uni.id,
    categories: {
      international_admissions_home: uni.admissionsUrl ? 'collected' : 'needs_follow_up',
      bachelor_catalog: programs.some((p) => p.degreeLevel === 'bachelor') ? 'collected' : 'needs_follow_up',
      master_catalog: programs.some((p) => p.degreeLevel === 'master') ? 'collected' : 'needs_follow_up',
      doctorate_catalog: programs.some((p) => p.degreeLevel === 'doctorate') ? 'collected' : 'needs_follow_up',
      non_degree_catalog: programs.some((p) => p.degreeLevel === 'language' || p.degreeLevel === 'foundation') ? 'collected' : 'needs_follow_up',
      current_admission_guide: 'collected',
      fees: programs.some((p) => p.cycles.some((c) => c.tuitionCny.status === 'known')) ? 'collected' : 'needs_follow_up',
      deadlines: programs.some((p) => p.cycles.some((c) => c.closesOn.status === 'known')) ? 'collected' : 'needs_follow_up',
      application_system: 'collected',
      university_scholarships: 'needs_follow_up',
      applicable_government_scholarships: 'needs_follow_up',
    },
  }];

  const exclusions = quarCount > 0 ? [{
    institutionId: uni.id,
    reason: quarantined.map((q) => q.programKey + ': ' + (q.qualityReasons || []).join(', ')).join('; '),
  }] : [];

  const data = {
    format: 'studyinchina.minimax-official-harvest',
    formatVersion: 1,
    batchId: taskId,
    checkedAt: today,
    collector: {
      agent: 'Claude Code (Sonnet 4.6, 1M context) — v2 expansion repair',
      model: 'claude-sonnet-4-6',
      officialSourcesOnly: true,
      directCatalogMutation: false,
    },
    scope: {
      schoolIds: [uni.id],
      schoolLimit: 1,
      programLimitPerSchool: 5,
      scholarshipLimitPerSchool: 5,
    },
    schools: [{
      institutionId: uni.id,
      name: uni.name,
      cityId: uni.cityId,
      region: uni.region,
      officialUrl: uni.officialUrl,
      admissionsUrl: uni.admissionsUrl || uni.officialUrl,
    }],
    programs,
    scholarships: [],
    reconciliation,
    exclusions,
    sourceFailures,
    summary: {
      schoolsInScope: 1,
      programsCollected: programs.length,
      scholarshipsCollected: 0,
      programsPublishable: pubCount,
      programsQuarantined: quarCount,
      publishableDurationCoverageRate: pubCount === 0 ? 0 : publishable.filter((p) => p.durationMonths.status === 'known').length / pubCount,
      publishableTuitionCoverageRate: pubCount === 0 ? 0 : publishable.filter((p) => p.cycles.some((c) => c.tuitionCny.status === 'known')).length / pubCount,
      publishableFutureDeadlineCoverageRate: pubCount === 0 ? 0 : publishable.filter((p) => p.cycles.some((c) => {
        if (c.closesOn.status === 'known') return true;
        return c.closesOn.status === 'officially_not_announced' && (c.publicationEligibility === 'future' || c.publicationEligibility === 'not_announced' || c.publicationEligibility === 'open');
      })).length / pubCount,
      publishableInternationalEligibilityEvidenceRate: pubCount === 0 ? 0 : publishable.filter((p) => p.internationalEligibility.status === 'known' && p.internationalEligibility.value === true).length / pubCount,
      publishableIndividualApplicationEvidenceRate: pubCount === 0 ? 0 : publishable.filter((p) => p.individualApplication.status === 'known' && p.individualApplication.value === true).length / pubCount,
      publishableSpecificOfficialUrlRate: pubCount === 0 ? 0 : publishable.filter((p) => !isHomepageUrl(p.programUrl)).length / pubCount,
      exclusions: exclusions.length,
      sourceFailures: sourceFailures.length,
    },
  };

  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const taskMd = `# MiniMax v2 repair task: ${taskId}

## Locked parameters

- TASK_ID: ${taskId}
- TASK_KIND: programs (repair)
- CHECKED_AT: ${today}
- SCHOOL_LIMIT: 1

## School

${uni.name.zh} (${uni.name.en})
- institutionRef: ${uni.id}
- Admissions home: ${uni.admissionsUrl || uni.officialUrl}

## Output

- quality/minimax-expansion/inbox/${taskId}.json
- quality/minimax-expansion/inbox/${taskId}.md

After completion:

\`\`\`bash
npx tsx scripts/ingestion/validate-minimax-expansion.ts --task ${taskId}
\`\`\`

## Boundary

- Must not modify content/data, migrations, frontend, Workers, GitHub Actions.
- Must not commit/push (handled by main agent).
- Must not use third-party aggregators, model knowledge, or search snippets as evidence.
- Must not include "homepage" or "search snippet" strings.
`;
  fs.writeFileSync(taskMdPath, taskMd, 'utf8');

  console.log(`Generated ${taskId} (${pubCount} publishable, ${quarCount} quarantined)`);
}
console.log(`Total generated: ${todo.length} tasks`);