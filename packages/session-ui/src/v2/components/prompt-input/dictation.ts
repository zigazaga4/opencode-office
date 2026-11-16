// Dictare vocala (voce -> text) pentru caseta de mesaj, pe Web Speech API.
// Logica e separata de interfata: butonul din prompt-input doar o foloseste.

export type DictationLanguage = { code: string; label: string; name: string }

export const DICTATION_LANGUAGES: readonly DictationLanguage[] = [
  { code: "ro-RO", label: "RO", name: "Română" },
  { code: "en-US", label: "EN", name: "English" },
]
export const DICTATION_LANGUAGE_KEY = "opencode.dictation.language"

/** Erori dupa care dictarea nu mai are sens sa fie reluata. */
export const DICTATION_FATAL_ERRORS = [
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
  "language-not-supported",
  "network",
] as const
export type DictationFatalError = (typeof DICTATION_FATAL_ERRORS)[number]

export function isFatalDictationError(code: string): code is DictationFatalError {
  return (DICTATION_FATAL_ERRORS as readonly string[]).includes(code)
}

// Tipurile minime ale Web Speech API (nu sunt in toate versiunile de lib.dom).
type SpeechAlternative = { transcript: string }
type SpeechResult = { readonly isFinal: boolean; readonly 0: SpeechAlternative }
export type SpeechResultEvent = { resultIndex: number; results: ArrayLike<SpeechResult> }
export type SpeechErrorEvent = { error: string }
export type SpeechRecognitionLike = {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: SpeechResultEvent) => void) | null
  onerror: ((event: SpeechErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}
export type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

export function speechRecognitionConstructor(scope: object = globalThis): SpeechRecognitionConstructor | undefined {
  const source = scope as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
  return source.SpeechRecognition ?? source.webkitSpeechRecognition
}

export function dictationLanguage(storage?: Pick<Storage, "getItem">): DictationLanguage {
  const saved = storage?.getItem(DICTATION_LANGUAGE_KEY)
  return DICTATION_LANGUAGES.find((item) => item.code === saved) ?? DICTATION_LANGUAGES[0]
}

export function nextDictationLanguage(current: string): DictationLanguage {
  const index = DICTATION_LANGUAGES.findIndex((item) => item.code === current)
  return DICTATION_LANGUAGES[(index + 1) % DICTATION_LANGUAGES.length]
}

/** Adauga un spatiu in fata textului dictat daca ce e deja scris nu se termina cu spatiu. */
export function spacedDictationText(before: string, text: string) {
  return before && !/\s$/.test(before) && !/^\s/.test(text) ? ` ${text}` : text
}

export type DictationOptions = {
  /** Limba curenta (cod BCP 47, ex. "ro-RO"); citita la fiecare pornire a unei sesiuni. */
  language: () => string
  /** Text final recunoscut. */
  onText: (text: string) => void
  /** Text provizoriu, inca neconfirmat (gol cand nu e nimic). */
  onInterim: (text: string) => void
  onListening: (listening: boolean) => void
  /** Cod de eroare pentru care dictarea s-a oprit. */
  onError: (code: DictationFatalError) => void
  recognition?: SpeechRecognitionConstructor
  now?: () => number
  restartDelayMs?: number
}

export type Dictation = {
  readonly supported: boolean
  readonly listening: () => boolean
  start(): void
  stop(): void
  toggle(): void
  /** Aplica limba noua: sesiunea curenta se opreste si se reia imediat. */
  restart(): void
}

const QUICK_END_MS = 1000
const MAX_QUICK_ENDS = 3

export function createDictation(options: DictationOptions): Dictation {
  const Recognition = options.recognition ?? speechRecognitionConstructor()
  const now = options.now ?? Date.now
  const restartDelay = options.restartDelayMs ?? 150
  let current: SpeechRecognitionLike | undefined
  let wanted = false
  let restartNow = false
  let quickEnds = 0
  let startedAt = 0

  const setWanted = (value: boolean) => {
    wanted = value
    options.onListening(value)
    if (!value) options.onInterim("")
  }

  const begin = () => {
    if (!Recognition) return
    const session = new Recognition()
    session.lang = options.language()
    session.continuous = true
    session.interimResults = true
    session.maxAlternatives = 1
    session.onresult = (event) => {
      let interim = ""
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index]
        const piece = result[0].transcript
        if (!result.isFinal) interim += piece
        else if (piece.trim()) options.onText(piece.trim())
      }
      options.onInterim(interim)
    }
    session.onerror = (event) => {
      if (!isFatalDictationError(event.error)) return
      setWanted(false)
      options.onError(event.error)
    }
    session.onend = () => {
      // Sesiune oprita de utilizator sau inlocuita de una noua: nu se reia.
      if (!wanted || current !== session) return
      if (restartNow) {
        restartNow = false
        quickEnds = 0
      } else {
        // Browserul inchide singur sesiunea dupa tacere: o reluam, dar nu la nesfarsit daca se opreste imediat.
        quickEnds = now() - startedAt < QUICK_END_MS ? quickEnds + 1 : 0
        if (quickEnds >= MAX_QUICK_ENDS) {
          setWanted(false)
          options.onError("network")
          return
        }
      }
      setTimeout(() => {
        if (wanted) begin()
      }, restartDelay)
    }
    current = session
    startedAt = now()
    try {
      session.start()
    } catch {
      // deja pornita
    }
  }

  const stopSession = () => {
    const session = current
    current = undefined
    try {
      session?.stop()
    } catch {
      // deja oprita
    }
  }

  const start = () => {
    if (!Recognition || wanted) return
    quickEnds = 0
    restartNow = false
    setWanted(true)
    begin()
  }
  const stop = () => {
    if (!wanted) return
    restartNow = false
    setWanted(false)
    stopSession()
  }

  return {
    supported: !!Recognition,
    listening: () => wanted,
    start,
    stop,
    toggle: () => (wanted ? stop() : start()),
    restart() {
      if (!wanted || !current) return
      restartNow = true
      try {
        current.stop()
      } catch {
        // deja oprita
      }
    },
  }
}

/**
 * Insereaza text la cursor in caseta de mesaj (sau la sfarsit daca cursorul e in afara ei).
 * Foloseste acelasi mecanism ca lipirea din clipboard, deci caseta reactioneaza ca la tastare.
 */
export function insertDictatedText(editor: HTMLElement, text: string) {
  if (!text) return false
  editor.focus()
  const selection = window.getSelection()
  if (!selection) return false
  if (!selection.rangeCount || !editor.contains(selection.anchorNode)) {
    const end = document.createRange()
    end.selectNodeContents(editor)
    end.collapse(false)
    selection.removeAllRanges()
    selection.addRange(end)
  }
  const before = document.createRange()
  before.selectNodeContents(editor)
  before.setEnd(selection.anchorNode!, selection.anchorOffset)
  const inserted = spacedDictationText(before.toString(), text)
  return document.execCommand("insertText", false, inserted)
}
