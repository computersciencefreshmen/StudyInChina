declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { contentType?: string })
    readonly window: {
      readonly document: Document
    }
  }
}
