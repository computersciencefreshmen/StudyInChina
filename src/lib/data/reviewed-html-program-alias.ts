/** Two individually reviewed identities, never a rule for removing suffixes.
 * Source hashes intentionally require a new review when the document changes. */
export const HTML_PROGRAM_ALIAS_RULE = 'html-two-school-degree-metadata-v1' as const
export const reviewedHtmlProgramAliasProfiles = [
  {
    recordId: 'prog-gap-wave8-gznu-tourism-management-master', universityId: 'uni-guizhou-normal-university',
    identitySha256: '2e59e17cda32a9fadcbf464550be93a5a23977cdd81796bdcead1a63e8458903',
    degreeLevel: 'master', programType: 'degree',
    oldNames: { en: "Tourism Management (Master's Program)", zh: '旅游管理硕士项目' },
    allowedNames: { en: 'Tourism Management', zh: '旅游管理' },
    sourceId: 'f657a8e5e24b05f49fed2ce8ef8b08f6cf939816fd4bf0cf7f9196cf435ae542',
    sourceUrl: 'https://sie.gznu.edu.cn/info/1771/89695.htm',
    rawSha256: '5ec1b54edfb244118c6aeceda1a0a5867b0b87268eb857c72e3e6f6b8b48e4a1',
    textSha256: '214172c5167613594f86f06dc4131a082996e8ca4a6242e2b91c3cce095ad125',
    origin: { candidateId: 'wave8-gznu-tourism-management-master',
      firstImportCommit: 'd43794fc40466adfb9efd162f223a93aebd6c740',
      programsGitBlob: 'f16785edaf128b1ca97d595b780f69517b75714b',
      originalFile: 'quality/official-gap-wave-2026-08-02/wave8-singletons-south-east.json',
      packSha256: '45d4e45ad9ebf481170daba2b4be7cee92a2ae628f08c3e9b25c68208b93222a',
      candidateSha256: '578cbc68f4ca18dd4b40de7279cf8e3fba3749ad7d904a6c49497a01eaa642da',
      firstRecordSha256: 'b683305f0fefece34dea339227c6c4261bf028eddb258a8785f5f4dad984a531' },
    quotes: { zh: '1.资助类别:旅游管理专业硕士研究生',
      en: '1. Scholarship Category: Master’s Program in Tourism Management',
      degree: '1.资助类别:旅游管理专业硕士研究生', international: '优秀国际学生到校学习', institution: '贵州师范大学国际教育学院' },
    sameUrlNeighbours: [],
  },
  {
    recordId: 'prog-gap-wave8-shzu-energy-power-master', universityId: 'uni-shihezi-university',
    identitySha256: 'a77e6323f9fe3de082d9c95c303cff6bb6f12b9e9fd1f73643895f24bf9d9e81',
    degreeLevel: 'master', programType: 'degree',
    oldNames: { en: "Energy and Power Engineering (Master's Program)", zh: '能源动力硕士项目' },
    allowedNames: { zh: '能源动力' },
    sourceId: 'abb9f5e3b41e79abe263f122fdf62ef4b0d5cc4d1cd429a41736626e96847685',
    sourceUrl: 'https://ncxy.shzu.edu.cn/2026/0323/c13505a229944/page.htm',
    rawSha256: 'fcf7968432a81e41a84ef7e4dd14993557164e40e5c6ec2b42cba3abe0e0f9a5',
    textSha256: '9e959b31876b0aa37fbbab86101a46cc307d8d592d62b30e6539dab49697b171',
    origin: { candidateId: 'wave8-shzu-energy-power-master',
      firstImportCommit: 'd43794fc40466adfb9efd162f223a93aebd6c740',
      programsGitBlob: 'f16785edaf128b1ca97d595b780f69517b75714b',
      originalFile: 'quality/official-gap-wave-2026-08-02/wave8-singletons-north-west.json',
      packSha256: '0f6eae68b533638520b985c14ec8623d9a0faf187cf5cd979307d63501ab113b',
      candidateSha256: 'a99554cf97f5e34b33167ddc81312330a08fd1fe2005f70db831f829c6203230',
      firstRecordSha256: 'abf1aceaa5d7f6a178b54c685463bc500db5af731005809d04c90afbf4929a4d' },
    quotes: { zh: '其中, 3 人报考能源动力专业, 2 人报考储能技术专业;',
      degree: '石河子大学能源与材料学院首次组织开展来华留学生硕士研究生招生面试',
      international: '来自巴基斯坦的 6 名学生参加了考核。', institution: '石河子大学能源与材料学院' },
    sameUrlNeighbours: [{ recordId: 'prog-gap-wave8-shzu-energy-storage-technology-master',
      identitySha256: 'fe49d0a91790bf393b8668d2cfae87342be8b55928cd4340d4d6f7b40f0dfcb4',
      distinctLiteral: '储能技术', quote: '其中, 3 人报考能源动力专业, 2 人报考储能技术专业;' }],
  },
] as const

export function reviewedHtmlAliasProfile(recordId: string) {
  return reviewedHtmlProgramAliasProfiles.find(profile => profile.recordId === recordId)
}
