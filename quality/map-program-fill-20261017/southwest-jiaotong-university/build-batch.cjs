const fs=require('node:fs');
const directory='quality/map-program-fill-20261017/southwest-jiaotong-university';
const capture=JSON.parse(fs.readFileSync(directory+'/captures/language-2027-notice.receipt.json'));
const sourceId='source-swjtu-language-2027-official-20261017';
const L=(en,zh)=>({en,zh});
const audit={sourceIds:[sourceId],verifiedAt:'2026-10-17',reviewAfter:'2026-10-24',status:'verified'};
const materials=[
 L('Passport identity page; the notice requires validity beyond September 2027. Renew the passport before applying if necessary.','护照首页；简章要求有效期晚于2027年9月，不符合时先换发护照。'),
 L('Notarized academic certificate and academic transcripts; provide notarized Chinese or English translations when necessary.','经公证的学历证明及成绩单；非中英文文件须提供经公证译文。'),
 L('Complete Foreigner Physical Examination Form in English, with the doctor signature, hospital seal and stamped photo; retain the original. Results are valid for six months.','英文填写且检查项目完整的外国人体格检查表，须有医生签名、医院公章及盖章照片；保留原件，体检结果有效期6个月。'),
 L('Bank statement, deposit certificate or signed sponsor statement covering tuition and living expenses in China.','足以承担在华学费和生活费的银行对账单、存款证明或担保人签署的资助证明。'),
 L('Valid non-criminal record issued by the local public security authority, normally within six months before the application.','所在地公安机关出具的有效无犯罪记录证明，通常应在申请日前6个月以内开具。'),
 L('Applicants under 18 must provide legal documents for an entrusted guardian in China. Applicants already in China must also provide their current visa or residence-permit page.','未满18周岁须提供在华委托监护法律文件；已在中国者另须提供现持签证或居留许可页。'),
 L('Upload clear, genuine and valid documents through the online system. Email and paper applications are not accepted.','材料须清晰、真实、有效并通过系统上传；不接受邮件或纸质申请。'),
];
const eligibility=[
 L('Non-Chinese citizen aged 17–50, in good physical and mental health, with no illegal or disciplinary record; comply with Chinese law and university rules.','非中国籍、17—50周岁，身心健康，无违法违纪记录，并遵守中国法律法规及校规。'),
 L('Able to fund study and living costs in China. The notice requests an academic certificate but does not specify a minimum qualification level.','能够承担在华学习和生活费用。简章要求学历证明，但未明确最低学历等级。'),
 L('Class level is assigned using an entry test. HSK3 and HSK4/5 are the stated learning goals for elementary and intermediate classes, rather than published entrance-score thresholds.','学校依入学测试安排班级。初级HSK3、中级HSK4/5属于学习目标，并非简章公布的入学分数门槛。'),
];
const notes=L('Spring 2027: the notice publishes 1 January 2027 as the application end date and also says to complete the online application before that date; apply early and confirm the exact cutoff with the university. An exact opening date is not supplied. The spring term is March–July; elementary study lasts two semesters and intermediate study one semester. Application fee CNY400 is non-refundable and payable after preliminary qualification review. Tuition is CNY7000/semester or CNY14000/academic year; all fees become non-refundable once courses start. Insurance is CNY1000/year; the advertised Xipu double-room accommodation is CNY365/month excluding utilities, subject to availability. The entry test determines placement; the notice does not state a mandatory HSK admission score. The school calls this its 2027 guide; the site groups spring 2027 under the 2026–2027 academic-year filter.','2027年春季简章公布报名截止为2027年1月1日，另要求在该日前完成网上申请；请提前报名并向学校确认精确截止时点，简章未给出明确起报日期。春季学期为3—7月；初级2学期，中级1学期。初审合格后缴400元报名费且不退。学费每学期7000元、每学年14000元；课程开始后所有费用不退。保险1000元/年；犀浦校区双人间标价365元/月，不含水电且以房源为准。班级依入学测试确定，简章未公布必须达到的入学HSK分数。学校称“2027学年”简章，本站按春季入学将该批次归入2026—2027学年筛选。');
const quote={
 name:'西南交通大学的语言生项目专注于汉语学习和中国文化体验。',
 degreeLevel:'西南交通大学的语言生项目专注于汉语学习和中国文化体验。',
 teachingLanguages:'1. 授课语言：英文+中文',
 durationText:'初级班：2学期；中级班：1学期',
 applyUrl:'西南交通大学：https://admission.swjtu.edu.cn',
 languageRequirements:'学生根据入学测试结果参加相应层级的班级学习。',
 eligibility:'2. 申请人年龄需17-50周岁；',
 applicationMaterials:'2. 经公证的学历证明Notarized academic certificate.',
 closesOn:'春季入学申请即日起至2027年1月1日；秋季入学申请从2027年3月1日起至2027年6月30日。',
 tuitionCny:'c.学费：7000元/人/学期，14000元/人/学年',
 tuitionPeriod:'c.学费：7000元/人/学期，14000元/人/学年',
 tuitionSchedule:'c.学费：7000元/人/学期，14000元/人/学年',
 applicationFeeCny:'a.报名费：400元/人',
};
const entries=[['elementary','Elementary Chinese Language Programme','汉语进修（初级班）','Two semesters','2学期'],['intermediate','Intermediate Chinese Language Programme','汉语进修（中级班）','One semester','1学期']].map(([key,en,zh,dEn,dZh])=>{
 const id='program-southwest-jiaotong-university-chinese-language-'+key;
 return {program:{...audit,id,slug:'southwest-jiaotong-university-chinese-language-'+key,universityId:'uni-southwest-jiaotong-university',name:L(en,zh),degreeLevel:'language',discipline:'chinese-education',teachingLanguages:['English','Chinese'],durationMonths:null,durationMonthsMax:null,durationText:L(dEn,dZh),programUrl:capture.url,applyUrl:'https://admission.swjtu.edu.cn',languageRequirements:[{test:'other',minimum:'Class placement follows the university entry test. The published HSK3 / HSK4–5 levels are learning goals; no mandatory HSK entrance score is specified.'}],verificationScope:'facts',supplementaryDetails:{faculty:L('School of International Education','国际教育学院'),languagePolicy:L('The official notice explicitly lists English and Chinese as teaching languages.','官方简章明确列为英文及中文授课。'),eligibility,applicationMaterials:materials}},
 cycle:{...audit,id:'cycle-swjtu-chinese-'+key+'-2027-spring',programId:id,academicYear:'2026-2027',intake:'spring',opensOn:null,closesOn:'2027-01-01',dateStatus:'published',tuitionCny:7000,tuitionPeriod:'semester',tuitionStatus:'confirmed',tuitionSchedule:L('CNY 7,000 per semester; CNY 14,000 per academic year','每学期7000元；每学年14000元'),applicationFeeCny:400,evidenceBasis:'cycle-specific',factScope:'complete',notes},
 evidence:Object.entries(quote).map(([field,value])=>({field,sourceId,quote:value,locator:'2027 guide and its inline application-document appendix',...(field==='degreeLevel'?{derivation:'Language-student training classified as non-degree language programme; no academic degree is claimed.'}:{} )})),reviewer:'pending-independent-review',reviewedAt:null,notes:'Prepared from the fresh complete official 2027 notice. Independent semantic review is still required; do not apply this draft.'};
});
const batch={schemaVersion:1,batchId:'swjtu-2027-spring-language-reviewed-20261017-v1',sources:[{id:sourceId,url:capture.url,title:'西南交通大学2027学年语言生项目招生简章',publisher:'Southwest Jiaotong University',kind:'admissions',language:'zh',official:true,accessedAt:'2026-10-17'}],captures:[{sourceId,url:capture.url,rawPath:capture.rawPath,rawSha256:capture.rawSha256,textPath:capture.textPath,textSha256:capture.textSha256,retrievedAt:capture.retrievedAt,httpStatus:capture.httpStatus}],entries};
fs.writeFileSync(directory+'/full-program-batch-draft.json',JSON.stringify(batch,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({draftEntries:entries.length,independentReviewPending:true}));
