const universitySlugAliases: Readonly<Record<string, string>> = {
  'beijing-language-university': 'beijing-language-and-culture-university',
}

export function canonicalUniversitySlug(slug: string): string {
  return universitySlugAliases[slug] ?? slug
}
