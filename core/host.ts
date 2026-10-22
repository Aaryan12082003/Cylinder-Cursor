export type SaveRequest = {
  title: string
  defaultName: string
  extension: 'pdf' | 'xlsx'
  bytes: Uint8Array
}

export type Host = {
  pickDirectory: (title: string) => Promise<string | null>
  pickOpenFile: (title: string, extensions: string[]) => Promise<string | null>
  saveBytes: (request: SaveRequest) => Promise<string | null>
  chooseLogo: () => Promise<string | null>
  notify: (title: string, body: string) => void
}
