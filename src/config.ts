/** Prefilled in the phone form; set VITE_T3_SERVER in .env.local to change it. */
export const DEFAULT_SERVER: string = import.meta.env?.VITE_T3_SERVER ?? ''

export const MAX_RECORD_MS = 60_000

export const DEFAULT_VOICE_PROMPT =
  'Voice message from my Even G2 glasses (WAV attached). Transcribe it locally, e.g. whisper-cli with ' +
  '~/.cache/whisper-models, and treat it as my message. If you cannot transcribe, say what is missing in one line. ' +
  'Reply briefly.'

/** Earlier defaults: a saved prompt equal to one of these is upgraded to the current default. */
export const OLD_VOICE_PROMPTS = [
  'Voice message from my Even G2 glasses, attached as a 16 kHz mono WAV file. ' +
    'Transcribe it on this machine with whatever speech-to-text is available ' +
    '(for example whisper-cli with a model from ~/.cache/whisper-models, or ffmpeg plus a Python whisper package), ' +
    'then treat the transcript as my message and act on it as if I had typed it. ' +
    'If nothing here can transcribe audio, reply in one short line saying what is missing and do nothing else. ' +
    'Keep replies short: I read them on a 576x288 display.',
]

/**
 * Addresses to look for T3 servers at, so other machines show up without typing a URL.
 * Comma-separated origins in VITE_T3_CANDIDATES, e.g. your tailnet addresses.
 */
export const CANDIDATE_ORIGINS: string[] = (import.meta.env?.VITE_T3_CANDIDATES ?? '')
  .split(',')
  .map((value: string) => value.trim().replace(/\/+$/, ''))
  .filter(Boolean)
