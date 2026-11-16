import { describe, expect, test } from "bun:test"
import {
  createDictation,
  dictationLanguage,
  isFatalDictationError,
  nextDictationLanguage,
  spacedDictationText,
  speechRecognitionConstructor,
  type SpeechRecognitionLike,
} from "./dictation"

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = []
  lang = ""
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: SpeechRecognitionLike["onresult"] = null
  onerror: SpeechRecognitionLike["onerror"] = null
  onend: SpeechRecognitionLike["onend"] = null
  started = false
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    this.started = true
  }
  stop() {
    this.started = false
    queueMicrotask(() => this.onend?.())
  }
  say(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: text }], { isFinal }) as never] })
  }
}

function setup(language = "ro-RO", now = () => 0) {
  FakeRecognition.instances = []
  const log = { text: [] as string[], interim: [] as string[], listening: [] as boolean[], errors: [] as string[] }
  const lang = { value: language }
  const dictation = createDictation({
    language: () => lang.value,
    onText: (text) => log.text.push(text),
    onInterim: (text) => log.interim.push(text),
    onListening: (on) => log.listening.push(on),
    onError: (code) => log.errors.push(code),
    recognition: FakeRecognition,
    restartDelayMs: 0,
    now,
  })
  return { dictation, log, lang }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 5))

describe("limba dictarii", () => {
  test("implicit romana, chiar si cu valoare salvata necunoscuta", () => {
    expect(dictationLanguage().code).toBe("ro-RO")
    expect(dictationLanguage({ getItem: () => "xx-XX" }).code).toBe("ro-RO")
    expect(dictationLanguage({ getItem: () => "en-US" }).code).toBe("en-US")
  })
  test("comutarea face ocolul listei", () => {
    expect(nextDictationLanguage("ro-RO").code).toBe("en-US")
    expect(nextDictationLanguage("en-US").code).toBe("ro-RO")
  })
})

describe("text", () => {
  test("spatiu doar cand e nevoie", () => {
    expect(spacedDictationText("", "salut")).toBe("salut")
    expect(spacedDictationText("salut", "lume")).toBe(" lume")
    expect(spacedDictationText("salut ", "lume")).toBe("lume")
    expect(spacedDictationText("salut\n", "lume")).toBe("lume")
    expect(spacedDictationText("salut", " lume")).toBe(" lume")
  })
  test("erori fatale", () => {
    expect(isFatalDictationError("not-allowed")).toBe(true)
    expect(isFatalDictationError("no-speech")).toBe(false)
  })
  test("constructorul prefixat e gasit", () => {
    expect(speechRecognitionConstructor({})).toBeUndefined()
    expect(speechRecognitionConstructor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(speechRecognitionConstructor({ SpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
  })
})

describe("sesiunea de dictare", () => {
  test("porneste cu limba aleasa, continuu si cu rezultate provizorii", () => {
    const { dictation, log } = setup("ro-RO")
    dictation.start()
    const [session] = FakeRecognition.instances
    expect(session.started && session.lang === "ro-RO" && session.continuous && session.interimResults).toBe(true)
    expect(log.listening).toEqual([true])
    expect(dictation.listening()).toBe(true)
  })

  test("textul provizoriu nu devine text final", () => {
    const { dictation, log } = setup()
    dictation.start()
    const [session] = FakeRecognition.instances
    session.say("salut vreau", false)
    expect(log.text).toEqual([])
    expect(log.interim.at(-1)).toBe("salut vreau")
    session.say("  salut, vreau un raport  ", true)
    expect(log.text).toEqual(["salut, vreau un raport"])
    expect(log.interim.at(-1)).toBe("")
  })

  test("tacerea nu opreste dictarea: sesiunea se reia singura", async () => {
    let clock = 0
    const { dictation, log } = setup("ro-RO", () => clock)
    dictation.start()
    clock = 5000
    FakeRecognition.instances[0].onend?.()
    await tick()
    expect(FakeRecognition.instances.length).toBe(2)
    expect(FakeRecognition.instances[1].started).toBe(true)
    expect(dictation.listening()).toBe(true)
    expect(log.errors).toEqual([])
  })

  test("sesiuni care se inchid imediat de 3 ori: se opreste cu eroare", async () => {
    const { dictation, log } = setup()
    dictation.start()
    for (let i = 0; i < 3; i++) {
      FakeRecognition.instances.at(-1)!.onend?.()
      await tick()
    }
    expect(dictation.listening()).toBe(false)
    expect(log.errors).toEqual(["network"])
    expect(FakeRecognition.instances.length).toBe(3)
  })

  test("eroare fatala (microfon interzis) opreste si anunta", () => {
    const { dictation, log } = setup()
    dictation.start()
    FakeRecognition.instances[0].onerror?.({ error: "not-allowed" })
    expect(dictation.listening()).toBe(false)
    expect(log.errors).toEqual(["not-allowed"])
    expect(log.listening).toEqual([true, false])
  })

  test("eroare nefatala (fara voce) e ignorata", () => {
    const { dictation, log } = setup()
    dictation.start()
    FakeRecognition.instances[0].onerror?.({ error: "no-speech" })
    expect(dictation.listening()).toBe(true)
    expect(log.errors).toEqual([])
  })

  test("oprirea de catre utilizator nu reia sesiunea", async () => {
    const { dictation } = setup()
    dictation.start()
    dictation.stop()
    await tick()
    expect(FakeRecognition.instances.length).toBe(1)
    expect(dictation.listening()).toBe(false)
  })

  test("schimbarea limbii reia imediat cu limba noua, fara sa numere ca esec", async () => {
    const { dictation, lang } = setup("ro-RO")
    dictation.start()
    for (let i = 0; i < 4; i++) {
      lang.value = lang.value === "ro-RO" ? "en-US" : "ro-RO"
      dictation.restart()
      await tick()
    }
    expect(dictation.listening()).toBe(true)
    expect(FakeRecognition.instances.length).toBe(5)
    expect(FakeRecognition.instances.at(-1)!.lang).toBe("ro-RO")
    expect(FakeRecognition.instances.at(-1)!.started).toBe(true)
  })

  test("toggle porneste si opreste", () => {
    const { dictation } = setup()
    dictation.toggle()
    expect(dictation.listening()).toBe(true)
    dictation.toggle()
    expect(dictation.listening()).toBe(false)
  })

  test("fara suport in browser nu porneste nimic", () => {
    const dictation = createDictation({
      language: () => "ro-RO",
      onText: () => {},
      onInterim: () => {},
      onListening: () => {},
      onError: () => {},
      recognition: undefined,
    })
    // fara constructor explicit se cauta in globalThis (aici lipseste)
    if (!dictation.supported) {
      dictation.start()
      expect(dictation.listening()).toBe(false)
    }
  })
})
