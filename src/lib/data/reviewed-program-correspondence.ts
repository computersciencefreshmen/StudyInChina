/** Individually reviewed correspondences, never a general name normalizer.
 * Source changes require a new review. No date or application condition is here. */
export const PROGRAM_CORRESPONDENCE_RULE = 'two-master-official-correspondence-v1' as const
export const reviewedProgramCorrespondenceProfiles = [
  {
    recordId: 'prog-gap-mew-csw-ccnu-international-chinese-education-master', universityId: 'uni-central-china-normal-university',
    identitySha256: 'dec2912eca5f61acfde51ffbb4fd65fb30a4fe45da674d9d5341842bec572e6d',
    oldNames: { en: 'International Chinese Language Education', zh: '国际中文教育' },
    verifiedName: { zh: '汉语国际教育' }, degreeLevel: 'master', programType: 'degree',
    existingProgramUrl: 'https://cice.ccnu.edu.cn/lhl_/gjzwjsjxj.htm',
    sourceUrl: 'https://www.ccnu.edu.cn/jzlm/jyjx/gjxsjy.htm',
    sourceId: '060450955177a6ca5f955053ff9a4c439dbf85945f746184c8382bf6d38f9933',
    rawSha256: 'cb15dd21eb11022ca09f6b92c5e380e99e173089dbac70a3eec5e32061e2d577',
    textSha256: '56e741d048c81eb9848c72988772b7ef98a4470bc3bedcabcd42b0812d97c0ea',
    parser: 'html', physicalPages: null, nativeProofSha256: null,
    correspondence: 'explicit_national_master_category_rename',
    quotes: {
      name: '汉语国际教育硕士专业',
      degree: '国际文化交流学院开设汉语言(含商务汉语和对外汉语教学方向)本科专业及汉语国际教育硕士专业,同时承担其他院系学历生的语言课程。',
      international: '国际文化交流学院专门负责来华留学生(包括本科生、硕士与博士研究生、博士后、访问学者)招生与管理',
      institution: '华中师范大学国际学生教育简介',
    },
    authority: {
      url: 'https://icle.chinese.cn/news/detail/33',
      rawSha256: 'a10b917cfca6496067ab91913f231df4bd1258bb158e6a802eaf4887cb896848',
      textSha256: '409d3d1c2e5a8139e829b8563e7315f811dd9d5b116b789c7a29e4c8c569b523',
      quote: '原“汉语国际教育”专业学位类别更名为“国际中文教育”专业学位类别(代码0453)',
      categoryCodeIsNotInstitutionProgrammeCode: true,
    },
    originalModel: {
      proposalSha256: '81f44aa2ff41049eb5f817716895b4cc39ec68efb678d390bf869ab2b1bedc70',
      attemptsSha256: '35025f0eb0c02f1a3f7f150f3630fab8250b1ffc42d7bb433340f3ede2236f29',
      reviewSha256: '431848ee4ba73442cf68cf8d552eb725b0f656c176be9bf0fc62e5b5242f454b',
      originalName: '汉语国际教育硕士专业',
    },
  },
  {
    recordId: 'prog-gap-breadth-jnmc-m-pharmacy', universityId: 'uni-jining-medical-university',
    identitySha256: '2214221e1e1e3436149f9d16841d0c098d027d2b4057e6292991ad8926921314',
    oldNames: { en: "Pharmacy (Professional Master's)", zh: '药学专业型硕士' },
    verifiedName: { zh: '药学' }, degreeLevel: 'master', programType: 'degree',
    existingProgramUrl: 'https://gjjyxy.jnmc.edu.cn/_upload/article/files/15/9f/3eb11e1e4b838ed918844868957c/a09ea7f0-c3b1-40d8-9316-ec987c854c05.pdf',
    sourceUrl: 'https://gjjyxy.jnmc.edu.cn/_upload/article/files/15/9f/3eb11e1e4b838ed918844868957c/a09ea7f0-c3b1-40d8-9316-ec987c854c05.pdf',
    sourceId: 'e7b5aef41f54406d9d8d73c4e03aa9403d5b3f93eb31ec4ff840423a1c789dcf',
    rawSha256: '1f1f9819676d148caef3a9c07d4b7983a24753969bfbc962e48ddb94ed237e78',
    textSha256: 'e93cd44035ba790f56cff16e359b9cbaaa4ff6cc5e25720370c4b79c2305395e',
    parser: 'poppler', physicalPages: 7,
    nativeProofSha256: '8599d907bc40c32fb07f70f69d204dca5ce59c5514a7523b5358dd6dc91a07dc',
    correspondence: 'exact_subject_plus_professional_master_qualification',
    quotes: {
      name: '二、招收专业 专业:临床医学、公共卫生、药学 层次:全日制专业型硕士研究生',
      degree: '二、招收专业 专业:临床医学、公共卫生、药学 层次:全日制专业型硕士研究生',
      international: '申请人为持有外国护照的非中国籍公民',
      institution: '济宁医学院 2026 年来华留学生硕士研究生 招生简章',
    },
    authority: null, originalModel: null,
  },
] as const

export function reviewedProgramCorrespondenceProfile(recordId: string) {
  return reviewedProgramCorrespondenceProfiles.find(profile => profile.recordId === recordId)
}
